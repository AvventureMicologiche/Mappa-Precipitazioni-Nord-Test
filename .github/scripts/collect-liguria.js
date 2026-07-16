/**
 * collect-liguria.js
 * Fonte: omirl.regione.liguria.it — endpoint /charts/{code}/Pluvio
 * Restituisce serie temporale oraria per ~69 ore.
 * Series 0 = incremento orario, Series 1 = cumulativo.
 * Strategia: sum(Series 0) per le ore di ieri = totale giornaliero esatto.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data', 'liguria');
const MAX_DAYS  = 365;
const OMIRL_BASE = 'https://omirl.regione.liguria.it/Omirl/rest';

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function getItalyDate(offsetDays) {
  const now = new Date();
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000 + (offsetDays || 0) * 86400000);
  return italy.toISOString().substring(0, 10);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchWithRetry(url, retries) {
  retries = retries || 2;
  for (var i = 0; i <= retries; i++) {
    try { return await fetchJSON(url); }
    catch(e) {
      if (i === retries) throw e;
      await new Promise(function(r) { setTimeout(r, 1000); });
    }
  }
}

async function main() {
  var yesterdayDate = process.env.DATE_OVERRIDE || getItalyDate(-1);
  console.log('\n=== Raccolta dati Liguria per ' + yesterdayDate + ' (da charts OMIRL) ===\n');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 1: lista stazioni
  console.log('Scarico lista stazioni...');
  var rawStations = await fetchJSON(OMIRL_BASE + '/stations/Pluvio');
  var stations = rawStations.filter(function(s) {
    return s.lat && s.lon && s.name && s.shortCode &&
      s.lat >= 43.7 && s.lat <= 44.8 && s.lon >= 7.4 && s.lon <= 10.3;
  });
  console.log('  Stazioni in Liguria: ' + stations.length);

  // Step 2: calcola boundaries giorno target in UTC
  var offset = getItalyOffset(new Date());
  var dayStart = new Date(yesterdayDate + 'T00:00:00Z');
  dayStart.setUTCHours(dayStart.getUTCHours() - offset);
  var dayEnd = new Date(dayStart.getTime() + 24 * 3600000);
  var dayStartMs = dayStart.getTime();
  var dayEndMs = dayEnd.getTime();
  console.log('  Finestra UTC: ' + dayStart.toISOString() + ' -> ' + dayEnd.toISOString());

  // Step 3: fetch charts per ogni stazione (batch di 10)
  console.log('  Scarico dati orari per ogni stazione...');
  var ok = 0, fail = 0, withRain = 0;
  var output = [];

  for (var i = 0; i < stations.length; i += 10) {
    var batch = stations.slice(i, i + 10);
    var promises = batch.map(function(s) {
      var url = OMIRL_BASE + '/charts/' + s.shortCode + '/Pluvio';
      return fetchWithRetry(url).then(function(chart) {
        var hourly = (chart.dataSeries && chart.dataSeries[0] && chart.dataSeries[0].data) || [];
        var mm = 0;
        hourly.forEach(function(p) {
          if (p[0] >= dayStartMs && p[0] < dayEndMs && p[1] > 0) {
            mm += p[1];
          }
        });
        return { station: s, mm: Math.round(mm * 10) / 10 };
      }).catch(function() {
        return null;
      });
    });
    var results = await Promise.all(promises);
    results.forEach(function(r) {
      if (r) {
        output.push({
          id:  r.station.shortCode,
          n:   r.station.name,
          lat: Math.round(r.station.lat * 10000) / 10000,
          lon: Math.round(r.station.lon * 10000) / 10000,
          q:   r.station.alt || 0,
          p:   r.station.municipality || '',
          mm:  r.mm
        });
        ok++;
        if (r.mm > 0) withRain++;
      } else {
        fail++;
      }
    });
    // Pausa tra batch
    if (i + 10 < stations.length) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }

  console.log('  OK: ' + ok + ', fallite: ' + fail + ', con pioggia: ' + withRain);

  if (output.length < 10) {
    console.error('Troppo poche stazioni, uscita senza salvare.');
    process.exit(1);
  }

  // Step 4: salva
  var outFile = path.join(DATA_DIR, yesterdayDate + '.json');
  fs.writeFileSync(outFile, JSON.stringify({
    date:      yesterdayDate,
    collected: new Date().toISOString(),
    source:    'arpa-liguria-omirl-charts',
    count:     output.length,
    stations:  output
  }), 'utf8');
  console.log('\nSalvato: ' + outFile + ' (' + output.length + ' stazioni, ' + withRain + ' con pioggia)');

  // Step 5: pulizia
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  var cutoffStr = cutoff.toISOString().substring(0, 10);
  var allFiles = fs.readdirSync(DATA_DIR)
    .filter(function(f) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(f); }).sort();
  var deleted = 0;
  allFiles.forEach(function(f) {
    if (f.replace('.json', '') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log('Pulizia: ' + deleted + ' eliminati, ' + (allFiles.length - deleted) + ' rimanenti');
  console.log('\n=== Completato! ===\n');
}

main().catch(function(e) { console.error('Errore fatale:', e); process.exit(1); });
