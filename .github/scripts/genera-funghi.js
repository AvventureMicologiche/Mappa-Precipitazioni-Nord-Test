#!/usr/bin/env node
/**
 * Scrive i numeri delle pagine «Piogge per funghi»: data/funghi/<regione>.json
 *
 * PERCHE' ESISTE. La pagina funghi si calcolava le sue tre finestre scaricando
 * gli ultimi 25 file giornalieri dal browser del visitatore. Misurato il
 * 2/9/2026 sulle 19 regioni: **500 richieste e 10,1 MB** in tutto, con casi
 * grotteschi — la Sicilia scaricava 1.387 KB per far vedere NOVE posti, la
 * Puglia 394 KB per DUE. Lo stesso conto fatto qui una volta al giorno sta in
 * **33 KB per tutte e 19**, la piu' grossa (Toscana) 5,9 KB: una richiesta
 * invece di venticinque, e centosettanta volte meno roba sul telefono di chi
 * apre la pagina in montagna.
 * E' la stessa medicina di `genera-riepiloghi.js` per le pagine regione, ma NON
 * lo stesso file: il riepilogo e' della REGIONE (media, giorni, primi cinque
 * nomi), qui serve **una riga per posto**. Aggiungere un periodo li' non
 * avrebbe risolto niente.
 *
 * DOVE SCRIVE E QUANTO COSTA. `data/funghi/`, che sta dentro `data/` e quindi
 * e' nella regola ignore di netlify.toml: **nessun deploy**, come i collector.
 *
 * ⚠️ LE CARTELLE DATI NON SI RICOPIANO: si prendono da
 * `genera-pagine-regione.js`, come fa `genera-riepiloghi.js`. Il calendario sta
 * in `lib-giorni.js`. Qui dentro non c'e' nessuna anagrafe duplicata.
 *
 * ⚠️ LE GEMELLE SONO GIA' FUORI, tolte una volta sola da `funghi-posti.json`:
 * dove una regione legge due cartelle lo stesso pluviometro compare due volte
 * con due id (il Friuli: l'OSMER e la copia che MeteoHub ne ripubblica), e in
 * una classifica di quindici righe si mangerebbe due volte lo stesso posto.
 * Nove tolte il 2/9/2026, tutte friulane. Per questo qui gli id si possono
 * unire fra cartelle senza tolleranze: sono gia' univoci.
 *
 * ⚠️ IL 12/9/2026 NE SONO USCITE ALTRE TRENTASETTE, e quelle erano di un'altra
 * razza: non due porte della stessa rete ma DUE AGENZIE diverse sullo stesso
 * pluviometro, quindi invisibili al controllo per cartella. Cabanne stava
 * sotto la Liguria (OMIRL) e sotto l'Emilia (ARPAE), Marradi sotto la Toscana
 * (SIR) e sotto l'Emilia: due pagine di paese a testa, e in trentatre' casi su
 * trentasette anche due volte dentro la media della STESSA zona. Si e' tenuta
 * quella dell'agenzia della regione dove il paese sta davvero, letta dalla
 * sigla della provincia. Restano fuori dal filtro due coppie vicine ma vere,
 * riconosciute confrontando sessanta giorni di pioggia: Barco e Giogo (810 m,
 * 180,8 mm contro 54,4) e Giacopiane Diga e Lago. I trentasette indirizzi
 * vecchi rimandano ai nuovi da `_redirects`.
 *
 * ⚠️ LE FINESTRE SONO 7 E 25 GIORNI DAVVERO. La pagina di prova sommava
 * `n = 6 … 0` e `n = 24 … 0` partendo pero' da n = 1 (oggi non c'e', i
 * collector scrivono ieri): erano SEI giorni sotto l'etichetta «ultimi 7» e
 * VENTIQUATTRO sotto «ultimi 25», col venticinquesimo scaricato e mai sommato.
 * Qui n va da 1 a 7 e da 1 a 25. Stessa famiglia del difetto del pannello
 * corretto il 27/8/2026.
 *
 * Uso: `node .github/scripts/genera-funghi.js` (nessun parametro).
 */

const fs = require('fs');
const path = require('path');
const { REGIONI } = require('./genera-pagine-regione.js');
const { DATI, oggiItalia, giorniIndietro, leggi } = require('./lib-giorni.js');
const { LOCALITA, bello, slugRegione } = require('./lib-nomi.js');

const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const USCITA = path.join(DATI, 'funghi');

const GIORNI = 25;                  // la finestra piu' lunga della pagina
const FORTE = 30;                   // «pioggia forte»: mm in un giorno solo
/* ⚠️ QUANTO INDIETRO SI CERCA L'ULTIMA PIOGGIA FORTE, e perche' non 25.
   La serie che la pagina scarica resta di 25 giorni, ma «da quanto non piove
   sul serio» con quella finestra sa dire solo «in 25 giorni mai», che e' la
   risposta meno utile proprio dove serve di piu'. Misurato l'11/9/2026 sulle
   114 zone con la soglia a 30 mm: TRENTA non avevano niente neanche in
   ottanta giorni. Si cerca quindi fino a 150 giorni, ma **solo per i
   pluviometri che nei primi 25 non hanno trovato niente**, e la scansione si
   ferma appena li ha risolti tutti: sul grosso delle regioni non legge un
   file in piu'. Il file che il visitatore scarica non cresce di un byte:
   sono due numeri per pluviometro, non 125 giorni di serie. */
const FINESTRA_FORTE = 150;
const DA = 20, A = 13;              // la finestra dei funghi: 13-20 giorni fa
const MINIMO = 5;                   // sotto questi giorni buoni non si scrive

// I mm di ogni stazione della regione, giorno per giorno: { 1: {id: mm}, ... }
// dove 1 e' ieri. Le cartelle di una regione si sommano per id — che dopo il
// filtro delle gemelle e' univoco — perche' l'Alto Adige e il Friuli hanno
// pluviometri che una sola delle due fonti pubblica.
function perGiorno(dirs, giorni) {
  const out = {}, outT = {}, outW = {};
  let presenti = 0, primo = null, ultimo = null;
  giorni.forEach((g, i) => {
    const n = i + 1;
    const m = {}, mt = {}, mw = {};
    let qualcosa = false;
    for (const dir of dirs) {
      const staz = leggi(dir, g);
      if (!staz) continue;
      qualcosa = true;
      for (const s of staz) {
        if (s.mm != null) m[s.id] = (m[s.id] || 0) + s.mm;
        // ⚠️ t e w si prendono COSI' COME SONO, non si sommano: la pioggia di
        // due cartelle sullo stesso id si somma, una temperatura no.
        if (Array.isArray(s.t) && s.t.some(v => v != null) && !mt[s.id]) mt[s.id] = s.t;
        if (Array.isArray(s.w) && s.w.some(v => v != null) && !mw[s.id]) mw[s.id] = s.w;
      }
    }
    if (!qualcosa) return;
    out[n] = m; outT[n] = mt; outW[n] = mw;
    presenti++;
    if (!ultimo) ultimo = g;        // giorni e' ordinato dal piu' recente
    primo = g;
  });
  return { mm: out, t: outT, w: outW, presenti, primo, ultimo };
}

const uno = n => Math.round(n * 10) / 10;

function somma(mm, da, a, id) {
  let t = 0;
  for (let n = da; n >= a; n--) if (mm[n] && mm[n][id] != null) t += mm[n][id];
  return uno(t);
}
// Il giorno piu' RECENTE in cui quel posto ha preso almeno FORTE mm.
function forte(mm, id) {
  for (let n = 1; n <= GIORNI; n++) if (mm[n] && mm[n][id] >= FORTE) return [n, uno(mm[n][id])];
  return null;
}

/* Chi nei primi GIORNI non ha trovato niente lo si cerca piu' indietro, un
   giorno per volta, fermandosi appena la lista dei mancanti si svuota.
   Restituisce { id: [giorniFa, mm] } e la profondita' raggiunta, che serve
   alla pagina per dire «in N giorni mai» invece di un «mai» senza appiglio. */
function forteIndietro(dirs, oggi, mancanti) {
  const trovati = {};
  let restano = new Set(mancanti);
  let arrivatoA = GIORNI;
  if (!restano.size) return { trovati, arrivatoA };
  const giorni = giorniIndietro(oggi, FINESTRA_FORTE);
  for (let n = GIORNI + 1; n <= FINESTRA_FORTE && restano.size; n++) {
    const g = giorni[n - 1];
    const somma = {};
    let qualcosa = false;
    for (const dir of dirs) {
      const staz = leggi(dir, g);
      if (!staz) continue;
      qualcosa = true;
      // ⚠️ Si somma per id come fa perGiorno: dove una regione legge due
      // cartelle lo stesso pluviometro puo' comparire in tutt'e due.
      for (const s of staz) if (s.mm != null && restano.has(String(s.id)))
        somma[s.id] = (somma[s.id] || 0) + s.mm;
    }
    if (qualcosa) arrivatoA = n;
    for (const id of Object.keys(somma)) {
      if (somma[id] >= FORTE) { trovati[id] = [n, uno(somma[id])]; restano.delete(id); }
    }
  }
  return { trovati, arrivatoA };
}

const oggi = oggiItalia();
const giorni = giorniIndietro(oggi, GIORNI);
fs.mkdirSync(USCITA, { recursive: true });

let scritti = 0;
const saltati = [];
// La classifica NAZIONALE, per la pagina indice `/funghi/`: si riempie regione
// per regione dentro il giro qui sotto e si scrive alla fine. Sta qui e non in
// un altro script perche' i millimetri li ha gia' in mano questo: rileggerli da
// fuori vorrebbe dire una seconda copia della ricetta, che prima o poi diverge.
const italia = [];
for (const k of Object.keys(POSTI)) {
  const r = REGIONI.find(x => x.k === k);
  // Se una regione sparisce dall'anagrafe delle pagine si ferma tutto: meglio
  // un workflow rosso che una pagina che mostra numeri di un'altra regione.
  if (!r) { console.error(`⚠️ «${k}» non e' in genera-pagine-regione.js`); process.exit(1); }

  const g = perGiorno(r.dirs, giorni);
  // ⚠️ Se i giorni buoni sono troppo pochi NON si scrive: si lascia il file di
  // ieri, e la pagina — vedendolo vecchio — torna a calcolarsi i numeri da se'.
  // Sovrascrivere con una classifica costruita su tre giorni sarebbe il modo
  // peggiore di gestire una fonte ferma: la pagina la mostrerebbe come buona.
  if (g.presenti < MINIMO) { saltati.push(`${k} (${g.presenti} giorni)`); continue; }

  const posti = {};
  const senzaForte = [];
  for (const p of POSTI[k]) {
    const id = p[0];
    const f = forte(g.mm, id);
    if (!f) senzaForte.push(String(id));
    posti[id] = [somma(g.mm, DA, A, id), somma(g.mm, 7, 1, id), somma(g.mm, GIORNI, 1, id),
                 f ? f[0] : 0, f ? f[1] : 0];
  }
  // Chi non ha preso 30 mm negli ultimi 25 giorni si cerca piu' indietro.
  const oltre = forteIndietro(r.dirs, oggi, senzaForte);
  for (const id of Object.keys(oltre.trovati)) {
    posti[id][3] = oltre.trovati[id][0];
    posti[id][4] = oltre.trovati[id][1];
  }

  // ⚠️ Entrano solo le regioni che hanno le pagine di paese: la classifica
  // nazionale e' fatta di righe CLICCABILI, e una riga senza pagina sarebbe un
  // nome scritto per niente. Oggi sono tutte e 19, ma la condizione resta.
  if (LOCALITA.includes(k)) {
    const sln = slugRegione(POSTI[k]);
    for (const p of POSTI[k]) {
      const v = posti[p[0]][0];
      if (v > 0) italia.push([bello(p[1]), p[2], k, sln[p[0]], v, p[4], p[5]]);
    }
  }

  const testo = JSON.stringify({
    regione: k, generato: new Date().toISOString(),
    oggi, giorni: g.presenti, primo: g.primo, ultimo: g.ultimo,
    // Fin dove si e' guardato indietro cercando la pioggia forte: serve alla
    // pagina per scrivere «in 92 giorni mai» invece di un «mai» campato.
    // ⚠️ `tetto` dice se quel numero e' il FONDO DELL'ARCHIVIO o solo il nostro
    // limite di ricerca: sono due frasi diverse. Con 114 giorni in Sicilia e'
    // vero che l'archivio finisce li'; con 150 in Liguria no, e' solo fin dove
    // abbiamo guardato — scriverlo come «da quando abbiamo archivio» sarebbe
    // falso.
    cercatoFino: oltre.arrivatoA, tetto: FINESTRA_FORTE, posti,
  }) + '\n';

  // Il campo `generato` cambia a ogni giro: se il resto e' identico non si
  // riscrive, cosi' un run in piu' non produce un commit di sole date.
  // ── Il file dei GIORNI, per le pagine di localita' ──────────────────────
  // ⚠️ E' un file A SE' e non un campo in piu' del riepilogo: chi apre la
  // pagina di una regione non deve scaricare le serie di 112 posti per vedere
  // una classifica di quindici righe. Le due pagine chiedono file diversi.
  // ⚠️ Dentro c'e' anche l'ANAGRAFE, coi nomi gia' scritti in tondo e con lo
  // slug: cosi' la pagina di un posto non se la porta cotta dentro. Erano
  // ~7 KB per pagina, cioe' 780 KB sulla sola Liguria e 6,6 MB se un giorno si
  // facessero tutte e 948.
  if (LOCALITA.includes(k)) {
    const serie = {};
    for (const p of POSTI[k]) {
      const a = [];
      for (let n = 1; n <= GIORNI; n++) a.push(uno((g.mm[n] && g.mm[n][p[0]]) || 0));
      serie[p[0]] = a;
    }
    /* ⚠️ TEMPERATURA E VENTO: due serie parallele alla pioggia, ma scritte
       SOLO per i pluviometri che quel sensore ce l'hanno. Su 948 posti la
       temperatura ce l'ha il 78%, il vento il 20%: mettere 25 null a testa
       per i restanti gonfierebbe il file senza dire niente. Chi non c'e',
       nella pagina non mostra la scheda. */
    const serieT = {}, serieW = {};
    for (const p of POSTI[k]) {
      const t = [], w = [];
      let haT = false, haW = false;
      for (let n = 1; n <= GIORNI; n++) {
        const vt = g.t[n] && g.t[n][p[0]];
        const vw = g.w[n] && g.w[n][p[0]];
        if (vt) { haT = true; t.push([uno(vt[0]), uno(vt[1])]); } else t.push(null);
        if (vw && vw[0] != null) { haW = true; w.push(uno(vw[0])); } else w.push(null);
      }
      if (haT) serieT[p[0]] = t;
      if (haW) serieW[p[0]] = w;
    }
    const sl = slugRegione(POSTI[k]);
    const anagrafe = POSTI[k].map(p => [p[0], bello(p[1]), p[2], p[3], p[4], p[5], p[6], sl[p[0]]]);
    /* ⚠️ L'ULTIMA PIOGGIA FORTE VA SCRITTA QUI, non lasciata calcolare alla
       pagina dalla serie: la serie e' di 25 giorni e la pagina di zona non
       potrebbe mai dire «21 giorni fa» per una valle asciutta da un mese.
       Sono due numeri per pluviometro, e solo per quelli che ce l'hanno. */
    const forteMap = {};
    for (const p of POSTI[k]) if (posti[p[0]][3]) forteMap[p[0]] = [posti[p[0]][3], posti[p[0]][4]];
    const testoG = JSON.stringify({
      regione: k, generato: new Date().toISOString(),
      oggi, giorni: g.presenti, primo: g.primo, ultimo: g.ultimo,
      cercatoFino: oltre.arrivatoA, tetto: FINESTRA_FORTE,
      anagrafe, serie, forte: forteMap,
      serieT, serieW,
    }) + '\n';
    const destG = path.join(USCITA, k + '-giorni.json');
    const primaG = fs.existsSync(destG) ? fs.readFileSync(destG, 'utf8') : '';
    const senzaDataG = t => t.replace(/"generato":"[^"]+",/, '');
    if (!(primaG && senzaDataG(primaG) === senzaDataG(testoG))) {
      fs.writeFileSync(destG, testoG, 'utf8');
      scritti++;
    }
  }

  const dest = path.join(USCITA, k + '.json');
  const prima = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  const senzaData = t => t.replace(/"generato":"[^"]+",/, '');
  const uguale = prima && senzaData(prima) === senzaData(testo);
  if (!uguale) { fs.writeFileSync(dest, testo, 'utf8'); scritti++; }

  const primi = Object.entries(posti).sort((a, b) => b[1][0] - a[1][0])[0];
  const nome = (POSTI[k].find(p => p[0] === primi[0]) || [, '?'])[1];
  console.log(`  ${k.padEnd(12)} ${String(POSTI[k].length).padStart(4)} posti  ` +
    `${String(g.presenti).padStart(2)}/${GIORNI} gg  ` +
    `primo: ${nome} ${primi[1][0]} mm${uguale ? '  (invariato)' : ''}`);
}
/* ── L'INDICE COORDINATE → PAGINA, per il tasto nel pannello della mappa ──
   ⚠️ LA CHIAVE SONO LE COORDINATE, NON L'ID. I loader della mappa
   ricostruiscono la stazione campo per campo e l'id NON lo copiano: nel
   pannello arrivano n, lat, lon, q, qt, t, w, u, p e basta. Latitudine e
   longitudine invece ci sono sempre, e vengono dagli stessi file dati da cui
   esce funghi-posti.json, quindi combaciano al quarto decimale.
   ⚠️ Si scrive UNA volta per tutte le regioni, non una per regione: la mappa
   non sa in che regione sia la stazione cliccata finche' non guarda qui.
   Il file lo scarica solo chi apre una stazione, mai chi guarda la mappa. */
{
  const indice = {};
  for (const k of LOCALITA) {
    const sl = slugRegione(POSTI[k] || []);
    for (const p of (POSTI[k] || [])) indice[p[4].toFixed(4) + ',' + p[5].toFixed(4)] = k + '/' + sl[p[0]];
  }
  const destI = path.join(USCITA, 'indice.json');
  const testoI = JSON.stringify(indice) + '\n';
  if (!fs.existsSync(destI) || fs.readFileSync(destI, 'utf8') !== testoI) {
    fs.writeFileSync(destI, testoI, 'utf8');
    scritti++;
    console.log(`  indice.json  ${Object.keys(indice).length} posti`);
  }
}

/* ── LA CLASSIFICA NAZIONALE, per la pagina indice `/funghi/` ──────────────
   La pagina indice fa UNA richiesta e trova i posti piu' bagnati d'Italia gia'
   in ordine. L'alternativa era farle scaricare i 19 file di regione: pochi KB
   l'uno, ma diciannove raffiche a raw.githubusercontent per ogni visita, che e'
   esattamente la raffica che il 18/8 prendeva i 429 veri.
   ⚠️ SI SCRIVONO 25 RIGHE E LA PAGINA NE MOSTRA 20: le ultime cinque sono la
   riserva per i posti che nel frattempo hanno perso la pagina. Piu' di cosi'
   non serve — chi vuole l'elenco intero della sua regione ha la pagina della
   regione, che li ha tutti. */
{
  italia.sort((a, b) => b[4] - a[4]);

  /* ⚠️ LE GEMELLE, che qui saltano fuori PIU' che altrove. Dentro una regione
     il problema non si pone (i doppioni li tolgono gia' i loader e i
     riepiloghi), ma la classifica nazionale mette in fila regioni diverse, e
     la Lunigiana la pubblicano sia OMIRL sia il SIR: al primo giro «Iera MS»
     compariva DUE volte con lo stesso identico numero, terza e quarta.
     Stessa regola e stessa tolleranza del resto del progetto: sotto il
     chilometro sono lo stesso strumento.
     ⚠️ NON si accoppiano per nome: la stessa stazione e' «Diga del Brugneto»
     per ARPAE e «Brugneto Diga» per OMIRL. Si accoppiano per posizione.
     ⚠️ CHI VINCE lo dice il dato, non una tabella scritta a mano: per ogni
     sigla di provincia la regione di CASA e' quella che ne ha piu' posti (MS
     e' toscana, che ne ha ventuno, non liguria che ne ha tre). Una tabella
     provincia -> regione battuta a mano sarebbe un secondo elenco da tenere
     allineato, ed e' l'errore che questo progetto ha gia' pagato altrove. */
  const quanti = {};
  for (const r of italia) {
    quanti[r[1]] = quanti[r[1]] || {};
    quanti[r[1]][r[2]] = (quanti[r[1]][r[2]] || 0) + 1;
  }
  const casa = {};
  for (const sig of Object.keys(quanti))
    casa[sig] = Object.entries(quanti[sig]).sort((a, b) => b[1] - a[1])[0][0];

  const vicino = (a, b) => {
    const dy = (a[5] - b[5]) * 111.2;
    const dx = (a[6] - b[6]) * 111.2 * Math.cos(a[5] * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy) < 1;
  };
  const tenute = [];
  let gemelle = 0;
  for (const r of italia) {
    const g = tenute.findIndex(t => vicino(t, r));
    if (g < 0) { tenute.push(r); continue; }
    gemelle++;
    // Se la doppia e' quella di casa prende il posto dell'altra: il numero e'
    // lo stesso, cambia solo su quale pagina si finisce cliccando.
    if (casa[r[1]] === r[2] && casa[tenute[g][1]] !== tenute[g][2]) tenute[g] = r;
  }
  /* ⚠️ SI RIORDINA DOPO, e non e' pignoleria: le due gemelle NON danno lo
     stesso numero. Sulla diga del Brugneto, sugli stessi otto giorni, ARPAE
     conta 245,8 mm e OMIRL 222,7 — sono due strumenti veri sullo stesso sito,
     letti da due catene diverse. Sostituendo la tenuta con quella di casa il
     valore cambia, e senza questo riordino la riga resta al posto della
     sorella: al primo giro il Brugneto usciva sopra un posto che ne aveva 14
     in piu'. */
  tenute.sort((a, b) => b[4] - a[4]);

  const testoN = JSON.stringify({
    generato: new Date().toISOString(), oggi,
    finestra: [giorni[DA - 1], giorni[A - 1]],
    quanti: tenute.length, regioni: Object.keys(POSTI).length - saltati.length,
    primi: tenute.slice(0, 25).map(r => [r[0], r[1], r[2], r[3], uno(r[4])]),
  }) + '\n';
  const destN = path.join(USCITA, 'italia.json');
  const primaN = fs.existsSync(destN) ? fs.readFileSync(destN, 'utf8') : '';
  const senzaDataN = t => t.replace(/"generato":"[^"]+",/, '');
  if (!(primaN && senzaDataN(primaN) === senzaDataN(testoN))) {
    fs.writeFileSync(destN, testoN, 'utf8');
    scritti++;
    console.log(`  italia.json  ${tenute.length} posti bagnati (${gemelle} gemelle scartate), ` +
      `primo: ${tenute.length ? tenute[0][0] + ' ' + uno(tenute[0][4]) + ' mm' : '—'}`);
  }
}

console.log(`\n${scritti} file scritti su ${Object.keys(POSTI).length}` +
  (saltati.length ? ', SALTATI: ' + saltati.join(', ') : ''));
