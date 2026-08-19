/**
 * backfill-vento-toscana-meteohub.js — UNA TANTUM, si lancia a mano.
 *
 * Attacca il vento ai file `data/toscana/<giorno>.json` già scritti, prendendolo
 * dagli anemometri SIR ripubblicati su MeteoHub (rete `sir-toscana`).
 * Serve perché il campionatore orario del CFR (`campiona-vento-toscana.js`)
 * parte dal 19/8/2026 e non può avere i giorni prima.
 *
 * LIMITE: senza login MeteoHub tiene ~9 giorni, il decimo risponde 401. Più
 * indietro di così non si va, e non c'è altra strada: il SIR non pubblica il
 * vento e la pagina anemometri del CFR mostra solo l'istante attuale.
 *
 * NON tocca mai `mm`, `t` o `u`: aggiunge solo `w` dove manca. Idempotente.
 *
 * Uso:  DATA_DIR=<percorso data/toscana> node backfill-vento-toscana-meteohub.js [--scrivi]
 *       senza --scrivi fa la prova a vuoto e stampa soltanto.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../..', 'data', 'toscana');
const SCRIVI   = process.argv.includes('--scrivi');
const MH_URL   = 'https://meteohub.agenziaitaliameteo.it/api/observations';

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

async function ventoMeteoHub(dateStr, elenco) {
  const off = getItalyOffset(new Date(dateStr + 'T12:00:00Z'));
  const start = new Date(new Date(dateStr + 'T00:00:00Z').getTime() - off * 3600000);
  const end   = new Date(start.getTime() + 24 * 3600000);
  const fq = d => d.toISOString().substring(0, 16).replace('T', ' ');
  const fr = d => d.toISOString().substring(0, 19);
  const prendi = async prod => {
    const q = `reftime: >=${fq(start)},<=${fq(end)};product:${prod};license:CCBY_COMPLIANT`;
    const res = await fetch(`${MH_URL}?networks=sir-toscana&q=${encodeURIComponent(q)}`,
                            { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const out = [];
    for (const e of (raw.data || [])) {
      const st = e.stat || {};
      if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
      let best = null;
      for (const pr of (e.prod || [])) {
        if (pr.var !== prod || !Array.isArray(pr.val)) continue;
        if (!best || pr.val.length > best.val.length) best = pr;
      }
      if (!best) continue;
      const vals = best.val.filter(v => v.ref > fr(start) && v.ref <= fr(end) && typeof v.val === 'number');
      if (!vals.length) continue;
      out.push({ lat: st.lat, lon: st.lon, v: vals.map(x => x.val),
                 ore: new Set(vals.map(x => x.ref.slice(11, 13))).size });
    }
    return out;
  };
  const medi = await prendi('B11002');
  let raff = [];
  try { raff = await prendi('B11041'); } catch (e) { /* poche stazioni */ }
  const vicino = (arr, s) => arr.find(o => Math.abs(o.lat - s.lat) < 0.0054 && Math.abs(o.lon - s.lon) < 0.0077);
  const out = {};
  for (const s of elenco) {
    const m = vicino(medi, s);
    if (!m || m.ore < 20) continue;
    const buoni = m.v.filter(v => v >= 0 && v < 60);
    if (!buoni.length) continue;
    const media = buoni.reduce((a, v) => a + v, 0) / buoni.length;
    const g = vicino(raff, s);
    const gu = g ? g.v.filter(v => v >= 0 && v < 90) : [];
    out[s.id] = [Math.round(media * 3.6 * 10) / 10,
                 gu.length ? Math.round(Math.max(...gu) * 3.6 * 10) / 10 : null];
  }
  return out;
}

(async () => {
  console.log(`=== backfill vento Toscana da MeteoHub ${SCRIVI ? '(SCRIVE)' : '(prova a vuoto)'} ===`);
  console.log(`   cartella: ${DATA_DIR}\n`);
  const oggi = new Date();
  const giorni = [];
  for (let i = 9; i >= 1; i--) {
    const d = new Date(oggi.getTime() - i * 86400000);
    giorni.push(d.toISOString().substring(0, 10));
  }
  let totale = 0;
  for (const g of giorni) {
    const file = path.join(DATA_DIR, `${g}.json`);
    if (!fs.existsSync(file)) { console.log(`${g}  file assente, salto`); continue; }
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mancanti = (j.stations || []).filter(s => !s.w);
    if (!mancanti.length) { console.log(`${g}  hanno già tutte il vento, salto`); continue; }
    let w;
    try { w = await ventoMeteoHub(g, mancanti); }
    catch (e) { console.log(`${g}  MeteoHub: ${e.message} (fuori dalla finestra pubblica)`); continue; }
    let n = 0;
    (j.stations || []).forEach(s => { if (!s.w && w[s.id]) { s.w = w[s.id]; n++; } });
    if (n && SCRIVI) {
      j.ventoBackfill = { fonte: 'meteohub-sir-toscana', quando: new Date().toISOString(), stazioni: n };
      fs.writeFileSync(file, JSON.stringify(j));
    }
    const esempi = Object.entries(w).slice(0, 3).map(([k, v]) => `${k}=${v[0]}${v[1] != null ? '/' + v[1] : ''}`).join(' ');
    console.log(`${g}  ${String(n).padStart(3)} stazioni su ${j.stations.length}   ${esempi}`);
    totale += n;
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`\nTotale: ${totale} stazioni-giorno${SCRIVI ? ' scritte' : ' (nulla scritto, manca --scrivi)'}`);
})();
