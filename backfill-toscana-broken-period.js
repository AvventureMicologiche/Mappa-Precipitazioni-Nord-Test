/**
 * backfill-toscana-broken-period.js  —  script una tantum, non nella pipeline automatica
 * Ricostruisce data/toscana/<data>.json per il periodo 2026-05-21 → 2026-07-11, in cui il feed
 * CFR (usato da collect-toscana-gh.js, dismesso il 12 luglio 2026) risultava rotto per il 61%
 * delle stazioni: restituiva Valore=0 anche con pioggia reale in corso.
 *
 * Non esiste modo di recuperare i valori reali di quei giorni: sia CFR sia SIR Toscana
 * ignorano qualsiasi parametro di data storica nelle loro API pubbliche (restituiscono sempre
 * e solo l'istante attuale), e l'unico archivio storico (sir.toscana.it/rilievi-storici) è
 * protetto da login a cui non abbiamo accesso.
 *
 * Questo script SOVRASCRIVE i file esistenti di quel periodo con stime Open-Meteo Archive
 * sulle stesse coordinate stazione (da toscana-stazioni-coords.json). Non sono dati di stazione
 * reali: il campo "source" è marcato 'open-meteo-backfill-toscana' per essere distinguibile da
 * 'sir-toscana' (dati reali, dal 12 luglio) o 'cfr-toscana' (dati rotti, sostituiti da questo
 * script). Uso: node backfill-toscana-broken-period.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const START_DATE  = '2026-05-21';
const END_DATE    = '2026-07-11';
const BATCH_SIZE  = 50;   // stazioni per chiamata — batch piccoli per stare larghi con la quota Open-Meteo
const BATCH_DELAY = 4000; // ms tra una chiamata e l'altra
const DATA_DIR   = path.join(__dirname, 'data', 'toscana');
const COORDS_FILE = path.join(__dirname, '.github', 'scripts', 'toscana-stazioni-coords.json');
const META_SOURCE_FILE = path.join(DATA_DIR, '2026-07-12.json'); // stazioni SIR post-fix, per n/p/q corretti

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url, retries = 4) {
  return new Promise(async (resolve, reject) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await new Promise((res, rej) => {
          https.get(url, { headers: { 'Accept': 'application/json' } }, r => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => res({ status: r.statusCode, data }));
          }).on('error', rej);
        });
        if (result.status === 200) return resolve(JSON.parse(result.data));
        if (result.status === 429) {
          console.warn(`  ⏳ Rate limit 429, attendo 90s... (tentativo ${attempt + 1}/${retries})`);
          await sleep(90000);
          continue;
        }
        throw new Error(`HTTP ${result.status}`);
      } catch (e) {
        if (attempt === retries - 1) return reject(e);
        await sleep(3000);
      }
    }
    reject(new Error('Troppi tentativi falliti'));
  });
}

function dateRange(start, end) {
  const dates = [];
  let d = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (d <= endD) {
    dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 3600000);
  }
  return dates;
}

async function main() {
  console.log('=== backfill-toscana-broken-period avviato ===');
  console.log(`  Periodo: ${START_DATE} -> ${END_DATE}`);

  const coords = JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));
  const metaSource = JSON.parse(fs.readFileSync(META_SOURCE_FILE, 'utf8'));
  const metaById = {};
  metaSource.stations.forEach(s => { metaById[s.id] = { n: s.n, p: s.p, q: s.q }; });

  const stationList = Object.entries(coords)
    .map(([id, c]) => {
      const m = metaById[id];
      if (!m) return null;
      return { id, n: m.n, p: m.p, q: m.q, lat: c.lat, lon: c.lon };
    })
    .filter(Boolean);
  console.log(`  Stazioni con metadati completi: ${stationList.length}`);

  const dates = dateRange(START_DATE, END_DATE);
  console.log(`  Giorni da ricostruire: ${dates.length}`);

  let done = 0, errors = 0, skipped = 0, consecutiveErrors = 0;
  for (const dateStr of dates) {
    if (consecutiveErrors >= 3) {
      console.warn(`\n  ⚠️  3 giorni falliti di fila, probabile ban/quota esaurita. Mi fermo qui per non peggiorare le cose.`);
      break;
    }
    const outFile = path.join(DATA_DIR, `${dateStr}.json`);
    if (fs.existsSync(outFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        if (existing.source === 'open-meteo-backfill-toscana' && existing.count > 300) {
          skipped++;
          continue;
        }
      } catch (e) { /* file corrotto, ricostruisci */ }
    }
    try {
      const stations = [];
      for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
        const batch = stationList.slice(i, i + BATCH_SIZE);
        const lats = batch.map(s => s.lat).join(',');
        const lons = batch.map(s => s.lon).join(',');
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;
        const data = await fetchJSON(url);
        const arr = Array.isArray(data) ? data : [data];

        arr.forEach((loc, j) => {
          const s = batch[j];
          if (!s) return;
          const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
          stations.push({ id: s.id, n: s.n, lat: s.lat, lon: s.lon, q: s.q, p: s.p,
                           mm: mm > 300 ? 0 : Math.round((mm || 0) * 10) / 10 });
        });
        process.stdout.write(`  ${dateStr} batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(stationList.length / BATCH_SIZE)}\r`);
        await sleep(BATCH_DELAY);
      }

      fs.writeFileSync(outFile, JSON.stringify({
        date: dateStr,
        collected: new Date().toISOString(),
        source: 'open-meteo-backfill-toscana',
        count: stations.length,
        stations
      }));
      done++;
      consecutiveErrors = 0;
      console.log(`  ${dateStr} ✓ (${stations.length} stazioni)                    `);
    } catch (e) {
      console.warn(`\n  ${dateStr} errore: ${e.message}`);
      errors++;
      consecutiveErrors++;
      await sleep(2000);
    }
  }

  console.log(`\n\n  Ricostruiti: ${done} | Saltati (già fatti): ${skipped} | Errori: ${errors}`);
  console.log('✅ Completato.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
