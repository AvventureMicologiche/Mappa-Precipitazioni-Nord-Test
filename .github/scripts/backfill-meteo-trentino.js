/**
 * backfill-meteo-trentino.js — una tantum, da lanciare in LOCALE
 * Aggiunge t ai file data/trentino esistenti: getValoriAggregatiGiornoJson
 * restituisce ~6 giorni con Minima/Massima ufficiali per stazione-giorno.
 * (Niente vento: l'API ha solo la raffica, senza media il grafico non
 * disegna.) Idempotente: tocca solo t, pioggia intatta.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'trentino');
const DATI_URL = 'https://dati.meteotrentino.it/service.asmx/getValoriAggregatiGiornoJson';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== backfill-meteo-trentino (t sui file esistenti) ===');
  const raw = await fetchJSON(DATI_URL);
  const records = raw.valoriAggregati || [];
  console.log(`  Record: ${records.length}`);

  const perGiorno = {};
  records.forEach(r => {
    const g = (r.giorno || '').slice(0, 10);
    const tn = parseFloat(r.Minima), tx = parseFloat(r.Massima);
    if (!g || isNaN(tn) || isNaN(tx) || tn < -45 || tx > 50 || tn > tx) return;
    (perGiorno[g] = perGiorno[g] || {})[r.idstaz] = [Math.round(tn * 10) / 10, Math.round(tx * 10) / 10];
  });

  const oggi = new Date().toISOString().slice(0, 10);
  let fileOk = 0, stazGiorno = 0;
  Object.keys(perGiorno).sort().forEach(g => {
    if (g >= oggi) return;
    const f = path.join(DATA_DIR, `${g}.json`);
    if (!fs.existsSync(f)) { console.log(`  ${g}: file assente, salto`); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    let toccate = 0;
    (data.stations || []).forEach(s => {
      const t = perGiorno[g][s.id];
      if (t) { s.t = t; toccate++; }
    });
    if (toccate > 0) { fs.writeFileSync(f, JSON.stringify(data)); fileOk++; stazGiorno += toccate; }
    console.log(`  ${g}: ${toccate} stazioni`);
  });
  console.log(`Fatto: ${fileOk} file aggiornati, ${stazGiorno} stazioni-giorno con t`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
