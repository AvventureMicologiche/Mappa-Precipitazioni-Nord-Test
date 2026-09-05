/**
 * collect-altoadige-gh.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Alto Adige
 * API: https://static-meteo.provincia.bz.it/stations-data/website/valley.json
 *   → restituisce tutte le stazioni con cumulato dalla mezzanotte
 * Sensore precipitazione: sensorCode = "N"
 *
 * TEMPERATURA E VENTO (dall'11/8/2026 — grafici stazione):
 * valley.json ha solo il valore ISTANTANEO, quindi min/max/media giornalieri
 * si calcolano dalle timeseries a 10 minuti dell'Open Data provinciale
 * (geoservices.buergernetz.bz.it/services/meteo/v1/timeseries — interrogabile
 * anche sui giorni passati, timestamp in ora locale CEST/CET):
 *   LT     → temperatura → t: [min, max] °C
 *   WG     → vento medio (m/s ×3,6)  ┐
 *   WG.BOE → raffica    (m/s ×3,6)  ┘→ w: [media, raffica] km/h
 * Ogni run ricalcola IERI (giorno completo) e OGGI (parziale, i run
 * successivi correggono) → nessun problema di merge. Campi scritti solo con
 * ore coperte ≥ MIN_ORE_METEO; stazioni senza sensore restano senza campi.
 * Sanity come Svizzera/Austria: t in [-45,50] °C, WG <60 m/s, BOE <90 m/s.
 * ~171 richieste extra per run (57 stazioni × 3 sensori); tutta la parte
 * meteo sta in un try: un suo guasto non tocca mai la raccolta pioggia.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'altoadige');
const API_URL  = 'https://static-meteo.provincia.bz.it/stations-data/website/valley.json';

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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
        }
      });
    }).on('error', reject);
  });
}

// ── Temperatura e vento dalle timeseries a 10 minuti ─────────────────
const TS_URL = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/timeseries';
const MIN_ORE_METEO = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Righe {day:'YYYY-MM-DD', hh, v} di un sensore fra due giorni (YYYY-MM-DD). */
async function fetchSensore(stationCode, sensorCode, fromDay, toDay) {
  const url = `${TS_URL}?station_code=${encodeURIComponent(stationCode)}`
            + `&sensor_code=${encodeURIComponent(sensorCode)}`
            + `&date_from=${fromDay.replace(/-/g, '')}&date_to=${toDay.replace(/-/g, '')}`;
  const rows = await fetchJSON(url);
  return (Array.isArray(rows) ? rows : []).map(r => {
    // DATE es. "2026-08-10T23:50:00CEST" — già ora locale, il giorno è il prefisso
    const v = parseFloat(r.VALUE);
    if (isNaN(v) || typeof r.DATE !== 'string') return null;
    return { day: r.DATE.slice(0, 10), hh: r.DATE.slice(11, 13), v };
  }).filter(Boolean);
}

/** Aggrega le righe dei tre sensori sul giorno dateStr → {t?, w?} (o {}). */
function aggregaMeteo(lt, wg, boe, dateStr, lf) {
  const out = {};
  const oreDi = rows => new Set(rows.map(r => r.hh)).size;
  const delGiorno = rows => rows.filter(r => r.day === dateStr);
  const vLT = delGiorno(lt).filter(r => r.v >= -45 && r.v <= 50);
  if (oreDi(vLT) >= MIN_ORE_METEO) {
    let mn = Infinity, mx = -Infinity;
    vLT.forEach(r => { if (r.v < mn) mn = r.v; if (r.v > mx) mx = r.v; });
    out.t = [Math.round(mn * 10) / 10, Math.round(mx * 10) / 10];
  }
  const vWG = delGiorno(wg).filter(r => r.v >= 0 && r.v < 60);
  if (oreDi(vWG) >= MIN_ORE_METEO) {
    const media = vWG.reduce((a, r) => a + r.v, 0) / vWG.length;
    const vBOE = delGiorno(boe).filter(r => r.v >= 0 && r.v < 90);
    out.w = [Math.round(media * 3.6 * 10) / 10,
             vBOE.length ? Math.round(Math.max(...vBOE.map(r => r.v)) * 3.6 * 10) / 10 : null];
  }
  // Umidità relativa (18/8/2026): sensore LF («Umidità relativa», %), 97 stazioni.
  const vLF = delGiorno(lf || []).filter(r => r.v >= 0 && r.v <= 100);
  if (oreDi(vLF) >= MIN_ORE_METEO) {
    let un = Infinity, ux = -Infinity;
    vLF.forEach(r => { if (r.v < un) un = r.v; if (r.v > ux) ux = r.v; });
    out.u = [Math.round(un), Math.round(ux)];
  }
  return out;
}

/** Scrive i t/w calcolati dentro il file del giorno, se esiste. */
function applicaMeteoAlFile(dateStr, meteoById) {
  const f = path.join(DATA_DIR, `${dateStr}.json`);
  if (!fs.existsSync(f)) return 0;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  let toccate = 0;
  (data.stations || []).forEach(s => {
    const m = meteoById[s.id];
    if (!m || (!m.t && !m.w && !m.u)) return;
    if (m.t) s.t = m.t;
    if (m.w) s.w = m.w;
    if (m.u) s.u = m.u;
    toccate++;
  });
  if (toccate > 0) fs.writeFileSync(f, JSON.stringify(data));
  return toccate;
}

/** Raccoglie t/w per tutte le stazioni sui giorni chiesti e aggiorna i file. */
async function raccogliMeteo(codes, giorni) {
  const fromDay = giorni[0];
  // date_to è ESCLUSIVO oltre la mezzanotte finale: si chiede fino al giorno dopo
  const d = new Date(giorni[giorni.length - 1] + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const toDay = d.toISOString().slice(0, 10);
  const perGiorno = {};             // dateStr → { id → {t?,w?} }
  giorni.forEach(g => perGiorno[g] = {});
  let falliti = 0;
  for (const code of codes) {
    // Un retry con pausa: l'endpoint ogni tanto rifiuta le raffiche di
    // richieste (visto al collaudo dell'11/8: 52/57 transitori in un run,
    // tutti ok pochi minuti dopo). Il run successivo ricalcola comunque.
    for (let tent = 1; tent <= 2; tent++) {
      try {
        const lt  = await fetchSensore(code, 'LT', fromDay, toDay);
        const wg  = await fetchSensore(code, 'WG', fromDay, toDay);
        const boe = await fetchSensore(code, 'WG.BOE', fromDay, toDay);
        let lf = [];
        try { lf = await fetchSensore(code, 'LF', fromDay, toDay); } catch (e) { /* stazione senza igrometro: t/w restano */ }
        giorni.forEach(g => { perGiorno[g][code] = aggregaMeteo(lt, wg, boe, g, lf); });
        break;
      } catch (e) {
        if (tent === 1) { await sleep(1500); continue; }
        falliti++;
        if (falliti <= 3) console.warn(`  Warn meteo ${code}: ${e.message}`);
      }
    }
    await sleep(80);
  }
  giorni.forEach(g => {
    const n = applicaMeteoAlFile(g, perGiorno[g]);
    console.log(`  Meteo t/w ${g}: ${n} stazioni aggiornate`);
  });
  if (falliti > 0) console.warn(`  Warn meteo: ${falliti} stazioni senza risposta timeseries`);
}

async function main() {
  console.log('=== collect-altoadige-gh avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const now = new Date();
  const dateStr = process.env.DATE_OVERRIDE || fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));

  console.log(`  Data: ${dateStr}`);
  console.log('  Fetch dati Alto Adige...');

  const data = await fetchJSON(API_URL);
  const stazioni = data.stations || [];

  if (stazioni.length === 0) throw new Error('Nessuna stazione ricevuta');
  console.log(`  Stazioni totali: ${stazioni.length}`);

  const stations = stazioni.map(s => {
    if (!s.lat || !s.lon) return null;

    // Trova il sensore precipitazione (N = Niederschlag)
    const nSensor = (s.statistics || []).find(x => x.sensorCode === 'N');
    if (!nSensor || nSensor.sensorValue === null || nSensor.sensorValue === undefined) return null;

    const mm = parseFloat(nSensor.sensorValue);
    if (isNaN(mm) || mm < 0) return null;

    return {
      id:  s.code,
      n:   s.name_it || s.name_de || s.code,
      lat: s.lat,
      lon: s.lon,
      q:   s.elevation || 0,
      p:   'BZ',
      mm:  Math.round(mm * 10) / 10
    };
  }).filter(Boolean);

  console.log(`  Stazioni con dati: ${stations.length}`);
  if (stations.length < 10) throw new Error(`Troppo poche stazioni: ${stations.length}`);

  const outFile = path.join(DATA_DIR, `${dateStr}.json`);

  // ── Guardia: cumulato di mezzanotte non ancora azzerato ──────────
  // L'API BZ espone il cumulato dalla mezzanotte. I cron slittano
  // regolarmente di 40+ minuti, quindi il run di chiusura serale può
  // atterrare dopo mezzanotte: se in quel momento l'API non ha ancora
  // azzerato, i totali di IERI finiscono nel file di OGGI e il merge MAX
  // li congela per sempre (pioggia fantasma, 22 luglio 2026).
  // Un payload identico stazione per stazione a quello del giorno prima non
  // è una coincidenza possibile su decine di stazioni: è un reset mancato.
  //
  // SI CONTANO SOLO LE STAZIONI BAGNATE (5 agosto 2026, terza recidiva).
  // Prima si guardavano tutte, con soglia 90%. In una giornata quasi asciutta
  // le decine di stazioni a zero in entrambi i giorni sono identiche per forza
  // e diluiscono le poche contaminate: il 30 luglio 2026 le identiche erano
  // 44 su 57 (77%, sotto soglia) ma fra le BAGNATE erano 26 su 39 (67%). La
  // firma c'era, nascosta dal bel tempo — lo stesso errore di misura già
  // imparato al check periodico dei giorni ripetuti.
  // Collaudato su 366 giorni di storico: la regola nuova prende sia il 27 sia
  // il 30 luglio e non scatta MAI sugli altri giorni; la vecchia mancava il 30
  // e scattava su 18 giornate di pioviggine buone, bloccandone la scrittura.
  // Il 30 luglio è stato trovato dal collector Austria, che sullo stesso giorno
  // dava 0 mm su 454 stazioni.
  let skipWrite = false;
  if (!fs.existsSync(outFile)) {
    const prevStr = new Date(Date.UTC(
      +dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)
    ) - 86400000).toISOString().slice(0, 10);
    const prevFile = path.join(DATA_DIR, `${prevStr}.json`);
    if (fs.existsSync(prevFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
        const prevMap = new Map((prev.stations || []).map(s => [s.id, s.mm]));
        const totale = stations.reduce((a, s) => a + s.mm, 0);
        // "bagnata" = con pioggia in almeno uno dei due giorni. Le altre non
        // informano: 0 contro 0 è identico sempre, anche quando tutto va bene.
        const bagnate = stations.filter(s => prevMap.get(s.id) > 0 || s.mm > 0);
        const uguali  = bagnate.filter(s => Math.abs(prevMap.get(s.id) - s.mm) < 0.05).length;
        skipWrite = totale > 0 && bagnate.length >= 5 && uguali >= bagnate.length * 0.6;
        if (skipWrite) console.log(`  Guardia reset: ${uguali}/${bagnate.length} stazioni BAGNATE identiche a ${prevStr}`);
      } catch(e) {
        console.warn('  Warn: guardia reset non applicabile: ' + e.message);
      }
    }
  }

  // Merge MAX con file esistente dello stesso giorno
  // Protegge da glitch API che restituiscono 0mm
  let finalStations = stations;
  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.date === dateStr && existing.stations) {
        const existMap = {};
        existing.stations.forEach(s => { existMap[s.id] = s.mm || 0; });
        finalStations = stations.map(s => {
          const prevMM = existMap[s.id] || 0;
          return { ...s, mm: Math.max(s.mm, prevMM) };
        });
        const newIds = new Set(stations.map(s => s.id));
        existing.stations.forEach(s => {
          if (!newIds.has(s.id) && s.mm > 0) finalStations.push(s);
        });
        console.log('  Merge MAX con file esistente applicato');
      }
    } catch(e) {
      console.warn('  Warn: merge fallito, uso dati nuovi');
    }
  }

  if (skipWrite) {
    console.warn(`⚠️  Payload quasi identico al giorno precedente (≥60% delle stazioni BAGNATE): l'API non ha ancora azzerato il cumulato di mezzanotte. Salto la scrittura di ${dateStr}.`);
  } else {
    fs.writeFileSync(outFile, JSON.stringify({
      date:      dateStr,
      collected: new Date().toISOString(),
      source:    'meteo-altoadige',
      count:     finalStations.length,
      stations:  finalStations
    }));
    console.log(`✅ Scritto ${outFile} (${finalStations.length} stazioni)`);
  }

  // ── Temperatura e vento: ieri (completo) + oggi (parziale) ──────
  // Dentro un try: un guasto delle timeseries non deve MAI far fallire
  // la raccolta pioggia già scritta qui sopra.
  try {
    const prevStr = new Date(Date.UTC(
      +dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)
    ) - 86400000).toISOString().slice(0, 10);
    const giorni = process.env.DATE_OVERRIDE ? [dateStr] : [prevStr, dateStr];
    console.log(`  Meteo t/w: raccolgo ${giorni.join(', ')}...`);
    await raccogliMeteo(stations.map(s => s.id), giorni);
  } catch (e) {
    console.warn('  Warn: raccolta meteo t/w fallita: ' + e.message);
  }

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(function(f) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(f); })
    .forEach(function(f) {
      if (f.replace('.json', '') < cutoffStr) {
        fs.unlinkSync(path.join(DATA_DIR, f));
        deleted++;
      }
    });
  if (deleted > 0) console.log('Pulizia retention: ' + deleted + ' file oltre i ' + MAX_DAYS + ' giorni eliminati');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
