/**
 * backfill-ticino.js  —  script una tantum, non nella pipeline automatica
 * Popola data/ticino/<data>.json per gli ultimi N giorni con dati REALI di
 * stazione dall'archivio OASI (oasi.ti.ch), che supporta query storiche
 * giorno per giorno (verificato: Airolo dal 2017, Lugano dal 2005).
 *
 * A differenza del backfill Toscana (stime Open-Meteo su un buco non
 * recuperabile), qui sono dati di stazione autentici al 100%.
 *
 * Per gentilezza verso l'API gratuita: una chiamata per stazione per giorno
 * con pausa tra le richieste, e ripresa automatica (i giorni gia' scritti
 * con source oasi-ticino vengono saltati).
 *
 * Uso: node backfill-ticino.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DAYS_BACK = 120;  // giorni da ricostruire (esclusi oggi e i file gia' presenti)
const DELAY_MS  = 150;  // pausa tra richieste
const DATA_DIR  = path.join(__dirname, 'data', 'ticino');
const BASE_URL  = 'https://www.oasi.ti.ch/web/rest';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchRaw(url, retries = 3) {
  return new Promise(async (resolve, reject) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const data = await new Promise((res, rej) => {
          https.get(url, {
            headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => r.statusCode === 200 ? res(d) : rej(new Error(`HTTP ${r.statusCode}`)));
          }).on('error', rej);
        });
        return resolve(data);
      } catch (e) {
        if (attempt === retries - 1) return reject(e);
        await sleep(5000);
      }
    }
  });
}

function lv95ToWgs84(E, N) {
  const y = (E - 2600000) / 1000000;
  const x = (N - 1200000) / 1000000;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x;
  return { lat: lat * 100 / 36, lon: lon * 100 / 36 };
}

function parseOasiCsv(csv) {
  const rows = [];
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('data;')) continue;
    const parts = t.split(';');
    if (parts.length < 2) continue;
    const m = parts[0].match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) continue;
    const val = parseFloat(parts[1]);
    if (isNaN(val)) continue;
    rows.push({ date: `${m[3]}-${m[2]}-${m[1]}`, mm: val });
  }
  return rows;
}

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  console.log('=== backfill-ticino avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const locs = JSON.parse(await fetchRaw(`${BASE_URL}/locations?domain=meteo`));
  const stations = locs
    .filter(l => !((l.simpleOwner || l.owner || '').toUpperCase().includes('ARPA')))
    .map(l => {
      const c = l.coordinates || {};
      if (typeof c.x !== 'number' || typeof c.y !== 'number') return null;
      const w = lv95ToWgs84(c.x, c.y);
      return { code: l.code, name: l.name,
               lat: Math.round(w.lat * 10000) / 10000,
               lon: Math.round(w.lon * 10000) / 10000,
               q: Math.round(c.z || 0) };
    })
    .filter(Boolean);
  console.log(`  Stazioni utilizzabili: ${stations.length}`);

  // Da ieri all'indietro per DAYS_BACK giorni
  const dates = [];
  const todayNoon = new Date(fmtDate(new Date()) + 'T12:00:00Z').getTime();
  for (let i = 1; i <= DAYS_BACK; i++) {
    dates.push(fmtDate(new Date(todayNoon - i * 24 * 3600000)));
  }

  let done = 0, skipped = 0, errors = 0;
  for (const dateStr of dates) {
    const outFile = path.join(DATA_DIR, `${dateStr}.json`);
    if (fs.existsSync(outFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        if (existing.source === 'oasi-ticino' && existing.count >= 30) { skipped++; continue; }
      } catch (e) { /* file corrotto, ricostruisci */ }
    }

    const out = [];
    for (const s of stations) {
      try {
        const url = `${BASE_URL}/measure/csv?domain=meteo&resolution=d&parameter=Prec&from=${dateStr}&to=${dateStr}&location=${encodeURIComponent(s.code)}`;
        const rows = parseOasiCsv(await fetchRaw(url)).filter(r => r.date === dateStr);
        if (rows.length > 0) {
          const mm = Math.round(rows[0].mm * 10) / 10;
          if (mm >= 0 && mm <= 500) out.push({ id: s.code, n: s.name, lat: s.lat, lon: s.lon, q: s.q, p: 'TI', mm });
        }
        await sleep(DELAY_MS);
      } catch (e) { /* stazione senza dato per quel giorno: ok */ }
    }

    if (out.length < 10) {
      console.warn(`  ${dateStr}: solo ${out.length} stazioni, salto`);
      errors++;
      continue;
    }
    fs.writeFileSync(outFile, JSON.stringify({
      date: dateStr, collected: new Date().toISOString(),
      source: 'oasi-ticino', count: out.length, stations: out
    }));
    done++;
    console.log(`  ${dateStr} ✓ (${out.length} stazioni)`);
  }

  console.log(`\n  Ricostruiti: ${done} | Saltati (gia' presenti): ${skipped} | Problemi: ${errors}`);
  console.log('✅ Completato.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
