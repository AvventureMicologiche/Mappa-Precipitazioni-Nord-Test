/**
 * backfill-meteo-altoadige.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/altoadige esistenti dalle timeseries a 10 minuti
 * dell'Open Data provinciale (interrogabili su qualsiasi giorno passato):
 *   LT → t: [min,max] °C · WG / WG.BOE → w: [media,raffica] km/h (m/s ×3,6)
 * Stessa ricetta del collector: ore coperte ≥ MIN_ORE, sanity t [-45,50],
 * WG <60 m/s, BOE <90 m/s. Idempotente, pioggia intatta.
 *
 * Uso: node backfill-meteo-altoadige.js          → ultimi 45 giorni
 *      GIORNI=10 node backfill-meteo-altoadige.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'altoadige');
const TS_URL   = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/timeseries';
const MIN_ORE  = 20;
const GIORNI   = parseInt(process.env.GIORNI || '45', 10);
const PASSO    = 15; // giorni per richiesta (finestre corte, risposte leggere)

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json,*/*', 'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } }
      });
    }).on('error', reject);
  });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchSensore(code, sensor, fromDay, toDay) {
  const url = `${TS_URL}?station_code=${encodeURIComponent(code)}`
            + `&sensor_code=${encodeURIComponent(sensor)}`
            + `&date_from=${fromDay.replace(/-/g, '')}&date_to=${toDay.replace(/-/g, '')}`;
  const rows = await fetchJSON(url);
  return (Array.isArray(rows) ? rows : []).map(r => {
    const v = parseFloat(r.VALUE);
    if (isNaN(v) || typeof r.DATE !== 'string') return null;
    return { day: r.DATE.slice(0, 10), hh: r.DATE.slice(11, 13), v };
  }).filter(Boolean);
}

function aggregaMeteo(lt, wg, boe, dateStr) {
  const out = {};
  const oreDi = rows => new Set(rows.map(r => r.hh)).size;
  const delGiorno = rows => rows.filter(r => r.day === dateStr);
  const vLT = delGiorno(lt).filter(r => r.v >= -45 && r.v <= 50);
  if (oreDi(vLT) >= MIN_ORE) {
    let mn = Infinity, mx = -Infinity;
    vLT.forEach(r => { if (r.v < mn) mn = r.v; if (r.v > mx) mx = r.v; });
    out.t = [Math.round(mn * 10) / 10, Math.round(mx * 10) / 10];
  }
  const vWG = delGiorno(wg).filter(r => r.v >= 0 && r.v < 60);
  if (oreDi(vWG) >= MIN_ORE) {
    const media = vWG.reduce((a, r) => a + r.v, 0) / vWG.length;
    const vBOE = delGiorno(boe).filter(r => r.v >= 0 && r.v < 90);
    out.w = [Math.round(media * 3.6 * 10) / 10,
             vBOE.length ? Math.round(Math.max(...vBOE.map(r => r.v)) * 3.6 * 10) / 10 : null];
  }
  return out;
}

async function main() {
  console.log('=== backfill-meteo-altoadige (t/w sui file esistenti) ===');
  const ieri = addDays(new Date().toISOString().slice(0, 10), -1);
  const start = addDays(ieri, -(GIORNI - 1));
  const giorni = [];
  for (let d = start; d <= ieri; d = addDays(d, 1)) {
    if (fs.existsSync(path.join(DATA_DIR, `${d}.json`))) giorni.push(d);
  }
  console.log(`  Giorni: ${giorni.length} (${giorni[0]} → ${giorni[giorni.length - 1]})`);

  // Anagrafe = unione degli id nei file della finestra
  const ids = new Set();
  giorni.forEach(d => {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${d}.json`), 'utf8'));
    (j.stations || []).forEach(s => ids.add(s.id));
  });
  console.log(`  Stazioni da coprire: ${ids.size}`);

  // meteo[day][id] = {t?, w?}
  const meteo = {};
  giorni.forEach(d => meteo[d] = {});
  let done = 0, falliti = 0;
  for (const code of ids) {
    try {
      for (let i = 0; i < giorni.length; i += PASSO) {
        const blocco = giorni.slice(i, i + PASSO);
        const fromDay = blocco[0], toDay = addDays(blocco[blocco.length - 1], 1);
        const lt  = await fetchSensore(code, 'LT', fromDay, toDay);
        const wg  = await fetchSensore(code, 'WG', fromDay, toDay);
        const boe = await fetchSensore(code, 'WG.BOE', fromDay, toDay);
        blocco.forEach(g => { meteo[g][code] = aggregaMeteo(lt, wg, boe, g); });
        await sleep(80);
      }
    } catch (e) { falliti++; }
    done++;
    process.stdout.write(`  ${done}/${ids.size} stazioni\r`);
  }
  console.log('');
  if (falliti > 0) console.warn(`  Warn: ${falliti} stazioni senza risposta`);

  let fileOk = 0, stazGiorno = 0;
  giorni.forEach(g => {
    const f = path.join(DATA_DIR, `${g}.json`);
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(s => {
      const m = meteo[g][s.id];
      if (!m || (!m.t && !m.w)) return;
      if (m.t) s.t = m.t;
      if (m.w) s.w = m.w;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
  });
  console.log(`Fatto: ${fileOk}/${giorni.length} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
