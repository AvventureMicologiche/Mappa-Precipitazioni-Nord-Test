/**
 * QUOTA DAL TERRENO, A GIRO IN CORSO  (14/10/2026)
 * ================================================
 *
 * Il 26/8/2026 la quota delle reti che non la pubblicano (MeteoHub, OSMER) e'
 * diventata l'ALTEZZA DEL TERRENO nel punto della stazione, letta da
 * `data/quote-terreno.json` (vedi quote-terreno.js) e mostrata col ~ davanti.
 * Quel file pero' si aggiornava solo a mano: una stazione comparsa dopo restava
 * senza quota («—» sul sito). Il 14/10 erano tre: Capua dal 12/9, Giovinazzo
 * dal 2/10, Deliceto dal 7/10.
 *
 * Questa libreria fa due cose, e le fa durante il giro del collector:
 *  - `completaQuote(recs)`: le stazioni con `q: null` (nessuno conosce la quota)
 *    la chiedono al modello del terreno, solo loro.
 *  - `correggiZeri(recs)`: le stazioni che l'ente dichiara a 0 m ma che per il
 *    terreno stanno sopra i 20 m prendono la quota del terreno. Nasce dalla
 *    Toscana: il SIR scrive 0 per Bulera (PI, 183 m) e Ponte Orgia (SI, 184 m).
 *    Le stazioni davvero sul mare (Livorno Mareografo, Viareggio, Orbetello...)
 *    per il terreno stanno fra 0 e 4 m e restano a 0, che e' giusto.
 *
 * La quota del terreno e' affidabile: misurata il 14/10/2026 su 1.848 stazioni
 * del nord con la quota dichiarata, scarto mediano 5 m, 90% entro 26 m, nessuna
 * oltre 200 m.
 *
 * ⚠️ LA LIBRERIA NON SCRIVE quote-terreno.json, apposta. La usano tre workflow
 * diversi (MeteoHub, OSMER, Toscana): se tutti scrivessero lo stesso file prima
 * o poi si scontrerebbero nel push, e uno scontro nel push costa un giorno di
 * pioggia. Le stazioni nuove chiedono la quota a ogni giro (una richiesta per
 * una manciata di punti); quando conviene si rilancia quote-terreno.js a mano.
 *
 * ⚠️ UN GUASTO QUI NON DEVE MAI TOCCARE LA PIOGGIA. Tetto di 15 secondi, una
 * sola prova, e al primo fallimento la libreria si spegne per il resto del giro
 * (MeteoHub chiama per 11 reti e piu' giorni: con Open-Meteo giu' sarebbero
 * minuti di attese). Se fallisce la quota resta `null`, cioe' «—», come prima.
 *
 * Prova a mano: TERRENO_SPENTO=1 finge Open-Meteo irraggiungibile.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const FILE_NOTE = path.join(__dirname, '..', '..', 'data', 'quote-terreno.json');
const TETTO_MS = 15000;
const LOTTO = 50;           // Open-Meteo conta le richieste a peso: lotti piccoli (vedi quote-terreno.js)
const SOGLIA_ZERO = 20;     // sopra questi metri uno 0 dichiarato non e' «sul mare»

let note = null;                // id -> metri, da quote-terreno.json
const chieste = new Map();      // id -> metri, chieste in questo giro
let spenta = !!process.env.TERRENO_SPENTO;

function quoteNote() {
  if (note === null) {
    note = {};
    try {
      const j = JSON.parse(fs.readFileSync(FILE_NOTE, 'utf8'));
      for (const rete of Object.values(j.reti || {})) Object.assign(note, rete);
      console.log(`  quote dal terreno: ${Object.keys(note).length} stazioni note`);
    } catch (e) { console.warn(`  Warn quote-terreno.json: ${e.message}`); }
  }
  return note;
}

/** Quota del terreno gia' nota (file o richiesta di questo giro), o null. */
function quotaNota(id) {
  const n = quoteNote();
  const q = n[id] !== undefined ? n[id] : chieste.get(id);
  return typeof q === 'number' && isFinite(q) ? Math.max(0, Math.round(q)) : null;
}

function chiediLotto(punti) {
  const url = 'https://api.open-meteo.com/v1/elevation?latitude=' +
    punti.map(p => p.lat).join(',') + '&longitude=' + punti.map(p => p.lon).join(',');
  return new Promise((ok, ko) => {
    const req = https.get(url, { headers: { 'User-Agent': 'mappa-pluviometrica/1.0' } }, r => {
      if (r.statusCode !== 200) { r.resume(); return ko(new Error('HTTP ' + r.statusCode)); }
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        try {
          const e = JSON.parse(b).elevation;
          if (!Array.isArray(e) || e.length !== punti.length) throw new Error('risposta inattesa');
          ok(e);
        } catch (err) { ko(err); }
      });
    });
    req.setTimeout(TETTO_MS, () => req.destroy(new Error('nessuna risposta in ' + TETTO_MS / 1000 + ' s')));
    req.on('error', ko);
  });
}

/** Chiede il terreno per i punti che nessuno conosce ancora. Non lancia mai. */
async function chiediTerreno(punti) {
  const daFare = [];
  const visti = new Set();
  for (const p of punti) {
    if (!p.id || visti.has(p.id) || quotaNota(p.id) !== null) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    visti.add(p.id);
    daFare.push(p);
  }
  if (!daFare.length) return;
  if (spenta) { console.warn(`  Warn quota dal terreno: spenta, ${daFare.length} stazioni restano senza`); return; }
  const inizio = Date.now();
  try {
    for (let i = 0; i < daFare.length; i += LOTTO) {
      if (Date.now() - inizio > TETTO_MS) throw new Error('tetto di ' + TETTO_MS / 1000 + ' s superato');
      const lotto = daFare.slice(i, i + LOTTO);
      const q = await chiediLotto(lotto);
      lotto.forEach((p, k) => { if (typeof q[k] === 'number' && isFinite(q[k])) chieste.set(p.id, q[k]); });
    }
    console.log(`  quota dal terreno chiesta per ${daFare.length} stazioni: ` +
      daFare.map(p => `${p.n || p.id} ${quotaNota(p.id)} m`).slice(0, 8).join(', '));
  } catch (e) {
    spenta = true;
    console.warn(`  Warn quota dal terreno: ${e.message}, la chiedo al prossimo giro`);
  }
}

/** Stazioni con q null: prendono la quota del terreno e qt:1. */
async function completaQuote(recs) {
  try {
    await chiediTerreno(recs.filter(r => r && r.q === null));
    for (const r of recs) {
      if (!r || r.q !== null) continue;
      const q = quotaNota(r.id);
      if (q !== null) { r.q = q; r.qt = 1; }
    }
  } catch (e) { console.warn(`  Warn completaQuote: ${e.message}`); }
}

/** Stazioni dichiarate a 0 m dall'ente: se il terreno sta sopra SOGLIA_ZERO,
 *  prendono la quota del terreno e qt:1. Le stazioni sul mare restano a 0. */
async function correggiZeri(recs) {
  try {
    const zeri = recs.filter(r => r && r.q === 0 && !r.qt);
    await chiediTerreno(zeri);
    for (const r of zeri) {
      const q = quotaNota(r.id);
      if (q !== null && q > SOGLIA_ZERO) { r.q = q; r.qt = 1; }
    }
  } catch (e) { console.warn(`  Warn correggiZeri: ${e.message}`); }
}

module.exports = { quotaNota, completaQuote, correggiZeri, SOGLIA_ZERO };
