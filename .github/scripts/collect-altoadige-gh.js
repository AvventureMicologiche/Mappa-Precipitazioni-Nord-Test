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

  // ── Guardia: cumulato di mezzanotte non ancora azzerato ──────────
  // L'API BZ espone il cumulato dalla mezzanotte. I cron slittano
  // regolarmente di 40+ minuti, quindi il run di chiusura serale può
  // atterrare dopo mezzanotte: se in quel momento l'API non ha ancora
  // azzerato, i totali di IERI finiscono nel file di OGGI e il merge MAX
  // li congela per sempre (pioggia fantasma, 22 luglio 2026).
  // Un payload identico stazione per stazione a quello del giorno prima non
  // è una coincidenza possibile su decine di stazioni: è un reset mancato.
  // Soglia 90% (non 100%): il 27 luglio 2026 il reset era già avvenuto su
  // 2 stazioni su 58 al momento del run slittato e la guardia non è scattata.
  let skipWrite = false;
  if (!fs.existsSync(outFile)) {
    const prevStr = new Date(Date.UTC(
      +dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)
    ) - 86400000).toISOString().slice(0, 10);
    const prevFile = path.join(DATA_DIR, `${prevStr}.json`);
    if (fs.existsSync(prevFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
        const prevMap = new Map((prev.stations || []).map(s => [s.id, s.mm]));
        const totale = stations.reduce((a, s) => a + s.mm, 0);
        const identiche = stations.filter(s => prevMap.get(s.id) === s.mm).length;
        skipWrite = totale > 0 && identiche >= stations.length * 0.9;
        if (skipWrite) console.log(`  Guardia reset: ${identiche}/${stations.length} stazioni identiche a ${prevStr}`);
      } catch(e) {
        console.warn('  Warn: guardia reset non applicabile: ' + e.message);
      }
    }
  }

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

  if (skipWrite) {
    console.warn(`⚠️  Payload quasi identico al giorno precedente (≥90% stazioni): l'API non ha ancora azzerato il cumulato di mezzanotte. Salto la scrittura di ${dateStr}.`);
  } else {
    fs.writeFileSync(outFile, JSON.stringify({
      date:      dateStr,
      collected: new Date().toISOString(),
      source:    'meteo-altoadige',
      count:     finalStations.length,
      stations:  finalStations
    }));
    console.log(`✅ Scritto ${outFile} (${finalStations.length} stazioni)`);
  }

  // ── Pulizia file > 365 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 365;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(function(f) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(f); })
    .forEach(function(f) {
      if (f.replace('.json', '') < cutoffStr) {
        fs.unlinkSync(path.join(DATA_DIR, f));
        deleted++;
      }
    });
  if (deleted > 0) console.log('Pulizia retention: ' + deleted + ' file oltre i ' + MAX_DAYS + ' giorni eliminati');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
