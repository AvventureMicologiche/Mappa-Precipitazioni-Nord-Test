/**
 * RIPARA LA QUOTA NEI FILE GIORNALIERI  (26/8/2026)
 * =================================================
 *
 * Trovato dall'utente: «molti pluviometri Piemonte non hanno l'altitudine».
 * Il check ha diviso il problema in due, e questo script li chiude tutti e due.
 * Tocca SOLO il campo `q` (e il contrassegno `qt`): pioggia, temperatura, vento
 * e umidita' non vengono mai sfiorati.
 *
 * ── PIEMONTE (modo `piemonte`) ────────────────────────────────────────────
 * Finestra rotta **3/5/2026 → 14/8/2026**, 104 file su 384: il collector di
 * allora scriveva `q:0` per tutte le stazioni, e solo il v2 (in produzione dal
 * 15/8) riempie la quota dall'anagrafica ufficiale ARPA. Prima del 3/5 il
 * Piemonte erano 56 stazioni e la quota c'era: la finestra rotta sta in mezzo.
 * La quota si rimette **dai file che ce l'hanno gia'**, per codice stazione:
 * non si inventa niente e non si chiede niente a nessuno. 99,2% agganciato.
 *
 * ── LE UNDICI RETI SENZA QUOTA (modo `terreno`) ───────────────────────────
 * MeteoHub (10 reti) e OSMER Friuli l'altitudine non la pubblicano proprio.
 * ⚠️ Qui la quota NON viene dall'ente: e' l'altezza del TERRENO nel punto
 * della stazione, presa da un modello altimetrico (vedi `quote-terreno.js`).
 * Per questo ogni stazione riempita da qui si porta dietro **`qt: 1`**, che il
 * sito legge per mostrare il ~ davanti al numero. RESTA DA RISOLVERE trovando
 * l'anagrafica vera di quelle reti.
 *
 * ── QUELLO CHE NON SI TOCCA ───────────────────────────────────────────────
 * ⚠️ Le stazioni **davvero sul mare** hanno q=0 ed e' giusto: Porto Tolle,
 * Chioggia, Marina di Ravenna, Livorno Mareografo, Viareggio, Orbetello,
 * Port-La-Nouvelle. Lo script lavora solo sulle cartelle che gli si dicono,
 * e Veneto, Toscana, Emilia e Francia non sono fra quelle.
 * ⚠️ Una stazione che resta senza quota diventa **`q: null`**, non 0: zero
 * vuol dire «sul mare», null vuol dire «non lo sappiamo», e il sito le mostra
 * in modo diverso. Era il difetto che peggiorava tutto: scrivere «0 m slm»
 * su un pluviometro di montagna e' peggio che non scrivere niente.
 *
 * uso: node .github/scripts/ripara-quote-storiche.js [piemonte|terreno|tutto] [--prova]
 *      --prova   dice cosa farebbe senza scrivere niente
 */

const fs = require('fs');
const path = require('path');

const RADICE = path.join(__dirname, '..', '..', 'data');
const MODO = (process.argv[2] || 'tutto').toLowerCase();
const PROVA = process.argv.includes('--prova');

const RETI_TERRENO = ['friuli-osmer'].concat(
  ['basilicata', 'calabria', 'campania', 'friuli', 'lazio', 'marche', 'molise',
   'puglia', 'sardegna', 'sicilia', 'umbria'].map(r => 'meteohub-' + r))
  // ⚠️ Il Piemonte sta qui SOLO per le briciole: due stazioni dismesse
  // (Malciaussia, Alto Sermenza) che nell'anagrafica di oggi non ci sono piu',
  // quindi la loro quota non ce l'ha nessuno dei nostri file. Tutte le altre
  // le riempie il modo `piemonte` col dato vero, e questo passaggio non le
  // tocca perche' hanno gia' la quota buona.
  .concat(['piemonte']);

const buona = q => typeof q === 'number' && isFinite(q) && q > 0;

function fileDi(cartella) {
  const dir = path.join(RADICE, cartella);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map(f => path.join(dir, f));
}

function leggi(f) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { d, st: Array.isArray(d) ? d : (d.stations || []) };
}

/** Passa i file di una cartella e mette la quota dove manca.
 *  `quote` = mappa id → metri; `terreno` = marca le riempite con qt:1. */
function riempi(cartella, quote, terreno) {
  const files = fileDi(cartella);
  let toccati = 0, messe = 0, ignote = 0;
  const orfane = new Map();

  for (const f of files) {
    const { d, st } = leggi(f);
    if (!st.length) continue;
    let cambiato = false;
    for (const s of st) {
      if (buona(s.q)) continue;                    // gia' a posto, non si tocca
      const q = quote[s.id];
      if (typeof q === 'number') {
        s.q = Math.max(0, Math.round(q));          // sotto lo zero e' rumore del modello
        if (terreno) s.qt = 1;
        messe++;
        cambiato = true;
      } else if (s.q !== null) {
        // ⚠️ null e non 0: «non lo sappiamo» e «sul mare» non sono la stessa cosa
        s.q = null;
        ignote++;
        cambiato = true;
        orfane.set(s.id, s.n);
      }
    }
    if (cambiato) {
      toccati++;
      if (!PROVA) fs.writeFileSync(f, JSON.stringify(d));
    }
  }
  const nota = orfane.size
    ? `  ⚠️ ${orfane.size} senza quota: ` + [...orfane.values()].slice(0, 6).join(', ')
    : '';
  console.log(`${cartella.padEnd(22)} file toccati ${String(toccati).padStart(3)}/${String(files.length).padStart(3)}` +
    `  quote messe ${String(messe).padStart(6)}  ignote ${String(ignote).padStart(4)}${nota}`);
  return { toccati, messe, ignote };
}

/** Le quote che il Piemonte ha gia' in casa: dall'anagrafica di oggi e dallo
 *  storico prima di maggio, che la quota ce l'aveva. */
function quotePiemonte() {
  const q = {};
  for (const f of fileDi('piemonte'))
    for (const s of leggi(f).st)
      if (buona(s.q) && q[s.id] === undefined) q[s.id] = s.q;
  return q;
}

const tot = { toccati: 0, messe: 0, ignote: 0 };
const somma = r => { tot.toccati += r.toccati; tot.messe += r.messe; tot.ignote += r.ignote; };

if (PROVA) console.log('— PROVA: non scrivo niente —\n');

if (MODO === 'piemonte' || MODO === 'tutto') {
  const q = quotePiemonte();
  console.log(`Piemonte: ${Object.keys(q).length} quote note dai file stessi`);
  somma(riempi('piemonte', q, false));
}

if (MODO === 'terreno' || MODO === 'tutto') {
  const f = path.join(RADICE, 'quote-terreno.json');
  if (!fs.existsSync(f)) {
    console.error('manca data/quote-terreno.json: lancia prima quote-terreno.js');
    process.exit(1);
  }
  const reti = JSON.parse(fs.readFileSync(f, 'utf8')).reti || {};
  console.log(`\nQuota dal terreno (~): ${Object.values(reti).reduce((a, r) => a + Object.keys(r).length, 0)} stazioni note`);
  for (const rete of RETI_TERRENO) somma(riempi(rete, reti[rete] || {}, true));
}

console.log(`\ntotale: ${tot.toccati} file toccati, ${tot.messe} quote messe, ${tot.ignote} restate ignote`);
