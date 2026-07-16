/**
 * diagnose-toscana.js  —  strumento diagnostico ad-hoc, NON fa parte della pipeline di raccolta.
 *
 * Scopo: capire perché ~61% delle stazioni CFR Toscana risultano sempre a 0mm nel periodo
 * "corretto" (dal 22 giugno) mentre stazioni gemelle in Emilia-Romagna e la reanalisi
 * Open-Meteo mostrano pioggia reale nello stesso punto/periodo.
 *
 * Come funziona:
 *  - Legge la lista timestamp di OGGI da action=PLUVIO (il CFR non permette query storiche:
 *    il parametro date= viene ignorato, quindi questo script va lanciato lo stesso giorno
 *    in cui si vuole osservare un evento di pioggia, idealmente in tarda serata quando la
 *    lista timestamp del giorno è quasi completa).
 *  - Per ogni timestamp del giorno, scarica action=PLUVIO&last=<ts> e salva il valore grezzo
 *    di un campione di stazioni note come "morte" (sempre 0 nei dati raccolti) e alcune "vive".
 *  - Alla fine stampa, per ciascuna stazione campione:
 *      - la sequenza intera dei valori nel tempo
 *      - se la sequenza è monotona non-decrescente (comportamento cumulativo atteso)
 *      - il valore secondo la formula attuale del collector: max(Valore) nel giorno
 *      - il valore secondo un'ipotesi alternativa: somma dei soli incrementi positivi
 *        (utile se Valore fosse in realtà un incremento nell'intervallo, non un cumulato)
 *  - Salva anche il dump grezzo completo in JSON per ispezione manuale.
 *
 * Uso:
 *   node diagnose-toscana.js
 *
 * Non scrive né modifica nulla in data/toscana — è completamente separato dal collector reale.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BASE_URL = 'https://www.cfr.toscana.it/monitoraggio/actions.php';
const OUT_DIR  = path.join(__dirname, 'diagnostic-output');

// Stazioni note come "sempre 0mm" nel periodo 22 giugno - 12 luglio 2026
// (dal controllo periodico dati del 2026-07-12)
const DEAD_SAMPLE = [
  'TOS30250000', // Marradi (FI) — storicamente attiva (max 59.1mm), morta da fine maggio/giugno
  'TOS30290300', // Firenzuola (FI) — storicamente attiva (max 36.8mm), morta da giugno
  'TOS01000025', // Vara (MS)
  'TOS01005981', // Livorno Mareografo (LI)
  'TOS01005251', // Bocca d'Arno (PI)
  'TOS09000015', // Bagnone (MS)
  'TOS09001053', // Passo della Cisa (MS)
  'TOS01002661', // Siena Poggio al Vento (SI)
  'TOS03002901', // Castel del Piano (GR)
  'TOS01000581', // Stia (AR)
];

// Stazioni "vive" note per confronto (hanno registrato pioggia >2mm nel periodo)
const ALIVE_SAMPLE_HINT = []; // popolato a runtime scegliendo le prime N stazioni con Valore>0 osservato

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
        }
      });
    }).on('error', reject);
  });
}

function isMonotonicNonDecreasing(seq) {
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].val < seq[i-1].val - 1e-9) return false;
  }
  return true;
}

async function main() {
  console.log('=== diagnose-toscana avviato ===');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetch lista stazioni e timestamp di oggi...');
  const base = await fetchJSON(`${BASE_URL}?action=PLUVIO`);
  if (!base.data || !Array.isArray(base.data)) throw new Error('Risposta inattesa da action=PLUVIO');

  const stMeta = {};
  base.data.forEach(s => {
    if (s.IDStazione) stMeta[s.IDStazione] = (s.Nome || s.IDStazione).split('\r\n')[0];
  });

  const timestamps = base.list || [];
  console.log(`Timestamps disponibili oggi: ${timestamps.length} (${timestamps[0]} -> ${timestamps[timestamps.length-1]})`);
  if (timestamps.length === 0) throw new Error('Nessun timestamp disponibile oggi');

  // serie temporale grezza per OGNI stazione (serve per l'analisi completa + dump)
  const series = {}; // id -> [{ts, val}]

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    try {
      const data = await fetchJSON(`${BASE_URL}?action=PLUVIO&last=${ts}`);
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach(s => {
          const id = s.IDStazione;
          const val = parseFloat(s.Valore);
          if (!id || isNaN(val)) return;
          if (!series[id]) series[id] = [];
          series[id].push({ ts, val });
        });
      }
      process.stdout.write(`  Processati ${i+1}/${timestamps.length} timestamps\r`);
      await sleep(200);
    } catch(e) {
      console.warn(`\nWarn: timestamp ${ts} fallito: ${e.message}`);
    }
  }
  console.log('\nRaccolta completata.');

  // scegli automaticamente un campione di stazioni "vive" (max Valore osservato oggi > 0)
  const aliveToday = Object.entries(series)
    .map(([id, seq]) => ({ id, max: Math.max(...seq.map(p => p.val)) }))
    .filter(s => s.max > 0)
    .sort((a, b) => b.max - a.max)
    .slice(0, 10)
    .map(s => s.id);

  console.log(`\nStazioni con pioggia OGGI (le prime ${aliveToday.length} per valore max): ${aliveToday.map(id => stMeta[id]||id).join(', ') || '(nessuna — giornata secca finora)'}`);

  const sampleIds = [...new Set([...DEAD_SAMPLE, ...aliveToday])];

  console.log('\n=== Analisi per stazione campione ===');
  const report = [];
  for (const id of sampleIds) {
    const seq = series[id] || [];
    const name = stMeta[id] || id;
    if (seq.length === 0) {
      console.log(`\n${name} (${id}): NESSUN DATO ricevuto in nessun timestamp oggi`);
      report.push({ id, name, note: 'nessun dato ricevuto' });
      continue;
    }
    const maxVal = Math.max(...seq.map(p => p.val));
    const monotonic = isMonotonicNonDecreasing(seq);
    let sumPositiveDeltas = seq[0].val > 0 ? seq[0].val : 0;
    for (let i = 1; i < seq.length; i++) {
      const d = seq[i].val - seq[i-1].val;
      if (d > 0) sumPositiveDeltas += d;
    }
    sumPositiveDeltas = Math.round(sumPositiveDeltas * 10) / 10;

    console.log(`\n${name} (${id}):`);
    console.log(`  letture: ${seq.length}  |  monotona non-decrescente: ${monotonic ? 'SI (comportamento cumulativo atteso)' : 'NO (anomalo)'}`);
    console.log(`  formula attuale max(Valore) = ${maxVal}mm  |  ipotesi alternativa sum(incrementi positivi) = ${sumPositiveDeltas}mm`);
    if (!monotonic) {
      const drops = [];
      for (let i = 1; i < seq.length; i++) {
        if (seq[i].val < seq[i-1].val - 1e-9) drops.push(`${seq[i-1].ts}(${seq[i-1].val})->${seq[i].ts}(${seq[i].val})`);
      }
      console.log(`  cali rilevati: ${drops.slice(0,5).join('; ')}${drops.length>5?' ...':''}`);
    }
    report.push({ id, name, letture: seq.length, monotonic, maxVal, sumPositiveDeltas, seq });
  }

  const outFile = path.join(OUT_DIR, `diag-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n✅ Report completo salvato in ${outFile}`);
  console.log('\nSuggerimento: rilancia questo script in tarda serata (dopo le 23:00) nel primo giorno di pioggia,');
  console.log('così la lista timestamp copre quasi tutta la giornata e il confronto max() vs sum(incrementi) è significativo.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
