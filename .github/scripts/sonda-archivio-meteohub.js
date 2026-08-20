#!/usr/bin/env node
/**
 * sonda-archivio-meteohub.js — quanto in la' vede l'archivio, rete per rete (20/8/2026).
 *
 * PERCHE'. Nelle dieci regioni del centro-sud ci sono giornate che NON sono
 * misure: quando MeteoHub non copriva ancora la regione i file sono stati
 * riempiti con Open-Meteo (`source: open-meteo-backfill-*`). Sono 13 giornate
 * su 45 per ogni regione, e il 20/8 si e' visto quanto valgono: nelle Marche
 * dell'11 luglio il modello dava 6-10 mm sulla zona di Osimo mentre quattro
 * pluviometri veri li' vicino dicevano zero.
 *
 * L'account MeteoHub apre l'archivio oltre la finestra pubblica di ~10 giorni
 * (dpcn-lazio da maggio, sir-toscana dal 14/6, dpcn-puglia completa dal 21/7),
 * quindi quelle giornate si POTREBBERO sostituire con dati veri. Ma prima si
 * guarda: ⚠️ il 20/8 abbiamo imparato che i buchi DENTRO il periodo coperto non
 * si recuperano (giornate mai ingerite, MeteoHub non le ripubblica: Lazio 3/8
 * risponde con 2 stazioni). Questa sonda dice, senza toccare NIENTE, quante
 * stazioni tornerebbero per ogni rete e per ogni giorno.
 *
 * USO:
 *   node .github/scripts/sonda-archivio-meteohub.js [DA A]
 *   senza date: le giornate di stima trovate nei nostri file degli ultimi 60 gg.
 *   MH_USER / MH_PASS: senza account vede solo ~10 giorni e la sonda non serve.
 *   DATA_ROOT=<cartella data> per leggere i file di un altro repo.
 */
const fs = require('fs'), path = require('path');

const BASE = 'https://meteohub.agenziaitaliameteo.it';
const DATA = process.env.DATA_ROOT || path.join(__dirname, '..', '..', 'data');
const MIN_ORE = 20;          // ore di lettura perche' una giornata sia completa

const RETI = [
  ['dpcn-marche', 'meteohub-marche'], ['dpcn-umbria', 'meteohub-umbria'],
  ['dpcn-lazio', 'meteohub-lazio'], ['dpcn-campania', 'meteohub-campania'],
  ['dpcn-puglia', 'meteohub-puglia'], ['dpcn-calabria', 'meteohub-calabria'],
  ['dpcn-sicilia', 'meteohub-sicilia'], ['dpcn-sardegna', 'meteohub-sardegna'],
  ['dpcn-basilicata', 'meteohub-basilicata'], ['dpcn-molise', 'meteohub-molise'],
];

let TOKEN = null;
async function login() {
  const u = (process.env.MH_USER || '').trim(), p = process.env.MH_PASS || '';
  if (!u || !p) return null;
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  if (!r.ok) throw new Error('login HTTP ' + r.status);
  const t = await r.text();
  let tok = t.trim();
  try { const j = JSON.parse(t); tok = j.token || j.access_token || j.accessToken || tok; } catch (e) {}
  return tok.replace(/^"|"$/g, '') || null;
}

function offsetIT(d) {
  const y = d.getUTCFullYear();
  const u = m => { const x = new Date(Date.UTC(y, m + 1, 0)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(1, 0, 0, 0); return x; };
  return (d >= u(2) && d < u(9)) ? 2 : 1;
}
function finestra(g) {
  const off = offsetIT(new Date(g + 'T12:00:00Z'));
  const s = new Date(new Date(g + 'T00:00:00Z').getTime() - off * 3600000), e = new Date(s.getTime() + 86400000);
  const q = d => d.toISOString().slice(0, 16).replace('T', ' '), r = d => d.toISOString().slice(0, 19);
  return { qFrom: q(s), qTo: q(e), refFrom: r(s), refTo: r(e) };
}

/** Quante stazioni risponderebbero per quella rete in quel giorno. */
async function sonda(rete, g) {
  const w = finestra(g);
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:B13011;license:CCBY_COMPLIANT`;
  const url = `${BASE}/api/observations?networks=${encodeURIComponent(rete)}&q=${encodeURIComponent(q)}`;
  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (r.status === 401) return { errore: 'fuori archivio (401)' };
  if (!r.ok) return { errore: 'HTTP ' + r.status };
  const j = await r.json();
  let tutte = 0, complete = 0, mm = 0;
  for (const e of (j.data || [])) {
    let best = null;
    for (const p of (e.prod || [])) if (p.var === 'B13011' && Array.isArray(p.val) && (!best || p.val.length > best.val.length)) best = p;
    if (!best) continue;
    tutte++;
    const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
    const ore = new Set(vals.map(v => v.ref.slice(11, 13))).size;
    if (ore >= MIN_ORE) { complete++; mm += vals.reduce((a, v) => a + v.val, 0); }
  }
  return { tutte, complete, media: complete ? mm / complete : 0 };
}

/** Le giornate dei nostri file che sono stime, non misure. */
function giornateDiStima(dir, da, a) {
  const out = [];
  for (let t = new Date(da + 'T12:00:00Z').getTime(); t <= new Date(a + 'T12:00:00Z').getTime(); t += 86400000) {
    const g = new Date(t).toISOString().slice(0, 10);
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DATA, dir, g + '.json'), 'utf8'));
      if ((j.source || '').startsWith('open-meteo')) out.push({ g, nostre: j.count || 0, fonte: j.source });
    } catch (e) {}
  }
  return out;
}

(async () => {
  const date = process.argv.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const oggi = new Date().toISOString().slice(0, 10);
  const da = date[0] || new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const a = date[1] || oggi;

  try { TOKEN = await login(); } catch (e) { console.warn('Warn login: ' + e.message); }
  console.log(`=== sonda archivio MeteoHub ${da} → ${a} (${TOKEN ? 'con account' : 'ANONIMA, vede ~10 giorni'}) ===\n`);

  let recuperabili = 0, perse = 0;
  for (const [rete, dir] of RETI) {
    const stime = giornateDiStima(dir, da, a);
    if (!stime.length) { console.log(`${rete.padEnd(17)} nessuna giornata di stima`); continue; }
    console.log(`${rete.padEnd(17)} ${stime.length} giornate di stima (${stime[0].g} → ${stime[stime.length - 1].g})`);
    for (const s of stime) {
      const r = await sonda(rete, s.g);
      if (r.errore) { console.log(`   ${s.g}  ${r.errore}`); perse++; }
      else {
        const buona = r.complete >= Math.max(10, s.nostre * 0.5);
        console.log(`   ${s.g}  archivio: ${String(r.complete).padStart(3)} stazioni complete su ${String(r.tutte).padStart(3)}` +
                    `, media ${r.media.toFixed(1)} mm   (nel nostro file: ${s.nostre} stimate)` + (buona ? '   ← RECUPERABILE' : ''));
        if (buona) recuperabili++; else perse++;
      }
      await new Promise(x => setTimeout(x, 800));
    }
  }
  console.log(`\nGiornate-regione recuperabili: ${recuperabili}, senza dato in archivio: ${perse}`);
})().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
