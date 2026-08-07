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
 * ~8 stazioni, l'orario ~20-40. Le ore sono in UTC (confermato dal footer del CSV
 * il 25/07/2026: colonna "ora UTC", valori 1..24). Per allinearsi al GIORNO SOLARE
 * ITALIANO usato da tutte le altre regioni (mezzanotte-mezzanotte locale) NON si
 * sommano le 24 ore UTC del giorno (sfaserebbe di ~2h), ma le 24 ore locali: le
 * ultime `offset` ore del giorno UTC precedente + le prime `24-offset` del giorno
 * UTC corrente (offset = 2 in ora legale, 1 in ora solare). Vedi localDayTotal.
 * L'ora h = pioggia dell'intervallo UTC [h-1, h]. Allineamento validato con
 * analisi di lag vs Open-Meteo (25/07/2026). Soglia completezza: ≥20/24 ore.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HOST     = 'www.meteo.fvg.it';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'friuli-osmer');
// L'archivio OSMER continua a ingerire le ore di un giorno per diversi giorni
// (una stazione supera la soglia solo quando ha ~24 ore complete). Perciò si
// riscarica SEMPRE una finestra larga e si fa MERGE col file esistente (vedi
// mergeDay): la copertura può solo crescere e il rumore di richiesta (timeout
// silenziosi) non cancella mai una stazione già presa. Verificato il 25/07/2026:
// riscaricando i giorni vecchi guadagnavano stazioni, i recenti oscillavano per
// i timeout — il vecchio last-write-wins su finestra di 2 giorni li peggiorava
// (es. 23/7 sceso da 39 a 32 stazioni).
const GIORNI_WINDOW = 7;    // giorni indietro riscaricati sempre (finestra di riempimento)
const MIN_ORE = 20;         // completezza minima (ore valide) per accettare una stazione
const MIN_STAZIONI = 8;     // sotto questa soglia il giorno non si scrive

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

/** Estrae la mappa oraria {ora(1..24) → mm} dal CSV OSMER, o null se illeggibile.
 *  Solo le ore con valore numerico valido entrano nella mappa (il '-' = dato
 *  mancante, NON zero). */
function parseHourly(bodyStr) {
  let html;
  try { html = JSON.parse(bodyStr); } catch (e) { return null; }
  const m = html.match(/data:application\/csv;charset=utf-8,([^"']+)/i);
  if (!m) return null;
  const csv = decodeURIComponent(m[1]).split(/\r?\n/);
  if (csv.length < 2) return null;
  const header = csv[0].split(';');
  const hc = header.findIndex(c => /ora/i.test(c));
  const pc = header.findIndex(c => /pioggia|precip/i.test(c));
  if (hc < 0 || pc < 0) return null;
  const hours = {};
  for (const line of csv.slice(1)) {
    const c = line.split(';');
    if (c.length <= Math.max(hc, pc)) continue;
    const h = parseInt(c[hc], 10);
    if (isNaN(h) || h < 1 || h > 24) continue;
    const v = c[pc];
    if (v && v !== '-') { const f = parseFloat(v); if (!isNaN(f)) hours[h] = f; }
  }
  return hours;
}

/** Totale del GIORNO SOLARE ITALIANO combinando le ore UTC dei due giorni al
 *  confine: dal giorno UTC precedente le ore > (24-offset), dal corrente le ore
 *  ≤ (24-offset). offset = 2 (ora legale) o 1 (ora solare). null se < MIN_ORE. */
function localDayTotal(prevHours, curHours, offset) {
  const B = 24 - offset;
  let sum = 0, valid = 0;
  for (let h = B + 1; h <= 24; h++) { if (prevHours && prevHours[h] != null) { sum += prevHours[h]; valid++; } }
  for (let h = 1; h <= B; h++)      { if (curHours  && curHours[h]  != null) { sum += curHours[h];  valid++; } }
  if (valid < MIN_ORE) return null;
  const mm = Math.round(sum * 10) / 10;
  return (mm < 0 || mm > 500) ? null : mm;
}

/** Scarica e parsa la serie oraria (UTC) di una stazione per una data UTC. */
async function fetchHourly(sess, stVal, utcDate) {
  const [a, m, g] = utcDate.split('-').map(x => String(parseInt(x, 10)));
  const H = { 'Cookie': sess.cookie, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HOST}/archivio.php?ln=&p=dati` };
  try {
    const r = await req('/ajax/getStationData.php', 'POST', H, { a, m, g, s: stVal, t: 'H_2', ln: '', o: 'visualizza' });
    if (r.code !== 200) return null;
    return parseHourly(r.body);
  } catch (e) { return null; }
}

/**
 * Unisce le stazioni appena raccolte con quelle già nel file del giorno:
 * per ogni stazione (per id) vince la lettura più recente (fresca = archivio
 * più completo); le stazioni già presenti che questo run NON riprende (timeout,
 * o non più nel form) NON vengono perse. Così la copertura può solo crescere e
 * un run "magro" non peggiora mai un file già ricco.
 */
function mergeDay(dateStr, freshStations) {
  const file = path.join(DATA_DIR, `${dateStr}.json`);
  const byId = {};
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      (prev.stations || []).forEach(s => { if (s && s.id) byId[s.id] = s; });
    } catch (e) {}
  }
  freshStations.forEach(s => { if (s && s.id) byId[s.id] = s; });
  const stations = Object.keys(byId).map(k => byId[k]);
  if (stations.length < MIN_STAZIONI) { console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto`); return false; }
  fs.writeFileSync(file, JSON.stringify({
    date: dateStr, collected: new Date().toISOString(), source: 'osmer-fvg', count: stations.length, stations
  }));
  console.log(`  ✅ ${dateStr}: ${stations.length} stazioni (fresche questo run: ${freshStations.length})`);
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
    for (let i = 1; i <= GIORNI_WINDOW; i++) targetDays.push(fmtDate(new Date(noon - i * 24 * 3600000)));
  }

  // Ogni giorno solare italiano usa le ore di DUE date UTC (quella del giorno e
  // la precedente, per le ore al confine). Raccolgo l'insieme minimo di date UTC:
  // giorni adiacenti condividono la data di confine, quindi per 7 giorni sono 8.
  const prevOf = d => fmtDate(new Date(new Date(d + 'T12:00:00Z').getTime() - 24 * 3600000));
  const utcSet = new Set();
  targetDays.forEach(d => { utcSet.add(d); utcSet.add(prevOf(d)); });
  const utcDates = [...utcSet];

  // Scarico la serie oraria di ogni (stazione, data UTC) una sola volta, in
  // batch di 5 richieste (stesso ritmo di prima), tenendola in cache.
  const cache = {}; // `${stVal}|${utcDate}` -> mappa oraria
  const tasks = [];
  for (const st of stazioni) for (const ud of utcDates) tasks.push({ st, ud });
  console.log(`  ${stazioni.length} stazioni × ${utcDates.length} date UTC = ${tasks.length} richieste`);
  const BATCH = 5;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const chunk = tasks.slice(i, i + BATCH);
    await Promise.all(chunk.map(async t => { cache[`${t.st.val}|${t.ud}`] = await fetchHourly(sess, t.st.val, t.ud); }));
    await sleep(400);
  }

  // Compongo ogni giorno solare italiano dalle ore in cache, poi merge.
  for (const dStr of targetDays) {
    const pd = prevOf(dStr);
    const offset = getItalyOffset(new Date(dStr + 'T12:00:00Z'));
    const stations = [];
    for (const st of stazioni) {
      const mm = localDayTotal(cache[`${st.val}|${pd}`], cache[`${st.val}|${dStr}`], offset);
      if (mm === null) continue;
      stations.push({ id: `osmer_${st.val.split('@')[0]}`, n: st.n, lat: Math.round(st.lat * 10000) / 10000, lon: Math.round(st.lon * 10000) / 10000, q: 0, p: 'FVG', mm });
    }
    mergeDay(dStr, stations);
  }

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
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
