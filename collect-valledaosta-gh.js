/**
 * collect-valledaosta-gh.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Valle d'Aosta
 * Fonte: Open-Meteo forecast (API pubblica)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'valledaosta');

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
  {n:"Valpelline",           lat:45.831, lon:7.330,  q:960},
  {n:"Cervinia",             lat:45.937, lon:7.626,  q:2050},
  {n:"Antey-Saint-Andre",    lat:45.814, lon:7.619,  q:1080},
  {n:"Torgnon",              lat:45.839, lon:7.570,  q:1489},
  {n:"Etroubles",            lat:45.822, lon:7.233,  q:1280},
  {n:"Saint-Oyen",           lat:45.835, lon:7.194,  q:1370},
  {n:"Gran-San-Bernardo",    lat:45.869, lon:7.171,  q:2469},
  {n:"Entrevès",             lat:45.834, lon:6.990,  q:1306},
  {n:"La-Palud",             lat:45.820, lon:6.970,  q:1370},
  {n:"Nus",                  lat:45.737, lon:7.471,  q:549},
  {n:"Quart",                lat:45.737, lon:7.415,  q:623},
  {n:"Saint-Christophe",     lat:45.737, lon:7.370,  q:631},
  {n:"Jovençan",             lat:45.680, lon:7.290,  q:870},
  {n:"Roisan",               lat:45.800, lon:7.280,  q:1080}
];

function getItalyOffset(date) {
  // Calcola offset italiano basato sul calendario (non getTimezoneOffset che è 0 su server UTC)
  // CEST (UTC+2): ultima domenica marzo → ultima domenica ottobre
  // CET  (UTC+1): resto dell'anno
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== collect-valledaosta-gh avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const now = new Date();
  const dateStr = process.env.DATE_OVERRIDE || fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));
  console.log(`  Data: ${dateStr}`);

  const lats = STATIONS.map(s => s.lat).join(',');
  const lons = STATIONS.map(s => s.lon).join(',');
  const url  = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;

  console.log('  Fetch Open-Meteo Archive...');
  const data = await fetchJSON(url);
  const arr  = Array.isArray(data) ? data : [data];

  const stations = arr.map((loc, i) => {
    const s  = STATIONS[i];
    if (!s) return null;
    const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
    return {
      id:  `om_vda_${i}`,
      n:   s.n,
      lat: s.lat,
      lon: s.lon,
      q:   s.q,
      p:   'AO',
      mm:  mm > 300 ? 0 : Math.round((mm || 0) * 10) / 10
    };
  }).filter(Boolean);

  console.log(`  Stazioni: ${stations.length}`);
  if (stations.length < 5) throw new Error(`Troppo poche stazioni: ${stations.length}`);

  const outFile = path.join(DATA_DIR, `${dateStr}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'open-meteo',
    count:     stations.length,
    stations
  }));
  console.log(`✅ Scritto ${outFile}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
