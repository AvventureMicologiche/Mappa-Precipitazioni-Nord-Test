/**
 * check-confini.js — due reti diverse, lo stesso cielo: sono d'accordo?
 *
 * DA LANCIARE A MANO (non è in nessun workflow):
 *     node .github/scripts/check-confini.js svizzera
 *     node .github/scripts/check-confini.js emilia-piemonte
 *     node .github/scripts/check-confini.js --lista
 *     GIORNI=60 MAX_KM=15 node .github/scripts/check-confini.js svizzera
 *
 * PERCHÉ ESISTE (4 agosto 2026). Ogni regione della mappa arriva da una rete
 * diversa, con la sua ricetta: finestra oraria, soglia di completezza, unità,
 * arrotondamenti. Se una di quelle ricette è sbagliata — la finestra sfasata di
 * sei ore, per dire — il singolo collector non se ne accorge: i suoi numeri
 * restano interni e coerenti. Si vede solo al confine, dove due reti misurano
 * la STESSA pioggia e devono dire la stessa cosa.
 *
 * Il controllo era già stato fatto due volte a mano (Emilia↔Piemonte a luglio,
 * Italia↔Svizzera il 4 agosto). Questo script è quella procedura messa in
 * forma stabile, così il prossimo confine costa un comando invece di mezz'ora.
 *
 * COME LEGGERE L'OUTPUT. Il numero che conta è "scarto medio": quanto un lato
 * sta sopra l'altro, mediato su tutti i confronti. Vicino a zero e con la
 * percentuale "A più alta" intorno al 50% = le due reti raccontano lo stesso
 * cielo. Uno scarto costante di un segno solo, invece, è la firma di una
 * ricetta diversa e va indagato nel collector.
 *
 * Il "divario medio in valore assoluto" è tutt'altra cosa e NON è un difetto:
 * su un temporale estivo due pluviometri a 10 km danno numeri lontanissimi.
 * Serve solo a dare la scala del rumore contro cui va letto lo scarto medio.
 *
 * ATTENZIONE ai due filtri, che non sono cosmetici:
 *  - il dislivello massimo (MAX_DQ) evita di scambiare l'orografia per un bias:
 *    una stazione di fondovalle e una di cresta a 8 km misurano davvero cose
 *    diverse, e senza filtro il confine risulterebbe sbilanciato sempre;
 *  - la soglia mm (SOGLIA) butta via i giorni asciutti da entrambi i lati, che
 *    sono la maggioranza e diluirebbero qualsiasi segnale a zero.
 *
 * IL DISLIVELLO NON È SEMPRE DISPONIBILE. Piemonte, Friuli-OSMER e tutte le
 * reti MeteoHub non pubblicano la quota (`q` vale 0 per ogni stazione). Se si
 * lasciasse lavorare il filtro lo stesso, `|0 − q| <= MAX_DQ` diventerebbe
 * "tieni solo le stazioni BASSE del lato che la quota ce l'ha": un campione
 * scelto male e per giunta in silenzio — sul confine Emilia↔Piemonte riduceva
 * le coppie da 19 a 2, tutte di fondovalle. Quando un lato non ha quote il
 * filtro si spegne e lo dice; l'orografia va allora tenuta a mente leggendo le
 * coppie, non delegata al programma.
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const DATA_ALT  = process.env.DATA_ALT || '';   // radice dati secondaria (repo di test)

const MAX_KM = Number(process.env.MAX_KM || 20);   // distanza massima fra le due stazioni di una coppia
const MAX_DQ = Number(process.env.MAX_DQ || 300);  // dislivello massimo, metri
const GIORNI = Number(process.env.GIORNI || 30);
const SOGLIA = Number(process.env.SOGLIA || 1);    // mm minimi da un lato perché il giorno conti

/**
 * I confini già noti. `lati` sono due gruppi di cartelle sotto data/: ogni
 * gruppo è un "paese" e le coppie si formano solo fra gruppi diversi, mai
 * dentro lo stesso. Le sotto-fonti di un lato (Svizzera = MeteoSwiss + OASI)
 * si dichiarano con `separa`, così l'esito viene rotto per fonte: se sbanda
 * una sola delle due pipeline, mediarle insieme la nasconderebbe.
 */
const CONFINI = {
  'svizzera': {
    titolo: 'Italia ↔ Svizzera',
    lati: [
      { nome: 'CH', dirs: ['svizzera', 'ticino'], separa: { svizzera: 'MeteoSwiss', ticino: 'OASI-Ticino' } },
      { nome: 'IT', dirs: ['valledaosta-cf', 'piemonte', 'lombardia', 'trentino', 'altoadige'] },
    ],
  },
  'emilia-piemonte': {
    titolo: 'Emilia ↔ Piemonte',
    lati: [
      { nome: 'Emilia',   dirs: ['emilia'] },
      { nome: 'Piemonte', dirs: ['piemonte'] },
    ],
  },
  'emilia-liguria': {
    titolo: 'Emilia ↔ Liguria',
    lati: [
      { nome: 'Emilia',  dirs: ['emilia'] },
      { nome: 'Liguria', dirs: ['liguria'] },
    ],
  },
  'toscana-emilia': {
    titolo: 'Toscana ↔ Emilia',
    lati: [
      { nome: 'Toscana', dirs: ['toscana'] },
      { nome: 'Emilia',  dirs: ['emilia'] },
    ],
  },
  'lombardia-trentino': {
    titolo: 'Lombardia ↔ Trentino',
    lati: [
      { nome: 'Lombardia', dirs: ['lombardia'] },
      { nome: 'Trentino',  dirs: ['trentino'] },
    ],
  },
  // Il confronto più stringente dopo le gemelle: uno dei DUE confini dove
  // entrambi i lati pubblicano la QUOTA (l'altro è slovenia-austria, dal
  // 12/8/2026), quindi il filtro dislivello lavora davvero invece di spegnersi
  // da solo. Dal 7/8/2026 l'Austria è in produzione: niente più DATA_ALT.
  'altoadige-tirolo': {
    titolo: 'Alto Adige ↔ Austria (Tirolo/Salisburgo/Carinzia)',
    lati: [
      { nome: 'Austria', dirs: ['austria'] },
      { nome: 'IT',      dirs: ['altoadige', 'trentino', 'friuli-osmer', 'veneto'] },
    ],
  },
  // Slovenia ↔ Austria (12/8/2026). Il SECONDO confine con la quota su
  // entrambi i lati, ed è la stessa misura che ha validato la ricetta slovena
  // in fase di studio (correlazione oraria e giornaliera contro l'Austria):
  // qui diventa un controllo ripetibile invece di un'analisi una tantum.
  // Le due reti sono indipendenti davvero — ARSO mezz'orario CET fisso contro
  // GeoSphere orario — quindi uno scarto costante di un segno solo
  // smaschererebbe una finestra sfasata da una parte o dall'altra.
  'slovenia-austria': {
    titolo: 'Slovenia ↔ Austria (Carinzia/Stiria)',
    lati: [
      { nome: 'Slovenia', dirs: ['slovenia'] },
      { nome: 'Austria',  dirs: ['austria'] },
    ],
  },
  // Slovenia ↔ Friuli. In mappa i due si toccano (160 stazioni insieme, la
  // heatmap attraversa il confine), quindi vale la pena sorvegliarlo.
  // ⚠️ L'OSMER non pubblica la quota: qui il filtro dislivello SI SPEGNE da
  // solo e lo dichiara. L'orografia va tenuta a mente leggendo le coppie —
  // il confine è breve e va dal Collio (poche decine di metri) alle Alpi
  // Giulie, quindi due stazioni vicine possono essere molto diverse.
  'slovenia-friuli': {
    titolo: 'Slovenia ↔ Friuli Venezia Giulia',
    lati: [
      { nome: 'Slovenia', dirs: ['slovenia'] },
      { nome: 'Friuli',   dirs: ['friuli-osmer'] },
    ],
  },
};

/**
 * Da quando lo storico di ogni regione è considerato affidabile (le date
 * "Dati corretti da" delle schede in CLAUDE.md). Il confronto si ferma alla
 * più tarda fra le regioni coinvolte.
 *
 * Non è pignoleria: con la finestra piena di 120 giorni il confine
 * Emilia↔Liguria risultava sbilanciato al 67%, con 39 stazioni su 45 dallo
 * stesso lato — sembrava un collector rotto. Erano invece i giorni emiliani
 * precedenti al 5/6/2026, dove l'evento dell'1-2 giugno è sul giorno
 * sbagliato e quasi raddoppiato. Tagliando lì: +0,96 mm e 58%. Uno strumento
 * che pesca in acque dichiarate torbide accusa gli innocenti.
 */
const AFFIDABILE_DA = {
  lombardia: '2026-01-01', ticino: '2026-03-18', emilia: '2026-06-05',
  veneto: '2026-06-04', altoadige: '2026-06-04', trentino: '2026-06-06',
  piemonte: '2026-06-12', liguria: '2026-06-19', toscana: '2026-07-12',
  'valledaosta-cf': '2026-07-16', 'friuli-osmer': '2026-07-18',
  // Austria: il backfill GeoSphere è fatto di dati REALI di stazione fin dal
  // primo giorno (non stime), quindi non c'è una data prima della quale
  // diffidare — vale tutto lo storico disponibile.
  austria: '2025-08-05',
  svizzera: '2025-08-04', // backfill dagli archivi MeteoSwiss: reale da subito
  // Slovenia: come l'Austria, il backfill ARSO è fatto di mezz'ore REALI di
  // stazione dal primo giorno (mai stime), quindi vale tutto lo storico.
  slovenia: '2025-08-11',
};

function distanzaKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Cartella dei dati di una regione, con radice secondaria di riserva.
 * Le fonti ancora in pilota vivono nel repo di test (oggi l'Austria): senza
 * questa via d'uscita il confine Alto Adige↔Tirolo non si potrebbe misurare
 * finché l'Austria non è promossa in produzione — cioè proprio quando la
 * misura servirebbe per decidere se promuoverla.
 *   DATA_ALT="…\Mappa-Precipitazioni-Nord-Test\data" node check-confini.js altoadige-tirolo
 */
function cartellaDi(dir) {
  const p1 = path.join(DATA_ROOT, dir);
  if (fs.existsSync(p1)) return p1;
  if (DATA_ALT) {
    const p2 = path.join(DATA_ALT, dir);
    if (fs.existsSync(p2)) return p2;
  }
  return p1;
}

function leggiGiorno(dir, giorno) {
  const f = path.join(cartellaDi(dir), giorno + '.json');
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(j.stations) ? j : null;
  } catch { return null; }
}

/**
 * Le stime Open-Meteo si annunciano a DUE livelli e vanno scartate entrambe,
 * altrimenti si finisce a misurare il modello invece del confine.
 *  - per stazione: `om: true` o `src` con open-meteo, quando il gapfill ha
 *    tappato solo i buchi dentro una giornata altrimenti reale;
 *  - per FILE: `source: open-meteo-backfill-*` / `open-meteo-archive`, cioè
 *    tutto il giorno è stimato. È il caso più insidioso perché le singole
 *    stazioni non portano nessun contrassegno: la Toscana è backfill fino
 *    all'11 luglio 2026, l'Emilia fino al 2 maggio, e senza questo controllo
 *    entravano nel confronto travestite da dato reale.
 */
function fileStimato(j) { return /open-meteo/.test(j.source || ''); }
function eStima(s) { return s.om === true || /open-meteo/.test(s.src || ''); }

function nomeFonte(lato, dir) { return (lato.separa && lato.separa[dir]) || lato.nome; }

// ── Argomenti ─────────────────────────────────────────────────────────────
const arg = (process.argv[2] || '').replace(/^--/, '');
if (!arg || arg === 'lista' || arg === 'help') {
  console.log('Confini disponibili:');
  for (const [k, v] of Object.entries(CONFINI)) console.log(`  ${k.padEnd(20)} ${v.titolo}`);
  console.log('\nEsempio:  node .github/scripts/check-confini.js emilia-piemonte');
  console.log('Variabili: GIORNI (30)  MAX_KM (20)  MAX_DQ (300)  SOGLIA (1)');
  process.exit(0);
}
const conf = CONFINI[arg];
if (!conf) { console.error(`Confine "${arg}" sconosciuto. Lancia con --lista per vederli.`); process.exit(1); }

const [latoA, latoB] = conf.lati;

// ── Giorni da esaminare ───────────────────────────────────────────────────
// Il calendario si prende dalla prima cartella del lato A e si scarta l'ultimo
// giorno: è quello in corso, ancora a metà raccolta, e falserebbe tutto.
const cartellaCal = latoA.dirs[0];
// La soglia si applica REGIONE PER REGIONE, non a tutto il confronto: tagliare
// la finestra intera alla data più tarda buttava via mesi di dati sani. Sul
// confine svizzero, per dire, la sola Valle d'Aosta (affidabile dal 16 luglio)
// riduceva 120 giorni a 18, pur essendo uno dei cinque lati italiani.
const giorni = fs.readdirSync(cartellaDi(cartellaCal))
  .filter(f => f.endsWith('.json'))
  .map(f => f.slice(0, 10))
  .sort()
  .slice(0, -1)                       // via il giorno in corso, ancora a metà raccolta
  .slice(-GIORNI);

if (giorni.length === 0) { console.error(`Nessun dato in data/${cartellaCal}.`); process.exit(1); }
const rif = giorni[giorni.length - 1];

// ── Coppie transfrontaliere, costruite una volta sull'ultimo giorno buono ──
function stazioniDi(lato, giorno) {
  const out = [];
  for (const dir of lato.dirs) {
    const j = leggiGiorno(dir, giorno);
    if (!j) continue;
    for (const s of j.stations) {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      out.push({ ...s, dir });
    }
  }
  return out;
}

const stazA = stazioniDi(latoA, rif);
const stazB = stazioniDi(latoB, rif);
if (!stazA.length || !stazB.length) { console.error(`Manca il giorno di riferimento ${rif} su un lato.`); process.exit(1); }

// Il filtro dislivello vale solo se ENTRAMBI i lati pubblicano la quota: con
// un lato a zero selezionerebbe le stazioni basse dell'altro invece di
// appaiare quote simili. Meglio spento e dichiarato che acceso e bugiardo.
const quoteA = stazA.some(s => s.q > 0);
const quoteB = stazB.some(s => s.q > 0);
const filtroQuota = quoteA && quoteB;

const coppie = [];
for (const a of stazA) {
  for (const b of stazB) {
    const d = distanzaKm(a, b);
    if (d > MAX_KM) continue;
    if (filtroQuota && Math.abs(a.q - b.q) > MAX_DQ) continue;
    coppie.push({ fonte: nomeFonte(latoA, a.dir), a, b, km: d });
  }
}

console.log(`=== ${conf.titolo} — coerenza al confine ===\n`);
console.log(`Finestra: ${giorni[0]} → ${rif}  (${giorni.length} giorni)`);
console.log(`Coppia valida: entro ${MAX_KM} km${filtroQuota ? ` e ${MAX_DQ} m di dislivello` : ''}.`);
console.log(`Giorno valido: almeno ${SOGLIA} mm da un lato, e nessuna delle due stimata.`);
if (!filtroQuota) {
  const muto = !quoteA ? latoA.nome : latoB.nome;
  console.log(`\n⚠️  FILTRO DISLIVELLO SPENTO: ${muto} non pubblica la quota delle stazioni.`);
  console.log(`   Le coppie appaiano solo per distanza, quindi fondovalle e crinale possono`);
  console.log(`   finire insieme. Prima di gridare al bias, guarda dove stanno le stazioni.`);
}
console.log('');

if (!coppie.length) {
  console.log('Nessuna coppia trovata: i due lati non si toccano entro i limiti dati.');
  console.log('Prova ad allargare MAX_KM o MAX_DQ.');
  process.exit(0);
}

console.log(`Coppie: ${coppie.length}`);
for (const f of [...new Set(coppie.map(c => c.fonte))]) {
  const sel = coppie.filter(c => c.fonte === f);
  const nA = new Set(sel.map(c => c.a.id)).size, nB = new Set(sel.map(c => c.b.id)).size;
  console.log(`  ${f.padEnd(14)} ${String(sel.length).padStart(4)} coppie  (${nA} stazioni ${latoA.nome} × ${nB} ${latoB.nome})`);
}

// ── Confronto giorno per giorno ───────────────────────────────────────────
const perFonte = {};
const perCoppia = new Map();
const perStazione = new Map();
const perGiorno = {};
const giorniStimati = new Set();
const giorniInaffidabili = new Set();
let scartatiStima = 0;

for (const g of giorni) {
  const mappe = {};
  for (const dir of [...latoA.dirs, ...latoB.dirs]) {
    if (AFFIDABILE_DA[dir] && g < AFFIDABILE_DA[dir]) { giorniInaffidabili.add(dir + ' ' + g); continue; }
    const j = leggiGiorno(dir, g);
    if (!j) continue;
    if (fileStimato(j)) { giorniStimati.add(dir + ' ' + g); continue; }
    mappe[dir] = new Map(j.stations.map(s => [s.id, s]));
  }

  for (const c of coppie) {
    const a = mappe[c.a.dir]?.get(c.a.id);
    const b = mappe[c.b.dir]?.get(c.b.id);
    if (!a || !b || typeof a.mm !== 'number' || typeof b.mm !== 'number') continue;
    // Una stima Open-Meteo confrontata con un dato reale misura il modello,
    // non il confine: sarebbe il difetto sbagliato da trovare.
    if (eStima(a) || eStima(b)) { scartatiStima++; continue; }
    if (a.mm < SOGLIA && b.mm < SOGLIA) continue;

    const diff = a.mm - b.mm;
    const f = perFonte[c.fonte] ||= { n: 0, aAlta: 0, pari: 0, sommaA: 0, sommaB: 0, diffAss: 0, casi: [] };
    f.n++; f.sommaA += a.mm; f.sommaB += b.mm; f.diffAss += Math.abs(diff);
    if (Math.abs(diff) < 0.15) f.pari++; else if (diff > 0) f.aAlta++;
    f.casi.push({ g, na: a.n, nb: b.n, mmA: a.mm, mmB: b.mm, diff, km: c.km });

    const k = c.a.id + '|' + c.b.id;
    const pc = perCoppia.get(k) || { fonte: c.fonte, na: a.n, nb: b.n, km: c.km, n: 0, somma: 0 };
    pc.n++; pc.somma += diff; perCoppia.set(k, pc);

    const ps = perStazione.get(c.a.id) || { n: a.n, conf: 0, somma: 0 };
    ps.conf++; ps.somma += diff; perStazione.set(c.a.id, ps);

    const pg = perGiorno[g] ||= { n: 0, somma: 0 };
    pg.n++; pg.somma += diff;
  }
}

const totale = Object.values(perFonte).reduce((a, f) => a + f.n, 0);
if (!totale) {
  console.log('\nNessun confronto utile: nella finestra non ha piovuto abbastanza su nessuna coppia.');
  console.log('Allarga GIORNI oppure abbassa SOGLIA.');
  process.exit(0);
}
if (scartatiStima) console.log(`\n(${scartatiStima} confronti scartati: una delle due stazioni era una stima Open-Meteo.)`);
if (giorniInaffidabili.size) {
  const per = {};
  for (const v of giorniInaffidabili) { const d = v.split(' ')[0]; per[d] = (per[d] || 0) + 1; }
  console.log('(giornate saltate perche' + String.fromCharCode(39) + ' precedenti alla data in cui la regione e' + String.fromCharCode(39) + ' dichiarata affidabile: ' + Object.entries(per).map(([d, n]) => d + ' ' + n).join(', ') + ')');
}
if (giorniStimati.size) {
  const per = {};
  for (const v of giorniStimati) { const d = v.split(' ')[0]; per[d] = (per[d] || 0) + 1; }
  console.log(`(giornate intere saltate perché di backfill Open-Meteo: ${Object.entries(per).map(([d, n]) => d + ' ' + n).join(', ')})`);
}

console.log(`\n=== ESITO  (positivo = ${latoA.nome} più alta) ===`);
for (const [fonte, f] of Object.entries(perFonte)) {
  const nonPari = f.n - f.pari || 1;
  const pct = 100 * f.aAlta / nonPari;
  const scarto = (f.sommaA - f.sommaB) / f.n;
  // Non e' un verdetto: e' un campanello. Prima di dare la colpa a un
  // collector si guarda il bilancio per stazione più sotto — su Emilia
  // ↔Liguria questa riga dice 67% e le stazioni si dividono 11 a 10.
  const verdetto = (pct >= 65 || pct <= 35) ? '⚠️  guardare il bilancio per stazione qui sotto'
                 : (pct >= 58 || pct <= 42) ? '~ leggera pendenza'
                 : '✓ equilibrato';
  console.log(`\n${fonte}`);
  console.log(`  confronti utili: ${f.n}   (di cui ${f.pari} sostanzialmente pari)`);
  console.log(`  media ${latoA.nome}: ${(f.sommaA / f.n).toFixed(2)} mm   media ${latoB.nome}: ${(f.sommaB / f.n).toFixed(2)} mm`);
  console.log(`  scarto medio: ${(scarto > 0 ? '+' : '') + scarto.toFixed(2)} mm`);
  console.log(`  ${latoA.nome} più alta nel ${pct.toFixed(0)}% dei confronti non pari   ${verdetto}`);
  console.log(`  divario medio in valore assoluto: ${(f.diffAss / f.n).toFixed(2)} mm  (rumore di fondo, non un difetto)`);
  console.log('  scarti più grossi:');
  for (const t of f.casi.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 5)) {
    console.log(`    ${t.g}  ${t.na} ${t.mmA} vs ${t.nb} ${t.mmB}   (${t.diff > 0 ? '+' : ''}${t.diff.toFixed(1)} mm, ${t.km.toFixed(1)} km)`);
  }
}

// ── Il controllo che distingue la ricetta dalla geografia ─────────────────
// La percentuale "A più alta" conta i CONFRONTI, e i confronti non pesano
// uguale: una stazione molto piovosa che si accoppia con cinque vicini più
// asciutti produce cinque risultati positivi da sola. Basta che il lato A
// abbia qualche stazione dentro un massimo pluviometrico e la percentuale
// schizza, senza che nessun collector abbia sbagliato niente.
// Il test vero e' contare le STAZIONI: se pendono tutte dallo stesso lato e'
// la ricetta, se si dividono a meta' e' la montagna.
const staz = [...perStazione.values()].filter(s => s.conf >= 8).map(s => ({ ...s, media: s.somma / s.conf }));
if (staz.length >= 4) {
  const su = staz.filter(s => s.media > 0).length;
  const giu = staz.length - su;
  const quota = 100 * su / staz.length;
  console.log(`\n=== BILANCIO PER STAZIONE DEL LATO ${latoA.nome} (min 8 confronti) ===`);
  console.log(`  ${su} stazioni leggono più alto dei vicini, ${giu} più basso  (${quota.toFixed(0)}% in positivo)`);
  console.log(`  ${(quota >= 25 && quota <= 75)
    ? '✓ si dividono: il divario è geografia, non ricetta — anche se la percentuale sui confronti è alta'
    : '⚠️  pendono quasi tutte dallo stesso lato: QUESTO sì che indica un problema di ricetta'}`);
  const ord = staz.sort((a, b) => b.media - a.media);
  const mostra = s => `${s.n} ${(s.media > 0 ? '+' : '') + s.media.toFixed(2)}`;
  console.log(`  più alte:  ${ord.slice(0, 3).map(mostra).join('  |  ')}`);
  console.log(`  più basse: ${ord.slice(-3).map(mostra).join('  |  ')}`);
}

console.log('\n=== COPPIE PIÙ SBILANCIATE (media, almeno 5 confronti) ===');
const sbil = [...perCoppia.values()].filter(c => c.n >= 5)
  .map(c => ({ ...c, media: c.somma / c.n }))
  .sort((a, b) => Math.abs(b.media) - Math.abs(a.media)).slice(0, 10);
if (!sbil.length) console.log('  (nessuna coppia arriva a 5 confronti: finestra troppo asciutta)');
for (const c of sbil) {
  console.log(`  ${((c.media > 0 ? '+' : '') + c.media.toFixed(2)).padStart(7)} mm/g   ${c.na} ↔ ${c.nb}   (${c.km.toFixed(1)} km, ${c.n} conf., ${c.fonte})`);
}
console.log('  Una singola coppia sbilanciata è quasi sempre orografia o una cella isolata.');
console.log('  Il sospetto vero nasce quando SBANDA TUTTA LA COLONNA nello stesso verso.');

console.log(`\n=== SCARTO MEDIO GIORNO PER GIORNO (${latoA.nome} − ${latoB.nome}) ===`);
for (const [g, v] of Object.entries(perGiorno)) {
  const m = v.somma / v.n;
  console.log(`  ${g}  ${((m > 0 ? '+' : '') + m.toFixed(2)).padStart(7)} mm  ${String(v.n).padStart(4)} conf.  ${'█'.repeat(Math.min(30, Math.round(Math.abs(m) * 4)))}`);
}
console.log('  Il segno che cambia di continuo è meteo. Il segno sempre uguale è una ricetta sbagliata.');
