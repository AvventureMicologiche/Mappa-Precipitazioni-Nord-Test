/**
 * populate-history-friuli.js
 * Genera file JSON storici per Friuli-Venezia Giulia usando Open-Meteo Archive
 * Uso: node populate-history-friuli.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const DAYS_BACK = 365;
const DELAY_MS  = 2000;
const DATA_DIR  = path.join(__dirname, 'data', 'friuli');

const STATIONS = [
  {n:"Trieste",              lat:45.649, lon:13.764, q:30,  p:"TS"},
  {n:"Udine",                lat:46.063, lon:13.235, q:113, p:"UD"},
  {n:"Pordenone",            lat:45.954, lon:12.661, q:24,  p:"PN"},
  {n:"Gorizia",              lat:45.940, lon:13.622, q:84,  p:"GO"},
  {n:"Monfalcone",           lat:45.800, lon:13.537, q:5,   p:"GO"},
  {n:"Lignano",              lat:45.690, lon:13.133, q:2,   p:"UD"},
  {n:"Cervignano del Friuli",lat:45.823, lon:13.336, q:8,   p:"UD"},
  {n:"Palmanova",            lat:45.906, lon:13.307, q:27,  p:"UD"},
  {n:"Cividale del Friuli",  lat:46.094, lon:13.432, q:135, p:"UD"},
  {n:"Gemona del Friuli",    lat:46.275, lon:13.137, q:272, p:"UD"},
  {n:"Tolmezzo",             lat:46.399, lon:13.006, q:324, p:"UD"},
  {n:"Tarvisio",             lat:46.506, lon:13.573, q:754, p:"UD"},
  {n:"Pontebba",             lat:46.503, lon:13.303, q:570, p:"UD"},
  {n:"Cave del Predil",      lat:46.423, lon:13.553, q:900, p:"UD"},
  {n:"Forni di Sopra",       lat:46.425, lon:12.579, q:907, p:"UD"},
  {n:"Sappada",              lat:46.570, lon:12.708, q:1265,p:"UD"},
  {n:"Piancavallo",          lat:46.115, lon:12.524, q:1275,p:"PN"},
  {n:"Brugnera",             lat:45.918, lon:12.545, q:22,  p:"PN"},
  {n:"San Vito al Tagliamento",lat:45.912,lon:12.858,q:25, p:"PN"},
  {n:"Codroipo",             lat:45.960, lon:13.001, q:36,  p:"UD"},
  {n:"Fagagna",              lat:46.113, lon:13.087, q:148, p:"UD"},
  {n:"Talmassons",           lat:45.882, lon:13.156, q:16,  p:"UD"},
  {n:"Capriva del Friuli",   lat:45.958, lon:13.512, q:85,  p:"GO"},
  {n:"Muggia",               lat:45.604, lon:13.762, q:2,   p:"TS"},
  {n:"Sgonico",              lat:45.738, lon:13.742, q:268, p:"TS"},
  {n:"Barcis",               lat:46.191, lon:12.563, q:465, p:"PN"},
  {n:"Chievolis",            lat:46.254, lon:12.734, q:345, p:"PN"},
  {n:"Enemonzo",             lat:46.410, lon:12.863, q:438, p:"UD"},
  {n:"Musi",                 lat:46.313, lon:13.275, q:600, p:"UD"},
  {n:"Bordano",              lat:46.333, lon:13.081, q:230, p:"UD"}
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
  console.log('\n🍄 Pre-popolamento storico Friuli-Venezia Giulia');
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
        return { id:`om_fvg_${i}`, n:s.n, lat:s.lat, lon:s.lon, q:s.q, p:s.p,
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
  console.log('\n✅ Completato! Carica data/friuli/ su GitHub.\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
