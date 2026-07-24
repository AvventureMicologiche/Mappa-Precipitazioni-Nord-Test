/**
 * collect-friuli-osmer.js  —  GitHub Actions (PILOTA, solo repo di test)
 * Raccoglie precipitazioni giornaliere reali del Friuli V.G. dall'archivio
 * ARPA OSMER (www.meteo.fvg.it). Scopo: valutare se le ~15-20 stazioni con
 * dato d'archivio battono l'Open-Meteo attuale (~30 punti stimati). Scrive in
 * data/friuli-osmer/, SEPARATA da data/friuli/ (Open-Meteo), per il confronto.
 *
 * ACCESSO (reverse-engineering del 23/07/2026):
 *  - GET /archivio.php?ln=&p=dati → cookie PHPSESSID. FONDAMENTALE aggiungere
 *    a mano il cookie di consenso "meteofvg_cookie=1": senza, l'endpoint dati
 *    risponde 400 Bad Request (era IL muro che aveva fatto rinunciare all'inizio).
 *  - Anagrafica stazioni: dal <select id="stazione"> della pagina archivio,
 *    valori "CODICE@nome@tipo@lat@lon@id" (lat/lon inclusi).
 *  - POST /ajax/getStationData.php  (form-urlencoded, NON json) con
 *    {a,m,g,s,t,ln,o}:  a=anno, m=mese, g=giorno, s=valore stazione,
 *    t=H_2 (ORARI) oppure H_3 (giornalieri), ln='', o='visualizza'.
 *    Risposta: stringa JSON contenente HTML, con dentro un data-URI CSV.
 *
 * PERCHÉ ORARI (H_2) E NON GIORNALIERI (H_3): l'archivio giornaliero copre solo
 * ~8 stazioni, l'orario ~20. Si sommano le 24 ore (colonna "Pioggia mm") per
 * ottenere il totale del giorno. Le ore sono in UTC: il totale è quindi il
 * giorno UTC, con un piccolo sfasamento (~2h) rispetto al giorno di calendario
 * italiano usato dalle altre regioni — DA VALIDARE nel confronto con Open-Meteo.
 * Soglia completezza: ≥20/24 ore valide, altrimenti niente dato (no sottostime).
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HOST     = 'www.meteo.fvg.it';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'friuli-osmer');
const GIORNI_TARGET = 2;    // ieri + altroieri
const GIORNI_REPAIR = 5;    // auto-riparazione se un file manca/è scarno
const MIN_ORE = 20;         // completezza minima per accettare un giorno

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

function req(pathName, method, headers, bodyForm) {
  return new Promise((resolve, reject) => {
    const data = bodyForm != null ? new URLSearchParams(bodyForm).toString() : null;
    const r = https.request({ host: HOST, path: pathName, method, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(headers || {})
    }}, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ code: res.statusCode, body: d, setCookie: res.headers['set-cookie'] }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Apre sessione: GET archivio + cookie di consenso. Ritorna {cookie, html}. */
async function apriSessione() {
  const page = await req('/archivio.php?ln=&p=dati', 'GET', {}, null);
  let cookie = (page.setCookie || []).map(c => c.split(';')[0]).join('; ');
  if (!/meteofvg_cookie/.test(cookie)) cookie += (cookie ? '; ' : '') + 'meteofvg_cookie=1';
  return { cookie, html: page.body };
}

/** Estrae le stazioni attuali dal <select>. */
function parseStazioni(html) {
  const out = [];
  // Le option hanno attributi in mezzo: <option data-start="2016" value="COD@nome@tipo@lat@lon@id">
  const re = /value="([^"]*@[^"]*@[^"]*@[^"]*@[^"]*@[^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = m[1];
    if (/fino al|interruzione/i.test(v)) continue;   // stazioni dismesse
    const p = v.split('@');
    const lat = parseFloat(p[3]), lon = parseFloat(p[4]);
    if (isNaN(lat) || isNaN(lon)) continue;
    out.push({ val: v, n: p[1], lat, lon });
  }
  return out;
}

/** Somma oraria → totale giornaliero, o null se troppo bucato. */
function dailyTotal(bodyStr) {
  let html;
  try { html = JSON.parse(bodyStr); } catch (e) { return null; }
  const m = html.match(/data:application\/csv;charset=utf-8,([^"']+)/i);
  if (!m) return null;
  const csv = decodeURIComponent(m[1]).split(/\r?\n/);
  if (csv.length < 2) return null;
  const header = csv[0].split(';');
  const pc = header.findIndex(c => /pioggia|precip/i.test(c));
  if (pc < 0) return null;
  let sum = 0, valid = 0;
  for (const line of csv.slice(1)) {
    const c = line.split(';');
    if (c.length <= pc) continue;
    const v = c[pc];
    if (v && v !== '-') { const f = parseFloat(v); if (!isNaN(f)) { sum += f; valid++; } }
  }
  if (valid < MIN_ORE) return null;
  const mm = Math.round(sum * 10) / 10;
  return (mm < 0 || mm > 500) ? null : mm;
}

async function collectDay(sess, stazioni, dateStr) {
  const [a, m, g] = dateStr.split('-').map(x => String(parseInt(x, 10)));
  const H = { 'Cookie': sess.cookie, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HOST}/archivio.php?ln=&p=dati` };
  const stations = [];
  const BATCH = 5;
  for (let i = 0; i < stazioni.length; i += BATCH) {
    const chunk = stazioni.slice(i, i + BATCH);
    await Promise.all(chunk.map(async st => {
      try {
        const r = await req('/ajax/getStationData.php', 'POST', H, { a, m, g, s: st.val, t: 'H_2', ln: '', o: 'visualizza' });
        if (r.code !== 200) return;
        const mm = dailyTotal(r.body);
        if (mm === null) return;
        stations.push({ id: `osmer_${st.val.split('@')[0]}`, n: st.n, lat: Math.round(st.lat * 10000) / 10000, lon: Math.round(st.lon * 10000) / 10000, q: 0, p: 'FVG', mm });
      } catch (e) {}
    }));
    await sleep(400);
  }
  return stations;
}

function writeDay(dateStr, stations) {
  if (stations.length < 8) { console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto`); return false; }
  fs.writeFileSync(path.join(DATA_DIR, `${dateStr}.json`), JSON.stringify({
    date: dateStr, collected: new Date().toISOString(), source: 'osmer-fvg', count: stations.length, stations
  }));
  console.log(`  ✅ ${dateStr}: ${stations.length} stazioni`);
  return true;
}

async function main() {
  console.log('=== collect-friuli-osmer avviato (pilota) ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const sess = await apriSessione();
  const stazioni = parseStazioni(sess.html);
  console.log(`  Sessione aperta, ${stazioni.length} stazioni nel form`);
  if (stazioni.length < 10) throw new Error(`Troppo poche stazioni nel form: ${stazioni.length}`);

  const now = new Date();
  const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const noon = new Date(fmtDate(italyNow) + 'T12:00:00Z').getTime();

  let targetDays;
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    targetDays = [process.env.DATE_OVERRIDE.trim()];
  } else {
    targetDays = [];
    for (let i = 1; i <= GIORNI_TARGET; i++) targetDays.push(fmtDate(new Date(noon - i * 24 * 3600000)));
    for (let i = GIORNI_TARGET + 1; i <= GIORNI_REPAIR; i++) {
      const dStr = fmtDate(new Date(noon - i * 24 * 3600000));
      const f = path.join(DATA_DIR, `${dStr}.json`);
      let repair = !fs.existsSync(f);
      if (!repair) { try { repair = (JSON.parse(fs.readFileSync(f, 'utf8')).count || 0) < 8; } catch (e) { repair = true; } }
      if (repair) targetDays.push(dStr);
    }
  }

  for (const dStr of targetDays) {
    console.log(`  Raccolgo ${dStr}...`);
    try { writeDay(dStr, await collectDay(sess, stazioni, dStr)); }
    catch (e) { console.warn(`  Warn ${dStr}: ${e.message}`); }
  }

  // ── Pulizia file > 365 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 365;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .forEach(f => { if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; } });
  if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file eliminati`);

  console.log('=== collect-friuli-osmer completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
