/**
 * collect-lombardia.js  —  GitHub Actions
 * Raccoglie precipitazioni giornaliere Lombardia da ARPA Lombardia (Socrata)
 * e le salva in file JSON giornalieri, come le altre regioni.
 *
 * Prima la Lombardia era l'UNICA regione caricata live dal browser (query
 * Socrata a ogni visualizzazione): lenta sui periodi lunghi (~60 richieste per
 * 30 giorni) e dipendente da Socrata in tempo reale. Passando ai file:
 *   - il sito legge file già pronti (veloce come le altre regioni)
 *   - i sensori MORTI (offline, nessun dato quel giorno) non entrano nel file
 *   - se Socrata va giù, lo storico resta comunque in mappa
 *
 * Fonti Socrata (pubbliche, dati.lombardia.it):
 *   - nf78-nj6b : anagrafe sensori (idsensore, nomestazione, lat, lng, quota, provincia)
 *   - 647i-nhxk : misure. sum(valore) su un giorno raggruppata per sensore = totale mm
 */

const https = require('https');
const fs    = require('fs');
const { creaOre, segna, intensita } = require('./lib-intensita.js');
const { creaDir, segnaDir, direzione } = require('./lib-direzione.js');
const { tieniMeteo } = require('./lib-tieni-meteo.js');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'lombardia');
const HOST     = 'www.dati.lombardia.it';

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ⚠️ GLI ORARI DI SOCRATA SONO IN ORA SOLARE FISSA (UTC+1) TUTTO L'ANNO, con la marca a FINE dei 10 minuti
// (26/10/2026, scheda 95). Misurato contro MeteoHub dpcn-lombardia (UTC certo) il 19-22/10: ore di pioggia identiche nel
// 97% con questa lettura, 5-22% con tutte le altre. Fino al 26/10 si chiedeva «D 00:00:00 - D 23:59:59» in quegli
// orari: d'estate il giorno andava dalle 0:50 alle 0:50 italiane (la pioggia fra mezzanotte e le 0:50 finiva sul giorno
// prima), d'inverno era indietro di 10 minuti. Ora il giorno italiano di finestraGiorno, portato in ora solare, (inizio,
// fine] sulle marche: giusto anche nei giorni da 23 e 25 ore. Lo storico fino al 26/10 resta com'e' (sua decisione).
const { finestraGiorno } = require('./lib-giorno-italiano.js');
function finestraSocrata(dateStr) {
  const f = finestraGiorno(dateStr), solare = t => new Date(t + 3600000).toISOString().slice(0, 19);
  return `data > '${solare(f.start)}' AND data <= '${solare(f.end)}'`;
}

// App token di Socrata (secret SOCRATA_APP_TOKEN, app «MappaPluvio» sul profilo avventuremicologiche di
// dati.lombardia.it, creata il 13/10/2026): alza i limiti che da anonimi davano i 429. Senza, si va come prima.
const INTESTAZIONI = Object.assign({ 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)' },
  process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {});

function getJSON(pathQ, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      https.get({ host: HOST, path: pathQ, headers: INTESTAZIONI }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          // 429 = Socrata rifiuta le raffiche: si riprova piu' volte e con pause piu' lunghe (13/10/2026)
          if (res.statusCode === 429 && n < Math.max(retries, 5)) return setTimeout(() => attempt(n+1), 10000*n);
          if (res.statusCode !== 200) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); return reject(new Error(`HTTP ${res.statusCode}`)); }
          try { resolve(JSON.parse(data)); } catch(e) { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(new Error('JSON: '+e.message)); }
        });
      }).on('error', e => { if (n < retries) return setTimeout(() => attempt(n+1), 4000*n); reject(e); });
    };
    attempt(1);
  });
}

/** Anagrafe sensori pioggia: id -> {n, lat, lon, q, p, st (idstazione)}. */
async function fetchAnagrafe() {
  const where = encodeURIComponent("tipologia='Precipitazione'");
  const sel = encodeURIComponent('idsensore,idstazione,nomestazione,lat,lng,quota,provincia');
  const rows = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${sel}&$where=${where}`);
  const map = {};
  rows.forEach(r => {
    const lat = parseFloat(r.lat), lon = parseFloat(r.lng);
    if (!r.idsensore || isNaN(lat) || isNaN(lon)) return;
    map[r.idsensore] = { n: r.nomestazione || r.idsensore, lat: Math.round(lat*100000)/100000, lon: Math.round(lon*100000)/100000, q: parseInt(r.quota,10) || 0, p: r.provincia || '', st: r.idstazione || '' };
  });
  return map;
}

// ── Temperatura e vento (11/8/2026 — grafici stazione) ────────────────
// L'anagrafe ha anche sensori Temperatura (309, °C) e Velocità Vento
// (155, m/s → ×3,6); idstazione lega i sensori della stessa stazione
// fisica al pluviometro. La raffica NON esiste su Socrata → w[1] = null.
/** idstazione → idsensore per una tipologia (Temperatura / Velocità Vento). */
async function fetchSensoriMeteo(tipologia) {
  const where = encodeURIComponent(`tipologia='${tipologia}'`);
  const sel = encodeURIComponent('idsensore,idstazione');
  const rows = await getJSON(`/resource/nf78-nj6b.json?$limit=1000&$select=${sel}&$where=${where}`);
  const map = {};
  rows.forEach(r => { if (r.idsensore && r.idstazione && !map[r.idstazione]) map[r.idstazione] = r.idsensore; });
  return map;
}

/**
 * t/w per idstazione sul giorno dateStr. UNA query raggruppata per
 * (sensore, ora): così la completezza si misura in ORE COPERTE (≥ MIN_ORE
 * come le altre reti), a prescindere dalla granularità del sensore
 * (temperatura a 10 min, vento a 5). valore > -50 esclude i -999 di ARPA.
 */
const MIN_ORE_METEO = 20;
/**
 * ⚠️ `idoperatore` NON E' UN DETTAGLIO (corretto il 29/8/2026).
 * Socrata pubblica PIU' RIGHE per la stessa marca temporale sullo stesso
 * sensore, distinte da questo campo: **1 = media, 3 = massimo (la raffica)**.
 * Senza separarle, `avg(valore)` mescolava medie e raffiche: la velocita' del
 * vento usciva gonfiata del **70-90%** e la raffica finiva nel calderone
 * invece che nel campo `w[1]`.
 * Trovato col tornado di Cremona del 28/8/2026: «Cremona v.Gerre Borghi»
 * media vera 4,3 km/h, quella che scrivevamo 7,9, **raffica reale 118,4
 * km/h** — cioe' il giorno del tornado la mappa diceva «vento 7,9».
 * ⚠️ Le altre grandezze NON erano toccate, verificato: la Precipitazione ha
 * solo `idoperatore 4`, Temperatura e Umidita' solo `1`. La pioggia non e'
 * mai stata doppiata.
 */
async function fetchMeteoDay(dateStr, tempByStaz, windByStaz, umidByStaz) {
  const sel = encodeURIComponent('idsensore,idoperatore,date_extract_d(data) as d,date_extract_hh(data) as h,min(valore) as mn,max(valore) as mx,avg(valore) as med,count(valore) as c');
  const where = encodeURIComponent(`${finestraSocrata(dateStr)} AND valore > -50`);
  const rows = await getJSON(`/resource/647i-nhxk.json?$select=${sel}&$where=${where}&$group=${encodeURIComponent('idsensore,idoperatore,d,h')}&$limit=80000`);
  // sensore → operatore → una riga per ora
  const perSens = {};
  rows.forEach(r => {
    const s = (perSens[r.idsensore] = perSens[r.idsensore] || {});
    (s[r.idoperatore] = s[r.idoperatore] || []).push(r);
  });
  const tempSens = {}, windSens = {}, umidSens = {};
  Object.keys(tempByStaz).forEach(st => tempSens[tempByStaz[st]] = st);
  Object.keys(windByStaz).forEach(st => windSens[windByStaz[st]] = st);
  Object.keys(umidByStaz || {}).forEach(st => umidSens[umidByStaz[st]] = st);
  const out = {};
  Object.keys(perSens).forEach(id => {
    const ore    = perSens[id]['1'] || [];   // la MEDIA: e' quella che si legge
    const oreMax = perSens[id]['3'] || [];   // il MASSIMO: la raffica
    if (ore.length < MIN_ORE_METEO) return;
    if (tempSens[id]) {
      // ⚠️ FALSI ZERI (3/10/2026): Socrata a volte ha UNA lettura a 0,0 in mezzo a
      // letture vere (Valdisotto Arginone 30/9: 0,0 alle 21:30, tutte le altre
      // sopra i 10°, e ARPA la segna «VA»). Un'ora con la minima esattamente 0 e
      // la media sopra i 3° non esiste: la minima di quell'ora si scarta (la
      // massima resta). 10 minime false in agosto-settembre.
      const mins = ore.filter(o => !(parseFloat(o.mn) === 0 && parseFloat(o.med) > 3))
        .map(o => parseFloat(o.mn)).filter(v => v >= -45 && v <= 50);
      const maxs = ore.map(o => parseFloat(o.mx)).filter(v => v >= -45 && v <= 50);
      if (mins.length >= MIN_ORE_METEO && maxs.length) {
        const st = tempSens[id];
        (out[st] = out[st] || {}).t = [Math.round(Math.min(...mins) * 10) / 10,
                                       Math.round(Math.max(...maxs) * 10) / 10];
      }
    }
    if (windSens[id]) {
      const medie = ore.map(o => parseFloat(o.med)).filter(v => v >= 0 && v < 60); // m/s
      if (medie.length >= MIN_ORE_METEO) {
        const st = windSens[id];
        // La raffica e' il massimo della giornata fra le righe `idoperatore 3`.
        // Se quella serie manca o e' bucata resta null, come prima: meglio
        // nessuna raffica che una raffica presa da mezza giornata.
        const raff = oreMax.map(o => parseFloat(o.mx)).filter(v => v >= 0 && v < 60);
        (out[st] = out[st] || {}).w = [
          Math.round(medie.reduce((a, v) => a + v, 0) / medie.length * 3.6 * 10) / 10,
          raff.length >= MIN_ORE_METEO ? Math.round(Math.max(...raff) * 3.6 * 10) / 10 : null];
      }
    }
    // Umidità relativa (18/8/2026): sensori «Umidità Relativa» (220), stessa query oraria.
    if (umidSens[id]) {
      const mins = ore.map(o => parseFloat(o.mn)).filter(v => v >= 0 && v <= 100);
      const maxs = ore.map(o => parseFloat(o.mx)).filter(v => v >= 0 && v <= 100);
      if (mins.length >= MIN_ORE_METEO && maxs.length) {
        const st = umidSens[id];
        (out[st] = out[st] || {}).u = [Math.round(Math.min(...mins)), Math.round(Math.max(...maxs))];
      }
    }
  });
  return out;
}

/**
 * DIREZIONE DEL VENTO (2/10/2026). Sensori «Direzione Vento» (155, gradi a 10').
 * ⚠️ NON si usa l'avg(valore) orario di Socrata: e' la media dei GRADI, e 350° e
 * 10° fanno 180°, cioe' l'opposto. Si chiedono i valori GREZZI di direzione e
 * velocita' (`idoperatore 1`, la media dei 10'; il 3 e' la raffica) in UNA query
 * per giorno, e la media vettoriale pesata sulla velocita' la fa lib-direzione.js.
 * ~45.000 righe (310 sensori x 144), sotto il tetto di 80.000.
 */
let DIR_BY_STAZ = null;   // idstazione -> idsensore direzione, riempito in main()
async function fetchDirezioneDay(dateStr, windByStaz) {
  if (!DIR_BY_STAZ || !windByStaz) return {};
  const coppie = Object.keys(DIR_BY_STAZ).filter(st => windByStaz[st]);
  if (!coppie.length) return {};
  const ids = [];
  coppie.forEach(st => { ids.push(DIR_BY_STAZ[st], windByStaz[st]); });
  const where = encodeURIComponent(`${finestraSocrata(dateStr)} AND idoperatore='1' AND valore > -50 AND idsensore in (${ids.map(i => `'${i}'`).join(',')})`);
  const rows = await getJSON(`/resource/647i-nhxk.json?$select=${encodeURIComponent('idsensore,data,valore')}&$where=${where}&$limit=80000`);
  const perSens = {};
  rows.forEach(r => { (perSens[r.idsensore] = perSens[r.idsensore] || {})[r.data] = parseFloat(r.valore); });
  const out = {};
  coppie.forEach(st => {
    const dir = perSens[DIR_BY_STAZ[st]] || {}, vel = perSens[windByStaz[st]] || {};
    const acc = creaDir();
    Object.keys(vel).forEach(t => {
      const v = vel[t];
      if (!(v >= 0 && v < 60)) return;
      segnaDir(acc, t.slice(0, 13), dir[t] !== undefined ? dir[t] : null, v);
    });
    const wd = direzione(acc);
    if (wd !== null) out[st] = wd;
  });
  return out;
}

/** Totale giornaliero per sensore per il giorno dateStr (YYYY-MM-DD). */
async function fetchDay(dateStr, anagrafe, tempByStaz, windByStaz, umidByStaz) {
  const where = encodeURIComponent(`${finestraSocrata(dateStr)} AND valore >= '0'`);
  const sel = encodeURIComponent('idsensore,date_extract_d(data) as d,date_extract_hh(data) as h,sum(valore) as s');
  const orarie = await getJSON(`/resource/647i-nhxk.json?$select=${sel}&$where=${where}&$group=${encodeURIComponent('idsensore,d,h')}&$limit=80000`);
  // Dalle righe orarie si ricava sia il totale del giorno sia l'intensita'.
  const perSensore = {};
  orarie.forEach(r => {
    const a = perSensore[r.idsensore] = perSensore[r.idsensore] || { s: 0, ore: creaOre() };
    const v = parseFloat(r.s);
    if (!isFinite(v)) return;
    a.s += v;
    segna(a.ore, r.d + ' ' + r.h, v);   // giorno e ora: la finestra tocca due date di Socrata
  });
  const rows = Object.keys(perSensore).map(id => ({ idsensore: id, s: perSensore[id].s }));
  // t/w in un try: un guasto della query meteo non tocca mai la pioggia
  let meteo = {}, meteoKo = false, direzioneKo = false;
  if (tempByStaz) {
    try { meteo = await fetchMeteoDay(dateStr, tempByStaz, windByStaz, umidByStaz); }
    catch (e) { meteoKo = true; console.warn(`  Warn meteo ${dateStr}: ${e.message}`); }
    try {
      await sleep(1000);   // Socrata limita le raffiche di richieste (429): un respiro prima della query in piu'
      const wd = await fetchDirezioneDay(dateStr, windByStaz);
      Object.keys(wd).forEach(st => { if (meteo[st] && meteo[st].w) meteo[st].wd = wd[st]; });
    } catch (e) { direzioneKo = true; console.warn(`  Warn direzione ${dateStr}: ${e.message}`); }
  }
  const stations = [];
  rows.forEach(r => {
    const meta = anagrafe[r.idsensore];
    if (!meta) return;                       // non è un sensore pioggia (o non in anagrafe)
    let mm = Math.round((parseFloat(r.s) || 0) * 10) / 10;
    if (mm < 0 || mm > 500) return;          // sanity per giorno singolo
    const rec = { id: r.idsensore, n: meta.n, lat: meta.lat, lon: meta.lon, q: meta.q, p: meta.p, mm };
    const inte = intensita(perSensore[r.idsensore].ore);
    if (inte) rec.i = inte;
    if (meta.st && meteo[meta.st]) Object.assign(rec, meteo[meta.st]);
    stations.push(rec);
  });
  stations.meteoKo = meteoKo; stations.direzioneKo = direzioneKo;   // li legge writeDay
  return stations;
}

function writeDay(dateStr, stations) {
  if (stations.length < 50) { console.warn(`  ${dateStr}: solo ${stations.length} sensori, salto (query incompleta?)`); return false; }
  const outFile = path.join(DATA_DIR, `${dateStr}.json`);
  // Merge protezione: se esiste già un file con più sensori, non sovrascrivere al ribasso
  if (fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (prev.stations && prev.stations.length > stations.length * 1.2) {
        console.warn(`  ${dateStr}: esistente ha ${prev.stations.length} sensori vs ${stations.length}, non sovrascrivo`);
        return false;
      }
      /* ⚠️ QUERY METEO FALLITA = SI TENGONO I VALORI GIA' NEL FILE (13/10/2026). Se Socrata rifiutava (429) la
         sola query di temperatura/vento/umidita', il file si riscriveva con la pioggia e basta e cancellava quello
         che i giri prima avevano salvato: l'11/10 e' passato da 231 stazioni con la temperatura a 0 all'ultimo
         giro utile, e l'ha visto check-campi. Ora, stazione per stazione, i campi della query fallita si
         riprendono dal file esistente dello stesso giorno.
         ⚠️ DAL 19/10/2026 (quinto check, bug 6) VALE SEMPRE, non solo con la query fallita: se cadeva l'ANAGRAFE
         dei sensori meteo o della direzione la query non partiva nemmeno, nessun errore, e i campi sparivano lo
         stesso (6/10: 122 direzioni perse l'8/10 alle 17:51, mai tornate). Regola in lib-tieni-meteo.js. */
      const ripresi = tieniMeteo(stations, prev.stations);
      if (ripresi) console.warn(`  ${dateStr}: t/w/u/wd mancanti a questo giro (${stations.meteoKo ? 'query meteo fallita' : stations.direzioneKo ? 'query direzione fallita' : 'nessun errore'}), ripresi dal file per ${ripresi} stazioni`);
    } catch(e) {}
  }
  fs.writeFileSync(outFile, JSON.stringify({ date: dateStr, collected: new Date().toISOString(), source: 'arpa-lombardia-socrata', count: stations.length, stations }));
  console.log(`  ✅ ${dateStr}: ${stations.length} sensori`);
  return true;
}

async function main() {
  console.log('=== collect-lombardia avviato ===');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const anagrafe = await fetchAnagrafe();
  console.log(`  Anagrafe: ${Object.keys(anagrafe).length} sensori pioggia`);
  if (Object.keys(anagrafe).length < 50) throw new Error('Anagrafe troppo piccola');
  let tempByStaz = null, windByStaz = null, umidByStaz = null;
  try {
    tempByStaz = await fetchSensoriMeteo('Temperatura');
    windByStaz = await fetchSensoriMeteo('Velocità Vento');
    umidByStaz = await fetchSensoriMeteo('Umidità Relativa');
    try { DIR_BY_STAZ = await fetchSensoriMeteo('Direzione Vento'); } catch (e) { console.warn('  Warn anagrafe direzione: ' + e.message); }
    console.log(`  Sensori meteo: ${Object.keys(tempByStaz).length} temperatura, ${Object.keys(windByStaz).length} vento, ${Object.keys(umidByStaz).length} umidità`);
  } catch (e) { console.warn('  Warn anagrafe meteo: ' + e.message); }

  // Giorni bersaglio: DATE_OVERRIDE (uno o "A:B" range) oppure ieri + altroieri
  let targetDays = [];
  const ov = (process.env.DATE_OVERRIDE || '').trim();
  if (ov.includes(':')) {
    const [a, b] = ov.split(':');
    let d = new Date(a + 'T12:00:00Z'), end = new Date(b + 'T12:00:00Z');
    while (d <= end) { targetDays.push(fmtDate(d)); d = new Date(d.getTime() + 86400000); }
  } else if (ov) {
    targetDays = [ov];
  } else {
    const now = new Date();
    const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
    const noon = new Date(fmtDate(italyNow) + 'T12:00:00Z').getTime();
    targetDays = [1, 2].map(i => fmtDate(new Date(noon - i * 86400000)));   // ieri + altroieri
  }

  for (const dStr of targetDays) {
    try { writeDay(dStr, await fetchDay(dStr, anagrafe, tempByStaz, windByStaz, umidByStaz)); }
    catch(e) { console.warn(`  Warn ${dStr}: ${e.message}`); }
    await sleep(500);
  }

  // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
  const MAX_DAYS = 730;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  let deleted = 0;
  fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .forEach(f => { if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; } });
  if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file eliminati`);

  console.log('=== collect-lombardia completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
