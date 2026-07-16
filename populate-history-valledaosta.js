/**
 * populate-history-valledaosta.js
 * Genera file JSON storici per Valle d'Aosta usando Open-Meteo Archive
 * Uso: node populate-history-valledaosta.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const DAYS_BACK = 365;
const DELAY_MS  = 2000;
const DATA_DIR  = path.join(__dirname, 'data', 'valledaosta');

const STATIONS = [
  {n:"Aosta",                lat:45.737, lon:7.315,  q:583},
  {n:"Saint-Vincent",        lat:45.751, lon:7.640,  q:575},
  {n:"Châtillon",            lat:45.747, lon:7.618,  q:549},
  {n:"Pont-Saint-Martin",    lat:45.597, lon:7.796,  q:345},
  {n:"Verrès",               lat:45.665, lon:7.688,  q:391},
  {n:"Courmayeur",           lat:45.796, lon:6.970,  q:1224},
  {n:"La Thuile",            lat:45.714, lon:6.952,  q:1441},
  {n:"Morgex",               lat:45.754, lon:7.043,  q:923},
  {n:"Pré-Saint-Didier",     lat:45.766, lon:6.988,  q:1004},
  {n:"Sarre",                lat:45.716, lon:7.269,  q:631},
  {n:"Charvensod",           lat:45.712, lon:7.353,  q:762},
  {n:"Gressan",              lat:45.700, lon:7.317,  q:893},
  {n:"Brissogne",            lat:45.694, lon:7.419,  q:585},
  {n:"Fénis",                lat:45.730, lon:7.497,  q:537},
  {n:"Chambave",             lat:45.745, lon:7.572,  q:497},
  {n:"Montjovet",            lat:45.715, lon:7.669,  q:398},
  {n:"Bard",                 lat:45.608, lon:7.743,  q:400},
  {n:"Donnas",               lat:45.603, lon:7.764,  q:322},
  {n:"Gressoney-Saint-Jean", lat:45.787, lon:7.829,  q:1385},
  {n:"Champoluc",            lat:45.828, lon:7.726,  q:1568},
  {n:"Brusson",              lat:45.762, lon:7.742,  q:1338},
  {n:"Antagnod",             lat:45.816, lon:7.748,  q:1699},
  {n:"Rhêmes-Notre-Dame",    lat:45.598, lon:7.132,  q:1731},
  {n:"Valsavarenche",        lat:45.591, lon:7.224,  q:1540},
  {n:"Cogne",                lat:45.608, lon:7.358,  q:1534},
  {n:"Villeneuve",           lat:45.697, lon:7.199,  q:747},
  {n:"Introd",               lat:45.654, lon:7.199,  q:850},
  {n:"Arvier",               lat:45.693, lon:7.160,  q:775},
  {n:"Avise",                lat:45.724, lon:7.108,  q:905},
  {n:"Valpelline",           lat:45.831, lon:7.330,  q:960}
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

async function fetchJSON(url, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', reject);
    });
    if (result.status === 200) return JSON.parse(result.data);
    if (result.status === 429) {
      const wait = 5 * 60 * 1000;
      console.warn(`\n  ⏳ Rate limit 429, attendo 5 minuti... (tentativo ${attempt + 1}/${retries})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${result.status}`);
  }
  throw new Error('Troppi tentativi falliti');
}

async function main() {
  console.log(`\n🍄 Pre-popolamento storico Valle d'Aosta`);
  console.log(`   Periodo: ultimi ${DAYS_BACK} giorni\n`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
      const lats = STATIONS.map(s => s.lat).join(',');
      const lons = STATIONS.map(s => s.lon).join(',');
      const url  = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;
      const data = await fetchJSON(url);
      const arr  = Array.isArray(data) ? data : [data];

      const stations = arr.map((loc, i) => {
        const s = STATIONS[i];
        if (!s) return null;
        const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
        return { id:`om_vda_${i}`, n:s.n, lat:s.lat, lon:s.lon, q:s.q, p:'AO',
                 mm: mm > 300 ? 0 : Math.round((mm||0)*10)/10 };
      }).filter(Boolean);

      fs.writeFileSync(outFile, JSON.stringify({
        date:dateStr, collected:new Date().toISOString(),
        source:'open-meteo-archive', count:stations.length, stations
      }));
      created++;
      process.stdout.write(`  ${dateStr} ✓ (${stations.length} stazioni)\r`);
      await sleep(DELAY_MS);
    } catch(e) {
      console.warn(`\n  ${dateStr} errore: ${e.message}`);
      errors++;
      await sleep(1000);
    }
  }

  console.log(`\n\n  Creati: ${created} | Saltati: ${skipped} | Errori: ${errors}`);
  console.log('\n✅ Completato! Carica data/valledaosta/ su GitHub.\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
