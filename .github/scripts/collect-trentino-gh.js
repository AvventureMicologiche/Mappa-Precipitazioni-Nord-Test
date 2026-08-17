/**
 * collect-trentino-gh.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Trentino da Meteotrentino
 * API: https://dati.meteotrentino.it/service.asmx/getValoriAggregatiGiornoJson
 *   → restituisce ultimi 6 giorni per tutte le stazioni attive
 * Lista stazioni: listaStazioniJson → lat/lon/quota
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const DATA_DIR      = path.join(__dirname, '..', '..', 'data', 'trentino');
const LIST_URL      = 'https://dati.meteotrentino.it/service.asmx/listaStazioniJson';
const DATI_URL      = 'https://dati.meteotrentino.it/service.asmx/getValoriAggregatiGiornoJson';

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

async function main() {
  console.log('=== collect-trentino-gh avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const now = new Date();
  const dateStr = process.env.DATE_OVERRIDE || fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));

  // Step 1: lista stazioni con coordinate
  console.log('  Fetch lista stazioni...');
  const listData = await fetchJSON(LIST_URL);
  const stMeta = {};
  const sites = listData.sites || listData.Stazioni || listData;
  if (Array.isArray(sites)) {
    sites.forEach(s => {
      // Salta stazioni non più attive (campo fine != '')
      if (s.fine && s.fine !== '') return;
      const id = s.codice;
      if (!id) return;
      stMeta[id] = {
        n:   (s.nome || s.nomebreve || id).trim(),
        lat: parseFloat(s.latitudine) || 0,
        lon: parseFloat(s.longitudine) || 0,
        q:   parseInt(s.quota, 10) || 0,
        p:   'TN'
      };
    });
  }
  console.log(`  Stazioni attive: ${Object.keys(stMeta).length}`);

  // Step 2: dati aggregati giornalieri (ultimi 6gg, tutte le stazioni)
  console.log('  Fetch dati precipitazioni...');
  const datiData = await fetchJSON(DATI_URL);
  const records = datiData.valoriAggregati || datiData;

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Nessun dato ricevuto da getValoriAggregatiGiornoJson');
  }

  // Meteotrentino pubblica l'aggregato giornaliero solo a giornata conclusa:
  // durante il giorno i record per `dateStr` non esistono ancora. Prima si
  // ripiegava sul "giorno più recente disponibile", scrivendo i dati di IERI
  // dentro il file di OGGI; il file veniva poi corretto solo dal primo run del
  // mattino successivo, e nel frattempo la mappa mostrava come "ieri" i dati
  // dell'altro ieri. Ora si salta il salvataggio di oggi e si aggiorna solo ieri.
  let todayRecords = records.filter(r => r.giorno && r.giorno.startsWith(dateStr));
  console.log(`  Record per ${dateStr}: ${todayRecords.length}`);

  if (todayRecords.length < 5) {
    console.log(`  Nessun aggregato pubblicato per ${dateStr}: salto il salvataggio di oggi.`);
    todayRecords = [];
  }

  // Temperatura (11/8/2026 — grafici stazione): Minima/Massima sono aggregati
  // ufficiali GIÀ nella stessa risposta, zero richieste extra. Il vento c'è
  // solo come raffica (vento_max) SENZA media: il grafico disegna la media,
  // quindi non si scrive niente — da riconsiderare se l'API pubblicasse anche
  // la media. Sanity come le altre reti: t in [-45,50] °C.
  function estraiMeteoTrn(r) {
    const out = {};
    const tn = parseFloat(r.Minima), tx = parseFloat(r.Massima);
    if (!isNaN(tn) && !isNaN(tx) && tn >= -45 && tx <= 50 && tn <= tx)
      out.t = [Math.round(tn * 10) / 10, Math.round(tx * 10) / 10];
    return out;
  }

  // Assembla stazioni
  const stations = todayRecords.map(r => {
    const id = r.idstaz;
    const mm = r.PrecTotale;
    if (mm === null || mm === undefined || isNaN(parseFloat(mm))) return null;
    const meta = stMeta[id];
    if (!meta || !meta.lat || !meta.lon) return null;
    const rec = {
      id,
      n:   meta.n,
      lat: meta.lat,
      lon: meta.lon,
      q:   meta.q,
      p:   meta.p,
      mm:  Math.round(parseFloat(mm) * 10) / 10
    };
    Object.assign(rec, estraiMeteoTrn(r));
    return rec;
  }).filter(Boolean);

  console.log(`  Stazioni con dati: ${stations.length}`);
  if (stations.length < 10) {
    console.warn('Poche stazioni oggi (' + stations.length + '), salto salvataggio oggi ma aggiorno ieri.');
  } else {

  const outFile = path.join(DATA_DIR, `${dateStr}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'meteotrentino',
    count:     stations.length,
    stations
  }));
  console.log(`✅ Scritto ${outFile} (${stations.length} stazioni)`);
  } // fine if stations.length >= 10

  // ── Aggiorna sempre anche ieri ──────────────────────────────
  // L'API restituisce 6 giorni di storico — aggiorna ieri ad ogni run
  if (!process.env.DATE_OVERRIDE) {
    const _yd = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000 - 24 * 3600000);
    const _p = n => String(n).padStart(2, '0');
    const _yDate = _yd.getUTCFullYear() + '-' + _p(_yd.getUTCMonth()+1) + '-' + _p(_yd.getUTCDate());
    console.log('Aggiorno anche ieri: ' + _yDate);
    try {
      let _yRecords = records.filter(r => r.giorno && r.giorno.startsWith(_yDate));
      if (_yRecords.length >= 5) {
        const _yStations = _yRecords.map(r => {
          const id = r.idstaz;
          const mm = r.PrecTotale;
          if (mm === null || mm === undefined || isNaN(parseFloat(mm))) return null;
          const meta = stMeta[id];
          if (!meta || !meta.lat || !meta.lon) return null;
          const _rec = { id, n: meta.n, lat: meta.lat, lon: meta.lon, q: meta.q, p: meta.p, mm: Math.round(parseFloat(mm) * 10) / 10 };
          Object.assign(_rec, estraiMeteoTrn(r));
          return _rec;
        }).filter(Boolean);
        if (_yStations.length >= 10) {
          const _yFile = path.join(DATA_DIR, `${_yDate}.json`);
          fs.writeFileSync(_yFile, JSON.stringify({ date: _yDate, collected: new Date().toISOString(), source: 'meteotrentino', count: _yStations.length, stations: _yStations }));
          console.log(`Aggiornato ieri: ${_yFile} (${_yStations.length} stazioni)`);
        }
      }
    } catch(e) { console.warn('Warn aggiornamento ieri: ' + e.message); }
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
