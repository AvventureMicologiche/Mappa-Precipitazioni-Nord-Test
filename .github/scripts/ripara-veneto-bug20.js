#!/usr/bin/env node
/**
 * Ripara lo storico Veneto del bug #20 (19/8/2026) con l'archivio MeteoHub.
 *
 * IL BUG: fino al 19/8 collect-veneto.js scriveva come totale del giorno il
 * Math.max dei valori ARPAV, credendoli cumulati; erano incrementi di 30 min.
 * Risultato: la mezz'ora più piovosa al posto del totale, sottostima ~36%
 * (il 16/8 -47%). Il collector è stato corretto il 19/8 e il 17-18/8 rifatti
 * dall'XML ARPAV, che però tiene solo 48 ore: più indietro non si torna.
 *
 * LA TOPPA: la rete ARPAV è ripubblicata dal DPC su MeteoHub (dpcn-veneto),
 * con serie a passo fisso che si SOMMANO, e l'account gratuito apre l'archivio
 * da giugno. Verificato il 19/8 contro i nostri giorni già corretti: 17/8 80%
 * identico (media 8,00 vs 7,69), 18/8 95%. È la stessa rete, stessi numeri.
 *
 * COSA FA, per ogni giorno dell'intervallo:
 *  - legge il nostro file data/veneto/<g>.json (array di stazioni);
 *  - scarica dpcn-veneto, somma per stazione (completezza ≥85%, come il collector);
 *  - per ogni NOSTRA stazione con una gemella MeteoHub entro 300 m sostituisce
 *    mm con la somma MeteoHub e marca fix20:'mh'. t/u/w non si toccano.
 *  - le stazioni senza gemella (~90 su 186) restano col valore vecchio: non
 *    abbiamo niente di meglio finché ARPAV non pubblica l'archivio mensile.
 *    Restano riconoscibili perché NON hanno fix20.
 *  - il file originale viene copiato in data/veneto/_pre-fix20/<g>.json la
 *    prima volta (idempotente: se c'è già non si sovrascrive).
 *
 * USO (credenziali solo da ambiente):
 *   $env:MH_USER="..."; $env:MH_PASS="..."; node .github/scripts/ripara-veneto-bug20.js 2026-07-20 2026-08-16
 *   aggiungere DRY=1 per vedere i numeri senza scrivere nulla.
 */
const fs = require('fs'), path = require('path');
const BASE = 'https://meteohub.agenziaitaliameteo.it';
const DIR = path.join(__dirname, '..', '..', 'data', 'veneto');
const BK = path.join(DIR, '_pre-fix20');
const DA = process.argv[2], A = process.argv[3];
const DRY = process.env.DRY === '1';
const user = (process.env.MH_USER || '').trim(), pass = process.env.MH_PASS || '';
if (!DA || !A) { console.error('uso: node ripara-veneto-bug20.js YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }
if (!user || !pass) { console.error('Mancano MH_USER / MH_PASS'); process.exit(1); }

async function login() {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
  const t = await r.text(); if (!r.ok) throw new Error('login HTTP ' + r.status);
  let tok = t.trim(); try { const j = JSON.parse(t); tok = j.token || j.access_token || tok; } catch (e) {}
  return tok.replace(/^"|"$/g, '');
}
function offsetIT(d) { const y = d.getUTCFullYear(); const u = m => { const x = new Date(Date.UTC(y, m + 1, 0)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(1, 0, 0, 0); return x; }; return (d >= u(2) && d < u(9)) ? 2 : 1; }
function finestra(g) {
  const off = offsetIT(new Date(g + 'T12:00:00Z'));
  const s = new Date(new Date(g + 'T00:00:00Z').getTime() - off * 3600000), e = new Date(s.getTime() + 86400000);
  const q = d => d.toISOString().slice(0, 16).replace('T', ' '), r = d => d.toISOString().slice(0, 19);
  return { qFrom: q(s), qTo: q(e), refFrom: r(s), refTo: r(e) };
}
async function giornoMH(g, tok) {
  const w = finestra(g);
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:B13011;license:CCBY_COMPLIANT`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + '/api/observations?networks=dpcn-veneto&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } });
    if (r.ok) {
      const j = await r.json(); const out = [];
      for (const e of (j.data || [])) {
        const st = e.stat || {}; if (typeof st.lat !== 'number') continue;
        let best = null; for (const p of (e.prod || [])) if (p.var === 'B13011' && Array.isArray(p.val) && (!best || p.val.length > best.val.length)) best = p;
        if (!best) continue;
        const step = parseInt((best.trange || '').split(',')[2], 10); if (!step) continue;
        const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
        if (vals.length < Math.round(86400 / step) * 0.85) continue;
        const mm = Math.round(vals.reduce((a, v) => a + v.val, 0) * 10) / 10;
        if (mm < 0 || mm > 300) continue;
        // Massimo su MEZZ'ORA allineata (:00 e :30), ricostruito dalla serie a
        // 5 minuti: è ESATTAMENTE la grandezza che il bug #20 scriveva al posto
        // del totale. Serve a verificare, stazione per stazione, che le due
        // fonti stiano guardando la stessa pioggia (vedi PROVA DI COERENZA).
        // ⚠️ La marca temporale è la FINE dell'accumulo (il collector filtra
        // proprio così: "accumuli che TERMINANO dentro il giorno"). Il valore
        // delle 10:00 appartiene quindi alla mezz'ora 09:30-10:00, non a quella
        // che inizia alle 10:00: si toglie 1 ms prima di scegliere il blocco.
        // Senza questa riga una pioggia a cavallo del confine finiva spezzata
        // in due mezz'ore e il confronto falliva (il 7/8 scartava 23 stazioni
        // su 95 per questo motivo).
        const blocchi = {};
        for (const v of vals) {
          const k = Math.floor((new Date(v.ref + 'Z').getTime() - 1) / 1800000);
          blocchi[k] = (blocchi[k] || 0) + v.val;
        }
        const max30 = Math.round(Math.max(0, ...Object.values(blocchi)) * 10) / 10;
        out.push({ lat: st.lat, lon: st.lon, mm, max30 });
      }
      return out;
    }
    await new Promise(r => setTimeout(r, 5000 * (i + 1)));
  }
  return null;
}
const km = (a, b) => { const R = 6371, dl = (b.lat - a.lat) * Math.PI / 180, dn = (b.lon - a.lon) * Math.PI / 180 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180); return R * Math.sqrt(dl * dl + dn * dn); };
const giorni = []; for (let t = new Date(DA + 'T12:00:00Z').getTime(); t <= new Date(A + 'T12:00:00Z').getTime(); t += 86400000) giorni.push(new Date(t).toISOString().slice(0, 10));

(async () => {
  const tok = await login(); console.log('login ok' + (DRY ? '  [DRY: non scrivo]' : ''));
  if (!DRY) fs.mkdirSync(BK, { recursive: true });
  console.log('giorno      gemelle  cambiate  media prima → dopo   max prima → dopo   scarti');
  let totCamb = 0;
  for (const g of giorni) {
    const f = path.join(DIR, g + '.json');
    let raw; try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(g, ' file assente, salto'); continue; }
    const st = Array.isArray(raw) ? raw : raw.stations;
    if (!Array.isArray(st)) { console.log(g, ' forma inattesa, salto'); continue; }
    const mh = await giornoMH(g, tok);
    if (!mh || mh.length < 50) { console.log(g, ' MeteoHub ' + (mh ? mh.length + ' stazioni' : 'errore') + ', salto'); continue; }
    const mediaPrima = st.reduce((a, s) => a + (s.mm || 0), 0) / st.length, maxPrima = Math.max(...st.map(s => s.mm || 0));
    let gem = 0, camb = 0, scartMinore = 0, scartIncoerente = 0;
    for (const s of st) {
      if (typeof s.mm !== 'number') continue;
      let best = null, bd = 9; for (const m of mh) { const d = km(s, m); if (d < bd) { bd = d; best = m; } }
      if (!best || bd > 0.3) continue;
      gem++;

      // ── PROVA DI COERENZA, stazione per stazione ──────────────────────
      // Il bug #20 scriveva come totale del giorno il MASSIMO DI UNA MEZZ'ORA.
      // Dalla serie MeteoHub a 5 minuti quel massimo si ricostruisce (max30):
      // se coincide col valore che abbiamo in archivio, le due fonti stanno
      // misurando la stessa pioggia e la somma MeteoHub è la correzione giusta.
      // Se NON coincide, non è una sottostima da correggere ma un disaccordo
      // fra le fonti, e si tiene il valore vecchio finché non esce l'archivio
      // ARPAV (fine settembre). È il caso di Castelnovo Bariano il 24/7 e di
      // Cavarzere il 4/8: nostro 0, MeteoHub 36,4 — con 36 mm caduti, nessuna
      // mezz'ora può valere zero.
      // Niente soglie a occhio: si confrontano due misure della STESSA cosa.
      const atteso = best.max30;
      const scarto = Math.abs(atteso - s.mm);
      if (scarto > 0.6 && scarto > atteso * 0.3) { scartIncoerente++; continue; }

      // Non abbassare mai: il massimo di una mezz'ora non può superare il
      // totale del giorno, quindi una correzione che abbassa sta importando
      // un buco di MeteoHub, non correggendo il bug.
      if (best.mm <= s.mm) { if (best.mm < s.mm) scartMinore++; continue; }

      s.mm = best.mm; camb++; s.fix20 = 'mh';
    }
    const mediaDopo = st.reduce((a, s) => a + (s.mm || 0), 0) / st.length, maxDopo = Math.max(...st.map(s => s.mm || 0));
    console.log(g.padEnd(11), String(gem).padStart(7), String(camb).padStart(9), '  ', mediaPrima.toFixed(2).padStart(6), '→', mediaDopo.toFixed(2).padStart(6), '     ', maxPrima.toFixed(1).padStart(6), '→', maxDopo.toFixed(1).padStart(6), '   scartate: ' + scartIncoerente + ' incoerenti, ' + scartMinore + ' minori');
    totCamb += camb;
    if (!DRY && camb > 0) {
      const bk = path.join(BK, g + '.json');
      if (!fs.existsSync(bk)) fs.copyFileSync(f, bk);
      fs.writeFileSync(f, JSON.stringify(raw));
    }
    await new Promise(r => setTimeout(r, 800));
  }
  console.log('\nstazioni-giorno cambiate:', totCamb, DRY ? '(DRY, nessun file toccato)' : '(originali in data/veneto/_pre-fix20)');
})().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
