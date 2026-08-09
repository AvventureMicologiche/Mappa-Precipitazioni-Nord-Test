#!/usr/bin/env node
/**
 * FRANCIA — Backfill 365+ giorni di dati REALI (una tantum, 9/8/2026)
 * ===================================================================
 * Semina lo storico da 2025-08-01 a 2026-08-04 (il giorno prima del primo
 * giorno del collector) dai CSV orari ufficiali `BASE/HOR/H_<dip>` di
 * meteo.data.gouv.fr — stessa banca dati climatologica, Licence Ouverte 2.0.
 * Niente stime, niente fase beta: come Svizzera e Austria.
 *
 * ⚠️ URL: SOLO il mirror S3 OVH (`meteofrance.s3.sbg.io.cloud.ovh.net`).
 * Il mirror `object.files.data.gouv.fr` è FERMO a giugno 2026 e per giunta
 * il `last_modified` dell'API data.gouv mente: i file OVH arrivano a poche
 * ore fa (verificato il 9/8: ore fino alle 04 UTC dello stesso giorno).
 * La voce "aggiornamento mensile" nel rapporto fonti nasceva dal mirror morto.
 *
 * RICETTA (misurata il 9/8/2026 prima di scrivere questo script):
 *  - L'etichetta oraria AAAAMMJJHH è UTC e indica la FINE dell'intervallo:
 *    confronto somma-ore vs RR ufficiale (finestra 06-06) su 856 giorni
 *    bagnati della Savoia: 825/827 esatti entro 0,2 mm (99,8%) con la
 *    convenzione fine, 73,9% con quella inizio. Stessa convenzione dell'API
 *    paquet (validity_time), di MeteoSvizzera, GeoSphere e OSMER.
 *  - Somma sul giorno solare italiano, MIN_ORE=20 — identico al collector.
 *
 * L'anagrafe viene dai CSV stessi (NOM_USUEL/LAT/LON/ALTI su ogni riga):
 * comprende anche stazioni chiuse durante l'anno, che nello storico hanno
 * diritto di esserci. I nomi passano dalla stessa pulizia del collector
 * (via `_SAPC`, Title Case) per uscire identici.
 *
 * NON tocca i file esistenti (i giorni del collector restano suoi).
 *
 * Uso: node backfill-francia-meteofrance.js            (scarica e semina)
 *      SOLO_GIORNO=2026-08-07 node ...                 (un giorno, per confronti)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR  = path.join(__dirname, '../..', 'data', 'francia');
const OVH       = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR';
const DIPS      = { '74': 'Haute-Savoie', '73': 'Savoie', '38': 'Isère',
                    '05': 'Hautes-Alpes', '04': 'Alpes-de-Haute-Provence', '06': 'Alpes-Maritimes' };
const DA        = '2025-08-01';
const A         = '2026-08-04';
const MIN_ORE   = 20;
const MIN_STAZ  = 100;

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
const p2 = n => String(n).padStart(2, '0');
function fmtDate(d) { return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; }

function belNome(s) {
  return s.replace(/_SAPC$/i, '').replace(/_/g, ' ').toLowerCase()
          .replace(/(^|[\s\-'])\S/g, m => m.toUpperCase()).trim();
}

async function scarica(dip) {
  const url = `${OVH}/H_${dip}_latest-2025-2026.csv.gz`;
  const r = await fetch(url, { headers: { 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
  return zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
}

async function main() {
  console.log('=== backfill-francia-meteofrance ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Giorni della semina, con finestra UTC (etichette di FINE ora) ──
  const giorni = [];
  const solo = (process.env.SOLO_GIORNO || '').trim();
  for (let t = Date.parse(DA + 'T12:00:00Z'); t <= Date.parse(A + 'T12:00:00Z'); t += 86400000) {
    const dateStr = fmtDate(new Date(t));
    if (solo && dateStr !== solo) continue;
    if (!solo && fs.existsSync(path.join(DATA_DIR, dateStr + '.json'))) continue;  // giorno del collector
    const off = getItalyOffset(new Date(t)) * 3600000;
    const start = Date.parse(dateStr + 'T00:00:00Z') - off;
    giorni.push({ dateStr, start, end: start + 86400000 });
  }
  console.log(`  Giorni da seminare: ${giorni.length} (${giorni[0] && giorni[0].dateStr} → ${giorni.length && giorni[giorni.length - 1].dateStr})`);
  if (!giorni.length) return;
  const inWindow = Object.fromEntries(giorni.map(g => [g.dateStr, g]));

  // ── Un dipartimento alla volta: parse a righe, accumulo per (giorno, stazione) ──
  const perDay = {};                                  // dateStr -> id -> {sum,n}
  for (const g of giorni) perDay[g.dateStr] = {};
  const ana = {};                                     // id -> {n,lat,lon,q,p}

  for (const dip of Object.keys(DIPS)) {
    const testo = await scarica(dip);
    const righe = testo.split('\n');
    const head = righe[0].trim().split(';');
    const iN = head.indexOf('NUM_POSTE'), iNom = head.indexOf('NOM_USUEL'),
          iLat = head.indexOf('LAT'), iLon = head.indexOf('LON'), iAlt = head.indexOf('ALTI'),
          iD = head.indexOf('AAAAMMJJHH'), iRR = head.indexOf('RR1');
    let usate = 0;
    for (let k = 1; k < righe.length; k++) {
      const c = righe[k].split(';');
      const rr = c[iRR];
      if (rr === '' || rr === undefined) continue;
      const et = c[iD];
      if (!et || et.length !== 10) continue;
      // etichetta UTC di fine ora → ms
      const ts = Date.UTC(+et.slice(0, 4), +et.slice(4, 6) - 1, +et.slice(6, 8), +et.slice(8, 10));
      // il giorno solare che contiene questa etichetta: (start, end]
      const dCivile = fmtDate(new Date(ts - 1));                    // candidato per fuso +2
      const dPrima  = fmtDate(new Date(ts - 1 + 86400000));         // l'etichetta 22-23 cade sul giorno DOPO
      let g = null;
      if (inWindow[dCivile] && ts > inWindow[dCivile].start && ts <= inWindow[dCivile].end) g = inWindow[dCivile];
      else if (inWindow[dPrima] && ts > inWindow[dPrima].start && ts <= inWindow[dPrima].end) g = inWindow[dPrima];
      if (!g) continue;
      const id = c[iN].trim();
      if (!ana[id]) ana[id] = {
        n: belNome(c[iNom] || id),
        lat: Math.round(parseFloat(c[iLat]) * 100000) / 100000,
        lon: Math.round(parseFloat(c[iLon]) * 100000) / 100000,
        q: isFinite(parseFloat(c[iAlt])) ? Math.round(parseFloat(c[iAlt])) : 0,
        p: DIPS[dip],
      };
      const slot = perDay[g.dateStr][id] || (perDay[g.dateStr][id] = { sum: 0, n: 0 });
      slot.sum += parseFloat(rr); slot.n++;
      usate++;
    }
    console.log(`  ${DIPS[dip]} (${dip}): ${righe.length - 1} righe, ${usate} ore usate`);
  }

  // ── Scrittura ──
  let scritti = 0, corti = 0;
  for (const g of giorni) {
    const stations = [];
    for (const id of Object.keys(perDay[g.dateStr])) {
      const { sum, n } = perDay[g.dateStr][id];
      if (n < MIN_ORE) continue;
      const mm = Math.round(sum * 10) / 10;
      if (mm < 0 || mm > 500) continue;
      const a = ana[id];
      stations.push({ id, n: a.n, lat: a.lat, lon: a.lon, q: a.q, p: a.p, mm });
    }
    if (stations.length < MIN_STAZ) { corti++; continue; }
    fs.writeFileSync(path.join(DATA_DIR, g.dateStr + '.json'), JSON.stringify({
      date: g.dateStr,
      collected: new Date().toISOString(),
      source: 'meteofrance-dppaquetobs',
      backfill: true,
      count: stations.length,
      stations,
    }));
    scritti++;
  }
  console.log(`  Stazioni viste in tutto: ${Object.keys(ana).length}`);
  console.log(`=== fine: ${scritti} giorni scritti, ${corti} saltati per poche stazioni ===`);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
