/**
 * backfill-meteo-meteohub.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/meteohub-* esistenti per i giorni ancora nella
 * finestra pubblica dell'API (~10, se ne coprono 9): prodotti B12101
 * (temperatura, KELVIN → −273,15), B11002 (vento medio, m/s → ×3,6),
 * B11041 (raffica, dove c'è). Stessa ricetta del collector: serie più fitta,
 * ore coperte ≥20, stazioni identificate dall'id lat_lon.
 * Idempotente: tocca solo t/w, pioggia (anche stimata om:true) intatta.
 *
 * Uso: node backfill-meteo-meteohub.js            → ultimi 9 giorni
 *      GIORNI=5 node backfill-meteo-meteohub.js
 */
const fs   = require('fs');
const path = require('path');

const BASE_URL  = 'https://meteohub.agenziaitaliameteo.it/api/observations';
const DATA_ROOT = path.join(__dirname, '../..', 'data');
const GIORNI    = parseInt(process.env.GIORNI || '9', 10);
const MIN_ORE   = 20;

const NETWORKS = [
  { net: 'dpcn-marche',     dir: 'meteohub-marche'     },
  { net: 'dpcn-umbria',     dir: 'meteohub-umbria'     },
  { net: 'dpcn-lazio',      dir: 'meteohub-lazio'      },
  { net: 'dpcn-campania',   dir: 'meteohub-campania'   },
  { net: 'dpcn-puglia',     dir: 'meteohub-puglia'     },
  { net: 'dpcn-calabria',   dir: 'meteohub-calabria'   },
  { net: 'dpcn-sicilia',    dir: 'meteohub-sicilia'    },
  { net: 'dpcn-sardegna',   dir: 'meteohub-sardegna'   },
  { net: 'dpcn-basilicata', dir: 'meteohub-basilicata' },
  { net: 'dpcn-molise',     dir: 'meteohub-molise'     },
];

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
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch(e) {
      if (i === retries - 1) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}

function utcWindowForItalianDay(dateStr) {
  const offset = getItalyOffset(new Date(dateStr + 'T12:00:00Z'));
  const start = new Date(new Date(dateStr + 'T00:00:00Z').getTime() - offset * 3600000);
  const end   = new Date(start.getTime() + 24 * 3600000);
  const fmtQ   = d => d.toISOString().substring(0, 16).replace('T', ' ');
  const fmtRef = d => d.toISOString().substring(0, 19);
  return { qFrom: fmtQ(start), qTo: fmtQ(end), refFrom: fmtRef(start), refTo: fmtRef(end) };
}

async function collectMeteoHub(net, w) {
  const out = {};
  const fetchProd = async prod => {
    const q = `reftime: >=${w.qFrom},<=${w.qTo};product:${prod};license:CCBY_COMPLIANT`;
    const raw = await fetchJSON(`${BASE_URL}?networks=${encodeURIComponent(net)}&q=${encodeURIComponent(q)}`);
    const perId = {};
    for (const entry of (raw.data || [])) {
      const stat = entry.stat || {};
      if (typeof stat.lat !== 'number' || typeof stat.lon !== 'number') continue;
      let best = null;
      for (const pr of (entry.prod || [])) {
        if (pr.var !== prod || !Array.isArray(pr.val)) continue;
        if (!best || pr.val.length > best.val.length) best = pr;
      }
      if (!best) continue;
      const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
      if (vals.length) perId[`${stat.lat.toFixed(5)}_${stat.lon.toFixed(5)}`] = vals;
    }
    return perId;
  };
  const oreDi = vals => new Set(vals.map(v => (v.ref || '').slice(11, 13))).size;

  const temp = await fetchProd('B12101');
  Object.keys(temp).forEach(id => {
    const vals = temp[id].map(v => v.val > 100 ? v.val - 273.15 : v.val).filter(v => v >= -45 && v <= 50);
    if (vals.length && oreDi(temp[id]) >= MIN_ORE)
      (out[id] = out[id] || {}).t = [Math.round(Math.min(...vals) * 10) / 10,
                                     Math.round(Math.max(...vals) * 10) / 10];
  });
  await sleep(400);
  const vento = await fetchProd('B11002');
  const raffica = await fetchProd('B11041');
  Object.keys(vento).forEach(id => {
    const vals = vento[id].map(v => v.val).filter(v => v >= 0 && v < 60);
    if (!vals.length || oreDi(vento[id]) < MIN_ORE) return;
    const media = vals.reduce((a, v) => a + v, 0) / vals.length;
    const gu = (raffica[id] || []).map(v => v.val).filter(v => v >= 0 && v < 90);
    (out[id] = out[id] || {}).w = [Math.round(media * 3.6 * 10) / 10,
                                   gu.length ? Math.round(Math.max(...gu) * 3.6 * 10) / 10 : null];
  });
  return out;
}

async function main() {
  console.log('=== backfill-meteo-meteohub (t/w sui file esistenti) ===');
  const now = new Date();
  const noon = new Date(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z').getTime();
  const giorni = [];
  for (let i = 1; i <= GIORNI; i++) giorni.push(fmtDate(new Date(noon - i * 24 * 3600000)));

  for (const netCfg of NETWORKS) {
    const dir = path.join(DATA_ROOT, netCfg.dir);
    let stazGiorno = 0, fileOk = 0;
    for (const g of giorni) {
      const f = path.join(dir, `${g}.json`);
      if (!fs.existsSync(f)) continue;
      try {
        const meteo = await collectMeteoHub(netCfg.net, utcWindowForItalianDay(g));
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        let toccate = 0;
        (data.stations || []).forEach(s => {
          const m = meteo[s.id];
          if (!m) return;
          if (m.t) s.t = m.t;
          if (m.w) s.w = m.w;
          toccate++;
        });
        if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
      } catch (e) { console.warn(`  Warn ${netCfg.net} ${g}: ${e.message}`); }
      await sleep(600);
    }
    console.log(`  ${netCfg.net}: ${fileOk} file, ${stazGiorno} stazioni-giorno con t/w`);
  }
  console.log('=== backfill completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
