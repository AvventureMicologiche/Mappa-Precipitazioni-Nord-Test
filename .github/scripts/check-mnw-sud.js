#!/usr/bin/env node
/**
 * check-mnw-sud.js — un TESTIMONE indipendente per le regioni MeteoHub (20/8/2026).
 *
 * PERCHE' ESISTE. Per le dieci regioni `dpcn-*` del centro-sud MeteoHub e' la
 * nostra UNICA fonte. Se pubblica un valore inventato finisce in mappa e non se
 * ne accorge nessuno: al Veneto un 36,4 mm fasullo e' saltato fuori solo perche'
 * avevamo ARPAV a smentirlo (bug #20, 19/8/2026). Al sud quel confronto non
 * esiste, e serve qualcuno che guardi la stessa pioggia da un'altra parte.
 *
 * IL TESTIMONE. La rete `mnw` (MeteoNetwork) ha ~930 pluviometri AMATORIALI su
 * tutta Italia, orari, sullo stesso MeteoHub. Come DATO li abbiamo scartati
 * (senza nome vero ne' quota, qualita' non garantita), ma come CONTROLLO vanno
 * benissimo: non serve che siano precisi al decimo, serve che dicano se in quella
 * zona e' piovuto oppure no. E' lo stesso metodo delle stazioni gemelle che ha
 * promosso il Friuli e bocciato la pioggia toscana.
 *
 * ⚠️ NON E' UN FILTRO E NON DEVE DIVENTARLO. Non tocca un solo dato: scrive un
 * registro e stampa un riassunto. Le piogge isolate NON sono di per se' sospette:
 * contate su 45 giorni (19/8/2026) le stazioni bagnate coi vicini asciutti sono
 * altrettanto frequenti nelle regioni a fonte diretta (Alto Adige 178 ogni
 * 10.000 stazioni-giorno, Friuli 120, Ticino 99) quanto in quelle MeteoHub
 * (Basilicata 187, Lazio 57, Sicilia 20): sono temporali estivi veri, ed e' il
 * fenomeno che la mappa deve mostrare. Scartarli sarebbe peggio del male.
 * Qui si segnala solo cio' che DUE fonti indipendenti raccontano in modo
 * incompatibile, e la decisione resta a una persona.
 *
 * COSA SEGNALA, per ogni stazione nostra con almeno MIN_TESTIMONI mnw vicine:
 *   BAGNATO_SOLO_NOI  noi >= MM_FORTE e TUTTI i testimoni sotto MM_ASCIUTTO
 *   ASCIUTTO_SOLO_NOI noi <= MM_ASCIUTTO e la MEDIANA dei testimoni >= MM_FORTE
 * e per ognuna dice CHI e' fuori dal coro, guardando anche i NOSTRI vicini:
 *   [stazione] i nostri vicini danno ragione ai testimoni, quindi e' quella
 *              stazione a sbagliare (pluviometro fermo o tarato male). E' il
 *              caso piu' comune e il piu' facile da chiudere: si esclude.
 *              Esempio vero, 12/8: Ponte S.Maria (Umbria) 0 mm mentre i nostri
 *              vicini a 5 e 6 km segnavano 10 e 21 mm.
 *   [rete]     i nostri vicini danno ragione a noi e i testimoni dicono
 *              un'altra cosa: il disaccordo riguarda l'intera zona. Piu' raro
 *              e piu' serio, perche' e' la forma che avrebbe un errore di
 *              MeteoHub, cioe' proprio cio' che al sud nessun altro vedrebbe.
 * piu' due indicatori d'insieme per regione: quante coppie concordano sul
 * bagnato/asciutto e il rapporto mediano fra i nostri mm e quelli dei testimoni
 * (un rapporto stabilmente lontano da 1 e' il sintomo di una sottostima
 * sistematica, cioe' proprio la forma che aveva il bug #20).
 *
 * PRIMA DI GIUDICARE si pesano i testimoni: quelli che contraddicono la zona
 * giorno dopo giorno vengono squalificati (blocco REPUTAZIONE DEI TESTIMONI
 * piu' sotto). Sul primo giro lungo quasi meta' delle segnalazioni "di zona"
 * veniva da quattro pluviometri amatoriali sballati attorno a Osimo.
 *
 * E QUANDO LE DUE FONTI RESTANO IN DISACCORDO si chiama un ARBITRO di fuori,
 * l'archivio Open-Meteo (blocco IL TERZO TESTIMONE): gratis, senza chiave, e
 * la sua risposta va letta in modo asimmetrico perche' e' un modello, non un
 * pluviometro. Si spegne con SENZA_TERZA=1.
 *
 * USO:
 *   node .github/scripts/check-mnw-sud.js [DA A]
 *   senza date: gli ultimi 8 giorni (finestra pubblica, non serve l'account).
 *   con MH_USER/MH_PASS si va piu' indietro.
 *   DATA_ROOT=<cartella data> per leggere i dati di un altro repo.
 */
const fs = require('fs'), path = require('path');

const BASE = 'https://meteohub.agenziaitaliameteo.it';
// DATA_ROOT: i dati del centro-sud vivono nel repo di PRODUZIONE (i cron del
// test sono spenti da agosto e le sue cartelle meteohub-* sono ferme al 31/7).
// Per il collaudo si punta la' senza spostare niente.
const DATA = process.env.DATA_ROOT || path.join(__dirname, '..', '..', 'data');
// Il registro sta SEMPRE nel repo che ospita il controllore, anche quando i
// dati arrivano da un'altra cartella: con DATA_ROOT puntato altrove, scriverlo
// accanto ai dati significherebbe lasciare un file estraneo in quel repo.
const REGISTRO = path.join(__dirname, '..', '..', 'data', 'mnw-check.json');

const RAGGIO_KM      = 10;   // quanto lontano puo' stare un testimone
const MIN_TESTIMONI  = 2;    // sotto questo numero non si giudica
const MM_FORTE       = 5;    // "qui ha piovuto sul serio"
const MM_ASCIUTTO    = 0.5;  // "qui non e' caduto niente"
const MIN_ORE        = 20;   // completezza della giornata del testimone
const GIORNI_DEFAULT = 8;
const RETENTION      = 120;  // giorni di storia tenuti nel registro

const REGIONI = [
  ['meteohub-marche', 'Marche'], ['meteohub-umbria', 'Umbria'],
  ['meteohub-lazio', 'Lazio'], ['meteohub-campania', 'Campania'],
  ['meteohub-puglia', 'Puglia'], ['meteohub-calabria', 'Calabria'],
  ['meteohub-sicilia', 'Sicilia'], ['meteohub-sardegna', 'Sardegna'],
  ['meteohub-basilicata', 'Basilicata'], ['meteohub-molise', 'Molise'],
];

let MH_TOKEN = null;
async function login() {
  const u = (process.env.MH_USER || '').trim(), p = process.env.MH_PASS || '';
  if (!u || !p) return null;
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const t = await r.text();
  if (!r.ok) throw new Error('login HTTP ' + r.status);
  let tok = t.trim();
  try { const j = JSON.parse(t); tok = j.token || j.access_token || j.accessToken || tok; } catch (e) {}
  return tok.replace(/^"|"$/g, '') || null;
}

function offsetIT(d) {
  const y = d.getUTCFullYear();
  const u = m => { const x = new Date(Date.UTC(y, m + 1, 0)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(1, 0, 0, 0); return x; };
  return (d >= u(2) && d < u(9)) ? 2 : 1;
}
function finestra(g) {
  const off = offsetIT(new Date(g + 'T12:00:00Z'));
  const s = new Date(new Date(g + 'T00:00:00Z').getTime() - off * 3600000), e = new Date(s.getTime() + 86400000);
  const q = d => d.toISOString().slice(0, 16).replace('T', ' '), r = d => d.toISOString().slice(0, 19);
  return { qFrom: q(s), qTo: q(e), refFrom: r(s), refTo: r(e) };
}
const km = (a, b) => {
  const R = 6371, dl = (b.lat - a.lat) * Math.PI / 180;
  const dn = (b.lon - a.lon) * Math.PI / 180 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return R * Math.sqrt(dl * dl + dn * dn);
};
const mediana = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Giornate MeteoNetwork: somma oraria per stazione, completezza >= MIN_ORE. */
async function testimoniDelGiorno(g) {
  const w = finestra(g);
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:B13011;license:CCBY_COMPLIANT`;
  const url = `${BASE}/api/observations?networks=mnw&q=${encodeURIComponent(q)}`;
  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
  if (MH_TOKEN) headers['Authorization'] = 'Bearer ' + MH_TOKEN;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (r.ok) {
      const j = await r.json(); const out = [];
      for (const e of (j.data || [])) {
        const st = e.stat || {};
        if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
        let best = null;
        for (const p of (e.prod || [])) if (p.var === 'B13011' && Array.isArray(p.val) && (!best || p.val.length > best.val.length)) best = p;
        if (!best) continue;
        const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
        const ore = new Set(vals.map(v => v.ref.slice(11, 13))).size;
        if (ore < MIN_ORE) continue;                       // giornata bucata: non fa da testimone
        const mm = Math.round(vals.reduce((a, v) => a + v.val, 0) * 10) / 10;
        if (mm < 0 || mm > 400) continue;
        const nome = ((st.details || []).find(x => x.var === 'B01019') || {}).val || '—';
        out.push({ id: nome, lat: st.lat, lon: st.lon, mm });
      }
      return out;
    }
    if (r.status === 401) return null;                     // fuori dalla finestra pubblica
    await new Promise(x => setTimeout(x, 5000 * (i + 1)));
  }
  return null;
}

/**
 * LE STAZIONI GIA' ESCLUSE non si controllano (20/8/2026).
 *
 * Il controllo legge i FILE dei dati, mentre l'esclusione di un pluviometro
 * guasto vive in index.html (MH_ESCLUSE): i suoi zeri falsi restano
 * nell'archivio anche quando la mappa non li disegna piu'. Senza questo,
 * Sellia Superiore continuerebbe a produrre allarmi per sempre, e un allarme
 * su una cosa gia' sistemata e' il modo piu' rapido per smettere di leggere
 * la posta.
 *
 * Si legge la lista da index.html invece di ricopiarla qui: una lista in due
 * posti diverge al primo che ci si dimentica.
 */
function escluse() {
  const fuori = {};
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    const blocco = (html.match(/var\s+MH_ESCLUSE\s*=\s*\{([\s\S]*?)\n\};/) || [])[1];
    if (!blocco) return fuori;
    for (const riga of blocco.split('\n')) {
      const reg = (riga.match(/([a-z]+)\s*:\s*\{/) || [])[1];
      if (!reg) continue;
      const nomi = riga.match(/'([^']+)'\s*:\s*true/g) || [];
      fuori[reg] = fuori[reg] || {};
      for (const n of nomi) fuori[reg][n.match(/'([^']+)'/)[1]] = true;
    }
  } catch (e) { console.warn('Warn: MH_ESCLUSE non letta (' + e.message + ')'); }
  return fuori;
}
const ESCLUSE = escluse();

function leggiNostro(dir, g) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, dir, g + '.json'), 'utf8'));
    const fuori = ESCLUSE[dir.replace('meteohub-', '')] || {};
    // le stime non si giudicano, e nemmeno i pluviometri gia' esclusi dalla mappa
    return (j.stations || []).filter(s => !s.om && typeof s.mm === 'number' && !fuori[s.n]);
  } catch (e) { return null; }
}

/**
 * REPUTAZIONE DEI TESTIMONI (20/8/2026, dopo il primo giro di 45 giorni).
 *
 * PERCHE'. Sul giro lungo 18 delle 39 segnalazioni "di zona" venivano da DUE
 * giorni soli e dagli STESSI quattro pluviometri amatoriali attorno a Osimo:
 * l'11/7 dicevano 0 mentre le nostre nove stazioni E Open-Meteo davano 6-10 mm,
 * il 16/7 dicevano 11 mentre tutti davano 0. Un testimone cosi' non toglie
 * dubbi, li fabbrica.
 *
 * COME. Prima di giudicare si guarda ogni testimone su TUTTA la finestra e si
 * confronta la sua serie con la mediana delle nostre stazioni vicine, provando
 * anche a spostarla di un giorno avanti e indietro:
 *   - contraddice spesso a sfasamento zero ma quasi mai a +1 o -1 giorno
 *     → SFASATO, chiude la giornata a un'altra ora;
 *   - contraddice spesso a qualunque sfasamento → INAFFIDABILE;
 *   - pioggia totale sotto un quarto o sopra il quadruplo di quella intorno
 *     → TARATURA (o sensore intasato).
 * Squalificati questi, si giudica come prima.
 *
 * ⚠️ LA TRAPPOLA, ed e' il motivo per cui questa parte va letta con attenzione:
 * misurare i testimoni contro le NOSTRE stazioni e' circolare. Se fosse
 * MeteoHub a sbagliare su un'intera regione, i testimoni di quella zona
 * sembrerebbero tutti bugiardi e verrebbero zittiti proprio quando hanno
 * ragione. Due difese: la squalifica chiede una contraddizione RIPETUTA nel
 * tempo (>= REP_MIN_CONTRO giorni su >= REP_MIN_GIORNI di storia, un errore
 * isolato non basta), e si stampa sempre l'avviso per regione: se piu' della
 * meta' dei testimoni di una regione risulta sfasata NELLO STESSO VERSO, il
 * sospetto si rovescia e riguarda i NOSTRI dati.
 */
const REP_MIN_GIORNI = 20;   // storia minima per giudicare un testimone
const REP_MIN_CONTRO = 3;    // contraddizioni oltre le quali si squalifica
const REP_RAPP_BASSO = 0.25; // pioggia totale rispetto ai vicini nostri
const REP_RAPP_ALTO  = 4;
const REP_MIN_MM     = 20;   // sotto questa pioggia intorno il rapporto non dice nulla

const chiave = m => m.lat.toFixed(3) + ',' + m.lon.toFixed(3);

/** Contraddizioni forti fra la serie di un testimone e quella dei nostri vicini. */
function contro(serieW, serieN, lag) {
  let n = 0;
  for (let i = 0; i < serieW.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= serieN.length) continue;
    const w = serieW[i], v = serieN[j];
    if (w === null || v === null) continue;
    if (w >= MM_FORTE && v <= MM_ASCIUTTO) n++;
    else if (w <= MM_ASCIUTTO && v >= MM_FORTE) n++;
  }
  return n;
}

function reputazione(giorni, mnwPerGiorno, nostrePerGiorno) {
  const serie = {};   // chiave testimone → {id, w[], n[], reg{}}
  giorni.forEach((g, i) => {
    const nostre = nostrePerGiorno[g] || [];
    for (const m of (mnwPerGiorno[g] || [])) {
      const k = chiave(m);
      if (!serie[k]) serie[k] = { id: m.id, lat: m.lat, lon: m.lon, reg: {},
                                  w: giorni.map(() => null), n: giorni.map(() => null) };
      serie[k].w[i] = m.mm;
      const vic = nostre.filter(s => km(m, s) <= RAGGIO_KM);
      if (vic.length >= 3) {
        serie[k].n[i] = mediana(vic.map(s => s.mm));
        for (const s of vic) serie[k].reg[s._reg] = (serie[k].reg[s._reg] || 0) + 1;
      }
    }
  });

  const squalificati = {}, motivi = { sfasato: [], inaffidabile: [], taratura: [] }, perRegione = {};
  for (const [k, s] of Object.entries(serie)) {
    const utili = s.w.filter((v, i) => v !== null && s.n[i] !== null).length;
    if (utili < REP_MIN_GIORNI) continue;                    // troppo poca storia: si tiene
    // regione = quella da cui vengono piu' vicini nostri
    const nome = Object.entries(s.reg).sort((a, b) => b[1] - a[1])[0][0];
    const P = perRegione[nome] = perRegione[nome] || { valutati: 0, piu: 0, meno: 0 };
    P.valutati++;

    const c0 = contro(s.w, s.n, 0), cPiu = contro(s.w, s.n, 1), cMeno = contro(s.w, s.n, -1);
    const sw = s.w.reduce((a, v, i) => a + (v !== null && s.n[i] !== null ? v : 0), 0);
    const sn = s.n.reduce((a, v, i) => a + (v !== null && s.w[i] !== null ? v : 0), 0);

    if (c0 >= REP_MIN_CONTRO && (cPiu * 3 <= c0 || cMeno * 3 <= c0)) {
      const verso = (cPiu <= cMeno) ? 1 : -1;
      squalificati[k] = 'sfasato';
      motivi.sfasato.push({ id: s.id, c0, verso, utili });
      if (verso > 0) P.piu++; else P.meno++;
    } else if (c0 >= REP_MIN_CONTRO) {
      squalificati[k] = 'inaffidabile';
      motivi.inaffidabile.push({ id: s.id, c0, utili });
    } else if (sn >= REP_MIN_MM && (sw / sn < REP_RAPP_BASSO || sw / sn > REP_RAPP_ALTO)) {
      squalificati[k] = 'taratura';
      motivi.taratura.push({ id: s.id, rap: sw / sn, mm: Math.round(sw), mmVicini: Math.round(sn) });
    }
  }
  return { squalificati, motivi, perRegione, valutati: Object.keys(serie).length };
}

/**
 * LA POSTA (20/8/2026): si scrive solo quando c'e' davvero da leggere.
 *
 * La mail parte SOLO per i casi in cui il terzo testimone da' ragione ai
 * testimoni, cioe' dove manca pioggia ai NOSTRI dati e la cosa e' confermata da
 * una fonte che non c'entra niente. Tutto il resto (le contraddizioni ancora
 * aperte, i temporali isolati, le stazioni sospette) resta nel registro e nel
 * resoconto del run: sono cose da guardare con calma, non allarmi.
 *
 * E parte solo per le NOVITA': un caso gia' scritto nel registro non si
 * rimanda. Con una finestra di 30 giorni ripetuta ogni settimana, senza questo
 * la stessa giornata arriverebbe quattro volte.
 *
 * Meccanica identica ad alert-fonti.js: lo script scrive il messaggio completo
 * in un .eml e il workflow lo spedisce con curl, cosi' la password per le app
 * di Gmail non esce mai dal runner.
 */
// Il messaggio finito NON entra nel repo: si scrive nella cartella temporanea
// (o dove dice EML) e il workflow lo prende da li'. Tenerlo nella radice come
// fa alert-fonti.js vorrebbe dire aggiungere una riga a .gitignore, che sta
// nella cartella del sito e costerebbe un deploy Netlify per niente.
const MAIL_FILE = process.env.EML || path.join(require('os').tmpdir(), 'mnw-mail.eml');

/** Subject con accenti ed emoji: encoded-word base64, spezzato per non sforare i 75 caratteri. */
function encodeSubject(s) {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const chars = [...s];
  const parti = [];
  for (let i = 0; i < chars.length; i += 15) {
    const pezzo = chars.slice(i, i + 15).join('');
    parti.push(`=?UTF-8?B?${Buffer.from(pezzo, 'utf8').toString('base64')}?=`);
  }
  return parti.join('\r\n ');
}

function scriviEml(subject, body) {
  const from = process.env.MAIL_USER || 'alert@example.invalid';
  const to = process.env.MAIL_TO || from;
  const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  fs.writeFileSync(MAIL_FILE, [
    `From: Mappa Precipitazioni <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    ''
  ].join('\r\n'));
}

function output(chiave, valore) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${chiave}=${valore}\n`);
}

const ita = g => g.slice(8, 10) + '/' + g.slice(5, 7);

/** I casi gravi che nel registro non c'erano ancora. */
function novita(reg, gravi) {
  const visti = new Set();
  for (const lista of Object.values((reg && reg.giorni) || {}))
    for (const x of lista) if (x.arbitro === 'testimoni') visti.add(x.g + '|' + x.staz);
  return gravi.filter(x => !visti.has(x.g + '|' + x.staz));
}

function corpoMail(nuovi, aperte, giorniOk) {
  const righe = nuovi.map(x =>
    `  ${ita(x.g)}  ${x.regione} · ${x.staz}\n` +
    `      noi ${x.mm} mm, i testimoni MeteoNetwork ${x.mnwMed}, Open-Meteo ${x.om}`);
  return [
    `Controllo MeteoNetwork, finestra ${ita(giorniOk[0])} - ${ita(giorniOk[giorniOk.length - 1])}.`,
    '',
    nuovi.length === 1 ? 'Un caso nuovo in cui manca pioggia ai nostri dati:'
                       : `${nuovi.length} casi nuovi in cui manca pioggia ai nostri dati:`,
    '',
    ...righe,
    '',
    'Sono i casi in cui due fonti indipendenti fra loro (i pluviometri',
    'amatoriali MeteoNetwork e la rianalisi Open-Meteo) dicono che lì ha',
    'piovuto e noi diamo asciutto. Di solito è un pluviometro fermo: si',
    'guarda la stazione e, se conferma, si esclude come Sellia Superiore.',
    '',
    `Nello stesso giro restano ${aperte.length} contraddizioni aperte, che NON sono`,
    'allarmi: quasi tutte sono nostre stazioni bagnate con i testimoni',
    'asciutti, cioè temporali estivi veri. Stanno nel registro e nel',
    'resoconto del run.',
    '',
    'Nessun dato è stato toccato: questo controllo non corregge niente.'
  ].join('\n');
}

/**
 * IL TERZO TESTIMONE (20/8/2026): l'archivio Open-Meteo come arbitro.
 *
 * PERCHE' NON BASTA LA REPUTAZIONE. Il filtro qui sopra squalifica chi sbaglia
 * di continuo, ma i quattro pluviometri di Osimo che hanno prodotto 18
 * segnalazioni sbagliavano DUE giorni su 45: sotto qualunque soglia sensata.
 * Il loro difetto non era essere cattivi testimoni in generale, era essere
 * tutti d'accordo fra loro nello sbagliare lo stesso giorno, e contro quello
 * nessuna statistica sui testimoni puo' nulla: serve qualcuno di FUORI.
 *
 * COME. Per ogni contraddizione forte si chiede all'archivio Open-Meteo
 * (rianalisi ERA5, gratuita e senza chiave) quanta pioggia dava quel giorno su
 * quelle coordinate. Le chiamate si accorpano: fino a 50 punti per volta e una
 * sola finestra di date, quindi tutte le segnalazioni costano due o tre
 * chiamate in croce.
 *
 * ⚠️ COME SI LEGGE LA SUA RISPOSTA, e non e' simmetrica. ERA5 e' un modello a
 * maglia larga, non un pluviometro: quando dice PIOVUTO e' una prova solida
 * (nessun modello inventa 10 mm dove non e' successo niente), quando dice
 * ASCIUTTO puo' semplicemente non aver visto un temporale isolato, cosa che
 * gli e' gia' successa (Selva di Val Gardena, 2,3 mm contro i 18,9 misurati).
 * Quindi:
 *   noi bagnati, testimoni asciutti  → OM bagnato: ragione a NOI, caso chiuso
 *                                    → OM asciutto: non decide, il caso resta
 *   noi asciutti, testimoni bagnati  → OM bagnato: ragione ai TESTIMONI, e
 *                                      allora e' grave: e' un buco nei dati
 *                                    → OM asciutto: ragione a NOI, caso chiuso
 * Si spegne con SENZA_TERZA=1.
 */
const OM_URL = 'https://archive-api.open-meteo.com/v1/archive';
const OM_LOTTO = 50;     // punti per chiamata
const OM_FORTE = 5;      // mm oltre i quali ERA5 "dice piovuto"
const OM_ASCIUTTO = 1;   // mm sotto i quali "dice asciutto"

async function terzaFonte(segnalazioni, giorni) {
  if (process.env.SENZA_TERZA || !segnalazioni.length) return 0;
  const da = giorni[0], a = giorni[giorni.length - 1];
  // un punto per stazione contestata, non per segnalazione
  const punti = [], indice = {};
  for (const s of segnalazioni) {
    const k = s.lat.toFixed(3) + ',' + s.lon.toFixed(3);
    if (!(k in indice)) { indice[k] = punti.length; punti.push({ lat: s.lat, lon: s.lon }); }
  }
  const serie = new Array(punti.length).fill(null);
  for (let i = 0; i < punti.length; i += OM_LOTTO) {
    const lotto = punti.slice(i, i + OM_LOTTO);
    const url = OM_URL + '?latitude=' + lotto.map(p => p.lat.toFixed(4)).join(',') +
                '&longitude=' + lotto.map(p => p.lon.toFixed(4)).join(',') +
                '&start_date=' + da + '&end_date=' + a +
                '&daily=precipitation_sum&timezone=Europe%2FRome';
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) { console.warn('  terza fonte: HTTP ' + r.status + ', si prosegue senza'); continue; }
      const j = await r.json();
      const arr = Array.isArray(j) ? j : [j];
      arr.forEach((x, n) => {
        const d = x.daily || {}; const m = {};
        (d.time || []).forEach((g, q) => { m[g] = (d.precipitation_sum || [])[q]; });
        serie[i + n] = m;
      });
    } catch (e) { console.warn('  terza fonte: ' + e.message + ', si prosegue senza'); }
    await new Promise(r => setTimeout(r, 1200));
  }

  let decisi = 0;
  for (const s of segnalazioni) {
    const m = serie[indice[s.lat.toFixed(3) + ',' + s.lon.toFixed(3)]];
    const om = m ? m[s.g] : undefined;
    if (om === undefined || om === null) { s.om = null; continue; }
    s.om = om;
    const bagnatoNoi = s.tipo === 'BAGNATO_SOLO_NOI';
    if (om >= OM_FORTE)        s.arbitro = bagnatoNoi ? 'noi' : 'testimoni';
    else if (om <= OM_ASCIUTTO) s.arbitro = bagnatoNoi ? null : 'noi';
    else                        s.arbitro = null;   // fra i due, non decide
    if (s.arbitro) decisi++;
  }
  return decisi;
}

/** Giudica una finestra gia' scaricata. `escludi` = testimoni squalificati. */
function giudica(giorni, mnwPerGiorno, nostrePerRegione, escludi) {
  const segnalazioni = [], perRegione = {}, coppiePerGiorno = {};
  for (const g of giorni) {
    const mnw = (mnwPerGiorno[g] || []).filter(m => !escludi[chiave(m)]);
    let coppieG = 0;
    for (const [nome, nostre] of Object.entries(nostrePerRegione[g] || {})) {
      const R = perRegione[nome] = perRegione[nome] || { coppie: 0, concordiBagnato: 0, concordiAsciutto: 0, rapporti: [] };
      for (const s of nostre) {
        const vicini = mnw.filter(m => km(s, m) <= RAGGIO_KM);
        if (vicini.length < MIN_TESTIMONI) continue;
        coppieG++; R.coppie++;
        const v = vicini.map(m => m.mm);
        const med = mediana(v), max = Math.max(...v);

        // indicatori d'insieme: solo dove almeno una delle due parti dice pioggia
        if (s.mm >= MM_FORTE && med >= MM_FORTE) { R.concordiBagnato++; R.rapporti.push(s.mm / med); }
        else if (s.mm <= MM_ASCIUTTO && med <= MM_ASCIUTTO) R.concordiAsciutto++;

        // contraddizioni forti
        const bagnatoSoloNoi  = s.mm >= MM_FORTE   && max < MM_ASCIUTTO;
        const asciuttoSoloNoi = s.mm <= MM_ASCIUTTO && med >= MM_FORTE;
        if (bagnatoSoloNoi || asciuttoSoloNoi) {
          // Da che parte stanno i NOSTRI vicini? Distingue la stazione rotta
          // (tutti gli altri nostri sono d'accordo coi testimoni) dal caso in
          // cui e' l'intera zona a raccontare un'altra storia.
          const nostriVic = nostre.filter(o => o !== s && km(s, o) <= RAGGIO_KM).map(o => o.mm);
          const nostroMed = nostriVic.length >= 2 ? mediana(nostriVic) : null;
          let chi = 'incerto';
          if (nostroMed !== null) {
            const noiConcordi = bagnatoSoloNoi ? nostroMed >= MM_FORTE : nostroMed <= MM_ASCIUTTO;
            chi = noiConcordi ? 'rete' : 'stazione';
          }
          segnalazioni.push({ g, regione: nome, chi, staz: s.n, mm: s.mm, lat: s.lat, lon: s.lon,
                              tipo: bagnatoSoloNoi ? 'BAGNATO_SOLO_NOI' : 'ASCIUTTO_SOLO_NOI',
                              testimoni: vicini.length, mnwMax: max, mnwMed: med,
                              nostriVicini: nostroMed });
        }
      }
    }
    coppiePerGiorno[g] = coppieG;
  }
  return { segnalazioni, perRegione, coppiePerGiorno };
}

async function main() {
  const date = process.argv.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const giorni = [];
  if (date.length === 2) {
    for (let t = new Date(date[0] + 'T12:00:00Z').getTime(); t <= new Date(date[1] + 'T12:00:00Z').getTime(); t += 86400000)
      giorni.push(new Date(t).toISOString().slice(0, 10));
  } else {
    for (let i = GIORNI_DEFAULT; i >= 1; i--) giorni.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }

  try { MH_TOKEN = await login(); } catch (e) { console.warn('Warn login: ' + e.message); }
  console.log(`=== controllo MeteoNetwork ${giorni[0]} → ${giorni[giorni.length - 1]} ` +
              `(${MH_TOKEN ? 'con account' : 'anonimo'}) ===\n`);

  // ── PASSO 1: si scarica tutta la finestra e si tiene da parte ──────────────
  // La reputazione di un testimone non si puo' misurare un giorno per volta:
  // serve la sua storia intera (vedi il blocco REPUTAZIONE piu' sopra).
  const mnwPerGiorno = {}, nostrePerGiorno = {}, nostrePerRegione = {};
  for (const g of giorni) {
    const mnw = await testimoniDelGiorno(g);
    if (!mnw) { console.log(`${g}  testimoni non disponibili, salto`); continue; }
    mnwPerGiorno[g] = mnw;
    nostrePerRegione[g] = {};
    const flat = [];
    for (const [dir, nome] of REGIONI) {
      const nostre = leggiNostro(dir, g);
      if (!nostre || nostre.length < 10) continue;
      nostre.forEach(s => { s._reg = nome; });
      nostrePerRegione[g][nome] = nostre;
      flat.push(...nostre);
    }
    nostrePerGiorno[g] = flat;
    console.log(`${g}  testimoni ${String(mnw.length).padStart(3)}  nostre ${String(flat.length).padStart(4)}`);
    await new Promise(r => setTimeout(r, 800));
  }
  const giorniOk = giorni.filter(g => mnwPerGiorno[g]);
  if (!giorniOk.length) throw new Error('nessun giorno scaricato');

  // ── PASSO 2: reputazione dei testimoni ────────────────────────────────────
  const rep = reputazione(giorniOk, mnwPerGiorno, nostrePerGiorno);
  const nSqual = Object.keys(rep.squalificati).length;
  console.log(`\n── reputazione dei testimoni ──`);
  console.log(`  valutabili ${rep.valutati}, squalificati ${nSqual} ` +
              `(sfasati ${rep.motivi.sfasato.length}, inaffidabili ${rep.motivi.inaffidabile.length}, taratura ${rep.motivi.taratura.length})`);
  for (const m of rep.motivi.sfasato.sort((a, b) => b.c0 - a.c0).slice(0, 8))
    console.log(`  [sfasato ${m.verso > 0 ? '+1' : '-1'}g] ${m.id} — ${m.c0} contraddizioni su ${m.utili} giorni`);
  for (const m of rep.motivi.inaffidabile.sort((a, b) => b.c0 - a.c0).slice(0, 8))
    console.log(`  [inaffidabile] ${m.id} — ${m.c0} contraddizioni su ${m.utili} giorni`);
  for (const m of rep.motivi.taratura.sort((a, b) => a.rap - b.rap).slice(0, 8))
    console.log(`  [taratura] ${m.id} — ${m.mm} mm contro ${m.mmVicini} dei vicini (${m.rap.toFixed(2)}x)`);

  // ⚠️ Il ribaltamento del sospetto: se in una regione la maggioranza dei
  // testimoni risulta sfasata nello STESSO verso, non sono loro a sbagliare.
  for (const [nome, r] of Object.entries(rep.perRegione)) {
    if (r.valutati < 5) continue;
    for (const verso of [1, -1]) {
      const n = verso > 0 ? r.piu : r.meno;
      if (n > r.valutati / 2)
        console.log(`  ⚠️ ${nome}: ${n} testimoni su ${r.valutati} sfasati di ${verso > 0 ? '+1' : '-1'} giorno. ` +
                    `Troppi perche' sia colpa loro: guardare le NOSTRE giornate.`);
    }
  }

  // ── PASSO 3: giudizio, prima con tutti e poi coi soli testimoni buoni ─────
  const prima = giudica(giorniOk, mnwPerGiorno, nostrePerRegione, {});
  const dopo  = giudica(giorniOk, mnwPerGiorno, nostrePerRegione, rep.squalificati);
  const { segnalazioni, perRegione } = dopo;
  console.log(`\n  segnalazioni: ${prima.segnalazioni.length} con tutti i testimoni, ` +
              `${segnalazioni.length} tenendo solo i credibili`);

  // ── PASSO 4: l'arbitro di fuori ────────────────────────────────────────────
  const decisi = await terzaFonte(segnalazioni, giorniOk);
  const perNoi = segnalazioni.filter(x => x.arbitro === 'noi');
  const perLoro = segnalazioni.filter(x => x.arbitro === 'testimoni');
  const aperte = segnalazioni.filter(x => x.arbitro !== 'noi');
  if (decisi) {
    console.log('\n── terzo testimone (Open-Meteo) ──');
    console.log(`  interpellato su ${segnalazioni.length} casi, ne decide ${decisi}: ` +
                `${perNoi.length} danno ragione a noi, ${perLoro.length} ai testimoni`);
    console.log(`  non decisi ${segnalazioni.length - decisi}: ERA5 e' un modello a maglia larga ` +
                `e i temporali isolati puo' non vederli, quindi restano aperti`);
    if (perLoro.length) {
      console.log("  ⚠️ QUI I TESTIMONI HANNO RAGIONE, cioe' e' un buco nei NOSTRI dati:");
      for (const x of perLoro)
        console.log(`     ${x.g}  ${x.regione} · ${x.staz} — noi ${x.mm} mm, testimoni ${x.mnwMed}, Open-Meteo ${x.om}`);
    }
  }

  console.log('\n── giorno per giorno ──');
  for (const g of giorniOk)
    console.log(`${g}  coppie ${String(dopo.coppiePerGiorno[g]).padStart(4)}  ` +
                `da guardare ${aperte.filter(s => s.g === g).length}`);

  console.log('\n── quadro per regione ──');
  console.log('regione       coppie  concordi(bagn/asc)  rapporto mediano nostro/testimoni');
  for (const [nome, R] of Object.entries(perRegione)) {
    const rap = mediana(R.rapporti);
    console.log(nome.padEnd(13), String(R.coppie).padStart(6),
                `   ${String(R.concordiBagnato).padStart(4)} / ${String(R.concordiAsciutto).padStart(5)}`,
                '        ', rap ? rap.toFixed(2) + (R.rapporti.length < 15 ? ' (solo ' + R.rapporti.length + ' casi, non fidarsi)' : '') : '—');
  }

  console.log(`\n── restano da guardare: ${aperte.length} ──`);
  console.log('  giorno      regione     chi sbaglia   noi     testimoni  nostri vicini  stazione');
  for (const s of aperte.slice(0, 40))
    console.log('  ' + s.g + '  ' + s.regione.padEnd(11) + ' [' + s.chi.padEnd(8) + '] ' +
                (s.tipo === 'BAGNATO_SOLO_NOI' ? 'noi bagnati ' : 'noi asciutti') + ' ' +
                String(s.mm).padStart(6) + ' | ' + String(s.mnwMed).padStart(6) + ' | ' +
                (s.nostriVicini === null ? '     —' : String(s.nostriVicini).padStart(6)) + '  ' + s.staz);
  if (aperte.length > 40) console.log('  … e altre ' + (aperte.length - 40));
  const perChi = {};
  aperte.forEach(x => { perChi[x.chi] = (perChi[x.chi] || 0) + 1; });
  console.log('  ripartizione: ' + (Object.entries(perChi).map(([k, v]) => k + ' ' + v).join(', ') || '—'));

  // Una stazione che torna piu' volte non e' sfortuna: e' un sensore da guardare.
  const conta = {};
  aperte.forEach(x => { const k = x.regione + ' · ' + x.staz; (conta[k] = conta[k] || []).push(x.g); });
  const ricorrenti = Object.entries(conta).filter(e => e[1].length >= 2).sort((a, b) => b[1].length - a[1].length);
  if (ricorrenti.length) {
    console.log("\n── segnalate piu' volte (da guardare per prime) ──");
    for (const e of ricorrenti) console.log('  ' + e[1].length + '×  ' + e[0] + '   (' + e[1].join(', ') + ')');
  }

  // registro: si accumula, non si sovrascrive
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch (e) {}

  // La posta si decide PRIMA di riscrivere il registro, se no i casi nuovi
  // risulterebbero gia' visti (vedi il blocco LA POSTA).
  const nuovi = novita(reg, perLoro);
  if (process.env.TEST_MAIL === '1') {
    scriviEml('Prova del controllo MeteoNetwork',
              'Messaggio di prova: la catena funziona. Il registro non è stato toccato.');
    output('mail', 'true'); output('registro', 'false');
    console.log("\nTEST_MAIL: scritta la mail di prova, registro lasciato com'era.");
    return;
  }
  if (nuovi.length) {
    const s = nuovi.length === 1
      ? `⚠️ Manca pioggia ai dati: ${nuovi[0].regione} · ${nuovi[0].staz}`
      : `⚠️ Manca pioggia ai dati in ${nuovi.length} casi`;
    scriviEml(s, corpoMail(nuovi, aperte, giorniOk));
    output('mail', 'true');
    console.log(`\nmail: ${nuovi.length} casi nuovi confermati dalla terza fonte`);
  } else {
    output('mail', 'false');
    console.log('\nmail: niente da mandare (nessun caso nuovo confermato dalla terza fonte)');
  }

  reg.aggiornato = new Date().toISOString();
  reg.parametri = { RAGGIO_KM, MIN_TESTIMONI, MM_FORTE, MM_ASCIUTTO, MIN_ORE,
                    REP_MIN_GIORNI, REP_MIN_CONTRO, REP_RAPP_BASSO, REP_RAPP_ALTO };
  reg.testimoniSqualificati = rep.motivi;
  reg.giorni = reg.giorni || {};
  for (const g of giorniOk) reg.giorni[g] = segnalazioni.filter(s => s.g === g);
  const limite = new Date(Date.now() - RETENTION * 86400000).toISOString().slice(0, 10);
  for (const g of Object.keys(reg.giorni)) if (g < limite) delete reg.giorni[g];
  fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 1));
  output('registro', 'true');
  console.log(`registro aggiornato: ${path.relative(process.cwd(), REGISTRO)}`);
}

main().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
