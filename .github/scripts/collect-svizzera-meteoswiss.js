/**
 * collect-svizzera-meteoswiss.js  —  GitHub Actions (PILOTA, repo di test)
 * Raccoglie precipitazioni giornaliere della SVIZZERA (esclusi Canton Ticino
 * e, di fatto, nient'altro) dall'Open Government Data di MeteoSvizzera.
 *
 * Fonte: OGD MeteoSwiss via API STAC della Confederazione (data.geo.admin.ch),
 * licenza CC BY 4.0, attribuzione "Fonte: MeteoSvizzera". Due collezioni:
 *  - ch.meteoschweiz.ogd-smn         → SwissMetNet, programma completo
 *  - ch.meteoschweiz.ogd-smn-precip  → rete pluviometrica automatica
 * File CSV per stazione, fascia "recent" = anno corrente. Le coordinate
 * dell'anagrafe sono già in WGS84 (niente conversione LV95, a differenza di OASI).
 *
 * RICETTA (validata il 3/8/2026 su 639 giorni-stazione, match al centesimo):
 * i giornalieri ufficiali NON coincidono col giorno solare italiano —
 *   rre150d0 = finestra climatologica 06-06 UTC
 *   rka150d0 = giorno di calendario UTC (00-24)
 * quindi si sommano le ORE (rre150h0, timestamp = FINE intervallo) sul giorno
 * solare italiano/svizzero, come per OSMER Friuli. MIN_ORE=20 su 24.
 *
 * Freschezza: il file _h_recent contiene già tutte le ore di ieri al mattino
 * presto (verificato alle 06:17 UTC); se l'ultima ora della finestra manca
 * (inverno: l'ora 23-24 UTC arriva col giorno dopo) si integra con _h_now
 * (aggiornato ogni 10 minuti, ~1 KB).
 *
 * Come OASI, l'archivio è interrogabile: "recent" copre l'intero anno, quindi
 * ogni run può auto-riparare GRATIS i giorni mancanti recenti (qui 3..10)
 * senza richieste aggiuntive. Un run fallito non perde mai dati.
 *
 * ESCLUSE le stazioni del Canton Ticino: quella zona è coperta da OASI
 * (~50 stazioni contro le 19 di MeteoSwiss sul cantone — vedi CLAUDE.md).
 * Le 3 stazioni del Liechtenstein (FL) restano: fuori dal confine ma utili
 * all'IDW della valle del Reno, come le 5 Veneto per il Friuli.
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
const MIN_ORE     = 20;   // ore valide minime per accettare il totale di un giorno
// OASI copre anche il Moesano grigionese, non solo il Canton Ticino: la
// S. Bernardino di MeteoSwiss è la STESSA stazione già pubblicata da OASI
// (distanza 0.01 km, valori identici — verificato il 3/8/2026, unico doppione
// sotto i 2 km su 260×47 coppie). Il filtro canton!=TI non la vede perché
// il paese sta in Canton Grigioni.
const SVIZZERA_ESCLUSE = ['SBE'];
const CONCURRENCY = 8;    // stazioni in parallelo (stile Liguria)
const REPAIR_DAYS = 10;   // auto-riparazione fino a D-10

function getItalyOffset(date) {
  // Svizzera e Italia condividono lo stesso fuso (CET/CEST)
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

/** GET → Buffer. 404 → null (stazione senza quel file, non è un errore). */
function fetchBuf(url, tries) {
  tries = tries || 2;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': '*/*', 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } }, res => {
      if (res.statusCode === 404) { res.resume(); resolve(null); return; }
      if (res.statusCode !== 200) {
        res.resume();
        if (tries > 1) return resolve(sleep(2000).then(() => fetchBuf(url, tries - 1)));
        return reject(new Error(`HTTP ${res.statusCode} su ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => {
      if (tries > 1) resolve(sleep(2000).then(() => fetchBuf(url, tries - 1)));
      else reject(e);
    });
  });
}

/** Parse CSV ';' → array di oggetti {col: val}. I meta sono in latin1. */
function parseCsv(buf, latin1) {
  const text = buf.toString(latin1 ? 'latin1' : 'utf8');
  const lines = text.trim().split(/\r?\n/);
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

/** "31.07.2026 14:00" → ms UTC (i timestamp OGD sono in UTC). */
function parseTs(s) {
  const m = (s || '').match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

/** Estrae [ [msUTC, mm], ... ] dalla colonna rre150h0 di un CSV orario. */
function parseHourly(buf) {
  const text = buf.toString('utf8');
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const iTs = head.indexOf('reference_timestamp');
  const iV  = head.indexOf('rre150h0');
  if (iTs < 0 || iV < 0) return null;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    const t = parseTs(c[iTs]);
    if (t === null) continue;
    const raw = c[iV];
    if (raw === '' || raw === undefined) continue;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) continue;
    out.push([t, v]);
  }
  return out;
}

/** Finestra UTC del giorno solare italiano D: (start, end] su timestamp di FINE ora. */
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
    // stazioni con la serie oraria di pioggia ATTIVA (data_till vuoto)
    const active = new Set(
      parseCsv(invBuf, true)
        .filter(r => r.parameter_shortname === 'rre150h0' && !(r.data_till || '').trim())
        .map(r => r.station_abbr)
    );
    for (const r of parseCsv(metaBuf, true)) {
      const abbr = r.station_abbr;
      if (!abbr || seen.has(abbr) || !active.has(abbr)) continue;
      if (r.station_canton === 'TI') continue; // coperto da OASI
      if (SVIZZERA_ESCLUSE.includes(abbr)) continue; // doppioni OASI fuori dal TI
      const lat = parseFloat(r.station_coordinates_wgs84_lat);
      const lon = parseFloat(r.station_coordinates_wgs84_lon);
      if (isNaN(lat) || isNaN(lon)) continue;
      seen.add(abbr);
      stations.push({
        abbr,
        col,
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

/**
 * Scarica gli orari di una stazione e restituisce { 'YYYY-MM-DD': mm } per i
 * giorni richiesti. `windows` = [{dateStr, start, end}], maxEnd = fine più tarda.
 */
async function collectStation(st, windows, maxEnd) {
  const low = st.abbr.toLowerCase();
  const baseUrl = `${BASE}/${st.col.id}/${low}/${st.col.prefix}_${low}_h`;
  const recBuf = await fetchBuf(`${baseUrl}_recent.csv`);
  if (!recBuf) return null;
  let rows = parseHourly(recBuf);
  if (!rows || rows.length === 0) return null;
  // se il recent non arriva alla fine della finestra più recente, integra con now
  if (rows[rows.length - 1][0] < maxEnd) {
    const nowBuf = await fetchBuf(`${baseUrl}_now.csv`);
    if (nowBuf) {
      const nowRows = parseHourly(nowBuf) || [];
      const lastRec = rows[rows.length - 1][0];
      for (const r of nowRows) if (r[0] > lastRec) rows.push(r);
    }
  }
  const res = {};
  for (const w of windows) {
    let sum = 0, n = 0;
    for (const [t, v] of rows) {
      if (t > w.start && t <= w.end) { sum += v; n++; }
    }
    if (n >= MIN_ORE) {
      const mm = Math.round(sum * 10) / 10;
      if (mm >= 0 && mm <= 500) res[w.dateStr] = mm;
    }
  }
  return res;
}

function loadExisting(dateStr) {
  const f = path.join(DATA_DIR, `${dateStr}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/** Merge per stazione: il valore nuovo vince, le stazioni vecchie senza valore nuovo restano. */
function writeDay(dateStr, freshStations) {
  const existing = loadExisting(dateStr);
  const byId = {};
  if (existing && Array.isArray(existing.stations)) {
    for (const s of existing.stations) byId[s.id] = s;
  }
  for (const s of freshStations) byId[s.id] = s;
  const merged = Object.values(byId);
  if (merged.length < 30) {
    console.warn(`  ${dateStr}: solo ${merged.length} stazioni, salto la scrittura`);
    return false;
  }
  fs.writeFileSync(path.join(DATA_DIR, `${dateStr}.json`), JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'meteoswiss',
    count:     merged.length,
    stations:  merged,
  }));
  console.log(`  ✅ ${dateStr}: ${merged.length} stazioni (${freshStations.length} fresche)`);
  return true;
}

async function main() {
  console.log('=== collect-svizzera-meteoswiss avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const stations = await buildStationList();
  console.log(`  Stazioni MeteoSwiss utilizzabili (rre150h0 attivo, escluso TI): ${stations.length}`);
  if (stations.length < 100) throw new Error(`Troppo poche stazioni in anagrafe: ${stations.length}`);

  // ── Giorni da raccogliere ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  let targets = [];   // {dateStr, always}
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    targets.push({ dateStr: process.env.DATE_OVERRIDE.trim(), always: true });
  } else {
    for (let i = 1; i <= REPAIR_DAYS; i++) {
      const dateStr = fmtDate(new Date(todayNoon - i * 24 * 3600000));
      if (i <= 2) { targets.push({ dateStr, always: true }); continue; }
      // 3..REPAIR_DAYS: solo se il file manca o è corto (auto-riparazione gratuita)
      const ex = loadExisting(dateStr);
      if (!ex || (ex.count || 0) < 150) targets.push({ dateStr, always: false });
    }
  }
  const windows = targets.map(t => Object.assign({ dateStr: t.dateStr }, dayWindow(t.dateStr)));
  const maxEnd = Math.max.apply(null, windows.map(w => w.end));
  console.log('  Giorni: ' + targets.map(t => t.dateStr + (t.always ? '' : ' (riparazione)')).join(', '));

  // ── Raccolta a batch ──
  const perDay = {};
  for (const w of windows) perDay[w.dateStr] = [];
  let done = 0, failed = 0;
  for (let i = 0; i < stations.length; i += CONCURRENCY) {
    const batch = stations.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(st =>
      collectStation(st, windows, maxEnd).catch(e => {
        console.warn(`\n  Warn: ${st.abbr} (${st.name}) fallita: ${e.message}`);
        failed++;
        return null;
      })
    ));
    for (let j = 0; j < batch.length; j++) {
      const st = batch[j], res = results[j];
      done++;
      if (!res) continue;
      for (const dateStr of Object.keys(res)) {
        perDay[dateStr].push({ id: st.abbr, n: st.name, lat: st.lat, lon: st.lon, q: st.q, p: st.canton, mm: res[dateStr] });
      }
    }
    process.stdout.write(`  ${done}/${stations.length} stazioni\r`);
    await sleep(100);
  }
  console.log('');
  if (failed > 0) console.log(`  (${failed} stazioni fallite)`);
  if (failed > stations.length / 2) throw new Error('Più di metà stazioni fallite: probabile problema di rete/API');

  for (const t of targets) writeDay(t.dateStr, perDay[t.dateStr]);

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
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

  console.log('=== collect-svizzera-meteoswiss completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
