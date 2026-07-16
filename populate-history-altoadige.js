/**
 * populate-history-altoadige.js
 * Genera file JSON storici per Alto Adige
 * - Oggi: dati Meteo Alto Adige reali (valley.json)
 * - Giorni precedenti: Open-Meteo Archive
 * Salta i file già esistenti (non sovrascrive dati reali)
 *
 * Uso: node populate-history-altoadige.js
 * Prerequisiti: Node.js 18+
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Configurazione ──────────────────────────────────────────────
const DAYS_BACK = 365;
const DELAY_MS  = 2000;
const DATA_DIR  = path.join(__dirname, 'data', 'altoadige');
const API_URL   = 'https://static-meteo.provincia.bz.it/stations-data/website/valley.json';

// Stazioni per Open-Meteo Archive
const OM_STATIONS = [
  {n:"Bolzano",              lat:46.498, lon:11.313, q:262},
  {n:"Merano",               lat:46.671, lon:11.159, q:323},
  {n:"Bressanone",           lat:46.715, lon:11.657, q:559},
  {n:"Brunico",              lat:46.797, lon:11.936, q:838},
  {n:"Silandro",             lat:46.627, lon:10.777, q:720},
  {n:"Vipiteno",             lat:46.895, lon:11.433, q:948},
  {n:"Ortisei",              lat:46.575, lon:11.672, q:1236},
  {n:"Corvara",              lat:46.550, lon:11.874, q:1568},
  {n:"Dobbiaco",             lat:46.731, lon:12.219, q:1256},
  {n:"San Candido",          lat:46.732, lon:12.284, q:1175},
  {n:"Glorenza",             lat:46.671, lon:10.555, q:920},
  {n:"Passo Resia",          lat:46.838, lon:10.524, q:1504},
  {n:"Solda",                lat:46.529, lon:10.587, q:1906},
  {n:"Malles Venosta",       lat:46.691, lon:10.543, q:1050},
  {n:"Laces",                lat:46.619, lon:10.862, q:639},
  {n:"Naturno",              lat:46.648, lon:10.991, q:554},
  {n:"Postal",               lat:46.622, lon:11.121, q:337},
  {n:"Appiano",              lat:46.448, lon:11.259, q:418},
  {n:"Egna",                 lat:46.319, lon:11.278, q:222},
  {n:"Caldaro",              lat:46.378, lon:11.241, q:425},
  {n:"Nova Ponente",         lat:46.428, lon:11.427, q:1388},
  {n:"Fiè allo Sciliar",     lat:46.517, lon:11.510, q:880},
  {n:"Castelrotto",          lat:46.567, lon:11.568, q:1060},
  {n:"Sarentino",            lat:46.633, lon:11.357, q:970},
  {n:"Chiusa",               lat:46.641, lon:11.563, q:525},
  {n:"Villandro",            lat:46.596, lon:11.526, q:880},
  {n:"Velturno",             lat:46.682, lon:11.605, q:880},
  {n:"Rio di Pusteria",      lat:46.811, lon:11.752, q:744},
  {n:"Campo Tures",          lat:46.918, lon:11.960, q:860},
  {n:"Selva Val Gardena",    lat:46.556, lon:11.762, q:1563},
  {n:"Ortisei",              lat:46.575, lon:11.672, q:1236},
  {n:"La Villa",             lat:46.572, lon:11.903, q:1480},
  {n:"Monguelfo",            lat:46.751, lon:12.124, q:1087},
  {n:"Rasun Anterselva",     lat:46.873, lon:12.083, q:1054},
  {n:"Valdaora",             lat:46.762, lon:11.984, q:1054},
  {n:"Falzes",               lat:46.784, lon:11.853, q:980},
  {n:"Perca",                lat:46.731, lon:11.877, q:960},
  {n:"Brunico",              lat:46.797, lon:11.936, q:838},
  {n:"Termeno",              lat:46.353, lon:11.229, q:276},
  {n:"Cortaccia",            lat:46.316, lon:11.222, q:333},
  {n:"Salorno",              lat:46.236, lon:11.186, q:212},
  {n:"Laives",               lat:46.426, lon:11.335, q:250},
  {n:"Terlano",              lat:46.530, lon:11.249, q:285},
  {n:"Nalles",               lat:46.570, lon:11.195, q:357},
  {n:"Gargazzone",           lat:46.578, lon:11.200, q:257},
  {n:"Lana",                 lat:46.614, lon:11.148, q:350},
  {n:"Lagundo",              lat:46.686, lon:11.108, q:397},
  {n:"Scena",                lat:46.684, lon:11.133, q:650},
  {n:"Parcines",             lat:46.680, lon:11.063, q:640},
  {n:"Passo Brennero",       lat:47.004, lon:11.508, q:1374}
];

// ── Utility ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

async function fetchJSON(url, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'Accept': 'application/json,*/*', 'User-Agent': 'Mozilla/5.0' }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', reject);
    });

    if (result.status === 200) return JSON.parse(result.data);
    if (result.status === 429) {
      const wait = 60000 * (attempt + 1);
      console.warn(`\n  Rate limit 429, attendo ${wait/1000}s...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${result.status}`);
  }
  throw new Error('Troppi tentativi falliti');
}

// ── Fetch dati Alto Adige oggi ───────────────────────────────────
async function fetchAltoAdige() {
  console.log('Scarico dati Meteo Alto Adige...');
  const data = await fetchJSON(API_URL);
  const stazioni = data.stations || [];

  const stations = stazioni.map(s => {
    if (!s.lat || !s.lon) return null;
    const nSensor = (s.statistics || []).find(x => x.sensorCode === 'N');
    if (!nSensor || nSensor.sensorValue === null || nSensor.sensorValue === undefined) return null;
    const mm = parseFloat(nSensor.sensorValue);
    if (isNaN(mm) || mm < 0) return null;
    return {
      id:  s.code,
      n:   s.name_it || s.name_de || s.code,
      lat: s.lat,
      lon: s.lon,
      q:   s.elevation || 0,
      p:   'BZ',
      mm:  Math.round(mm * 10) / 10
    };
  }).filter(Boolean);

  const dateStr = fmtDate(new Date());
  console.log(`  Stazioni con dati oggi (${dateStr}): ${stations.length}`);
  return { [dateStr]: stations };
}

// ── Fetch Open-Meteo Archive per un giorno ───────────────────────
async function fetchDayOM(stations, dateStr, offset = 0) {
  const lats = stations.map(s => s.lat).join(',');
  const lons = stations.map(s => s.lon).join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;

  const data = await fetchJSON(url);
  const arr = Array.isArray(data) ? data : [data];

  return arr.map((loc, i) => {
    const s = stations[i];
    if (!s) return null;
    const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
    return {
      id:  `om_bz_${offset + i}`,
      n:   s.n,
      lat: s.lat,
      lon: s.lon,
      q:   s.q,
      p:   'BZ',
      mm:  mm > 300 ? 0 : Math.round((mm || 0) * 10) / 10
    };
  }).filter(Boolean);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🍄 Pre-popolamento storico Alto Adige`);
  console.log(`   Periodo: ultimi ${DAYS_BACK} giorni`);
  console.log(`   Meteo Alto Adige per oggi, Open-Meteo Archive per il resto\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const aaByDate = await fetchAltoAdige();

  const today = new Date();
  const dates = [];
  for (let i = 0; i <= DAYS_BACK; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600000);
    dates.push(fmtDate(d));
  }

  let created = 0, skipped = 0, errors = 0;

  for (const dateStr of dates) {
    const outFile = path.join(DATA_DIR, `${dateStr}.json`);

    if (fs.existsSync(outFile)) { skipped++; continue; }

    try {
      let stations = [];
      let source = '';

      if (aaByDate[dateStr] && aaByDate[dateStr].length >= 10) {
        stations = aaByDate[dateStr];
        source = 'meteo-altoadige';
        process.stdout.write(`  ${dateStr} ✓ AA (${stations.length} stazioni)\r`);
      } else {
        const BATCH = 50;
        for (let i = 0; i < OM_STATIONS.length; i += BATCH) {
          const batch = OM_STATIONS.slice(i, i + BATCH);
          const results = await fetchDayOM(batch, dateStr, i);
          stations.push(...results);
          if (i + BATCH < OM_STATIONS.length) await sleep(200);
        }
        source = 'open-meteo-archive';
        process.stdout.write(`  ${dateStr} ✓ OM (${stations.length} stazioni)\r`);
        await sleep(DELAY_MS);
      }

      if (stations.length < 5) { errors++; continue; }

      fs.writeFileSync(outFile, JSON.stringify({
        date:      dateStr,
        collected: new Date().toISOString(),
        source,
        count:     stations.length,
        stations
      }));
      created++;

    } catch(e) {
      console.warn(`\n  ${dateStr} errore: ${e.message}`);
      errors++;
      await sleep(1000);
    }
  }

  console.log(`\n\n  Creati: ${created} | Saltati: ${skipped} | Errori: ${errors}`);
  console.log('\n✅ Completato! Carica data/altoadige/ su GitHub.\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
