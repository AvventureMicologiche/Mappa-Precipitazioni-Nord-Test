/**
 * backfill-meteo-lombardia.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/lombardia esistenti con le stesse query Socrata
 * del collector: UNA query per giorno raggruppata per (sensore, ora) →
 * completezza in ORE COPERTE (≥20) a prescindere dalla granularità.
 * t: [min,max] °C · w: [media, raffica] km/h (vento m/s ×3,6; la raffica
 * ESISTE su Socrata, e' `idoperatore=3` — corretto il 29/8/2026). Join pluviometro ↔ termometro/anemometro via idstazione.
 * Idempotente: tocca solo t/w, pioggia intatta.
 *
 * Uso: node backfill-meteo-lombardia.js          → ultimi 45 giorni
 *      GIORNI=10 node backfill-meteo-lombardia.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'lombardia');
const HOST     = 'www.dati.lombardia.it';
const MIN_ORE  = 20;
const GIORNI   = parseInt(process.env.GIORNI || '45', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(pathQ, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      https.get({ host: HOST, path: pathQ, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)' } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); return reject(new Error(`HTTP ${res.statusCode}`)); }
          try { resolve(JSON.parse(data)); } catch(e) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(new Error('JSON: '+e.message)); }
        });
      }).on('error', e => { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(e); });
    };
    attempt(1);
  });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function anagrafePerTipologia(tipologia) {
  const where = encodeURIComponent(`tipologia='${tipologia}'`);
  const sel = encodeURIComponent('idsensore,idstazione');
  const rows = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${sel}&$where=${where}`);
  const map = {};
  rows.forEach(r => { if (r.idsensore && r.idstazione && !map[r.idstazione]) map[r.idstazione] = r.idsensore; });
  return map;
}

async function meteoDay(dateStr, tempByStaz, windByStaz) {
  // ⚠️ `idoperatore`: 1 = media, 3 = massimo (la raffica). Vedi la nota lunga
  //    in collect-lombardia.js — senza separarli il vento usciva gonfiato del
  //    70-90% e la raffica finiva nel calderone. Questa funzione e' una COPIA
  //    di quella del collector: le due devono restare uguali.
  const sel = encodeURIComponent('idsensore,idoperatore,date_extract_hh(data) as h,min(valore) as mn,max(valore) as mx,avg(valore) as med,count(valore) as c');
  const where = encodeURIComponent(`data between '${dateStr}T00:00:00' and '${dateStr}T23:59:59' AND valore > -50`);
  const rows = await getJSON(`/resource/647i-nhxk.json?$select=${sel}&$where=${where}&$group=${encodeURIComponent('idsensore,idoperatore,h')}&$limit=80000`);
  const perSens = {};
  rows.forEach(r => {
    const s = (perSens[r.idsensore] = perSens[r.idsensore] || {});
    (s[r.idoperatore] = s[r.idoperatore] || []).push(r);
  });
  const tempSens = {}, windSens = {};
  Object.keys(tempByStaz).forEach(st => tempSens[tempByStaz[st]] = st);
  Object.keys(windByStaz).forEach(st => windSens[windByStaz[st]] = st);
  const out = {};
  Object.keys(perSens).forEach(id => {
    const ore    = perSens[id]['1'] || [];   // la MEDIA
    const oreMax = perSens[id]['3'] || [];   // il MASSIMO: la raffica
    if (ore.length < MIN_ORE) return;
    if (tempSens[id]) {
      const mins = ore.map(o => parseFloat(o.mn)).filter(v => v >= -45 && v <= 50);
      const maxs = ore.map(o => parseFloat(o.mx)).filter(v => v >= -45 && v <= 50);
      if (mins.length >= MIN_ORE && maxs.length) {
        const st = tempSens[id];
        (out[st] = out[st] || {}).t = [Math.round(Math.min(...mins) * 10) / 10,
                                       Math.round(Math.max(...maxs) * 10) / 10];
      }
    }
    if (windSens[id]) {
      const medie = ore.map(o => parseFloat(o.med)).filter(v => v >= 0 && v < 60);
      if (medie.length >= MIN_ORE) {
        const st = windSens[id];
        const raff = oreMax.map(o => parseFloat(o.mx)).filter(v => v >= 0 && v < 60);
        (out[st] = out[st] || {}).w = [
          Math.round(medie.reduce((a, v) => a + v, 0) / medie.length * 3.6 * 10) / 10,
          raff.length >= MIN_ORE ? Math.round(Math.max(...raff) * 3.6 * 10) / 10 : null];
      }
    }
  });
  return out;
}

async function main() {
  console.log('=== backfill-meteo-lombardia (t/w sui file esistenti) ===');
  const ieri = addDays(new Date().toISOString().slice(0, 10), -1);
  const start = addDays(ieri, -(GIORNI - 1));
  const giorni = [];
  for (let d = start; d <= ieri; d = addDays(d, 1)) {
    if (fs.existsSync(path.join(DATA_DIR, `${d}.json`))) giorni.push(d);
  }
  console.log(`  Giorni: ${giorni.length} (${giorni[0]} → ${giorni[giorni.length - 1]})`);

  // pluviometro → idstazione (per agganciare t/w alle stazioni dei file)
  const whereP = encodeURIComponent("tipologia='Precipitazione'");
  const selP = encodeURIComponent('idsensore,idstazione');
  const pluvio = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${selP}&$where=${whereP}`);
  const stByPluvio = {};
  pluvio.forEach(r => { if (r.idsensore && r.idstazione) stByPluvio[r.idsensore] = r.idstazione; });
  const tempByStaz = await anagrafePerTipologia('Temperatura');
  const windByStaz = await anagrafePerTipologia('Velocità Vento');
  console.log(`  Sensori: ${Object.keys(tempByStaz).length} temperatura, ${Object.keys(windByStaz).length} vento`);

  let fileOk = 0, stazGiorno = 0;
  for (const g of giorni) {
    const meteo = await meteoDay(g, tempByStaz, windByStaz);
    const fp = path.join(DATA_DIR, `${g}.json`);
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(s => {
      const st = stByPluvio[s.id];
      const m = st && meteo[st];
      if (!m) return;
      if (m.t) s.t = m.t;
      if (m.w) s.w = m.w;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(fp, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
    process.stdout.write(`  ${g}: ${toccate} stazioni\r`);
    await sleep(400);
  }
  console.log('');
  console.log(`Fatto: ${fileOk}/${giorni.length} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
