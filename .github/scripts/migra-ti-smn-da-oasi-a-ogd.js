/**
 * migra-ti-smn-da-oasi-a-ogd.js — UNA TANTUM, da lanciare in LOCALE (11/8/2026)
 *
 * Le condizioni d'uso OASI vietano di ripubblicare i dati grezzi delle stazioni
 * di proprietà MeteoSvizzera, ma 9 di quelle stazioni erano nei nostri
 * data/ticino da mesi (il filtro escludeva solo le ARPA). Questa migrazione:
 *
 *  1. AGGIUNGE le stesse 9 stazioni fisiche ai file data/svizzera esistenti,
 *     ricostruendo la pioggia dall'orario MeteoSwiss OGD (CC BY) con la ricetta
 *     del collector (somma rre150h0, timestamp di fine, giorno solare italiano,
 *     MIN_ORE=20) su TUTTO lo storico; t/w solo dal 27/6/2026 (la data di
 *     METEO_HIST_FROM.svizzera, per coerenza col resto della rete).
 *  2. RIMUOVE le 9 gemelle OASI da tutti i file data/ticino (conteggi rifatti).
 *
 * Il file di OGGI non si tocca: ci pensa il primo run del collector.
 * Idempotente: le stazioni si sostituiscono per id, la rimozione è stabile.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DIR_CH = path.join(__dirname, '../..', 'data', 'svizzera');
const DIR_TI = path.join(__dirname, '../..', 'data', 'ticino');
const BASE   = 'https://data.geo.admin.ch';
const COL    = { id: 'ch.meteoschweiz.ogd-smn', prefix: 'ogd-smn' };
const MIN_ORE = 20;
const METEO_DAL = '2026-06-27';

// abbr OGD → id OASI della stessa stazione fisica
const MAPPA = {
  MAG: 'air_Nabel_MAG', CEV: 'meteo_25', COM: 'meteo_10', OTL: 'meteo_13',
  LUG: 'meteo_11', PIO: 'meteo_14', ROE: 'meteo_15', SBE: 'meteo_38', SBO: 'meteo_16',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchBuf(url, tries) {
  tries = tries || 3;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': '*/*', 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        if (tries > 1) return resolve(sleep(2000).then(() => fetchBuf(url, tries - 1)));
        return reject(new Error(`HTTP ${res.statusCode} su ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(120000, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => {
      if (tries > 1) resolve(sleep(2000).then(() => fetchBuf(url, tries - 1)));
      else reject(e);
    });
  });
}

function parseCsv(buf) {
  const lines = buf.toString('latin1').trim().split(/\r?\n/);
  const head = lines[0].split(';');
  return lines.slice(1).map(l => {
    const p = l.split(';');
    const o = {};
    head.forEach((h, i) => o[h] = p[i]);
    return o;
  });
}

function parseTs(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

/** [msUTC, mm, tn, tx, ff, fx] dalle colonne del CSV orario SMN. */
function parseHourly(buf) {
  const text = buf.toString('utf8');
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const iTs = head.indexOf('reference_timestamp');
  const iV  = head.indexOf('rre150h0');
  if (iTs < 0 || iV < 0) return [];
  const iTn = head.indexOf('tre200hn'), iTx = head.indexOf('tre200hx');
  const iFf = head.indexOf('fkl010h0'), iFx = head.indexOf('fkl010h1');
  const num = (c, i) => {
    if (i < 0) return null;
    const raw = c[i];
    if (raw === '' || raw === undefined) return null;
    const v = parseFloat(raw);
    return isNaN(v) ? null : v;
  };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    const t = parseTs(c[iTs]);
    if (t === null) continue;
    const raw = c[iV];
    if (raw === '' || raw === undefined) continue;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) continue;
    out.push([t, v, num(c, iTn), num(c, iTx), num(c, iFf), num(c, iFx)]);
  }
  return out;
}

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { start, end: start + 24 * 3600000 };
}

/** {mm, t?, w?} della stazione sul giorno, o null se ore insufficienti. */
function aggrega(rows, dateStr) {
  const w = dayWindow(dateStr);
  let sum = 0, n = 0;
  let tmin = Infinity, tmax = -Infinity, nT = 0;
  let ffSum = 0, nFF = 0, fxMax = -Infinity, nFX = 0;
  for (const [t, v, tn, tx, ff, fx] of rows) {
    if (!(t > w.start && t <= w.end)) continue;
    sum += v; n++;
    if (tn != null && tn >= -45 && tn <= 50) { if (tn < tmin) tmin = tn; nT++; }
    if (tx != null && tx >= -45 && tx <= 50) { if (tx > tmax) tmax = tx; }
    if (ff != null && ff >= 0 && ff < 60) { ffSum += ff; nFF++; }
    if (fx != null && fx >= 0 && fx < 90) { if (fx > fxMax) fxMax = fx; nFX++; }
  }
  if (n < MIN_ORE) return null;
  const mm = Math.round(sum * 10) / 10;
  if (mm < 0 || mm > 500) return null;
  const rec = { mm };
  if (dateStr >= METEO_DAL) {
    if (nT >= MIN_ORE && tmax > -Infinity)
      rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
    if (nFF >= MIN_ORE)
      rec.w = [Math.round(ffSum / nFF * 3.6 * 10) / 10,
               nFX > 0 ? Math.round(fxMax * 3.6 * 10) / 10 : null];
  }
  return rec;
}

async function main() {
  console.log('=== migra-ti-smn-da-oasi-a-ogd (una tantum) ===');
  const oggi = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000)
    .toISOString().slice(0, 10);

  // ── Anagrafe delle 9 dall'OGD ─────────────────────────────────────
  const meta = parseCsv(await fetchBuf(`${BASE}/${COL.id}/${COL.prefix}_meta_stations.csv`));
  const stazioni = [];
  for (const r of meta) {
    if (!MAPPA[r.station_abbr]) continue;
    stazioni.push({
      abbr: r.station_abbr,
      name: r.station_name,
      canton: r.station_canton || '',
      lat: Math.round(parseFloat(r.station_coordinates_wgs84_lat) * 10000) / 10000,
      lon: Math.round(parseFloat(r.station_coordinates_wgs84_lon) * 10000) / 10000,
      q:   Math.round(parseFloat(r.station_height_masl) || 0),
    });
  }
  if (stazioni.length !== 9) throw new Error(`Attese 9 stazioni, trovate ${stazioni.length}`);
  console.log('  Stazioni: ' + stazioni.map(s => s.abbr).join(', '));

  // ── Orari (historical + recent) per stazione ──────────────────────
  const oreDi = {};
  for (const st of stazioni) {
    const low = st.abbr.toLowerCase();
    const baseUrl = `${BASE}/${COL.id}/${low}/${COL.prefix}_${low}_h`;
    const rows = parseHourly(await fetchBuf(`${baseUrl}_historical_2020-2029.csv`));
    const rec = parseHourly(await fetchBuf(`${baseUrl}_recent.csv`));
    const lastH = rows.length ? rows[rows.length - 1][0] : -Infinity;
    for (const r of rec) if (r[0] > lastH) rows.push(r);
    oreDi[st.abbr] = rows;
    console.log(`  ${st.abbr} ${st.name}: ${rows.length} ore scaricate`);
  }

  // ── 1. Aggiunta ai file data/svizzera ─────────────────────────────
  const fileCH = fs.readdirSync(DIR_CH).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let chToccati = 0, chStazGiorno = 0;
  for (const f of fileCH) {
    const dateStr = f.replace('.json', '');
    if (dateStr >= oggi) continue; // oggi lo fa il collector
    const fp = path.join(DIR_CH, f);
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const byId = new Map((data.stations || []).map(s => [s.id, s]));
    let touched = false;
    for (const st of stazioni) {
      const rec = aggrega(oreDi[st.abbr], dateStr);
      if (!rec) continue;
      const nuovo = { id: st.abbr, n: st.name, lat: st.lat, lon: st.lon, q: st.q, p: st.canton, mm: rec.mm };
      if (rec.t) nuovo.t = rec.t;
      if (rec.w) nuovo.w = rec.w;
      byId.set(st.abbr, nuovo);
      touched = true;
      chStazGiorno++;
    }
    if (touched) {
      data.stations = Array.from(byId.values());
      data.count = data.stations.length;
      fs.writeFileSync(fp, JSON.stringify(data));
      chToccati++;
    }
  }
  console.log(`  data/svizzera: ${chToccati} file aggiornati, ${chStazGiorno} stazioni-giorno aggiunte`);

  // ── 2. Rimozione dai file data/ticino ─────────────────────────────
  const idOasi = new Set(Object.values(MAPPA));
  const fileTI = fs.readdirSync(DIR_TI).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let tiToccati = 0, tiRimosse = 0;
  for (const f of fileTI) {
    const fp = path.join(DIR_TI, f);
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const prima = (data.stations || []).length;
    data.stations = (data.stations || []).filter(s => !idOasi.has(s.id));
    if (data.stations.length !== prima) {
      tiRimosse += prima - data.stations.length;
      data.count = data.stations.length;
      fs.writeFileSync(fp, JSON.stringify(data));
      tiToccati++;
    }
  }
  console.log(`  data/ticino: ${tiToccati} file ripuliti, ${tiRimosse} voci rimosse`);
  console.log('=== migrazione completata ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
