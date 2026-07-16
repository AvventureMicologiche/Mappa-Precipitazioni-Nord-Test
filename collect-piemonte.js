/**
 * collect-piemonte.js - Script definitivo
 * API ARPA Piemonte: /pie_anag (stazioni) + /data_pie (misure)
 * Usa sum(cum_rain_1h) per totale giornaliero + merge MAX protezione
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'piemonte');
const MAX_DAYS = 365;
const API_BASE = 'https://utility.arpa.piemonte.it/api_realtime';

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
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    return process.env.DATE_OVERRIDE.trim();
  }
  const now = new Date();
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  return italy.toISOString().substring(0, 10);
}

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  tentativo ${i+1}/${retries} fallito: ${e.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('fetch fallito dopo ' + retries + ' tentativi');
}

async function main() {
  const targetDate = getTargetDate();
  console.log('\n=== Raccolta dati Piemonte per ' + targetDate + ' ===\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const outFile = path.join(DATA_DIR, targetDate + '.json');

  // ── Step 1: anagrafica stazioni ──────────────────────────────
  console.log('Carico anagrafica stazioni...');
  const anagRaw = await fetchJSON(API_BASE + '/pie_anag?page_size=10000');
  const stazioni = Array.isArray(anagRaw) ? anagRaw : (anagRaw.data || anagRaw.results || []);
  console.log('  Stazioni: ' + stazioni.length);

  // Indice stazione per station_code
  const stIndex = {};
  stazioni.forEach(function(s) {
    if (s.station_code) stIndex[s.station_code] = s;
  });

  // ── Step 2: misure del giorno ────────────────────────────────
  // Usiamo sum(cum_rain_1h) per il totale giornaliero
  const dateFrom = targetDate + 'T00:00';
  const dateTo   = targetDate + 'T23:59';
  console.log('Carico misure ' + dateFrom + ' → ' + dateTo + '...');

  let allMisure = [];
  let page = 1;
  while (true) {
    const url = API_BASE + '/data_pie?date_from=' + encodeURIComponent(dateFrom)
      + '&date_to=' + encodeURIComponent(dateTo)
      + '&page=' + page + '&page_size=10000';
    const raw = await fetchJSON(url);
    const records = Array.isArray(raw) ? raw : (raw.data || raw.results || []);
    allMisure = allMisure.concat(records);
    if (records.length < 10000) break;
    page++;
  }
  console.log('  Misure totali: ' + allMisure.length);

  // ── Step 3: somma cum_rain_1h per stazione ─────────────────
  // sum(cum_rain_1h) è il totale giornaliero esatto quando ci sono tutti i 24 record
  const rainMap = {};
  allMisure.forEach(function(m) {
    const id = m.station_code;
    if (!id) return;
    const v = parseFloat(m.cum_rain_1h);
    if (isNaN(v) || v < 0) return;
    rainMap[id] = (rainMap[id] || 0) + v;
  });
  // Arrotonda a 1 decimale
  Object.keys(rainMap).forEach(id => { rainMap[id] = Math.round(rainMap[id] * 10) / 10; });

  // ── Step 4: costruisci output ─────────────────────────────────
  const output = [];
  Object.keys(rainMap).forEach(function(id) {
    const s = stIndex[id];
    if (!s) return;
    const lat = parseFloat(s.lat);
    const lon = parseFloat(s.lng || s.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    // Bbox Piemonte
    if (lat < 43.8 || lat > 46.5 || lon < 6.6 || lon > 9.3) return;

    let mm = rainMap[id];
    if (mm > 300) mm = 0; // cap anomalie

    output.push({
      id:  id,
      n:   s.name || id,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q:   parseInt(s.altitude || 0) || 0,
      p:   s.province || '—',
      mm:  Math.round(mm * 10) / 10
    });
  });

  console.log('  Stazioni con dati: ' + output.length);

  if (output.length < 5) {
    console.warn('Poche stazioni oggi (' + output.length + '), salto salvataggio oggi ma aggiorno ieri.');
  } else {

  // ── Step 5: salva ─────────────────────────────────────────────
  const fileData = {
    date:      targetDate,
    collected: new Date().toISOString(),
    count:     output.length,
    stations:  output
  };
  fs.writeFileSync(outFile, JSON.stringify(fileData), 'utf8');
  console.log('\nSalvato: ' + outFile + ' (' + output.length + ' stazioni)');
  } // fine if output.length >= 5
  // ── Step 5b: aggiorna sempre anche ieri ──────────────────────
  // Ad ogni run aggiorna ieri con sum(cum_rain_1h) + merge MAX protezione
  if (!process.env.DATE_OVERRIDE) {
    const _yd = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000 - 24 * 3600000);
    const _p = n => String(n).padStart(2, '0');
    const _yDate = _yd.getUTCFullYear() + '-' + _p(_yd.getUTCMonth()+1) + '-' + _p(_yd.getUTCDate());
    console.log('Aggiorno anche ieri: ' + _yDate);
    try {
      let _mY = []; let _pg = 1;
      while (true) {
        const _u = API_BASE + '/data_pie?date_from=' + encodeURIComponent(_yDate+'T00:00') + '&date_to=' + encodeURIComponent(_yDate+'T23:59') + '&page=' + _pg + '&page_size=10000';
        const _r = await fetchJSON(_u);
        const _rec = Array.isArray(_r) ? _r : (_r.data || _r.results || []);
        _mY = _mY.concat(_rec);
        if (_rec.length < 10000) break;
        _pg++;
      }
      console.log('  Record ieri: ' + _mY.length);

      // Safeguard: se < 1000 record, dati parziali → non aggiornare
      if (_mY.length < 1000) {
        console.log('  Troppo pochi record (' + _mY.length + '), salto aggiornamento ieri.');
      } else {
        // sum(cum_rain_1h) per stazione
        const _rm = {};
        _mY.forEach(m => { const id=m.station_code; if(!id) return; const v=parseFloat(m.cum_rain_1h); if(isNaN(v)||v<0) return; _rm[id]=(_rm[id]||0)+v; });

        const _out = [];
        Object.keys(_rm).forEach(id => {
          const s=stIndex[id]; if(!s) return;
          const lat=parseFloat(s.lat); const lon=parseFloat(s.lng||s.lon);
          if(isNaN(lat)||isNaN(lon)) return;
          if(lat<43.8||lat>46.5||lon<6.6||lon>9.3) return;
          let mm=Math.round(_rm[id]*10)/10; if(mm>300) mm=0;
          _out.push({id,n:s.name||id,lat:Math.round(lat*10000)/10000,lon:Math.round(lon*10000)/10000,q:parseInt(s.altitude||0)||0,p:s.province||'—',mm});
        });

        if (_out.length >= 5) {
          // Merge MAX: confronta con file esistente, tieni il valore più alto per stazione
          const yFile = path.join(DATA_DIR, _yDate+'.json');
          let merged = _out;
          if (fs.existsSync(yFile)) {
            try {
              const existing = JSON.parse(fs.readFileSync(yFile, 'utf8'));
              const existMap = {};
              (existing.stations || []).forEach(s => { existMap[s.id || s.n] = s.mm || 0; });
              merged = _out.map(s => {
                const prev = existMap[s.id || s.n] || 0;
                return { ...s, mm: Math.max(s.mm, prev) };
              });
              // Aggiungi stazioni che erano nel vecchio file ma non nel nuovo
              const newIds = new Set(_out.map(s => s.id || s.n));
              (existing.stations || []).forEach(s => {
                if (!newIds.has(s.id || s.n) && s.mm > 0) merged.push(s);
              });
            } catch(e) { /* file corrotto, sovrascrivi */ }
          }
          fs.writeFileSync(yFile, JSON.stringify({date:_yDate,collected:new Date().toISOString(),count:merged.length,stations:merged}),'utf8');
          console.log('Aggiornato ieri: ' + _yDate + ' (' + merged.length + ' stazioni, merge MAX)');
        }
      }
    } catch(e) { console.warn('Warn aggiornamento ieri: ' + e.message); }
  }


  // ── Step 6: pulizia file > 365 giorni ────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(function(f) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(f); })
    .sort();
  let deleted = 0;
  allFiles.forEach(function(f) {
    if (f.replace('.json', '') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log('Pulizia: ' + deleted + ' eliminati, ' + (allFiles.length - deleted) + ' rimanenti');
  console.log('\n=== Completato! ===\n');
}

main().catch(function(e) {
  console.error('Errore fatale:', e);
  process.exit(1);
});
