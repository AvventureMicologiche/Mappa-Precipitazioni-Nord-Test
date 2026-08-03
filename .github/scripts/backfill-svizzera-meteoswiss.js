/**
 * backfill-svizzera-meteoswiss.js  —  UNA TANTUM, da lanciare in LOCALE
 * (scarica ~1 GB di CSV storici: non ha senso farlo girare su Actions).
 *
 * Costruisce data/svizzera/ per la finestra retention completa (365 giorni)
 * con DATI REALI di stazione: a differenza dei backfill Open-Meteo di VdA e
 * Friuli, MeteoSwiss pubblica lo storico completo, quindi qui non c'è nessuna
 * stima — stessa ricetta del collector (somma oraria rre150h0, timestamp di
 * fine intervallo, sul giorno solare italiano; MIN_ORE=20).
 *
 * Sorgenti per stazione:
 *  - _h_historical_2020-2029.csv  → fino al 31/12/2025 (agosto-dicembre 2025)
 *  - _h_recent.csv                → anno 2026
 * I giorni già presenti con count>=150 (scritti dal collector) vengono saltati.
 * I file scritti hanno "backfill": true per distinguerli, ma source resta
 * 'meteoswiss': sono dati reali, non stime.
 *
 * Uso:  node .github/scripts/backfill-svizzera-meteoswiss.js
 *       (opzionale: FROM=2025-08-04 TO=2026-07-23)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '../..', 'data', 'svizzera');
const BASE     = 'https://data.geo.admin.ch';
const COLLECTIONS = [
  { id: 'ch.meteoschweiz.ogd-smn',        prefix: 'ogd-smn'        },
  { id: 'ch.meteoschweiz.ogd-smn-precip', prefix: 'ogd-smn-precip' },
];
const MIN_ORE     = 20;
const CONCURRENCY = 6;
// Stessa esclusione del collector: S. Bernardino è già in OASI (Moesano, GR)
const SVIZZERA_ESCLUSE = ['SBE'];

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
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchBuf(url, tries) {
  tries = tries || 3;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': '*/*', 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } }, res => {
      if (res.statusCode === 404) { res.resume(); resolve(null); return; }
      if (res.statusCode !== 200) {
        res.resume();
        if (tries > 1) return resolve(sleep(3000).then(() => fetchBuf(url, tries - 1)));
        return reject(new Error(`HTTP ${res.statusCode} su ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(180000, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => {
      if (tries > 1) resolve(sleep(3000).then(() => fetchBuf(url, tries - 1)));
      else reject(e);
    });
  });
}

function parseCsv(buf, latin1) {
  const lines = buf.toString(latin1 ? 'latin1' : 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length < 2) continue;
    const row = {};
    for (let j = 0; j < head.length; j++) row[head[j]] = c[j];
    out.push(row);
  }
  return out;
}
function parseTs(s) {
  const m = (s || '').match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}
/** Colonna rre150h0, solo righe con tMin <= t <= tMax (per non tenere in RAM 6 anni di ore). */
function parseHourly(buf, tMin, tMax) {
  const lines = buf.toString('utf8').trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const iTs = head.indexOf('reference_timestamp');
  const iV  = head.indexOf('rre150h0');
  if (iTs < 0 || iV < 0) return null;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    const t = parseTs(c[iTs]);
    if (t === null || t < tMin || t > tMax) continue;
    const raw = c[iV];
    if (raw === '' || raw === undefined) continue;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) continue;
    out.push([t, v]);
  }
  return out;
}
function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { start, end: start + 24 * 3600000 };
}

async function buildStationList() {
  const stations = [];
  const seen = new Set();
  for (const col of COLLECTIONS) {
    const [metaBuf, invBuf] = await Promise.all([
      fetchBuf(`${BASE}/${col.id}/${col.prefix}_meta_stations.csv`),
      fetchBuf(`${BASE}/${col.id}/${col.prefix}_meta_datainventory.csv`),
    ]);
    if (!metaBuf || !invBuf) throw new Error(`Anagrafe ${col.id} non scaricabile`);
    const active = new Set(
      parseCsv(invBuf, true)
        .filter(r => r.parameter_shortname === 'rre150h0' && !(r.data_till || '').trim())
        .map(r => r.station_abbr)
    );
    for (const r of parseCsv(metaBuf, true)) {
      const abbr = r.station_abbr;
      if (!abbr || seen.has(abbr) || !active.has(abbr)) continue;
      if (r.station_canton === 'TI') continue;
      if (SVIZZERA_ESCLUSE.includes(abbr)) continue;
      const lat = parseFloat(r.station_coordinates_wgs84_lat);
      const lon = parseFloat(r.station_coordinates_wgs84_lon);
      if (isNaN(lat) || isNaN(lon)) continue;
      seen.add(abbr);
      stations.push({
        abbr, col,
        name:   r.station_name,
        canton: r.station_canton || '',
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        q:   Math.round(parseFloat(r.station_height_masl) || 0),
      });
    }
  }
  return stations;
}

async function main() {
  console.log('=== backfill-svizzera-meteoswiss (una tantum) ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Finestra: dal limite retention a ieri-11 (i giorni 1..10 li fa il collector)
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const defFrom = fmtDate(new Date(todayNoon - 364 * 24 * 3600000));
  const defTo   = fmtDate(new Date(todayNoon - 11 * 24 * 3600000));
  const FROM = (process.env.FROM || defFrom).trim();
  const TO   = (process.env.TO   || defTo).trim();

  const days = [];
  for (let t = Date.parse(FROM + 'T12:00:00Z'); t <= Date.parse(TO + 'T12:00:00Z'); t += 24 * 3600000) {
    const dateStr = fmtDate(new Date(t));
    const f = path.join(DATA_DIR, `${dateStr}.json`);
    let skip = false;
    if (fs.existsSync(f)) {
      try { skip = (JSON.parse(fs.readFileSync(f, 'utf8')).count || 0) >= 150; } catch (e) {}
    }
    if (!skip) days.push(Object.assign({ dateStr }, dayWindow(dateStr)));
  }
  console.log(`  Giorni da costruire: ${days.length} (${FROM} → ${TO})`);
  if (days.length === 0) { console.log('  Niente da fare.'); return; }
  const tMin = Math.min.apply(null, days.map(w => w.start));
  const tMax = Math.max.apply(null, days.map(w => w.end));
  const needHistorical = tMin < Date.parse('2026-01-01T00:00:00Z');

  const stations = await buildStationList();
  console.log(`  Stazioni: ${stations.length} — scarico historical 2020-2029${needHistorical ? '' : ' (non serve)'} + recent`);

  const perDay = {};
  for (const w of days) perDay[w.dateStr] = [];
  let done = 0, failed = 0;

  async function doStation(st) {
    const low = st.abbr.toLowerCase();
    const baseUrl = `${BASE}/${st.col.id}/${low}/${st.col.prefix}_${low}_h`;
    let rows = [];
    if (needHistorical) {
      const hBuf = await fetchBuf(`${baseUrl}_historical_2020-2029.csv`);
      if (hBuf) rows = parseHourly(hBuf, tMin, tMax) || [];
    }
    const rBuf = await fetchBuf(`${baseUrl}_recent.csv`);
    if (rBuf) {
      const rRows = parseHourly(rBuf, tMin, tMax) || [];
      const lastH = rows.length ? rows[rows.length - 1][0] : -Infinity;
      for (const r of rRows) if (r[0] > lastH) rows.push(r);
    }
    if (rows.length === 0) return;
    for (const w of days) {
      let sum = 0, n = 0;
      for (const [t, v] of rows) if (t > w.start && t <= w.end) { sum += v; n++; }
      if (n >= MIN_ORE) {
        const mm = Math.round(sum * 10) / 10;
        if (mm >= 0 && mm <= 500) {
          perDay[w.dateStr].push({ id: st.abbr, n: st.name, lat: st.lat, lon: st.lon, q: st.q, p: st.canton, mm });
        }
      }
    }
  }

  for (let i = 0; i < stations.length; i += CONCURRENCY) {
    const batch = stations.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(st => doStation(st).catch(e => {
      console.warn(`\n  Warn: ${st.abbr} (${st.name}) fallita: ${e.message}`);
      failed++;
    })));
    done += batch.length;
    process.stdout.write(`  ${done}/${stations.length} stazioni\r`);
    await sleep(100);
  }
  console.log('');
  if (failed > 0) console.log(`  (${failed} stazioni fallite)`);
  if (failed > stations.length / 10) throw new Error('Troppe stazioni fallite: rilanciare');

  let written = 0, short = 0;
  for (const w of days) {
    const list = perDay[w.dateStr];
    if (list.length < 150) { short++; console.warn(`  ⚠️ ${w.dateStr}: solo ${list.length} stazioni, NON scritto`); continue; }
    fs.writeFileSync(path.join(DATA_DIR, `${w.dateStr}.json`), JSON.stringify({
      date:      w.dateStr,
      collected: new Date().toISOString(),
      source:    'meteoswiss',
      backfill:  true,
      count:     list.length,
      stations:  list,
    }));
    written++;
  }
  console.log(`  ✅ Scritti ${written} giorni${short ? `, ${short} saltati perché corti` : ''}`);
  console.log('=== backfill completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
