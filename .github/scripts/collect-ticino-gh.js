/**
 * collect-ticino-gh.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere del Canton Ticino da OASI
 * (Osservatorio Ambientale della Svizzera Italiana, oasi.ti.ch).
 *
 * L'API OASI è la più semplice del progetto:
 *  - /web/rest/locations?domain=meteo                      → elenco stazioni (coordinate LV95)
 *  - /web/rest/measure/csv?domain=meteo&resolution=d
 *      &parameter=Prec&from=YYYY-MM-DD&to=YYYY-MM-DD
 *      &location=<code>                                    → mm giornalieri, già aggregati
 *
 * A differenza di CFR/SIR Toscana, le QUERY STORICHE FUNZIONANO: si può chiedere
 * qualsiasi giorno passato e ottenere il valore consolidato.
 * Niente merge MAX né finestre mobili: il valore giornaliero OASI è autoritativo,
 * l'ultima lettura vince sempre.
 *
 * ATTENZIONE: il valore giornaliero (resolution=d) per il GIORNO CORRENTE non
 * esiste ancora — OASI lo pubblica solo a giornata conclusa (verificato il
 * 16/07/2026: query su oggi = 0 righe, su ieri = dati completi). Non è un
 * problema: la mappa esclude sempre la giornata odierna (regola #3 del progetto),
 * quindi il collector raccoglie IERI (fresco) e L'ALTROIERI (versione consolidata
 * dei valori marcati "provvisorio" il giorno prima).
 *
 * Vengono escluse le stazioni gestite da ARPA Lombardia / ARPA Piemonte presenti
 * in OASI: quelle zone sono già coperte dai nostri collector regionali.
 *
 * Licenza dati OASI: uso e pubblicazione liberi citando la fonte (oasi.ti.ch).
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '../..', 'data', 'ticino');
const BASE_URL = 'https://www.oasi.ti.ch/web/rest';

function getItalyOffset(date) {
  // Svizzera e Italia condividono lo stesso fuso (CET/CEST)
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

/**
 * Conversione coordinate svizzere LV95 → WGS84 (formule approssimate swisstopo,
 * precisione ~1 m — più che sufficiente per una mappa).
 */
function lv95ToWgs84(E, N) {
  const y = (E - 2600000) / 1000000;
  const x = (N - 1200000) / 1000000;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x
            - 0.0436 * y * y * y;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x
            - 0.0447 * y * y * x - 0.0140 * x * x * x;
  return { lat: lat * 100 / 36, lon: lon * 100 / 36 };
}

/** Parse del CSV OASI: righe commento con #, header "data;Prec;provvisorio;" */
function parseOasiCsv(csv) {
  const rows = [];
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('data;')) continue;
    const parts = t.split(';');
    if (parts.length < 2) continue;
    // data formato "14.07.2026 12:00:00"
    const m = parts[0].match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) continue;
    const val = parseFloat(parts[1]);
    if (isNaN(val)) continue;
    rows.push({ date: `${m[3]}-${m[2]}-${m[1]}`, mm: val, provisional: (parts[2] || '').includes('*') });
  }
  return rows;
}

async function collectDay(stations, dateStr) {
  const out = [];
  let fallbacks = 0;
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    try {
      const url = `${BASE_URL}/measure/csv?domain=meteo&resolution=d&parameter=Prec&from=${dateStr}&to=${dateStr}&location=${encodeURIComponent(s.code)}`;
      const csv = await fetchRaw(url);
      const rows = parseOasiCsv(csv).filter(r => r.date === dateStr);
      let mm = null;
      if (rows.length > 0) {
        mm = rows[0].mm;
      } else {
        // Il totale giornaliero di ieri viene pubblicato da OASI solo a metà
        // mattina (~08:30 CEST): fino ad allora la riga esiste ma è vuota.
        // Fallback: somma delle letture da 10 minuti, disponibili in tempo
        // quasi reale (validato: scarto ~3% dal giornaliero ufficiale).
        // I run successivi sovrascrivono col valore ufficiale.
        const hUrl = `${BASE_URL}/measure/csv?domain=meteo&resolution=h&parameter=Prec&from=${dateStr}&to=${dateStr}&location=${encodeURIComponent(s.code)}`;
        const hRows = parseOasiCsv(await fetchRaw(hUrl)).filter(r => r.date === dateStr);
        // 144 letture attese (10 min): accetta solo giornate quasi complete
        // per non scrivere sottostime grossolane da buchi di trasmissione.
        if (hRows.length >= 120) {
          mm = hRows.reduce((a, r) => a + r.mm, 0);
          fallbacks++;
        }
      }
      if (mm !== null) {
        mm = Math.round(mm * 10) / 10;
        if (mm >= 0 && mm <= 500) {
          out.push({ id: s.code, n: s.name, lat: s.lat, lon: s.lon, q: s.q, p: 'TI', mm });
        }
      }
      process.stdout.write(`  ${dateStr}: ${i+1}/${stations.length} stazioni\r`);
      await sleep(150);
    } catch(e) {
      console.warn(`\n  Warn: stazione ${s.code} (${s.name}) fallita: ${e.message}`);
    }
  }
  console.log('');
  if (fallbacks > 0) console.log(`  (${fallbacks} stazioni da somma 10-min, giornaliero non ancora pubblicato)`);
  return out;
}

function writeDay(dateStr, stations) {
  if (stations.length < 10) {
    console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto la scrittura per non degradare il file esistente`);
    return false;
  }
  const outFile = path.join(DATA_DIR, `${dateStr}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'oasi-ticino',
    count:     stations.length,
    stations
  }));
  console.log(`  ✅ Scritto ${outFile} (${stations.length} stazioni)`);
  return true;
}

async function main() {
  console.log('=== collect-ticino-gh avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('  Fetch elenco stazioni OASI...');
  const locs = JSON.parse(await fetchRaw(`${BASE_URL}/locations?domain=meteo`));

  const stations = locs
    .filter(l => !((l.simpleOwner || l.owner || '').toUpperCase().includes('ARPA')))
    .map(l => {
      const c = l.coordinates || {};
      if (typeof c.x !== 'number' || typeof c.y !== 'number') return null;
      const w = lv95ToWgs84(c.x, c.y);
      return {
        code: l.code,
        name: l.name,
        lat: Math.round(w.lat * 10000) / 10000,
        lon: Math.round(w.lon * 10000) / 10000,
        q:   Math.round(c.z || 0)
      };
    })
    .filter(Boolean);

  console.log(`  Stazioni OASI utilizzabili (escluse ARPA): ${stations.length}`);
  if (stations.length < 10) throw new Error(`Troppo poche stazioni: ${stations.length}`);

  // DATE_OVERRIDE raccoglie solo quel giorno specifico (per backfill manuale);
  // altrimenti: ieri (primo dato disponibile) + altroieri (consolidamento).
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    const dStr = process.env.DATE_OVERRIDE.trim();
    console.log(`  Raccolgo ${dStr} (DATE_OVERRIDE)...`);
    writeDay(dStr, await collectDay(stations, dStr));
  } else {
    const now = new Date();
    const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
    const todayStr = fmtDate(italyNow);
    const noon = new Date(todayStr + 'T12:00:00Z').getTime();
    const yesterdayStr  = fmtDate(new Date(noon - 24 * 3600000));
    const dayBeforeStr  = fmtDate(new Date(noon - 48 * 3600000));

    console.log(`  Raccolgo ieri (${yesterdayStr})...`);
    writeDay(yesterdayStr, await collectDay(stations, yesterdayStr));

    console.log(`  Consolido l'altroieri (${dayBeforeStr})...`);
    writeDay(dayBeforeStr, await collectDay(stations, dayBeforeStr));

    // ── Auto-riparazione: recupera dall'archivio OASI eventuali giorni
    // mancanti negli ultimi 7 (es. run falliti per piu' giorni di fila).
    // Possibile solo perche' le query storiche OASI funzionano.
    for (let i = 3; i <= 7; i++) {
      const dStr = fmtDate(new Date(noon - i * 24 * 3600000));
      const f = path.join(DATA_DIR, `${dStr}.json`);
      let needsRepair = !fs.existsSync(f);
      if (!needsRepair) {
        try { needsRepair = (JSON.parse(fs.readFileSync(f, 'utf8')).count || 0) < 30; }
        catch(e) { needsRepair = true; }
      }
      if (needsRepair) {
        console.log(`  Auto-riparazione: recupero ${dStr} dall'archivio...`);
        writeDay(dStr, await collectDay(stations, dStr));
      }
    }
  }

  // ── Pulizia file > 365 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 365;
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

  console.log('=== collect-ticino-gh completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
