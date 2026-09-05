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

const oggi = oggiItalia();
const giorni = giorniIndietro(oggi, GIORNI);
fs.mkdirSync(USCITA, { recursive: true });

let scritti = 0;
const saltati = [];
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
  for (const p of POSTI[k]) {
    const id = p[0];
    const f = forte(g.mm, id);
    posti[id] = [somma(g.mm, DA, A, id), somma(g.mm, 7, 1, id), somma(g.mm, GIORNI, 1, id),
                 f ? f[0] : 0, f ? f[1] : 0];
  }

  const testo = JSON.stringify({
    regione: k, generato: new Date().toISOString(),
    oggi, giorni: g.presenti, primo: g.primo, ultimo: g.ultimo, posti,
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
    const testoG = JSON.stringify({
      regione: k, generato: new Date().toISOString(),
      oggi, giorni: g.presenti, primo: g.primo, ultimo: g.ultimo, anagrafe, serie,
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

console.log(`\n${scritti} file scritti su ${Object.keys(POSTI).length}` +
  (saltati.length ? ', SALTATI: ' + saltati.join(', ') : ''));
