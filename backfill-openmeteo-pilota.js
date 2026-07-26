/**
 * backfill-openmeteo-pilota.js — script UNA-TANTUM, NON nella pipeline automatica.
 *
 * Ricostruisce i giorni PRIMA dell'inizio dei dati reali per i piloti
 * VdA Centro Funzionale (data/valledaosta-cf) e Friuli OSMER (data/friuli-osmer),
 * con stime Open-Meteo Archive sulle STESSE coordinate / id / nomi delle stazioni
 * reali (letti dal file reale più recente della cartella). Così i periodi lunghi
 * mostrano SEMPRE lo stesso set di stazioni: giorni recenti reali + giorni vecchi
 * stimati, senza cambiare i punti sulla mappa (stesso approccio del backfill Toscana).
 *
 * I file generati hanno source 'open-meteo-backfill-<reg>' per restare distinguibili
 * dai dati reali ('cf-valledaosta' / 'osmer-fvg'). NON sovrascrivono mai file reali.
 *
 * Uso:  node backfill-openmeteo-pilota.js [vda|friuli|all]   (default: all)
 *
 * PROMOZIONE A PROD: i path sono relativi a __dirname, quindi lo script gira
 * identico nella copia di produzione del repo — basta eseguirlo lì (oppure copiare
 * i file data/ generati). Nessuna modifica al codice necessaria.
 *
 * NB Open-Meteo Archive (ERA5) è LENTO: timeout per richiesta volutamente lungo.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const CONFIG = {
  vda: {
    dir:       path.join(__dirname, 'data', 'valledaosta-cf'),
    realFrom:  '2026-07-16',                 // primo giorno di dati reali (escluso dal backfill)
    sourceTag: 'open-meteo-backfill-vda',
    provDefault: 'AO'
  },
  friuli: {
    dir:       path.join(__dirname, 'data', 'friuli-osmer'),
    realFrom:  '2026-07-18',
    sourceTag: 'open-meteo-backfill-friuli',
    provDefault: 'FVG'
  }
};

const BACKFILL_DAYS = 60;
const BATCH_SIZE    = 40;      // stazioni per chiamata (lat/lon multipli in un'unica URL)
const BATCH_DELAY   = 3000;    // ms tra un batch e l'altro
const REQ_TIMEOUT   = 120000;  // ms per singola richiesta — Archive è lento

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url, retries = 4) {
  return new Promise(async (resolve, reject) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await new Promise((ok, ko) => {
          const req = https.get(url, { headers: { Accept: 'application/json' } }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => ok({ status: r.statusCode, data: d }));
          });
          req.on('error', ko);
          req.setTimeout(REQ_TIMEOUT, () => { req.destroy(new Error('timeout ' + REQ_TIMEOUT + 'ms')); });
        });
        if (res.status === 200) return resolve(JSON.parse(res.data));
        if (res.status === 429) {
          console.warn(`  ⏳ Rate limit 429, attendo 90s... (tentativo ${attempt + 1}/${retries})`);
          await sleep(90000);
          continue;
        }
        throw new Error('HTTP ' + res.status);
      } catch (e) {
        console.warn(`  tentativo ${attempt + 1}/${retries} fallito: ${e.message}`);
        if (attempt === retries - 1) return reject(e);
        await sleep(5000);
      }
    }
  });
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// Prende il file reale più recente della cartella (source NON di backfill) per
// avere l'anagrafe corretta delle stazioni (id/n/lat/lon/q/p).
function latestRealFile(dir) {
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf8'));
    if (d.source && d.source.indexOf('backfill') < 0 && d.stations && d.stations.length > 0) return d;
  }
  throw new Error('nessun file reale trovato in ' + dir);
}

async function backfillRegion(key) {
  const cfg = CONFIG[key];
  console.log(`\n=== Backfill ${key} ===`);

  const anag = latestRealFile(cfg.dir);
  const stations = anag.stations.map(s => ({
    id: s.id, n: s.n, lat: s.lat, lon: s.lon, q: s.q || 0, p: s.p || cfg.provDefault
  }));
  console.log(`  Anagrafe da ${anag.date}: ${stations.length} stazioni`);

  const endDate   = ymd(addDays(cfg.realFrom, -1));               // giorno prima del primo reale
  const startDate = ymd(addDays(cfg.realFrom, -BACKFILL_DAYS));
  console.log(`  Periodo backfill: ${startDate} → ${endDate} (${BACKFILL_DAYS} giorni)`);

  const days = [];
  for (let d = new Date(startDate + 'T00:00:00Z'); ymd(d) <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  const byDay = {}; days.forEach(dd => byDay[dd] = {});

  const nBatch = Math.ceil(stations.length / BATCH_SIZE);
  for (let i = 0; i < stations.length; i += BATCH_SIZE) {
    const batch = stations.slice(i, i + BATCH_SIZE);
    const lats = batch.map(s => s.lat).join(',');
    const lons = batch.map(s => s.lon).join(',');
    // Una sola chiamata copre l'INTERO range di 60 giorni (daily.precipitation_sum)
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}`
              + `&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${startDate}&end_date=${endDate}`;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}/${nBatch} (${batch.length} staz)...`);
    const data = await fetchJSON(url);
    const arr = Array.isArray(data) ? data : [data];
    arr.forEach((loc, j) => {
      const s = batch[j]; if (!s) return;
      const times = (loc.daily && loc.daily.time) || [];
      const prec  = (loc.daily && loc.daily.precipitation_sum) || [];
      times.forEach((t, k) => {
        if (byDay[t] !== undefined) {
          let mm = prec[k];
          mm = (mm == null || mm > 300) ? 0 : Math.round(mm * 10) / 10;
          byDay[t][s.id] = mm;
        }
      });
    });
    await sleep(BATCH_DELAY);
  }

  let written = 0, skipped = 0;
  days.forEach(dd => {
    const out = path.join(cfg.dir, dd + '.json');
    if (fs.existsSync(out)) {
      try {
        const ex = JSON.parse(fs.readFileSync(out, 'utf8'));
        if (ex.source && ex.source.indexOf('backfill') < 0) { skipped++; return; } // MAI sovrascrivere dati reali
      } catch (e) { /* file corrotto: riscrivi */ }
    }
    const sts = stations.map(s => ({
      id: s.id, n: s.n, lat: s.lat, lon: s.lon, q: s.q, p: s.p, mm: byDay[dd][s.id] || 0
    }));
    fs.writeFileSync(out, JSON.stringify({
      date: dd, collected: new Date().toISOString(), source: cfg.sourceTag, count: sts.length, stations: sts
    }));
    written++;
  });
  console.log(`  ✓ ${key}: scritti ${written} file, saltati ${skipped} (reali protetti)`);
}

async function main() {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const keys = arg === 'all' ? Object.keys(CONFIG) : [arg];
  for (const k of keys) {
    if (!CONFIG[k]) { console.error('regione sconosciuta: ' + k + ' (usa: vda | friuli | all)'); process.exit(1); }
    await backfillRegion(k);
  }
  console.log('\n✅ Backfill completato.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
