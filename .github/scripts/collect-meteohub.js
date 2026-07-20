/**
 * collect-meteohub.js  —  GitHub Actions (PILOTA, solo repo di test)
 * Raccoglie precipitazioni giornaliere da MeteoHub (Agenzia ItaliaMeteo,
 * ex progetto Mistral) — rete DPCN dei centri funzionali regionali.
 *
 * Scopo del pilota (luglio 2026): valutare MeteoHub come fonte unica per
 * l'espansione della mappa a tutta Italia.
 *  - dpcn-lombardia: regione di CONTROLLO — abbiamo la verità a terra via
 *    ARPA Lombardia (Socrata) per validare che MeteoHub sia attendibile
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
  { net: 'dpcn-lombardia', dir: 'meteohub-lombardia', sigla: 'LOM' },
  { net: 'dpcn-marche',    dir: 'meteohub-marche',    sigla: 'MAR' },
  { net: 'dpcn-umbria',    dir: 'meteohub-umbria',    sigla: 'UMB' },
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
  return out;
}

function writeDay(dir, dateStr, stations, net) {
  if (stations.length < 10) {
    console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto la scrittura`);
    return false;
  }
  const outFile = path.join(dir, `${dateStr}.json`);
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
    if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
      targetDays = [process.env.DATE_OVERRIDE.trim()];
    } else {
      // ieri + altroieri sempre; auto-riparazione 3-7 giorni indietro
      // (la finestra pubblica MeteoHub copre ~10 giorni)
      targetDays = [1, 2].map(i => fmtDate(new Date(noon - i * 24 * 3600000)));
      for (let i = 3; i <= 7; i++) {
        const dStr = fmtDate(new Date(noon - i * 24 * 3600000));
        const f = path.join(dir, `${dStr}.json`);
        let needsRepair = !fs.existsSync(f);
        if (!needsRepair) {
          try { needsRepair = (JSON.parse(fs.readFileSync(f, 'utf8')).count || 0) < 10; }
          catch(e) { needsRepair = true; }
        }
        if (needsRepair) targetDays.push(dStr);
      }
    }

    for (const dStr of targetDays) {
      try {
        console.log(`  Raccolgo ${dStr}...`);
        writeDay(dir, dStr, await collectDay(netCfg, dStr), netCfg.net);
      } catch(e) {
        console.warn(`  Warn: ${netCfg.net} ${dStr} fallito: ${e.message}`);
      }
      await sleep(1000);
    }

    // ── Pulizia file > 365 giorni (retention finestra scorrevole) ──
    const MAX_DAYS = 365;
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
