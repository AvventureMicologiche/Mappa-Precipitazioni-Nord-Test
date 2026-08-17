/**
 * collect-valledaosta-cf.js  —  GitHub Actions (PILOTA, solo repo di test)
 * Raccoglie precipitazioni giornaliere reali della Valle d'Aosta dal
 * Centro Funzionale VdA (piattaforma "ecometer/bobo" su presidi2.regione.vda.it),
 * ~72 stazioni reali. Scopo: validare la fonte per sostituire Open-Meteo (che
 * oggi copre la VdA con ~45 punti stimati). Scrive in data/valledaosta-cf/,
 * SEPARATA da data/valledaosta/ (Open-Meteo), per il confronto affiancato.
 *
 * COME FUNZIONA L'ACCESSO (reverse-engineering del 23/07/2026):
 *  - GET /str_dataview  → cookie "it.ecometer.bobo=<base64>--<hmac>". Il base64
 *    prima di "--" è un JSON {csrf_token, expires}. Le POST richiedono l'header
 *    X-CSRF-Token con quel token + il cookie. (NON X-CSRFToken, NON campo body.)
 *  - POST /str_dataview_get_map_stations {params:'[93]'}  → elenco stazioni con
 *    prid 93 = "Precipitazione ufficiale" (id, nome, lat, lon, quota nel desc).
 *    Usato come ANAGRAFICA. (get_map_last_data darebbe anche il valore ma esige
 *    che la sessione sia "preparata" da chiamate precedenti — get_map_stations no.)
 *  - POST /str_dataview_get_allparams_data {id, aggr:'dd', from, to}  → per la
 *    stazione, i valori GIORNALIERI (una coppia [timestamp_ms, mm] per giorno)
 *    di tutti i parametri; si estrae il parametro 93. Accetta un INTERVALLO di
 *    date, quindi una sola chiamata per stazione copre l'intera settimana.
 *
 * I body POST vanno inviati form-urlencoded (application/x-www-form-urlencoded),
 * NON JSON: il server è quello che jQuery interroga di default. Con JSON risponde
 * {"res":"ERR"}.
 *
 * ATTENZIONE: piattaforma autenticata su misura (csrf a ogni sessione), più
 * fragile delle fonti Socrata/XML. Se cambia lo schema csrf o l'endpoint, si
 * rompe. Da validare in test: allineamento del giorno (i bucket 'dd' coincidono
 * col giorno di calendario italiano?) confrontando con Open-Meteo, e stabilità
 * del valore dopo la chiusura del giorno.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HOST     = 'presidi2.regione.vda.it';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'valledaosta-cf');
const PRID_PIOGGIA = 93;
const GIORNI_FINESTRA = 7;   // ieri + auto-riparazione della settimana
// Temperatura e vento (11/8/2026 — grafici stazione): stessa piattaforma,
// aggr:'hh' → valori ORARI di tutti i parametri in una chiamata per stazione
// (la seconda del run). prid 1 = Temperatura (°C), prid 10 = Velocità Vento
// Vett. — in m/s → ×3,6 (validato l'11/8 contro Open-Meteo: Aosta Mont-Fleury
// rapporto 3,81 ≈ 3,6; Donnas più alto del modello ma è la porta del föhn).
// Nessuna raffica → w:[media, null]. Ore coperte ≥ MIN_ORE_METEO, sanity
// t in [-45,50] °C, vento <60 m/s. Tutta la parte meteo sta in try.
const PRID_TEMP  = 1;
const PRID_VENTO = 10;
const MIN_ORE_METEO = 20;

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

/** Richiesta HTTPS grezza. bodyForm = oggetto → inviato form-urlencoded. */
function req(pathName, method, headers, bodyForm) {
  return new Promise((resolve, reject) => {
    const data = bodyForm != null ? new URLSearchParams(bodyForm).toString() : null;
    const r = https.request({
      host: HOST, path: pathName, method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)',
        'Accept': 'application/json, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://${HOST}/str_dataview`,
        ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(headers || {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ code: res.statusCode, body: d, setCookie: res.headers['set-cookie'] }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Apre una sessione: ritorna { cookie, csrf }. */
async function apriSessione() {
  const page = await req('/str_dataview', 'GET', {}, null);
  const cookie = (page.setCookie || []).map(c => c.split(';')[0]).join('; ');
  const raw = cookie.split('it.ecometer.bobo=')[1];
  if (!raw) throw new Error('cookie di sessione non ricevuto');
  const csrf = JSON.parse(Buffer.from(raw.split('--')[0], 'base64').toString()).csrf_token;
  if (!csrf) throw new Error('csrf_token non estraibile dal cookie');
  return { cookie, csrf };
}

function post(pathName, sess, bodyForm) {
  return req(pathName, 'POST', { 'Cookie': sess.cookie, 'X-CSRF-Token': sess.csrf }, bodyForm)
    .then(r => {
      if (r.code !== 200) throw new Error(`HTTP ${r.code}`);
      const j = JSON.parse(r.body);
      if (j.res && j.res !== 'OK') throw new Error(`risposta ${j.res}`);
      return j;
    });
}

/** Estrae la quota dall'HTML del marker_desc. */
function quotaDaDesc(desc) {
  const m = /Quota\s*:\s*<\/strong>\s*(\d+)/i.exec(desc || '');
  return m ? parseInt(m[1], 10) : 0;
}

async function main() {
  console.log('=== collect-valledaosta-cf avviato (pilota) ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const sess = await apriSessione();
  console.log('  Sessione aperta (csrf ok)');

  // 1) Anagrafica stazioni con il parametro pioggia
  const mapData = await post('/str_dataview_get_map_stations', sess, { params: JSON.stringify([PRID_PIOGGIA]) });
  const anagrafica = (mapData.stations || []).map(s => ({
    id:  s.marker_id,
    n:   s.marker_name,
    lat: Math.round(s.marker_lat * 10000) / 10000,
    lon: Math.round(s.marker_lon * 10000) / 10000,
    q:   quotaDaDesc(s.marker_desc),
    p:   'AO'
  })).filter(s => s.id && typeof s.lat === 'number' && typeof s.lon === 'number');
  console.log(`  Stazioni in anagrafica: ${anagrafica.length}`);
  if (anagrafica.length < 20) throw new Error(`Troppo poche stazioni: ${anagrafica.length}`);

  // 2) Giorni bersaglio: ieri..(ieri-6), o DATE_OVERRIDE
  const now = new Date();
  const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const noon = new Date(fmtDate(italyNow) + 'T12:00:00Z').getTime();
  let targetDays;
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    targetDays = [process.env.DATE_OVERRIDE.trim()];
  } else {
    targetDays = [];
    for (let i = 1; i <= GIORNI_FINESTRA; i++) targetDays.push(fmtDate(new Date(noon - i * 24 * 3600000)));
  }
  const targetSet = new Set(targetDays);
  const from = targetDays[targetDays.length - 1] + ' 00:00:00';
  const to   = targetDays[0] + ' 23:59:59';
  console.log(`  Finestra: ${from} → ${to} (${targetDays.length} giorni)`);

  // 3) Una chiamata per stazione: valori giornalieri del parametro pioggia
  //    dayMap[dateStr] = [ {stazione+mm}, ... ]
  const dayMap = {};
  const meteoByDay = {};   // dStr → { id_record → {t?, w?} }
  targetDays.forEach(d => { dayMap[d] = []; meteoByDay[d] = {}; });
  let okStazioni = 0;

  const BATCH = 6;
  for (let i = 0; i < anagrafica.length; i += BATCH) {
    const chunk = anagrafica.slice(i, i + BATCH);
    await Promise.all(chunk.map(async st => {
      try {
        const r = await post('/str_dataview_get_allparams_data', sess, { id: st.id, aggr: 'dd', from, to });
        const p = (r.data || []).find(x => x.parameter_id === PRID_PIOGGIA);
        if (!p || !Array.isArray(p.station_param_values)) return;
        okStazioni++;
        for (const [ts, val] of p.station_param_values) {
          if (typeof val !== 'number') continue;               // "n.d." o null → salta
          // Il bucket giornaliero: la sua data in ora italiana
          const dStr = fmtDate(new Date(ts + getItalyOffset(new Date(ts)) * 3600000));
          if (!targetSet.has(dStr)) continue;
          let mm = Math.round(val * 10) / 10;
          if (mm < 0 || mm > 500) continue;                    // sanity
          dayMap[dStr].push({ id: `cf_vda_${st.id}`, n: st.n, lat: st.lat, lon: st.lon, q: st.q, p: st.p, mm });
        }
      } catch (e) {
        // stazione singola fallita: non blocca le altre
      }
      // t/w dagli orari: seconda chiamata, fallimento innocuo per la pioggia
      try {
        const rh = await post('/str_dataview_get_allparams_data', sess, { id: st.id, aggr: 'hh', from, to });
        const perDay = {}; // dStr → {temps:[], venti:[]}
        for (const prid of [PRID_TEMP, PRID_VENTO]) {
          const p = (rh.data || []).find(x => x.parameter_id === prid);
          if (!p || !Array.isArray(p.station_param_values)) continue;
          for (const [ts, val] of p.station_param_values) {
            if (typeof val !== 'number') continue;
            const dStr = fmtDate(new Date(ts + getItalyOffset(new Date(ts)) * 3600000));
            if (!targetSet.has(dStr)) continue;
            const acc = perDay[dStr] = perDay[dStr] || { temps: [], venti: [] };
            if (prid === PRID_TEMP && val >= -45 && val <= 50) acc.temps.push(val);
            if (prid === PRID_VENTO && val >= 0 && val < 60) acc.venti.push(val);
          }
        }
        Object.keys(perDay).forEach(dStr => {
          const a = perDay[dStr], m = {};
          if (a.temps.length >= MIN_ORE_METEO)
            m.t = [Math.round(Math.min(...a.temps) * 10) / 10, Math.round(Math.max(...a.temps) * 10) / 10];
          if (a.venti.length >= MIN_ORE_METEO)
            m.w = [Math.round(a.venti.reduce((x, v) => x + v, 0) / a.venti.length * 3.6 * 10) / 10, null];
          if (m.t || m.w) meteoByDay[dStr][`cf_vda_${st.id}`] = m;
        });
      } catch (e) { /* meteo di una stazione fallito: pioggia intatta */ }
    }));
    await sleep(400);
  }
  console.log(`  Stazioni con dati: ${okStazioni}/${anagrafica.length}`);
  // aggancia t/w ai record del giorno
  targetDays.forEach(dStr => {
    dayMap[dStr].forEach(rec => {
      const m = meteoByDay[dStr][rec.id];
      if (m) Object.assign(rec, m);
    });
  });

  // 4) Scrittura per giorno (l'ultima lettura vince: sovrascrive il file)
  let scritti = 0;
  for (const dStr of targetDays) {
    const stations = dayMap[dStr];
    if (stations.length < 10) { console.warn(`  ${dStr}: solo ${stations.length} stazioni, salto`); continue; }
    const outFile = path.join(DATA_DIR, `${dStr}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      date: dStr, collected: new Date().toISOString(),
      source: 'cf-valledaosta', count: stations.length, stations
    }));
    scritti++;
  }
  console.log(`  ✅ Scritti ${scritti} file giornalieri`);

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .forEach(f => { if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; } });
  if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file oltre i ${MAX_DAYS} giorni eliminati`);

  console.log('=== collect-valledaosta-cf completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
