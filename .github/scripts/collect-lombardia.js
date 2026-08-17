/**
 * collect-lombardia.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Lombardia da ARPA Lombardia (Socrata)
 * e le salva in file JSON giornalieri, come le altre regioni.
 *
 * Prima la Lombardia era l'UNICA regione caricata live dal browser (query
 * Socrata a ogni visualizzazione): lenta sui periodi lunghi (~60 richieste per
 * 30 giorni) e dipendente da Socrata in tempo reale. Passando ai file:
 *   - il sito legge file già pronti (veloce come le altre regioni)
 *   - i sensori MORTI (offline, nessun dato quel giorno) non entrano nel file
 *   - se Socrata va giù, lo storico resta comunque in mappa
 *
 * Fonti Socrata (pubbliche, dati.lombardia.it):
 *   - nf78-nj6b : anagrafe sensori (idsensore, nomestazione, lat, lng, quota, provincia)
 *   - 647i-nhxk : misure. sum(valore) su un giorno raggruppata per sensore = totale mm
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'lombardia');
const HOST     = 'www.dati.lombardia.it';

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJSON(pathQ, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      https.get({ host: HOST, path: pathQ, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)' } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); return reject(new Error(`HTTP ${res.statusCode}`)); }
          try { resolve(JSON.parse(data)); } catch(e) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(new Error('JSON: '+e.message)); }
        });
      }).on('error', e => { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(e); });
    };
    attempt(1);
  });
}

/** Anagrafe sensori pioggia: id -> {n, lat, lon, q, p, st (idstazione)}. */
async function fetchAnagrafe() {
  const where = encodeURIComponent("tipologia='Precipitazione'");
  const sel = encodeURIComponent('idsensore,idstazione,nomestazione,lat,lng,quota,provincia');
  const rows = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${sel}&$where=${where}`);
  const map = {};
  rows.forEach(r => {
    const lat = parseFloat(r.lat), lon = parseFloat(r.lng);
    if (!r.idsensore || isNaN(lat) || isNaN(lon)) return;
    map[r.idsensore] = { n: r.nomestazione || r.idsensore, lat: Math.round(lat*100000)/100000, lon: Math.round(lon*100000)/100000, q: parseInt(r.quota,10) || 0, p: r.provincia || '', st: r.idstazione || '' };
  });
  return map;
}

// ── Temperatura e vento (11/8/2026 — grafici stazione) ────────────────
// L'anagrafe ha anche sensori Temperatura (309, °C) e Velocità Vento
// (155, m/s → ×3,6); idstazione lega i sensori della stessa stazione
// fisica al pluviometro. La raffica NON esiste su Socrata → w[1] = null.
/** idstazione → idsensore per una tipologia (Temperatura / Velocità Vento). */
async function fetchSensoriMeteo(tipologia) {
  const where = encodeURIComponent(`tipologia='${tipologia}'`);
  const sel = encodeURIComponent('idsensore,idstazione');
  const rows = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${sel}&$where=${where}`);
  const map = {};
  rows.forEach(r => { if (r.idsensore && r.idstazione && !map[r.idstazione]) map[r.idstazione] = r.idsensore; });
  return map;
}

/**
 * t/w per idstazione sul giorno dateStr. UNA query raggruppata per
 * (sensore, ora): così la completezza si misura in ORE COPERTE (≥ MIN_ORE
 * come le altre reti), a prescindere dalla granularità del sensore
 * (temperatura a 10 min, vento a 5). valore > -50 esclude i -999 di ARPA.
 */
const MIN_ORE_METEO = 20;
async function fetchMeteoDay(dateStr, tempByStaz, windByStaz) {
  const sel = encodeURIComponent('idsensore,date_extract_hh(data) as h,min(valore) as mn,max(valore) as mx,avg(valore) as med,count(valore) as c');
  const where = encodeURIComponent(`data between '${dateStr}T00:00:00' and '${dateStr}T23:59:59' AND valore > -50`);
  const rows = await getJSON(`/resource/647i-nhxk.json?$select=${sel}&$where=${where}&$group=${encodeURIComponent('idsensore,h')}&$limit=50000`);
  const perSens = {};
  rows.forEach(r => { (perSens[r.idsensore] = perSens[r.idsensore] || []).push(r); });
  const tempSens = {}, windSens = {};
  Object.keys(tempByStaz).forEach(st => tempSens[tempByStaz[st]] = st);
  Object.keys(windByStaz).forEach(st => windSens[windByStaz[st]] = st);
  const out = {};
  Object.keys(perSens).forEach(id => {
    const ore = perSens[id];
    if (ore.length < MIN_ORE_METEO) return;
    if (tempSens[id]) {
      const mins = ore.map(o => parseFloat(o.mn)).filter(v => v >= -45 && v <= 50);
      const maxs = ore.map(o => parseFloat(o.mx)).filter(v => v >= -45 && v <= 50);
      if (mins.length >= MIN_ORE_METEO && maxs.length) {
        const st = tempSens[id];
        (out[st] = out[st] || {}).t = [Math.round(Math.min(...mins) * 10) / 10,
                                       Math.round(Math.max(...maxs) * 10) / 10];
      }
    }
    if (windSens[id]) {
      const medie = ore.map(o => parseFloat(o.med)).filter(v => v >= 0 && v < 60); // m/s
      if (medie.length >= MIN_ORE_METEO) {
        const st = windSens[id];
        (out[st] = out[st] || {}).w = [Math.round(medie.reduce((a, v) => a + v, 0) / medie.length * 3.6 * 10) / 10, null];
      }
    }
  });
  return out;
}

/** Totale giornaliero per sensore per il giorno dateStr (YYYY-MM-DD). */
async function fetchDay(dateStr, anagrafe, tempByStaz, windByStaz) {
  const where = encodeURIComponent(`data between '${dateStr}T00:00:00' and '${dateStr}T23:59:59' AND valore >= '0'`);
  const sel = encodeURIComponent('idsensore,sum(valore) as s');
  const rows = await getJSON(`/resource/647i-nhxk.json?$select=${sel}&$where=${where}&$group=idsensore&$limit=5000`);
  // t/w in un try: un guasto della query meteo non tocca mai la pioggia
  let meteo = {};
  if (tempByStaz) {
    try { meteo = await fetchMeteoDay(dateStr, tempByStaz, windByStaz); }
    catch (e) { console.warn(`  Warn meteo ${dateStr}: ${e.message}`); }
  }
  const stations = [];
  rows.forEach(r => {
    const meta = anagrafe[r.idsensore];
    if (!meta) return;                       // non è un sensore pioggia (o non in anagrafe)
    let mm = Math.round((parseFloat(r.s) || 0) * 10) / 10;
    if (mm < 0 || mm > 500) return;          // sanity per giorno singolo
    const rec = { id: r.idsensore, n: meta.n, lat: meta.lat, lon: meta.lon, q: meta.q, p: meta.p, mm };
    if (meta.st && meteo[meta.st]) Object.assign(rec, meteo[meta.st]);
    stations.push(rec);
  });
  return stations;
}

function writeDay(dateStr, stations) {
  if (stations.length < 50) { console.warn(`  ${dateStr}: solo ${stations.length} sensori, salto (query incompleta?)`); return false; }
  const outFile = path.join(DATA_DIR, `${dateStr}.json`);
  // Merge protezione: se esiste già un file con più sensori, non sovrascrivere al ribasso
  if (fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (prev.stations && prev.stations.length > stations.length * 1.2) {
        console.warn(`  ${dateStr}: esistente ha ${prev.stations.length} sensori vs ${stations.length}, non sovrascrivo`);
        return false;
      }
    } catch(e) {}
  }
  fs.writeFileSync(outFile, JSON.stringify({ date: dateStr, collected: new Date().toISOString(), source: 'arpa-lombardia-socrata', count: stations.length, stations }));
  console.log(`  ✅ ${dateStr}: ${stations.length} sensori`);
  return true;
}

async function main() {
  console.log('=== collect-lombardia avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const anagrafe = await fetchAnagrafe();
  console.log(`  Anagrafe: ${Object.keys(anagrafe).length} sensori pioggia`);
  if (Object.keys(anagrafe).length < 50) throw new Error('Anagrafe troppo piccola');
  let tempByStaz = null, windByStaz = null;
  try {
    tempByStaz = await fetchSensoriMeteo('Temperatura');
    windByStaz = await fetchSensoriMeteo('Velocità Vento');
    console.log(`  Sensori meteo: ${Object.keys(tempByStaz).length} temperatura, ${Object.keys(windByStaz).length} vento`);
  } catch (e) { console.warn('  Warn anagrafe meteo: ' + e.message); }

  // Giorni bersaglio: DATE_OVERRIDE (uno o "A:B" range) oppure ieri + altroieri
  let targetDays = [];
  const ov = (process.env.DATE_OVERRIDE || '').trim();
  if (ov.includes(':')) {
    const [a, b] = ov.split(':');
    let d = new Date(a + 'T12:00:00Z'), end = new Date(b + 'T12:00:00Z');
    while (d <= end) { targetDays.push(fmtDate(d)); d = new Date(d.getTime() + 86400000); }
  } else if (ov) {
    targetDays = [ov];
  } else {
    const now = new Date();
    const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
    const noon = new Date(fmtDate(italyNow) + 'T12:00:00Z').getTime();
    targetDays = [1, 2].map(i => fmtDate(new Date(noon - i * 86400000)));   // ieri + altroieri
  }

  for (const dStr of targetDays) {
    try { writeDay(dStr, await fetchDay(dStr, anagrafe, tempByStaz, windByStaz)); }
    catch(e) { console.warn(`  Warn ${dStr}: ${e.message}`); }
    await sleep(500);
  }

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .forEach(f => { if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; } });
  if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file eliminati`);

  console.log('=== collect-lombardia completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
