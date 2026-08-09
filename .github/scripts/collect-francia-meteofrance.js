#!/usr/bin/env node
/**
 * FRANCIA (6 dipartimenti di confine) — Météo-France API Paquet Observations
 * ==========================================================================
 * API `public-api.meteofrance.fr/public/DPPaquetObs/v2`, Licence Ouverte v2.0
 * Etalab («Fonte: Météo-France»). Un pacchetto per dipartimento restituisce
 * TUTTE le stazioni con le loro ore: 6 richieste coprono tutto (74 Haute-Savoie,
 * 73 Savoie, 38 Isère, 05 Hautes-Alpes, 04 Alpes-de-Haute-Provence,
 * 06 Alpes-Maritimes). Studio completo: francia-rapporto-fonti.md (cartella
 * claudio, 9/8/2026).
 *
 * RICETTA — validata il 9/8/2026 prima di scrivere una riga di collector:
 *
 *  1. Il GIORNALIERO ufficiale francese (RR) NON è il giorno solare: è la
 *     finestra 06-06 UTC («RR del giorno J = dalle 06 UTC di J alle 06 UTC di
 *     J+1», definizione Météo-France). Stessa trappola di rre150d0 svizzero e
 *     del Klimatag austriaco. Quindi si sommano le ORE (`rr1`).
 *  2. `rr1` alla validity_time T copre l'ora che FINISCE a T: finestra
 *     `(start, end]` su timestamp di fine ora, identica a Svizzera, Austria e
 *     OSMER. Quadratura misurata sulla Savoia contro il RR ufficiale
 *     consolidato: 38/38 stazioni esatte in un giorno asciutto e 37/37 in uno
 *     di pioggia vera (Tignes 12,4 mm identico al decimo), scarto max 0,00.
 *  3. MIN_ORE=20 su 24, come per le altre fonti orarie.
 *
 * DIFFERENZE dagli altri collector:
 *  - serve la CHIAVE (env METEOFRANCE_API_KEY, secret GitHub): gratuita dal
 *    portale portail-api.meteofrance.fr, la nostra scade il 9/8/2028 insieme
 *    all'abbonamento. Se il collector inizia a dare 401 all'improvviso, è lei.
 *  - il pacchetto contiene ~5 GIORNI di ore (misurato il 9/8/2026, la doc dice
 *    24h): l'auto-riparazione copre D-1..D-4 gratis, oltre serve DPClim.
 *  - l'anagrafe (`/liste-stations`, nomi/coordinate/quota) è un CSV unico per
 *    tutta la Francia: si filtra sui 6 dipartimenti dal prefisso dell'id.
 *  - ⚠️ `id-departement` vuole il numero SENZA zero davanti (5, non 05: con lo
 *    zero risponde 400), ma gli id stazione lo TENGONO (05046001).
 *
 * Uso: METEOFRANCE_API_KEY=... node collect-francia-meteofrance.js
 *      DATE_OVERRIDE=2026-08-07 METEOFRANCE_API_KEY=... node collect-francia-meteofrance.js
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '../..', 'data', 'francia');
const API         = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v2';
const APIKEY      = (process.env.METEOFRANCE_API_KEY || '').trim();
const MIN_ORE     = 20;   // ore valide minime per accettare il totale di un giorno
const REPAIR_DAYS = 4;    // il pacchetto tiene ~5 giorni: D-1..D-4 riparabili gratis
const MIN_STAZ    = 100;  // sotto questa soglia non si scrive (attese ~150-190)
const RETENTION   = 730;

const DIPARTIMENTI = [
  { num: 74, pref: '74', nome: 'Haute-Savoie' },
  { num: 73, pref: '73', nome: 'Savoie' },
  { num: 38, pref: '38', nome: 'Isère' },
  { num: 5,  pref: '05', nome: 'Hautes-Alpes' },
  { num: 4,  pref: '04', nome: 'Alpes-de-Haute-Provence' },
  { num: 6,  pref: '06', nome: 'Alpes-Maritimes' },
];

function getItalyOffset(date) {
  // Francia e Italia condividono lo stesso fuso (CET/CEST)
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Finestra UTC del giorno solare italiano D: (start, end] su timestamp di FINE ora. */
function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off  = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { dateStr, start, end: start + 24 * 3600000 };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getCsv(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: {
        'apikey': APIKEY,
        'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)',
      } });
      if (r.status === 401 || r.status === 403)
        throw new Error(`HTTP ${r.status} — chiave API rifiutata (scade il 9/8/2028: rigenerarla dal portale)`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries) throw new Error(`${e.message} su ${url.slice(0, 100)}`);
      await sleep(3000 * i);
    }
  }
}

/** CSV a punto e virgola → array di oggetti {colonna: valore}. */
function parseCsv(text) {
  const righe = text.split('\n').map(r => r.trim()).filter(r => r);
  const head = righe[0].split(';');
  return righe.slice(1).map(r => {
    const c = r.split(';'), o = {};
    head.forEach((h, i) => o[h] = c[i] !== undefined ? c[i] : '');
    return o;
  });
}

/** "LE BOUCHET_SAPC" → "Le Bouchet" (il suffisso _SAPC è un marchio di rete, non un nome). */
function belNome(s) {
  return s.replace(/_SAPC$/i, '').replace(/_/g, ' ').toLowerCase()
          .replace(/(^|[\s\-'])\S/g, m => m.toUpperCase()).trim();
}

/**
 * Anagrafe: /liste-stations (CSV unico per tutta la Francia) filtrato sui 6
 * dipartimenti dal prefisso dell'id. Porta nome, coordinate e QUOTA — quindi
 * il filtro dislivello di check-confini.js funzionerà sul confine con
 * Piemonte e Valle d'Aosta, come per l'Austria sul Tirolo.
 * Nessuna deduplica: rete unica Météo-France, niente doppioni noti (a
 * differenza delle coppie COMBINED/INDIVIDUAL austriache).
 */
async function buildStationList() {
  const righe = parseCsv(await getCsv(`${API}/liste-stations`));
  const prefissi = Object.fromEntries(DIPARTIMENTI.map(d => [d.pref, d.nome]));
  const tenute = [];
  for (const r of righe) {
    const id = (r.Id_station || '').trim();
    const dip = prefissi[id.slice(0, 2)];
    if (!dip) continue;
    const lat = parseFloat(r.Latitude), lon = parseFloat(r.Longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    tenute.push({
      id,
      n:   belNome(r.Nom_usuel || id),
      lat: Math.round(lat * 100000) / 100000,
      lon: Math.round(lon * 100000) / 100000,
      q:   isFinite(parseFloat(r.Altitude)) ? Math.round(parseFloat(r.Altitude)) : 0,
      p:   dip,
    });
  }
  return tenute;
}

function loadExisting(dateStr) {
  const f = path.join(DATA_DIR, `${dateStr}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/** Merge per stazione: il valore nuovo vince, le vecchie senza valore nuovo restano. */
function writeDay(dateStr, fresh) {
  const existing = loadExisting(dateStr);
  const byId = {};
  if (existing && Array.isArray(existing.stations)) for (const s of existing.stations) byId[s.id] = s;
  for (const s of fresh) byId[s.id] = s;
  const merged = Object.values(byId);
  if (merged.length < MIN_STAZ) {
    console.warn(`  ${dateStr}: solo ${merged.length} stazioni, salto la scrittura`);
    return false;
  }
  fs.writeFileSync(path.join(DATA_DIR, `${dateStr}.json`), JSON.stringify({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    'meteofrance-dppaquetobs',
    count:     merged.length,
    stations:  merged,
  }));
  const tot = merged.reduce((a, b) => a + b.mm, 0);
  console.log(`  ✅ ${dateStr}: ${merged.length} stazioni (${fresh.length} fresche), totale ${tot.toFixed(0)} mm`);
  return true;
}

function pulizia() {
  const limite = fmtDate(new Date(Date.now() - RETENTION * 24 * 3600000));
  let tolti = 0;
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && m[1] < limite) { fs.unlinkSync(path.join(DATA_DIR, f)); tolti++; }
  }
  if (tolti) console.log(`  Pulizia retention: ${tolti} file oltre i ${RETENTION} giorni`);
}

async function main() {
  console.log('=== collect-francia-meteofrance avviato ===');
  if (!APIKEY) throw new Error('manca METEOFRANCE_API_KEY (secret GitHub / variabile d\'ambiente)');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const stations = await buildStationList();
  console.log(`  Stazioni in anagrafe sui 6 dipartimenti: ${stations.length}`);
  if (stations.length < 120) throw new Error(`Troppo poche stazioni in anagrafe: ${stations.length}`);
  const byId = Object.fromEntries(stations.map(s => [s.id, s]));

  // ── Giorni da raccogliere ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const targets = [];
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    targets.push(process.env.DATE_OVERRIDE.trim());
  } else {
    for (let i = 1; i <= REPAIR_DAYS; i++) {
      const dateStr = fmtDate(new Date(todayNoon - i * 24 * 3600000));
      if (i <= 2) { targets.push(dateStr); continue; }
      const ex = loadExisting(dateStr);
      if (!ex || (ex.count || 0) < MIN_STAZ) targets.push(dateStr);  // riparazione
    }
  }
  const windows = targets.map(dayWindow);
  console.log('  Giorni: ' + targets.join(', '));

  // ── Raccolta: un pacchetto per dipartimento, tutte le ore di ~5 giorni ──
  const perDay = {};                        // dateStr -> [{...stazione, mm}]
  for (const w of windows) perDay[w.dateStr] = [];
  const ignote = new Set();

  for (const dip of DIPARTIMENTI) {
    const righe = parseCsv(await getCsv(`${API}/paquet/horaire?id-departement=${dip.num}&format=csv`));
    // ore per stazione: id -> [ts, mm]
    const ore = {};
    for (const r of righe) {
      const rr = r.rr1;
      if (rr === '' || rr === undefined) continue;
      const ts = Date.parse(r.validity_time);
      if (!isFinite(ts)) continue;
      (ore[r.geo_id_insee] = ore[r.geo_id_insee] || []).push([ts, parseFloat(rr)]);
    }
    let fresche = 0;
    for (const id of Object.keys(ore)) {
      const st = byId[id];
      if (!st) { ignote.add(id); continue; }   // fuori anagrafe: capita, si conta e basta
      for (const w of windows) {
        let sum = 0, n = 0;
        for (const [ts, v] of ore[id]) {
          if (ts > w.start && ts <= w.end && isFinite(v)) { sum += v; n++; }
        }
        if (n < MIN_ORE) continue;
        const mm = Math.round(sum * 10) / 10;
        if (mm < 0 || mm > 500) continue;      // valore implausibile: si scarta
        perDay[w.dateStr].push({ id: st.id, n: st.n, lat: st.lat, lon: st.lon, q: st.q, p: st.p, mm });
        fresche++;
      }
    }
    console.log(`  ${dip.nome} (${dip.num}): ${Object.keys(ore).length} stazioni con ore, ${fresche} giorni-stazione`);
    await sleep(500);
  }
  if (ignote.size) console.log(`  Stazioni nel pacchetto ma non in anagrafe (ignorate): ${ignote.size}`);

  let scritti = 0;
  for (const w of windows) if (writeDay(w.dateStr, perDay[w.dateStr])) scritti++;
  pulizia();
  console.log(`=== fine: ${scritti}/${windows.length} giorni scritti ===`);
  if (scritti === 0) process.exit(1);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
