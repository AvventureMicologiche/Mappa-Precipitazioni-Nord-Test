/**
 * collect-liguria.js
 * Fonte: omirl.regione.liguria.it — endpoint /charts/{code}/Pluvio
 * Restituisce serie temporale oraria per ~69 ore.
 * Series 0 = incremento orario, Series 1 = cumulativo.
 * Strategia: sum(Series 0) per le ore di ieri = totale giornaliero esatto.
 *
 * TEMPERATURA E VENTO (dall'11/8/2026 — grafici stazione):
 * stessi shortCode, endpoint /charts/{code}/Termo (185 stazioni: serie
 * media/min/max ogni 30', ~15 giorni) e /charts/{code}/Vento (57 stazioni:
 * velocità + raffica, GIÀ in km/h — validato l'11/8 contro Open-Meteo su
 * stazioni basse, rapporto ~0,9; fosse m/s sarebbe ~3,6).
 * t: [min,max] °C · w: [media,raffica] km/h, solo con ore coperte ≥ MIN_ORE.
 * Tutta la parte meteo sta in un try: un suo guasto non tocca la pioggia.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data', 'liguria');
const MAX_DAYS  = 730;
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

// ── Temperatura e vento dai charts OMIRL ─────────────────────────────
var MIN_ORE_METEO = 20;

function oreCoperte(punti, startMs, endMs) {
  var ore = {};
  punti.forEach(function(p) { if (p[0] >= startMs && p[0] < endMs && p[1] != null) ore[Math.floor((p[0] - startMs) / 3600000)] = 1; });
  return Object.keys(ore).length;
}
function valoriIn(punti, startMs, endMs, lo, hi) {
  return punti.filter(function(p) { return p[0] >= startMs && p[0] < endMs && p[1] != null && p[1] >= lo && p[1] <= hi; })
              .map(function(p) { return p[1]; });
}

/** Aggiunge t/w ai record del giorno (byId: shortCode → record del file). */
async function aggiungiMeteoLiguria(byId, dayStartMs, dayEndMs) {
  var termo = await fetchWithRetry(OMIRL_BASE + '/stations/Termo');
  var vento = await fetchWithRetry(OMIRL_BASE + '/stations/Vento');
  var codsT = termo.map(function(s) { return s.shortCode; }).filter(function(c) { return byId[c]; });
  var codsV = vento.map(function(s) { return s.shortCode; }).filter(function(c) { return byId[c]; });
  var conT = 0, conW = 0;

  for (var i = 0; i < codsT.length; i += 10) {
    var batch = codsT.slice(i, i + 10);
    var res = await Promise.all(batch.map(function(code) {
      return fetchWithRetry(OMIRL_BASE + '/charts/' + code + '/Termo').then(function(ch) {
        var ds = ch.dataSeries || [];
        // serie 0 = media 30', 1 = minima, 2 = massima
        var med = (ds[0] && ds[0].data) || [], mn = (ds[1] && ds[1].data) || [], mx = (ds[2] && ds[2].data) || [];
        if (oreCoperte(med, dayStartMs, dayEndMs) < MIN_ORE_METEO) return null;
        var mins = valoriIn(mn.length ? mn : med, dayStartMs, dayEndMs, -45, 50);
        var maxs = valoriIn(mx.length ? mx : med, dayStartMs, dayEndMs, -45, 50);
        if (!mins.length || !maxs.length) return null;
        return { code: code, t: [Math.round(Math.min.apply(null, mins) * 10) / 10,
                                 Math.round(Math.max.apply(null, maxs) * 10) / 10] };
      }).catch(function() { return null; });
    }));
    res.forEach(function(r) { if (r) { byId[r.code].t = r.t; conT++; } });
    await new Promise(function(r) { setTimeout(r, 400); });
  }

  for (var j = 0; j < codsV.length; j += 10) {
    var batchV = codsV.slice(j, j + 10);
    var resV = await Promise.all(batchV.map(function(code) {
      return fetchWithRetry(OMIRL_BASE + '/charts/' + code + '/Vento').then(function(ch) {
        var ds = ch.dataSeries || [];
        // serie 0 = velocità, 1 = raffica (km/h)
        var vel = (ds[0] && ds[0].data) || [], raf = (ds[1] && ds[1].data) || [];
        if (oreCoperte(vel, dayStartMs, dayEndMs) < MIN_ORE_METEO) return null;
        var vv = valoriIn(vel, dayStartMs, dayEndMs, 0, 216);
        if (!vv.length) return null;
        var rr = valoriIn(raf, dayStartMs, dayEndMs, 0, 324);
        var media = vv.reduce(function(a, v) { return a + v; }, 0) / vv.length;
        return { code: code, w: [Math.round(media * 10) / 10,
                                 rr.length ? Math.round(Math.max.apply(null, rr) * 10) / 10 : null] };
      }).catch(function() { return null; });
    }));
    resV.forEach(function(r) { if (r) { byId[r.code].w = r.w; conW++; } });
    await new Promise(function(r) { setTimeout(r, 400); });
  }
  console.log('  Meteo t/w: ' + conT + ' stazioni con temperatura, ' + conW + ' col vento');
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

  // Temperatura e vento: in un try, la pioggia non deve mai risentirne
  try {
    var byId = {};
    output.forEach(function(s) { byId[s.id] = s; });
    await aggiungiMeteoLiguria(byId, dayStartMs, dayEndMs);
  } catch(e) { console.warn('  Warn: meteo t/w saltato: ' + e.message); }

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
