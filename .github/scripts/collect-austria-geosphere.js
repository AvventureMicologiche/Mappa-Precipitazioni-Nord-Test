#!/usr/bin/env node
/**
 * AUSTRIA — GeoSphere Austria Data Hub (ex ZAMG)
 * ==============================================
 * API pubblica `dataset.api.hub.geosphere.at`, licenza CC BY 4.0
 * («Fonte: GeoSphere Austria»). Dataset usato: `klima-v2-1h`, stazioni
 * climatologiche con il parametro `rr` (precipitazione oraria, mm).
 *
 * RICETTA — validata il 5/8/2026 prima di scrivere una riga di collector:
 *
 *  1. Il GIORNALIERO ufficiale `klima-v2-1d` NON è il giorno solare: è la
 *     finestra 06-06 UTC, cioè il Klimatag 07-07 in ora solare mitteleuropea.
 *     Usarlo darebbe la pioggia sul giorno sbagliato, esattamente come
 *     `rre150d0` per MeteoSvizzera. Quindi si sommano le ORE.
 *  2. Il timestamp orario indica la FINE dell'intervallo (il valore alle 14:00
 *     copre 13-14). Misurato in due modi indipendenti:
 *     - somma oraria vs giornaliero ufficiale: lo sfasamento che li allinea è
 *       di 7 ore = 6 (finestra Klimatag) + 1 (fine intervallo), con 379 giorni
 *       bagnati esatti su 380 e scarto medio 0,050 mm su 15 stazioni;
 *     - correlazione oraria con MeteoSvizzera, di cui la convenzione è già
 *       accertata, sulla coppia Rohrspitz (AT) ↔ Altenrhein (CH) a 5,0 km:
 *       r=0,822 a sfasamento 0, contro 0,32 a ±1 ora.
 *     Da qui la finestra `(start, end]` su timestamp di fine ora, identica a
 *     quella di Svizzera e OSMER Friuli.
 *  3. MIN_ORE=20 su 24, come per le altre fonti orarie.
 *
 * TEMPERATURA E VENTO (dal 10/8/2026 — pilota grafici stazione):
 *  la stessa richiesta porta anche `tl` (temperatura 2m, °C), `ff` (vento medio,
 *  m/s) e `ffx` (raffica, m/s) — zero chiamate in più. Per ogni stazione-giorno
 *  si scrivono due campi compatti, presenti solo se le ore valide sono ≥ MIN_ORE:
 *    t: [min, max]        °C sul giorno solare italiano
 *    w: [media, raffica]  km/h (conversione ×3,6 dal m/s della fonte)
 *  Le stazioni senza termometro/anemometro semplicemente non hanno il campo,
 *  e il pannello mostra «non disponibile». Niente merge min/max fra run: ogni
 *  run ricalcola il giorno INTERO dalle ore, quindi l'ultimo scrive tutto.
 *
 * VANTAGGI rispetto agli altri collector:
 *  - una sola richiesta copre TUTTE le stazioni insieme (non una per stazione
 *    come Liguria o Svizzera): niente batch da 199 chiamate;
 *  - le query storiche funzionano su tutto l'archivio (dal 1880), quindi
 *    l'auto-riparazione D-3..D-10 è gratis e un run fallito non perde dati;
 *  - l'anagrafe pubblica la QUOTA, cosa che Piemonte, OSMER e le reti MeteoHub
 *    non fanno: il filtro dislivello di check-confini.js funziona davvero sul
 *    confine Alto Adige↔Tirolo.
 *
 * Uso: node collect-austria-geosphere.js
 *      DATE_OVERRIDE=2026-07-15 node collect-austria-geosphere.js
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '../..', 'data', 'austria');
const API         = 'https://dataset.api.hub.geosphere.at/v1/station/historical/klima-v2-1h';
const MIN_ORE     = 20;    // ore valide minime per accettare il totale di un giorno
const REPAIR_DAYS = 10;    // auto-riparazione fino a D-10 (gratis: l'archivio risponde)
const BATCH       = 120;   // stazioni per richiesta (tiene corta la URL)
const MIN_STAZ    = 100;   // sotto questa soglia non si scrive: anagrafe sospetta
const RETENTION   = 730;

function getItalyOffset(date) {
  // Austria e Italia condividono lo stesso fuso (CET/CEST)
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

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw new Error(`${e.message} su ${url.slice(0, 120)}`);
      await sleep(3000 * i);
    }
  }
}

const distKm = (a, b) =>
  Math.hypot((a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111);

/**
 * Anagrafe: stazioni orarie ancora attive, con coordinate e quota, DEDUPLICATE.
 *
 * GeoSphere pubblica quasi ogni sito DUE VOLTE — come stazione `COMBINED`
 * (serie storica unita, id basso) e come `INDIVIDUAL` (strumento fisico, id
 * alto), con nome e quota identici e gli stessi identici valori. Al primo run
 * (5/8/2026) erano 184 coppie su 454 stazioni: le stazioni vere sono ~270.
 * Senza questo filtro la mappa disegnerebbe ogni pluviometro austriaco due
 * volte e l'IDW lo peserebbe il doppio — è il caso di S. Bernardino in
 * Svizzera, ma su scala industriale.
 *
 * Il criterio è FISICO (meno di 500 m), non il nome: i doppioni si scrivono
 * anche in modo leggermente diverso ("St.Jakob" contro "St. Jakob").
 * A parità di posizione si tiene la COMBINED, che ha la storia più lunga.
 */
async function buildStationList() {
  const meta = await getJson(`${API}/metadata`);
  const oggi = new Date().toISOString().slice(0, 10);
  const grezze = (meta.stations || [])
    .filter(s => s.valid_from && s.valid_from.slice(0, 10) <= oggi)
    .filter(s => !s.valid_to || s.valid_to.slice(0, 10) >= oggi)
    .filter(s => typeof s.lat === 'number' && typeof s.lon === 'number')
    .map(s => ({
      id:   String(s.id),
      n:    s.name,
      lat:  Math.round(s.lat * 100000) / 100000,
      lon:  Math.round(s.lon * 100000) / 100000,
      q:    s.altitude != null ? Math.round(s.altitude) : 0,
      p:    s.state || '',
      tipo: s.type || '',
      dal:  s.valid_from || '',
    }));

  const tenute = [];
  let scartate = 0;
  for (const s of grezze) {
    const gemella = tenute.find(t => distKm(t, s) < 0.5);
    if (!gemella) { tenute.push(s); continue; }
    scartate++;
    // meglio la COMBINED; a parità, quella con la storia più lunga
    const meglio = (s.tipo === 'COMBINED' && gemella.tipo !== 'COMBINED') ||
                   (s.tipo === gemella.tipo && s.dal < gemella.dal);
    if (meglio) tenute[tenute.indexOf(gemella)] = s;
  }
  console.log(`  Doppioni scartati: ${scartate} (stesso sito entro 500 m)`);
  return tenute.map(({ tipo, dal, ...s }) => s);
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
    source:    'geosphere-at',
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
  console.log('=== collect-austria-geosphere avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const stations = await buildStationList();
  console.log(`  Stazioni orarie attive in anagrafe: ${stations.length}`);
  if (stations.length < MIN_STAZ) throw new Error(`Troppo poche stazioni in anagrafe: ${stations.length}`);

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

  const minStart = Math.min(...windows.map(w => w.start));
  const maxEnd   = Math.max(...windows.map(w => w.end));
  const iso = ms => new Date(ms).toISOString().slice(0, 16);

  // ── Raccolta: una richiesta ogni BATCH stazioni, tutte le ore insieme ──
  const perDay = {};                       // dateStr -> [{...stazione, mm}]
  for (const w of windows) perDay[w.dateStr] = [];
  const byId = Object.fromEntries(stations.map(s => [s.id, s]));

  for (let i = 0; i < stations.length; i += BATCH) {
    const gruppo = stations.slice(i, i + BATCH);
    const url = `${API}?parameters=rr,tl,ff,ffx,rf&start=${iso(minStart + 3600000)}&end=${iso(maxEnd)}` +
                `&station_ids=${gruppo.map(s => s.id).join(',')}&output_format=geojson`;
    const j = await getJson(url);
    const ts = (j.timestamps || []).map(t => Date.parse(t));
    for (const f of (j.features || [])) {
      const id = String(f.properties.station);
      const st = byId[id];
      const P  = f.properties.parameters || {};
      const dati = P.rr && P.rr.data;
      if (!st || !dati) continue;
      const dTl  = (P.tl  && P.tl.data)  || [];
      const dFf  = (P.ff  && P.ff.data)  || [];
      const dFfx = (P.ffx && P.ffx.data) || [];
      const dRf  = (P.rf  && P.rf.data)  || [];   // umidità relativa % (18/8/2026)
      for (const w of windows) {
        let sum = 0, n = 0;
        let tmin = Infinity, tmax = -Infinity, nT = 0;
        let ffSum = 0, nFF = 0, fxMax = -Infinity, nFX = 0;
        let umin = Infinity, umax = -Infinity, nU = 0;
        for (let k = 0; k < ts.length; k++) {
          if (!(ts[k] > w.start && ts[k] <= w.end)) continue;
          const v = dati[k];
          if (v != null) { sum += v; n++; }
          const vt = dTl[k];   // sanity: fuori da [-45,50] °C è un glitch di sensore
          if (vt != null && vt >= -45 && vt <= 50) { if (vt < tmin) tmin = vt; if (vt > tmax) tmax = vt; nT++; }
          const vf = dFf[k];   // 60 m/s = 216 km/h di vento MEDIO orario: irreale
          if (vf != null && vf >= 0 && vf < 60) { ffSum += vf; nFF++; }
          const vx = dFfx[k];  // 90 m/s = 324 km/h di raffica: irreale anche in cresta
          if (vx != null && vx >= 0 && vx < 90) { if (vx > fxMax) fxMax = vx; nFX++; }
          const vu = dRf[k];
          if (vu != null && vu >= 0 && vu <= 100) { if (vu < umin) umin = vu; if (vu > umax) umax = vu; nU++; }
        }
        if (n < MIN_ORE) continue;
        const mm = Math.round(sum * 10) / 10;
        if (mm < 0 || mm > 500) continue;   // valore implausibile: si scarta
        const rec = { id: st.id, n: st.n, lat: st.lat, lon: st.lon, q: st.q, p: st.p, mm };
        if (nT >= MIN_ORE)  rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
        if (nFF >= MIN_ORE) rec.w = [Math.round(ffSum / nFF * 3.6 * 10) / 10,
                                     nFX > 0 ? Math.round(fxMax * 3.6 * 10) / 10 : null];
        if (nU >= MIN_ORE && umax > -Infinity) rec.u = [Math.round(umin), Math.round(umax)];
        perDay[w.dateStr].push(rec);
      }
    }
    console.log(`  batch ${i / BATCH + 1}/${Math.ceil(stations.length / BATCH)}: ${gruppo.length} stazioni`);
    await sleep(500);
  }

  let scritti = 0;
  for (const w of windows) if (writeDay(w.dateStr, perDay[w.dateStr])) scritti++;
  pulizia();
  console.log(`=== fine: ${scritti}/${windows.length} giorni scritti ===`);
  if (scritti === 0) process.exit(1);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
