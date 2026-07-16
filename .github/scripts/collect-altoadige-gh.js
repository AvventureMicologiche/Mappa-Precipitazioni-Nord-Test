/**
 * collect-altoadige-gh.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Alto Adige
 * API: https://static-meteo.provincia.bz.it/stations-data/website/valley.json
 *   → restituisce tutte le stazioni con cumulato dalla mezzanotte
 * Sensore precipitazione: sensorCode = "N"
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'altoadige');
const API_URL  = 'https://static-meteo.provincia.bz.it/stations-data/website/valley.json';

function getItalyOffset(date) {
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
    https.get(url, {
      headers: {
        'Accept': 'application/json,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)'
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

async function main() {
  console.log('=== collect-altoadige-gh avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const now = new Date();
  const dateStr = process.env.DATE_OVERRIDE || fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));

  console.log(`  Data: ${dateStr}`);
  console.log('  Fetch dati Alto Adige...');

  const data = await fetchJSON(API_URL);
  const stazioni = data.stations || [];

  if (stazioni.length === 0) throw new Error('Nessuna stazione ricevuta');
  console.log(`  Stazioni totali: ${stazioni.length}`);

  const stations = stazioni.map(s => {
    if (!s.lat || !s.lon) return null;

    // Trova il sensore precipitazione (N = Niederschlag)
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

  console.log(`  Stazioni con dati: ${stations.length}`);
  if (stations.length < 10) throw new Error(`Troppo poche stazioni: ${stations.length}`);

  const outFile = path.join(DATA_DIR, `${dateStr}.json`);

  // Merge MAX con file esistente dello stesso giorno
  // Protegge da glitch API che restituiscono 0mm
  let finalStations = stations;
  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.date === dateStr && existing.stations) {
        const existMap = {};
        existing.stations.forEach(s => { existMap[s.id] = s.mm || 0; });
        finalStations = stations.map(s => {
          const prevMM = existMap[s.id] || 0;
          return { ...s, mm: Math.max(s.mm, prevMM) };
        });
        const newIds = new Set(stations.map(s => s.id));
        existing.stations.forEach(s => {
          if (!newIds.has(s.id) && s.mm > 0) finalStations.push(s);
        });
        console.log('  Merge MAX con file esistente applicato');
      }
    } catch(e) {
      console.warn('  Warn: merge fallito, uso dati nuovi');
    }
  }

  fs.writeFileSync(outFile, JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'meteo-altoadige',
    count:     finalStations.length,
    stations:  finalStations
  }));
  console.log(`✅ Scritto ${outFile} (${finalStations.length} stazioni)`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
