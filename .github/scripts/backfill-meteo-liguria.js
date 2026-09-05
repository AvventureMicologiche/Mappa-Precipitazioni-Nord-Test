/**
 * backfill-meteo-liguria.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/liguria esistenti dai charts OMIRL: le serie
 * Termo (media/min/max ogni 30') e Vento (velocità+raffica, già km/h)
 * coprono ~15 giorni, quindi basta UNA chiamata per stazione per sensore
 * e si aggregano tutti i giorni insieme. Stessa ricetta del collector
 * (ore coperte ≥ MIN_ORE, sanity t [-45,50], vento <216/324 km/h).
 * Idempotente: tocca solo t/w, pioggia intatta.
 *
 * Uso: node backfill-meteo-liguria.js            → ultimi 15 giorni
 *      GIORNI=10 node backfill-meteo-liguria.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data', 'liguria');
const OMIRL_BASE = 'https://omirl.regione.liguria.it/Omirl/rest';
const MIN_ORE    = 20;
const GIORNI     = parseInt(process.env.GIORNI || '15', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('JSON parse error')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
async function fetchWithRetry(url, retries) {
  retries = retries || 2;
  for (let i = 0; i <= retries; i++) {
    try { return await fetchJSON(url); }
    catch(e) { if (i === retries) throw e; await sleep(1200); }
  }
}

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function finestra(dateStr) {
  const off = getItalyOffset(new Date(dateStr + 'T12:00:00Z')) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { start, end: start + 24 * 3600000 };
}

function oreCoperte(punti, w) {
  const ore = new Set();
  punti.forEach(p => { if (p[0] >= w.start && p[0] < w.end && p[1] != null) ore.add(Math.floor((p[0] - w.start) / 3600000)); });
  return ore.size;
}
function senzaZeriFinti(v) {
  if (v.length < 3) return v;
  const noZero = v.filter(x => x !== 0);
  if (noZero.length === v.length || !noZero.length) return v;
  return Math.min(...noZero) > 5 ? noZero : v;
}

function valoriIn(punti, w, lo, hi) {
  return punti.filter(p => p[0] >= w.start && p[0] < w.end && p[1] != null && p[1] >= lo && p[1] <= hi).map(p => p[1]);
}

async function main() {
  console.log('=== backfill-meteo-liguria (t/w sui file esistenti) ===');
  const oggi = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000).toISOString().slice(0, 10);
  const ieri = addDays(oggi, -1);
  const giorni = [];
  for (let d = addDays(ieri, -(GIORNI - 1)); d <= ieri; d = addDays(d, 1)) {
    if (fs.existsSync(path.join(DATA_DIR, `${d}.json`))) giorni.push(d);
  }
  console.log(`  Giorni: ${giorni.length} (${giorni[0]} → ${giorni[giorni.length - 1]})`);

  const termo = await fetchWithRetry(OMIRL_BASE + '/stations/Termo');
  const vento = await fetchWithRetry(OMIRL_BASE + '/stations/Vento');
  console.log(`  Stazioni OMIRL: ${termo.length} Termo, ${vento.length} Vento`);

  // meteo[day][shortCode] = {t?, w?}
  const meteo = {};
  giorni.forEach(g => meteo[g] = {});
  const finestre = giorni.map(g => ({ g, w: finestra(g) }));

  let done = 0;
  for (const s of termo) {
    try {
      const ch = await fetchWithRetry(OMIRL_BASE + '/charts/' + s.shortCode + '/Termo');
      const ds = ch.dataSeries || [];
      const med = (ds[0] && ds[0].data) || [], mn = (ds[1] && ds[1].data) || [], mx = (ds[2] && ds[2].data) || [];
      finestre.forEach(({ g, w }) => {
        if (oreCoperte(med, w) < MIN_ORE) return;
        // ⚠️ Stessa regola del collector: lo zero esatto e' un buco, non una
        //    temperatura, quando la lettura piu' bassa vera sta sopra i 5 °C.
        //    Vedi il commento lungo in collect-liguria.js: le due copie devono
        //    restare uguali, se no il ripristino rimette gli zeri che il
        //    collector toglie.
        const mins = senzaZeriFinti(valoriIn(mn.length ? mn : med, w, -45, 50));
        const maxs = valoriIn(mx.length ? mx : med, w, -45, 50);
        if (!mins.length || !maxs.length) return;
        (meteo[g][s.shortCode] = meteo[g][s.shortCode] || {}).t =
          [Math.round(Math.min(...mins) * 10) / 10, Math.round(Math.max(...maxs) * 10) / 10];
      });
    } catch(e) {}
    done++; process.stdout.write(`  Termo ${done}/${termo.length}\r`);
    await sleep(120);
  }
  console.log('');
  done = 0;
  for (const s of vento) {
    try {
      const ch = await fetchWithRetry(OMIRL_BASE + '/charts/' + s.shortCode + '/Vento');
      const ds = ch.dataSeries || [];
      const vel = (ds[0] && ds[0].data) || [], raf = (ds[1] && ds[1].data) || [];
      finestre.forEach(({ g, w }) => {
        if (oreCoperte(vel, w) < MIN_ORE) return;
        const vv = valoriIn(vel, w, 0, 216);
        if (!vv.length) return;
        const rr = valoriIn(raf, w, 0, 324);
        (meteo[g][s.shortCode] = meteo[g][s.shortCode] || {}).w =
          [Math.round(vv.reduce((a, v) => a + v, 0) / vv.length * 10) / 10,
           rr.length ? Math.round(Math.max(...rr) * 10) / 10 : null];
      });
    } catch(e) {}
    done++; process.stdout.write(`  Vento ${done}/${vento.length}\r`);
    await sleep(120);
  }
  console.log('');

  let fileOk = 0, stazGiorno = 0;
  giorni.forEach(g => {
    const fp = path.join(DATA_DIR, `${g}.json`);
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(s => {
      const m = meteo[g][s.id];
      if (!m) return;
      if (m.t) s.t = m.t;
      if (m.w) s.w = m.w;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(fp, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
  });
  console.log(`Fatto: ${fileOk}/${giorni.length} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
