#!/usr/bin/env node
/**
 * BACKFILL una-tantum: aggiunge temperatura e vento (campi t/w) ai file
 * data/svizzera ESISTENTI, senza toccare la pioggia (mm resta quello validato).
 * ==========================================================================
 * Stessa fonte, stesse colonne e stessa finestra del collector (vedi ricetta in
 * collect-svizzera-meteoswiss.js): tre200hn/hx per min/max veri, fkl010h0/h1
 * ×3,6 per media/raffica in km/h, MIN_ORE=20, giorno solare italiano.
 * Il CSV _h_recent copre l'intero anno corrente → un download per stazione
 * basta per tutti i giorni richiesti. Le stazioni si accoppiano per id (abbr).
 * Le solo-pioggia (CSV a 3 colonne) semplicemente non producono campi.
 *
 * Uso: node backfill-meteo-svizzera.js            → ultimi 45 giorni
 *      GIORNI=90 node backfill-meteo-svizzera.js  → finestra più lunga
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
const GIORNI      = parseInt(process.env.GIORNI || '45', 10);
const CONCURRENCY = 8;

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
function parseTs(s) {
  const m = (s || '').match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}
function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { dateStr, start, end: start + 24 * 3600000 };
}

/** [ [msUTC, tn, tx, ff, fx], ... ] — qui la pioggia non serve. */
function parseHourlyMeteo(buf) {
  const text = buf.toString('utf8');
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const iTs = head.indexOf('reference_timestamp');
  const iTn = head.indexOf('tre200hn'), iTx = head.indexOf('tre200hx');
  const iFf = head.indexOf('fkl010h0'), iFx = head.indexOf('fkl010h1');
  if (iTs < 0 || (iTn < 0 && iFf < 0)) return null; // CSV solo-pioggia: niente da fare
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
    out.push([t, num(c, iTn), num(c, iTx), num(c, iFf), num(c, iFx)]);
  }
  return out;
}

async function main() {
  // ── Giorni target: gli ultimi GIORNI per cui esiste già il file ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const targets = [];
  for (let i = 1; i <= GIORNI; i++) {
    const dateStr = fmtDate(new Date(todayNoon - i * 24 * 3600000));
    if (fs.existsSync(path.join(DATA_DIR, `${dateStr}.json`))) targets.push(dateStr);
  }
  targets.sort();
  const windows = targets.map(dayWindow);
  console.log(`Backfill t/w su ${targets.length} file (${targets[0]} → ${targets[targets.length - 1]})`);

  // ── Anagrafe: unione di id e collezione dai file stessi + inventario STAC ──
  // Serve sapere in QUALE collezione sta ogni abbr: si prova prima smn, poi precip.
  const ids = new Set();
  for (const d of targets) {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${d}.json`), 'utf8'));
    for (const s of (j.stations || [])) ids.add(String(s.id));
  }
  const allIds = [...ids].sort();
  console.log(`Stazioni da coprire: ${allIds.length}`);

  // ── Raccolta: meteo[dateStr][abbr] = {t, w} ──
  const meteo = {};
  for (const d of targets) meteo[d] = {};
  let fatte = 0, senzaMeteo = 0;

  async function lavora(abbr) {
    const low = abbr.toLowerCase();
    let buf = await fetchBuf(`${BASE}/ch.meteoschweiz.ogd-smn/${low}/ogd-smn_${low}_h_recent.csv`);
    if (!buf) buf = await fetchBuf(`${BASE}/ch.meteoschweiz.ogd-smn-precip/${low}/ogd-smn-precip_${low}_h_recent.csv`);
    if (!buf) { senzaMeteo++; return; }
    const rows = parseHourlyMeteo(buf);
    if (!rows) { senzaMeteo++; return; } // solo-pioggia
    for (const w of windows) {
      let tmin = Infinity, tmax = -Infinity, nT = 0;
      let ffSum = 0, nFF = 0, fxMax = -Infinity, nFX = 0;
      for (const [t, tn, tx, ff, fx] of rows) {
        if (!(t > w.start && t <= w.end)) continue;
        if (tn != null && tn >= -45 && tn <= 50) { if (tn < tmin) tmin = tn; nT++; }
        if (tx != null && tx >= -45 && tx <= 50) { if (tx > tmax) tmax = tx; }
        if (ff != null && ff >= 0 && ff < 60) { ffSum += ff; nFF++; }
        if (fx != null && fx >= 0 && fx < 90) { if (fx > fxMax) fxMax = fx; nFX++; }
      }
      const rec = {};
      if (nT >= MIN_ORE && tmax > -Infinity)
        rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
      if (nFF >= MIN_ORE)
        rec.w = [Math.round(ffSum / nFF * 3.6 * 10) / 10,
                 nFX > 0 ? Math.round(fxMax * 3.6 * 10) / 10 : null];
      if (rec.t || rec.w) meteo[w.dateStr][abbr] = rec;
    }
  }

  for (let i = 0; i < allIds.length; i += CONCURRENCY) {
    const batch = allIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(a => lavora(a).catch(e => { console.warn(`  Warn ${a}: ${e.message}`); })));
    fatte += batch.length;
    process.stdout.write(`  ${fatte}/${allIds.length} stazioni\r`);
    await sleep(100);
  }
  console.log('');
  console.log(`  (${senzaMeteo} stazioni senza colonne meteo: rete solo-pioggia)`);

  // ── Scrittura: i campi t/w si AGGIUNGONO alle stazioni esistenti, mm intatto ──
  let fileToccati = 0, stazConT = 0, stazTot = 0;
  for (const d of targets) {
    const fp = path.join(DATA_DIR, `${d}.json`);
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let cambiato = false;
    for (const s of (j.stations || [])) {
      stazTot++;
      const rec = meteo[d][String(s.id)];
      if (!rec) continue;
      if (rec.t) { s.t = rec.t; stazConT++; }
      if (rec.w) s.w = rec.w;
      cambiato = true;
    }
    if (cambiato) {
      j.meteo_backfill = '2026-08-11';
      fs.writeFileSync(fp, JSON.stringify(j));
      fileToccati++;
    }
  }
  console.log(`Fatto: ${fileToccati}/${targets.length} file aggiornati, ` +
              `${stazConT}/${stazTot} stazioni-giorno con temperatura`);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
