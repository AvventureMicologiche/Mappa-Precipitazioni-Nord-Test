/**
 * collect-emilia.js
 * Fonte: apps.arpae.it/REST/meteo_giornalieri
 * 347 stazioni con precipitazione_cumulata_giornaliera
 * Aggiornamento: ogni 4 ore via GitHub Actions
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'emilia');
const MAX_DAYS = 365;
const API_URL  = 'https://apps.arpae.it/REST/meteo_giornalieri?max_results=1000';

function getItalyOffset(date) {
  // Calcola offset italiano basato sul calendario (non getTimezoneOffset che è 0 su server UTC)
  // CEST (UTC+2): ultima domenica marzo → ultima domenica ottobre
  // CET  (UTC+1): resto dell'anno
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  const now = new Date();
  // GitHub Actions gira in UTC — calcola ora italiana con DST
  // Italia: UTC+1 (inverno CET), UTC+2 (estate CEST, ultima dom marzo → ultima dom ottobre)
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  return italy.toISOString().substring(0, 10);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Emilia Romagna per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Step 1: scarica dati ARPAE ─────────────────────────────
  console.log('Scarico dati da ARPAE...');
  let raw;
  try {
    raw = await fetchJSON(API_URL);
  } catch(e) {
    console.error('Errore fetch ARPAE:', e.message);
    process.exit(1);
  }

  const items = raw._items || [];
  console.log(`  Stazioni ricevute: ${items.length}`);

  // ── Step 2: converti data target in formato ARPAE (YYYYMMDD) ─
  // ARPAE API ha offset +1 giorno: la chiave 20260606 contiene i dati meteo del 5 giugno
  // Per ottenere i dati del giorno X, servono dalla chiave X+1
  function dateKeyPlusOne(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().substring(0, 10).replace(/-/g, '');
  }
  const dateKey = dateKeyPlusOne(targetDate);
  console.log(`  Chiave API per ${targetDate}: ${dateKey} (offset ARPAE +1g)`);

  // ── Step 3: estrai dati del giorno target ───────────────────
  const output = [];
  let ok = 0, skip = 0;

  items.forEach(s => {
    try {
      const ana = s.anagrafica;
      if (!ana || !ana.geometry || !ana.geometry.coordinates) { skip++; return; }

      const lon = ana.geometry.coordinates[0];
      const lat = ana.geometry.coordinates[1];

      // Bounding box Emilia Romagna
      if (lat < 43.7 || lat > 45.2 || lon < 9.1 || lon > 12.8) { skip++; return; }

      // Solo stazioni con precipitazione
      if (!ana.variabili || !ana.variabili.includes('precipitazione_cumulata_giornaliera')) { skip++; return; }

      // Cerca il dato del giorno target
      const dati = s.dati || {};
      const dayData = dati[dateKey];
      let mm = 0;

      if (dayData && dayData['0000'] && dayData['0000'].precipitazione_cumulata_giornaliera !== undefined) {
        const val = parseFloat(dayData['0000'].precipitazione_cumulata_giornaliera);
        if (!isNaN(val) && val >= 0 && val < 500) mm = Math.round(val * 10) / 10;
      }

      output.push({
        id:  s._id,
        n:   ana.nome || '—',
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        q:   ana.altitudine || 0,
        p:   ana.provincia || '—',
        mm
      });
      ok++;
    } catch(e) {
      skip++;
    }
  });

  console.log(`  Stazioni Emilia: ${ok} | Saltate: ${skip}`);

  // ── Step 4: merge con file esistente ────────────────────────
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);
  let existingMap = {};

  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.stations) {
        existing.stations.forEach(s => { existingMap[s.id] = s; });
        console.log(`  File esistente: ${existing.stations.length} stazioni`);
      }
    } catch(e) {
      console.log('  Nessun file esistente, creo nuovo.');
    }
  }

  // Sovrascrittura diretta — i nuovi dati sostituiscono sempre i vecchi
  // (evita di preservare valori anomali da run precedenti)
  const merged = Object.assign({}, existingMap);
  output.forEach(s => {
    merged[s.id] = s;
  });

  const finalOutput = Object.values(merged);
  console.log(`  Stazioni finali: ${finalOutput.length}`);

  if (finalOutput.length < 10) {
    console.warn('Poche stazioni oggi (' + finalOutput.length + '), salto salvataggio oggi ma aggiorno ieri.');
  } else {

  // ── Step 5: salva ────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date:      targetDate,
    collected: new Date().toISOString(),
    source:    'arpa-emilia-arpae',
    count:     finalOutput.length,
    stations:  finalOutput
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${finalOutput.length} stazioni)`);
  } // fine if finalOutput.length >= 10
  // ── Step 5b: aggiorna sempre anche ieri ──────────────────────
  if (!process.env.DATE_OVERRIDE) {
    const _yd = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000 - 24 * 3600000);
    const _p = n => String(n).padStart(2, '0');
    const _yDate = _yd.getUTCFullYear() + '-' + _p(_yd.getUTCMonth()+1) + '-' + _p(_yd.getUTCDate());
    const _yKey = dateKeyPlusOne(_yDate);
    console.log('Aggiorno anche ieri: ' + _yDate);
    try {
      const _out = [];
      items.forEach(s => {
        try {
          const ana=s.anagrafica; if(!ana||!ana.geometry||!ana.geometry.coordinates) return;
          const lon=ana.geometry.coordinates[0]; const lat=ana.geometry.coordinates[1];
          if(lat<43.7||lat>45.2||lon<9.1||lon>12.8) return;
          if(!ana.variabili||!ana.variabili.includes('precipitazione_cumulata_giornaliera')) return;
          const dd=(s.dati||{})[_yKey]; let mm=0;
          if(dd&&dd['0000']&&dd['0000'].precipitazione_cumulata_giornaliera!==undefined){
            const v=parseFloat(dd['0000'].precipitazione_cumulata_giornaliera);
            if(!isNaN(v)&&v>=0&&v<500) mm=Math.round(v*10)/10;
          }
          _out.push({id:s._id,n:ana.nome||'—',lat:Math.round(lat*10000)/10000,lon:Math.round(lon*10000)/10000,q:ana.altitudine||0,p:ana.provincia||'—',mm});
        } catch(e) {}
      });
      if (_out.length >= 10) {
        fs.writeFileSync(path.join(DATA_DIR,_yDate+'.json'), JSON.stringify({date:_yDate,collected:new Date().toISOString(),source:'arpa-emilia-arpae',count:_out.length,stations:_out}),'utf8');
        console.log('Aggiornato ieri: ' + _yDate + ' (' + _out.length + ' stazioni)');
      }
    } catch(e) { console.warn('Warn aggiornamento ieri: ' + e.message); }
  }


  // ── Step 6: pulizia ──────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json', '') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
