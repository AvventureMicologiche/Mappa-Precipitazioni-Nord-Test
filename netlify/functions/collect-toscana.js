/**
 * collect-toscana.js  –  Netlify Function
 * Raccoglie precipitazioni giornaliere Toscana da CFR Toscana
 * Fonte dati: https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=pluvio_men
 *   → pagina HTML server-rendered con DataTable (nessuna API JSON)
 * Lista stazioni (lat/lon): actions.php?action=list&rt=0&type_gauge=pluvio
 *
 * Output: data/toscana/YYYY-MM-DD.json
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Configurazione ──────────────────────────────────────────────
const DATA_DIR     = path.join('/tmp', 'toscana');
const LIST_URL     = 'https://www.cfr.toscana.it/monitoraggio/actions.php?action=list&rt=0&type_gauge=pluvio&speed=km/h';
const SCRAPE_URL   = 'https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=pluvio_men';

// ── Utility ─────────────────────────────────────────────────────
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function fetchJSON(url) {
  return fetchText(url).then(t => JSON.parse(t));
}

// ── Step 1: Lista stazioni con coordinate ────────────────────────
async function fetchStationList() {
  const data = await fetchJSON(LIST_URL);
  const stazioni = {};

  // Response attesa: array di oggetti con IDStazione, Nome, Provincia, Lat, Lon
  // Response è GeoJSON: { type:"featureCollection", features:[{IDStazione, Nome, Lat, Lon, ...}] }
  const items = Array.isArray(data) ? data
              : (data.features || data.data || data.stazioni || data.result || []);
  items.forEach(s => {
    const id  = String(s.IDStazione || s.id || '').trim();
    const lat = parseFloat(s.Lat || s.lat || s.LAT || 0);
    const lon = parseFloat(s.Lon || s.lon || s.LON || 0);
    if (!id || !lat || !lon) return;
    stazioni[id] = {
      n:   (s.Nome || s.nome || s.NOME || id).trim(),
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q:   parseInt(s.Quota || s.quota || 0, 10) || 0,
      p:   (s.Provincia || s.provincia || '—').trim()
    };
  });

  console.log(`  Lista stazioni: ${Object.keys(stazioni).length} trovate`);
  return stazioni;
}

// ── Step 2: Scraping HTML tabella precipitazioni ─────────────────
async function fetchPrecipData() {
  const html = await fetchText(SCRAPE_URL);

  // La tabella DataTable ha righe <tr> con <td> nell'ordine:
  // Codice | Stazione | Comune | Provincia | Zona allerta | Quota | Oggi (dalle 00.00) | Ultimi dati | 1g | 2g | 5g | ...
  // Indici:   0           1        2           3               4        5                  6             7    8    9   10

  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    let tdMatch;
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(tdMatch[1]));
    }

    // Riga valida: almeno 8 colonne, prima cella = codice stazione TOS...
    if (cells.length < 8) continue;
    const codice = cells[0].replace(/\s+/g, '');
    if (!codice.match(/^TOS\d+$/i) && !codice.match(/^\d+$/)) continue;

    const mmOggi = parseFloat(cells[6]);
    if (isNaN(mmOggi) || mmOggi < 0) continue;

    rows.push({
      codice,
      stazione: cells[1] || codice,
      provincia: cells[3] || '—',
      quota: parseInt(cells[5], 10) || 0,
      mm: Math.round(mmOggi * 10) / 10
    });
  }

  console.log(`  Righe scraping: ${rows.length}`);
  return rows;
}

// ── Step 3: Join dati + coordinate ──────────────────────────────
function buildStations(precipRows, stationList) {
  const result = [];

  precipRows.forEach(row => {
    // Cerca per IDStazione: il codice CFR è tipo TOS01000025
    // Proviamo match diretto, poi estrazione numero
    let info = stationList[row.codice];

    if (!info) {
      // Prova a estrarre solo la parte numerica
      const numPart = row.codice.replace(/^TOS0*/i, '');
      info = stationList[numPart] || stationList['TOS' + numPart.padStart(8, '0')];
    }

    if (!info) {
      // Fallback: usa i dati della tabella HTML (senza lat/lon)
      return; // salta stazioni senza coordinate
    }

    result.push({
      id:  row.codice,
      n:   info.n || row.stazione,
      lat: info.lat,
      lon: info.lon,
      q:   info.q || row.quota,
      p:   info.p || row.provincia,
      mm:  row.mm
    });
  });

  console.log(`  Stazioni con coordinate: ${result.length}`);
  return result;
}

// ── Handler Netlify ──────────────────────────────────────────────
exports.handler = async function(event, context) {
  try {
    console.log('=== collect-toscana avviato ===');

    const today   = new Date();
    const dateStr = fmtDate(today);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Fetch parallelo: lista stazioni + dati precipitazione
    const [stationList, precipRows] = await Promise.all([
      fetchStationList(),
      fetchPrecipData()
    ]);

    const stations = buildStations(precipRows, stationList);

    if (stations.length < 10) {
      throw new Error(`Troppo poche stazioni: ${stations.length}`);
    }

    const output = {
      date:      dateStr,
      collected: new Date().toISOString(),
      source:    'cfr-toscana',
      count:     stations.length,
      stations
    };

    const outFile = path.join(DATA_DIR, `${dateStr}.json`);
    fs.writeFileSync(outFile, JSON.stringify(output));
    console.log(`  Scritto: ${outFile} (${stations.length} stazioni)`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, date: dateStr, count: stations.length })
    };

  } catch (err) {
    console.error('Errore collect-toscana:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
