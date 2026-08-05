#!/usr/bin/env node
/**
 * BACKFILL AUSTRIA — una tantum, da lanciare in locale.
 * =====================================================
 * Riempie `data/austria` con 365 giorni di dati REALI di stazione, non stime:
 * l'archivio orario GeoSphere (`klima-v2-1h`) risponde su qualsiasi data, quindi
 * non serve Open-Meteo e l'Austria non ha bisogno di una fase beta — come la
 * Svizzera, e a differenza del centro-sud MeteoHub.
 *
 * Molto più leggero del backfill svizzero (~1 GB di CSV per stazione): qui una
 * richiesta copre un mese intero per un gruppo di stazioni, quindi bastano
 * ~70 richieste JSON.
 *
 * Ricetta identica al collector: somma delle ore `rr` sul giorno solare
 * italiano, finestra (start, end] su timestamp di FINE intervallo, MIN_ORE=20.
 *
 * Uso: node backfill-austria-geosphere.js [giorni]      (default 365)
 *      SOVRASCRIVI=1 node backfill-austria-geosphere.js  (rifà anche i giorni già presenti)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../..', 'data', 'austria');
const API      = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1h';
const GIORNI   = parseInt(process.argv[2] || '365', 10);
const MIN_ORE  = 20;
const BATCH    = 60;    // stazioni per richiesta (un mese alla volta: tiene bassa la risposta)
const SALTA_ULTIMI = 10; // gli ultimi 10 giorni li fa il collector normale

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
const fmt = d => { const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; };
function dayWindow(dateStr) {
  const off = getItalyOffset(new Date(dateStr + 'T12:00:00Z')) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { dateStr, start, end: start + 24 * 3600000 };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const distKm = (a, b) =>
  Math.hypot((a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111);

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries) throw new Error(e.message + ' su ' + url.slice(0, 120));
      await sleep(4000 * i);
    }
  }
}

async function stazioni() {
  const meta = await getJson(API + '/metadata');
  const oggi = new Date().toISOString().slice(0, 10);
  const grezze = (meta.stations || [])
    .filter(s => s.valid_from && s.valid_from.slice(0, 10) <= oggi)
    .filter(s => !s.valid_to || s.valid_to.slice(0, 10) >= oggi)
    .filter(s => typeof s.lat === 'number' && typeof s.lon === 'number')
    .map(s => ({ id: String(s.id), n: s.name, lat: Math.round(s.lat * 1e5) / 1e5,
                 lon: Math.round(s.lon * 1e5) / 1e5, q: s.altitude != null ? Math.round(s.altitude) : 0,
                 p: s.state || '', tipo: s.type || '', dal: s.valid_from || '' }));
  const tenute = [];
  for (const s of grezze) {
    const g = tenute.find(t => distKm(t, s) < 0.5);
    if (!g) { tenute.push(s); continue; }
    if ((s.tipo === 'COMBINED' && g.tipo !== 'COMBINED') || (s.tipo === g.tipo && s.dal < g.dal))
      tenute[tenute.indexOf(g)] = s;
  }
  return tenute.map(({ tipo, dal, ...s }) => s);
}

(async () => {
  console.log('=== backfill Austria: ' + GIORNI + ' giorni ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const staz = await stazioni();
  console.log('Stazioni (deduplicate): ' + staz.length);
  const byId = Object.fromEntries(staz.map(s => [s.id, s]));

  const oggiIt = new Date(Date.now() + getItalyOffset(new Date()) * 3600000);
  const target = [];
  for (let i = SALTA_ULTIMI + 1; i <= GIORNI; i++) {
    const d = fmt(new Date(Date.parse(fmt(oggiIt) + 'T12:00:00Z') - i * 86400000));
    if (!process.env.SOVRASCRIVI && fs.existsSync(path.join(DATA_DIR, d + '.json'))) continue;
    target.push(d);
  }
  if (!target.length) { console.log('Niente da fare.'); return; }
  console.log('Giorni da riempire: ' + target.length + ' (dal ' + target[target.length - 1] + ' al ' + target[0] + ')');

  // raggruppa per mese, così una richiesta copre ~30 giorni
  const mesi = {};
  target.forEach(d => (mesi[d.slice(0, 7)] = mesi[d.slice(0, 7)] || []).push(d));
  const chiavi = Object.keys(mesi).sort();

  let scritti = 0;
  for (const mese of chiavi) {
    const giorni = mesi[mese].sort();
    const windows = giorni.map(dayWindow);
    const minStart = Math.min(...windows.map(w => w.start));
    const maxEnd   = Math.max(...windows.map(w => w.end));
    const iso = ms => new Date(ms).toISOString().slice(0, 16);
    const perDay = {};
    giorni.forEach(g => perDay[g] = []);

    for (let i = 0; i < staz.length; i += BATCH) {
      const gruppo = staz.slice(i, i + BATCH);
      const url = API + '?parameters=rr&start=' + iso(minStart + 3600000) + '&end=' + iso(maxEnd) +
        '&station_ids=' + gruppo.map(s => s.id).join(',') + '&output_format=geojson';
      const j = await getJson(url);
      const ts = (j.timestamps || []).map(t => Date.parse(t));
      for (const f of (j.features || [])) {
        const st = byId[String(f.properties.station)];
        const dati = f.properties.parameters && f.properties.parameters.rr && f.properties.parameters.rr.data;
        if (!st || !dati) continue;
        for (const w of windows) {
          let sum = 0, n = 0;
          for (let k = 0; k < ts.length; k++) {
            const v = dati[k];
            if (v == null) continue;
            if (ts[k] > w.start && ts[k] <= w.end) { sum += v; n++; }
          }
          if (n < MIN_ORE) continue;
          const mm = Math.round(sum * 10) / 10;
          if (mm < 0 || mm > 500) continue;
          perDay[w.dateStr].push({ id: st.id, n: st.n, lat: st.lat, lon: st.lon, q: st.q, p: st.p, mm });
        }
      }
      await sleep(400);
    }

    let okMese = 0;
    for (const g of giorni) {
      if (perDay[g].length < 100) { console.warn('  ' + g + ': solo ' + perDay[g].length + ' stazioni, salto'); continue; }
      fs.writeFileSync(path.join(DATA_DIR, g + '.json'), JSON.stringify({
        date: g, collected: new Date().toISOString(), source: 'geosphere-at',
        backfill: true, count: perDay[g].length, stations: perDay[g],
      }));
      okMese++; scritti++;
    }
    console.log('  ' + mese + ': ' + okMese + '/' + giorni.length + ' giorni scritti');
  }
  console.log('=== fine: ' + scritti + ' giorni ===');
})().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
