/**
 * collect-meteohub.js  —  GitHub Actions (PILOTA, solo repo di test)
 * Raccoglie precipitazioni giornaliere da MeteoHub (Agenzia ItaliaMeteo,
 * ex progetto Mistral) — rete DPCN dei centri funzionali regionali.
 *
 * Scopo del pilota (luglio 2026): valutare MeteoHub come fonte unica per
 * l'espansione della mappa a tutta Italia.
 *  - dpcn-lombardia era la regione di CONTROLLO (verità a terra via ARPA
 *    Socrata) — RIMOSSA il 27/7/2026: in mappa/prod la Lombardia usa ARPA.
 *  - dpcn-marche, dpcn-umbria: prime regioni nuove candidate
 *
 * API (verificata il 20/07/2026, nessun login richiesto):
 *   GET /api/observations?networks=<rete>&q=reftime: >=A,<=B;product:B13011;license:CCBY_COMPLIANT
 *   → JSON con serie di accumuli per stazione. B13011 = precipitazione (KG/M**2 = mm).
 *
 * ATTENZIONE — cose scoperte in fase di analisi:
 *  - I reftime sono UTC (verificato empiricamente: ultimo dato ≈ ora UTC attuale).
 *    Il giorno italiano D va quindi richiesto come finestra UTC [D-1 22:00 → D 22:00]
 *    in estate (23:00 in inverno), gestita con getItalyOffset.
 *  - Ogni lettura è un accumulo che TERMINA al proprio reftime: la lettura con
 *    ref esattamente all'inizio finestra appartiene al giorno precedente
 *    (si filtra con ref > inizio e ref <= fine).
 *  - La granularità VARIA per rete: Lombardia 10 min (trange "1,0,600"),
 *    Marche 15 min ("1,0,900"), Umbria 1 min ("1,0,60"). Si sceglie per ogni
 *    stazione la serie B13011 più fitta e si somma; completezza richiesta ≥85%
 *    delle letture attese (86400/passo) per non scrivere sottostime.
 *  - Senza login sono accessibili solo gli ultimi ~10 giorni: un run fallito
 *    si recupera (auto-riparazione fino a 7 giorni), oltre serve un account.
 *  - Metadati stazione: solo nome (B01019) e lat/lon — niente quota (q:0).
 *
 * Licenza dati: CC-BY compliant, citare la fonte (MeteoHub / Agenzia ItaliaMeteo).
 */

const fs   = require('fs');
const path = require('path');

const BASE_URL = 'https://meteohub.agenziaitaliameteo.it/api/observations';
const DATA_ROOT = path.join(__dirname, '../..', 'data');

const NETWORKS = [
  // Lombardia RIMOSSA il 27/7/2026: in mappa (e in produzione) la Lombardia usa
  // ARPA, non MeteoHub. La rete dpcn-lombardia serviva solo da CONTROLLO — la
  // cartella storica data/meteohub-lombardia resta nel repo ma non si aggiorna più.
  { net: 'dpcn-marche',     dir: 'meteohub-marche',     sigla: 'MAR' },
  { net: 'dpcn-umbria',     dir: 'meteohub-umbria',     sigla: 'UMB' },
  { net: 'dpcn-lazio',      dir: 'meteohub-lazio',      sigla: 'LAZ' },
  { net: 'dpcn-campania',   dir: 'meteohub-campania',   sigla: 'CAM' },
  { net: 'dpcn-puglia',     dir: 'meteohub-puglia',     sigla: 'PUG' },
  { net: 'dpcn-calabria',   dir: 'meteohub-calabria',   sigla: 'CAL' },
  { net: 'dpcn-sicilia',    dir: 'meteohub-sicilia',    sigla: 'SIC' },
  { net: 'dpcn-sardegna',   dir: 'meteohub-sardegna',   sigla: 'SAR' },
  { net: 'dpcn-basilicata', dir: 'meteohub-basilicata', sigla: 'BAS' },
  { net: 'dpcn-molise',     dir: 'meteohub-molise',     sigla: 'MOL' },
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

/** Finestra UTC del giorno di calendario italiano dateStr (YYYY-MM-DD). */
function utcWindowForItalianDay(dateStr) {
  const offset = getItalyOffset(new Date(dateStr + 'T12:00:00Z'));
  const start = new Date(new Date(dateStr + 'T00:00:00Z').getTime() - offset * 3600000);
  const end   = new Date(start.getTime() + 24 * 3600000);
  const fmtQ   = d => d.toISOString().substring(0, 16).replace('T', ' '); // "YYYY-MM-DD HH:MM"
  const fmtRef = d => d.toISOString().substring(0, 19);                   // confronto stringa coi ref
  return { qFrom: fmtQ(start), qTo: fmtQ(end), refFrom: fmtRef(start), refTo: fmtRef(end) };
}

// Temperatura e vento (11/8/2026 — grafici stazione): prodotti B12101
// (temperatura, ⚠️ in KELVIN → v>100 ? v-273,15, come la Francia), B11002
// (vento medio, m/s → ×3,6) e B11041 (raffica, m/s — poche stazioni, null
// dove manca). Tre query in più per (rete, giorno); stazione identificata
// dallo stesso id lat_lon della pioggia. Serie più fitta per prodotto (come
// per B13011); completezza in ORE COPERTE ≥ MIN_ORE_METEO. Tutto in un try:
// un guasto delle query meteo non tocca mai la pioggia.
const MIN_ORE_METEO = 20;
async function collectMeteoHub(netCfg, w) {
  const out = {};   // id → {t?, w?}
  const fetchProd = async prod => {
    const q = `reftime: >=${w.qFrom},<=${w.qTo};product:${prod};license:CCBY_COMPLIANT`;
    const url = `${BASE_URL}?networks=${encodeURIComponent(netCfg.net)}&q=${encodeURIComponent(q)}`;
    const raw = await fetchJSON(url);
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
      if (!vals.length) continue;
      perId[`${stat.lat.toFixed(5)}_${stat.lon.toFixed(5)}`] = vals;
    }
    return perId;
  };
  const oreDi = vals => new Set(vals.map(v => (v.ref || '').slice(11, 13))).size;

  const temp = await fetchProd('B12101');
  Object.keys(temp).forEach(id => {
    const vals = temp[id].map(v => v.val > 100 ? v.val - 273.15 : v.val).filter(v => v >= -45 && v <= 50);
    if (vals.length && oreDi(temp[id]) >= MIN_ORE_METEO)
      (out[id] = out[id] || {}).t = [Math.round(Math.min(...vals) * 10) / 10,
                                     Math.round(Math.max(...vals) * 10) / 10];
  });
  await sleep(500);
  const vento = await fetchProd('B11002');
  const raffica = await fetchProd('B11041');
  Object.keys(vento).forEach(id => {
    const vals = vento[id].map(v => v.val).filter(v => v >= 0 && v < 60);
    if (!vals.length || oreDi(vento[id]) < MIN_ORE_METEO) return;
    const media = vals.reduce((a, v) => a + v, 0) / vals.length;
    const gu = (raffica[id] || []).map(v => v.val).filter(v => v >= 0 && v < 90);
    (out[id] = out[id] || {}).w = [Math.round(media * 3.6 * 10) / 10,
                                   gu.length ? Math.round(Math.max(...gu) * 3.6 * 10) / 10 : null];
  });
  // Umidità relativa (18/8/2026): prodotto B13003 (%), una query in più per rete/giorno.
  await sleep(500);
  const umid = await fetchProd('B13003');
  Object.keys(umid).forEach(id => {
    const vals = umid[id].map(v => v.val).filter(v => v >= 0 && v <= 100);
    if (vals.length && oreDi(umid[id]) >= MIN_ORE_METEO)
      (out[id] = out[id] || {}).u = [Math.round(Math.min(...vals)), Math.round(Math.max(...vals))];
  });
  return out;
}

async function collectDay(netCfg, dateStr) {
  const w = utcWindowForItalianDay(dateStr);
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:B13011;license:CCBY_COMPLIANT`;
  const url = `${BASE_URL}?networks=${encodeURIComponent(netCfg.net)}&q=${encodeURIComponent(q)}`;
  const raw = await fetchJSON(url);
  const out = [];
  for (const entry of (raw.data || [])) {
    const stat = entry.stat || {};
    if (typeof stat.lat !== 'number' || typeof stat.lon !== 'number') continue;
    // Serie B13011 più fitta per questa stazione
    let best = null;
    for (const pr of (entry.prod || [])) {
      if (pr.var !== 'B13011' || !Array.isArray(pr.val)) continue;
      if (!best || pr.val.length > best.val.length) best = pr;
    }
    if (!best) continue;
    // Passo in secondi dal trange "1,0,N" → letture attese nel giorno
    const stepSec = parseInt((best.trange || '').split(',')[2], 10);
    if (!stepSec || stepSec <= 0) continue;
    const expected = Math.round(86400 / stepSec);
    // Accumuli che TERMINANO dentro il giorno italiano: ref > inizio, ref <= fine
    const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
    if (vals.length < expected * 0.85) continue; // giornata troppo bucata: meglio nessun dato che una sottostima
    let mm = vals.reduce((a, v) => a + v.val, 0);
    mm = Math.round(mm * 10) / 10;
    if (mm < 0 || mm > 500) continue;
    const nome = ((entry.stat.details || []).find(x => x.var === 'B01019') || {}).val || '—';
    out.push({
      id:  `${stat.lat.toFixed(5)}_${stat.lon.toFixed(5)}`,
      n:   nome,
      lat: Math.round(stat.lat * 10000) / 10000,
      lon: Math.round(stat.lon * 10000) / 10000,
      q:   0,
      p:   netCfg.sigla,
      mm
    });
  }
  // t/w: un guasto qui non deve mai far fallire la pioggia
  try {
    const meteo = await collectMeteoHub(netCfg, w);
    out.forEach(rec => { if (meteo[rec.id]) Object.assign(rec, meteo[rec.id]); });
  } catch (e) { console.warn(`  Warn meteo ${netCfg.net}: ${e.message}`); }
  return out;
}

/** Stazioni REALI (non stimate) presenti in un file già scritto. */
function realiInFile(j) {
  if (!j || !Array.isArray(j.stations)) return 0;
  return j.stations.filter(s => !s.om).length;
}
/** Il file contiene stime Open-Meteo? (copertura intera o integrazione parziale) */
function haStime(j) {
  return !!j && (j.source === 'open-meteo-gapfill' || !!j.gapfill ||
                 (Array.isArray(j.stations) && j.stations.some(s => s.om)));
}
function leggiFile(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
/** Quante stazioni reali porta di solito questa rete: mediana sui file recenti. */
function tipicoReali(dir, giorni) {
  const v = [];
  for (const d of giorni) {
    const j = leggiFile(path.join(dir, `${d}.json`));
    if (j && !haStime(j)) v.push(realiInFile(j));
  }
  if (v.length < 3) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

function writeDay(dir, dateStr, stations, net, soglia) {
  if (stations.length < 10) {
    console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto la scrittura`);
    return false;
  }
  const outFile = path.join(dir, `${dateStr}.json`);
  // Non peggiorare un giorno già coperto: se il file contiene stime Open-Meteo
  // (che coprono l'intera rete) lo si sostituisce solo quando la raccolta nuova
  // è abbastanza ricca da reggere da sola. Altrimenti si rimpiazzerebbero 130
  // stazioni stimate con le 2 o 3 vere che MeteoHub ha ripubblicato, lasciando
  // la mappa più vuota di prima.
  if (soglia) {
    const vecchio = leggiFile(outFile);
    if (haStime(vecchio) && stations.length < soglia) {
      console.log(`  ${dateStr}: ${stations.length} stazioni reali < soglia ${soglia}, tengo il file con le stime`);
      return false;
    }
    if (haStime(vecchio)) {
      console.log(`  ${dateStr}: dato reale tornato (${stations.length} stazioni), sostituisco le stime`);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'meteohub-dpcn',
    network:   net,
    count:     stations.length,
    stations
  }));
  console.log(`  ✅ Scritto ${outFile} (${stations.length} stazioni)`);
  return true;
}

async function main() {
  console.log('=== collect-meteohub avviato (pilota) ===');

  const now = new Date();
  const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const todayStr = fmtDate(italyNow);
  const noon = new Date(todayStr + 'T12:00:00Z').getTime();

  for (const netCfg of NETWORKS) {
    console.log(`--- Rete ${netCfg.net}`);
    const dir = path.join(DATA_ROOT, netCfg.dir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let targetDays;
    let soglia = 0; // stazioni reali minime perché un giorno regga senza stime
    if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
      targetDays = [process.env.DATE_OVERRIDE.trim()];
    } else {
      // ieri + altroieri sempre; auto-riparazione 3-9 giorni indietro
      // (la finestra pubblica MeteoHub copre ~10 giorni: 9 lascia un giorno di
      // margine ed è più larga dei 7 di prima).
      //
      // Il campanello "questo giorno è venuto male" ora conta le stazioni
      // REALI, non le righe del file (30/7/2026). Prima bastava `count < 10`,
      // e siccome la copertura Open-Meteo scrive un file pieno (130 stazioni
      // stimate per la Puglia del 27/7), dal momento della toppa in poi il
      // giorno sembrava sano e non veniva più riprovato: ci chiudevamo da soli
      // la porta al dato reale, sprecando i giorni di finestra rimasti. Peggio
      // ancora i giorni parziali sopra le 10 stazioni (Molise 29/7: 23 su 28),
      // che non venivano riletti MAI.
      targetDays = [1, 2].map(i => fmtDate(new Date(noon - i * 24 * 3600000)));
      const recenti = [];
      for (let i = 1; i <= 10; i++) recenti.push(fmtDate(new Date(noon - i * 24 * 3600000)));
      soglia = Math.floor(tipicoReali(dir, recenti) * 0.9); // 0 se la finestra è troppo scarna
      for (let i = 3; i <= 9; i++) {
        const dStr = fmtDate(new Date(noon - i * 24 * 3600000));
        const j = leggiFile(path.join(dir, `${dStr}.json`));
        const reali = realiInFile(j);
        let motivo = null;
        if (!j) motivo = 'file assente';
        else if ((j.count || 0) < 10) motivo = `solo ${j.count || 0} righe`;
        else if (haStime(j)) motivo = `contiene stime (${reali} stazioni reali)`;
        else if (soglia >= 10 && reali < soglia) motivo = `${reali} stazioni reali sotto la soglia ${soglia}`;
        if (motivo) { targetDays.push(dStr); console.log(`  ↻ ${dStr}: ${motivo}, riprovo`); }
      }
    }

    for (const dStr of targetDays) {
      try {
        console.log(`  Raccolgo ${dStr}...`);
        writeDay(dir, dStr, await collectDay(netCfg, dStr), netCfg.net, soglia);
      } catch(e) {
        console.warn(`  Warn: ${netCfg.net} ${dStr} fallito: ${e.message}`);
      }
      await sleep(1000);
    }

    // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
    const MAX_DAYS = 730;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    const cutoffStr = cutoff.toISOString().substring(0, 10);
    let deleted = 0;
    fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .forEach(f => {
        if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(dir, f)); deleted++; }
      });
    if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file oltre i ${MAX_DAYS} giorni eliminati`);
  }

  console.log('=== collect-meteohub completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
