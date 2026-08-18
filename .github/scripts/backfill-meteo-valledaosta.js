/**
 * backfill-meteo-valledaosta.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/valledaosta-cf esistenti dagli orari del Centro
 * Funzionale (str_dataview_get_allparams_data, aggr:'hh' — una chiamata per
 * stazione copre l'intera finestra). prid 1 = Temperatura (°C), prid 10 =
 * Velocità Vento Vett. (m/s → ×3,6, validato contro Open-Meteo l'11/8).
 * Stessa ricetta del collector: ore ≥20, sanity t [-45,50], vento <60 m/s.
 * Idempotente: tocca solo t/w, pioggia intatta.
 *
 * Uso: node backfill-meteo-valledaosta.js          → ultimi 45 giorni
 *      GIORNI=10 node backfill-meteo-valledaosta.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HOST     = 'presidi2.regione.vda.it';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'valledaosta-cf');
const GIORNI   = parseInt(process.env.GIORNI || '45', 10);
const MIN_ORE  = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

async function main() {
  console.log('=== backfill-meteo-valledaosta (t/w sui file esistenti) ===');
  const oggi = fmtDate(new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000));
  const ieri = addDays(oggi, -1);
  const giorni = [];
  for (let d = addDays(ieri, -(GIORNI - 1)); d <= ieri; d = addDays(d, 1)) {
    if (fs.existsSync(path.join(DATA_DIR, `${d}.json`))) giorni.push(d);
  }
  console.log(`  Giorni: ${giorni.length} (${giorni[0]} → ${giorni[giorni.length - 1]})`);
  const targetSet = new Set(giorni);
  const from = giorni[0] + ' 00:00:00', to = giorni[giorni.length - 1] + ' 23:59:59';

  const page = await req('/str_dataview', 'GET', {}, null);
  const cookie = (page.setCookie || []).map(c => c.split(';')[0]).join('; ');
  const csrf = JSON.parse(Buffer.from(cookie.split('it.ecometer.bobo=')[1].split('--')[0], 'base64').toString()).csrf_token;
  const post = (p, b) => req(p, 'POST', { 'Cookie': cookie, 'X-CSRF-Token': csrf }, b).then(r => {
    if (r.code !== 200) throw new Error(`HTTP ${r.code}`);
    const j = JSON.parse(r.body);
    if (j.res && j.res !== 'OK') throw new Error(`risposta ${j.res}`);
    return j;
  });
  console.log('  Sessione aperta');

  const map = await post('/str_dataview_get_map_stations', { params: JSON.stringify([93]) });
  const stazioni = (map.stations || []).filter(s => s.marker_id);
  console.log(`  Stazioni: ${stazioni.length}`);

  // meteo[dStr][id_record] = {t?, w?}
  const meteo = {};
  giorni.forEach(g => meteo[g] = {});
  let done = 0, falliti = 0;
  for (const st of stazioni) {
    try {
      const rh = await post('/str_dataview_get_allparams_data', { id: st.marker_id, aggr: 'hh', from, to });
      const perDay = {};
      for (const prid of [1, 10, 2]) {   // 2 = umidita' relativa (18/8/2026)
        const p = (rh.data || []).find(x => x.parameter_id === prid);
        if (!p || !Array.isArray(p.station_param_values)) continue;
        for (const [ts, val] of p.station_param_values) {
          if (typeof val !== 'number') continue;
          const dStr = fmtDate(new Date(ts + getItalyOffset(new Date(ts)) * 3600000));
          if (!targetSet.has(dStr)) continue;
          const acc = perDay[dStr] = perDay[dStr] || { temps: [], venti: [], umid: [] };
          if (prid === 1 && val >= -45 && val <= 50) acc.temps.push(val);
          if (prid === 10 && val >= 0 && val < 60) acc.venti.push(val);
          if (prid === 2 && val >= 0 && val <= 100) acc.umid.push(val);
        }
      }
      Object.keys(perDay).forEach(dStr => {
        const a = perDay[dStr], m = {};
        if (a.temps.length >= MIN_ORE)
          m.t = [Math.round(Math.min(...a.temps) * 10) / 10, Math.round(Math.max(...a.temps) * 10) / 10];
        if (a.venti.length >= MIN_ORE)
          m.w = [Math.round(a.venti.reduce((x, v) => x + v, 0) / a.venti.length * 3.6 * 10) / 10, null];
        if (a.umid.length >= MIN_ORE) m.u = [Math.round(Math.min(...a.umid)), Math.round(Math.max(...a.umid))];
        if (m.t || m.w || m.u) meteo[dStr][`cf_vda_${st.marker_id}`] = m;
      });
    } catch (e) { falliti++; }
    done++;
    process.stdout.write(`  ${done}/${stazioni.length} stazioni\r`);
    await sleep(250);
  }
  console.log('');
  if (falliti > 0) console.warn(`  Warn: ${falliti} stazioni fallite`);

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
      if (m.u) s.u = m.u;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
  });
  console.log(`Fatto: ${fileOk}/${giorni.length} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
