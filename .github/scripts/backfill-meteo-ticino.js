/**
 * backfill-meteo-ticino.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/ticino esistenti dalle letture OASI a 10 minuti
 * (resolution=h, query storiche funzionanti): T → t: [min,max] °C,
 * WS/WSgust → w: [media,raffica] km/h (m/s ×3,6).
 * Stessa ricetta del collector: ore coperte ≥ MIN_ORE, sanity t [-45,50],
 * WS <60 m/s, gust <90 m/s. Le stazioni MeteoSvizzera si SALTANO (le
 * condizioni d'uso OASI vietano di ripubblicarne i grezzi). Idempotente.
 *
 * Uso: node backfill-meteo-ticino.js          → ultimi 45 giorni
 *      GIORNI=10 node backfill-meteo-ticino.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'ticino');
const BASE_URL = 'https://www.oasi.ti.ch/web/rest';
const MIN_ORE  = 20;
const GIORNI   = parseInt(process.env.GIORNI || '45', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Righe {day, hh, v} da un CSV OASI a 10 minuti (qualsiasi parametro). */
function parseOre(csv) {
  const out = [];
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('data;')) continue;
    const parts = t.split(';');
    if (parts.length < 2) continue;
    const m = parts[0].match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2})/);
    if (!m) continue;
    const v = parseFloat(parts[1]);
    if (!isNaN(v)) out.push({ day: `${m[3]}-${m[2]}-${m[1]}`, hh: m[4], v });
  }
  return out;
}

async function fetchParam(code, param, fromDay, toDay) {
  const url = `${BASE_URL}/measure/csv?domain=meteo&resolution=h&parameter=${param}`
            + `&from=${fromDay}&to=${toDay}&location=${encodeURIComponent(code)}`;
  return parseOre(await fetchRaw(url));
}

const oreDi = rows => new Set(rows.map(r => r.hh)).size;

async function main() {
  console.log('=== backfill-meteo-ticino (t/w sui file esistenti) ===');
  const ieri = addDays(new Date().toISOString().slice(0, 10), -1);
  const start = addDays(ieri, -(GIORNI - 1));
  const giorni = [];
  for (let d = start; d <= ieri; d = addDays(d, 1)) {
    if (fs.existsSync(path.join(DATA_DIR, `${d}.json`))) giorni.push(d);
  }
  console.log(`  Giorni: ${giorni.length} (${giorni[0]} → ${giorni[giorni.length - 1]})`);

  console.log('  Fetch elenco stazioni OASI...');
  const locs = JSON.parse(await fetchRaw(`${BASE_URL}/locations?domain=meteo`));
  const stations = locs.filter(l => {
    const o = (l.simpleOwner || l.owner || '');
    return !o.toUpperCase().includes('ARPA') && o !== 'MeteoSvizzera';
  });
  console.log(`  Stazioni candidate (no ARPA, no MeteoSvizzera): ${stations.length}`);

  // meteo[day][id] = {t?, w?}
  const meteo = {};
  giorni.forEach(d => meteo[d] = {});
  let conSensori = 0;
  for (const s of stations) {
    try {
      const vT = (await fetchParam(s.code, 'T', giorni[0], giorni[giorni.length - 1]))
        .filter(r => r.v >= -45 && r.v <= 50);
      if (!vT.length) { await sleep(100); continue; } // niente termometro → niente altri sensori
      conSensori++;
      const vWS = (await fetchParam(s.code, 'WS', giorni[0], giorni[giorni.length - 1]))
        .filter(r => r.v >= 0 && r.v < 60);
      const vGU = vWS.length
        ? (await fetchParam(s.code, 'WSgust', giorni[0], giorni[giorni.length - 1]))
            .filter(r => r.v >= 0 && r.v < 90)
        : [];
      giorni.forEach(g => {
        const m = {};
        const tG = vT.filter(r => r.day === g);
        if (oreDi(tG) >= MIN_ORE)
          m.t = [Math.round(Math.min(...tG.map(r => r.v)) * 10) / 10,
                 Math.round(Math.max(...tG.map(r => r.v)) * 10) / 10];
        const wG = vWS.filter(r => r.day === g);
        if (oreDi(wG) >= MIN_ORE) {
          const media = wG.reduce((a, r) => a + r.v, 0) / wG.length;
          const gG = vGU.filter(r => r.day === g);
          m.w = [Math.round(media * 3.6 * 10) / 10,
                 gG.length ? Math.round(Math.max(...gG.map(r => r.v)) * 3.6 * 10) / 10 : null];
        }
        if (m.t || m.w) meteo[g][s.code] = m;
      });
      await sleep(150);
      process.stdout.write(`  ${s.name}: ok\n`);
    } catch (e) {
      console.warn(`  Warn ${s.code} (${s.name}): ${e.message}`);
    }
  }
  console.log(`  Stazioni con sensori: ${conSensori}`);

  let fileOk = 0, stazGiorno = 0;
  giorni.forEach(g => {
    const f = path.join(DATA_DIR, `${g}.json`);
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(s => {
      const m = meteo[g][s.id];
      if (!m) return;
      if (m.t) s.t = m.t;
      if (m.w) s.w = m.w;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
  });
  console.log(`Fatto: ${fileOk}/${giorni.length} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
