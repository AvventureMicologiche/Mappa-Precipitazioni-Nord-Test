/**
 * backfill-meteo-emilia.js — una tantum, da lanciare in LOCALE
 * Aggiunge t/w ai file data/emilia esistenti leggendo gli aggregati
 * giornalieri già presenti nella risposta ARPAE (stessa chiamata del
 * collector). L'API conserva ~15 giorni: il backfill copre solo quelli.
 * Idempotente: tocca SOLO i campi t/w, la pioggia resta intatta.
 * La chiave ARPAE ha offset +1: la chiave 20260810 contiene i dati del 9/8.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'emilia');
const API_URL  = 'https://apps.arpae.it/REST/meteo_giornalieri?max_results=1000';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// Identica al collector
function estraiMeteo(day) {
  const num = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };
  const tn = num(day.temperatura_minima_giornaliera_2m);
  const tx = num(day.temperatura_massima_giornaliera_2m);
  const ff = num(day.velocita_vento_media_giornaliera_10m);
  const fx = num(day.massima_raffica_vento_giornaliera_10m);
  const out = {};
  if (tn != null && tx != null && tn >= -45 && tx <= 50 && tn <= tx)
    out.t = [Math.round(tn * 10) / 10, Math.round(tx * 10) / 10];
  if (ff != null && ff >= 0 && ff < 60)
    out.w = [Math.round(ff * 3.6 * 10) / 10,
             (fx != null && fx >= 0 && fx < 90) ? Math.round(fx * 3.6 * 10) / 10 : null];
  return out;
}

/** Chiave ARPAE YYYYMMDD → data meteo reale YYYY-MM-DD (chiave − 1 giorno). */
function keyToDate(key) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)) - 86400000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('=== backfill-meteo-emilia (t/w sui file esistenti) ===');
  const raw = await fetchJSON(API_URL);
  const items = raw._items || [];
  console.log(`  Stazioni ricevute: ${items.length}`);

  // meteo[date][id] = {t?, w?}
  const meteo = {};
  items.forEach(s => {
    const dati = s.dati || {};
    Object.keys(dati).forEach(key => {
      if (!/^\d{8}$/.test(key) || !dati[key]['0000']) return;
      const date = keyToDate(key);
      const m = estraiMeteo(dati[key]['0000']);
      if (!m.t && !m.w) return;
      (meteo[date] = meteo[date] || {})[s._id] = m;
    });
  });

  const oggi = new Date().toISOString().slice(0, 10);
  const giorni = Object.keys(meteo).filter(d => d < oggi).sort();
  console.log(`  Giorni coperti dall'API: ${giorni[0]} → ${giorni[giorni.length - 1]}`);

  let fileOk = 0, stazGiorno = 0;
  giorni.forEach(date => {
    const f = path.join(DATA_DIR, `${date}.json`);
    if (!fs.existsSync(f)) { console.log(`  ${date}: file assente, salto`); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(st => {
      const m = meteo[date][st.id];
      if (!m) return;
      if (m.t) st.t = m.t;
      if (m.w) st.w = m.w;
      toccate++;
    });
    if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
  });
  console.log(`Fatto: ${fileOk} file aggiornati, ${stazGiorno} stazioni-giorno con t/w`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
