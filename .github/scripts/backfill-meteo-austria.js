#!/usr/bin/env node
/**
 * BACKFILL una-tantum: aggiunge temperatura e vento (campi t/w) ai file
 * data/austria ESISTENTI, senza toccare la pioggia (mm resta quello validato).
 * ==========================================================================
 * Stessa fonte e stessa finestra del collector (GeoSphere klima-v2-1h, giorno
 * solare italiano, timestamp di fine intervallo, MIN_ORE=20): vedi la ricetta
 * in collect-austria-geosphere.js. Le stazioni si accoppiano per id, quindi il
 * dedup dei doppioni è ereditato dai file stessi.
 *
 * Uso: node backfill-meteo-austria.js            → ultimi 40 giorni
 *      GIORNI=365 node backfill-meteo-austria.js → finestra più lunga
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../..', 'data', 'austria');
const API      = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1h';
const MIN_ORE  = 20;
const GIORNI   = parseInt(process.env.GIORNI || '40', 10);
const BATCH    = 120;   // stazioni per richiesta
const CHUNK    = 10;    // giorni per richiesta (tiene il payload sotto i ~2 MB)

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
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off  = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { dateStr, start, end: start + 24 * 3600000 };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw new Error(`${e.message} su ${url.slice(0, 120)}`);
      await sleep(3000 * i);
    }
  }
}

async function main() {
  // ── Giorni target: gli ultimi GIORNI per cui ESISTE già il file (ieri compreso) ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const targets = [];
  for (let i = 1; i <= GIORNI; i++) {
    const dateStr = fmtDate(new Date(todayNoon - i * 24 * 3600000));
    if (fs.existsSync(path.join(DATA_DIR, `${dateStr}.json`))) targets.push(dateStr);
  }
  targets.sort();
  console.log(`Backfill t/w su ${targets.length} file (${targets[0]} → ${targets[targets.length - 1]})`);

  // ── Anagrafe: l'unione degli id presenti nei file target ──
  const ids = new Set();
  for (const d of targets) {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${d}.json`), 'utf8'));
    for (const s of (j.stations || [])) ids.add(String(s.id));
  }
  const allIds = [...ids].sort((a, b) => +a - +b);
  console.log(`Stazioni da coprire: ${allIds.length}`);

  // ── Raccolta: meteo[dateStr][id] = {t, w} ──
  const meteo = {};
  for (const d of targets) meteo[d] = {};
  const iso = ms => new Date(ms).toISOString().slice(0, 16);

  for (let c = 0; c < targets.length; c += CHUNK) {
    const giorni = targets.slice(c, c + CHUNK).map(dayWindow);
    const minStart = Math.min(...giorni.map(w => w.start));
    const maxEnd   = Math.max(...giorni.map(w => w.end));
    for (let i = 0; i < allIds.length; i += BATCH) {
      const gruppo = allIds.slice(i, i + BATCH);
      const url = `${API}?parameters=tl,ff,ffx&start=${iso(minStart + 3600000)}&end=${iso(maxEnd)}` +
                  `&station_ids=${gruppo.join(',')}&output_format=geojson`;
      const j = await getJson(url);
      const ts = (j.timestamps || []).map(t => Date.parse(t));
      for (const f of (j.features || [])) {
        const id = String(f.properties.station);
        const P  = f.properties.parameters || {};
        const dTl  = (P.tl  && P.tl.data)  || [];
        const dFf  = (P.ff  && P.ff.data)  || [];
        const dFfx = (P.ffx && P.ffx.data) || [];
        for (const w of giorni) {
          let tmin = Infinity, tmax = -Infinity, nT = 0;
          let ffSum = 0, nFF = 0, fxMax = -Infinity, nFX = 0;
          for (let k = 0; k < ts.length; k++) {
            if (!(ts[k] > w.start && ts[k] <= w.end)) continue;
            const vt = dTl[k];
            if (vt != null && vt >= -45 && vt <= 50) { if (vt < tmin) tmin = vt; if (vt > tmax) tmax = vt; nT++; }
            const vf = dFf[k];
            if (vf != null && vf >= 0 && vf < 60) { ffSum += vf; nFF++; }
            const vx = dFfx[k];
            if (vx != null && vx >= 0 && vx < 90) { if (vx > fxMax) fxMax = vx; nFX++; }
          }
          const rec = {};
          if (nT >= MIN_ORE)  rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
          if (nFF >= MIN_ORE) rec.w = [Math.round(ffSum / nFF * 3.6 * 10) / 10,
                                       nFX > 0 ? Math.round(fxMax * 3.6 * 10) / 10 : null];
          if (rec.t || rec.w) meteo[w.dateStr][id] = rec;
        }
      }
      await sleep(400);
    }
    console.log(`  giorni ${giorni[0].dateStr} → ${giorni[giorni.length - 1].dateStr} raccolti`);
  }

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
      j.meteo_backfill = '2026-08-10';
      fs.writeFileSync(fp, JSON.stringify(j));
      fileToccati++;
    }
  }
  console.log(`Fatto: ${fileToccati}/${targets.length} file aggiornati, ` +
              `${stazConT}/${stazTot} stazioni-giorno con temperatura`);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
