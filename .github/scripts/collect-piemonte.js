/**
 * collect-piemonte.js — v2 (17 agosto 2026, in prova nel repo di TEST)
 *
 * Due fonti ARPA Piemonte, stesso ente, due usi diversi:
 *   1. api_realtime  (/pie_anag + /data_pie): record ORARI, tenuti ~4 giorni.
 *      È la fonte del valore in mappa: sum(cum_rain_1h) sul GIORNO SOLARE
 *      ITALIANO, come tutte le altre regioni del progetto.
 *   2. meteoidro (banca dati storica): totali GIORNALIERI VALIDATI, disponibili
 *      già per ieri (verificato il 17/8: latest_date = ieri), una sola chiamata
 *      per tutte le stazioni di un giorno. Porta anche tmin/tmax, vento medio e
 *      raffica (m/s), e l'anagrafica ha QUOTA e coordinate.
 *
 * ⚠️ IL GIORNO UFFICIALE È IN UTC (misurato il 17/8/2026 su Crodo, Druogno e
 * Cursolo: il giorno G dell'archivio = record locali dalle 03:00 di G alle 02:00
 * di G+1 in ora legale, cioè il giorno di calendario UTC con marca a FINE ora).
 * NON si adotta: il progetto usa il giorno solare italiano ovunque (Svizzera,
 * Austria, OSMER, Francia hanno scartato apposta le finestre ufficiali), e
 * spostare il solo Piemonte di due ore creerebbe una cucitura col resto della
 * mappa sui temporali notturni. Quindi l'ufficiale NON sostituisce il nostro
 * valore quando il nostro è completo: le differenze da giorno UTC (pioggia fra
 * le 00 e le 02) sono attese e si loggano soltanto.
 *
 * Cosa fa questa versione, rispetto alla precedente:
 *  - ricalcola dal realtime D-1, D-2 e D-3 (non solo ieri) — l'API tiene 4
 *    giorni — e per ogni stazione scrive `h` = ore valide di pioggia; il merge
 *    non è più «MAX» ma «vince chi ha più ore»: il MAX poteva solo sottostimare
 *    o congelare, questo converge al giorno completo;
 *  - passata UFFICIALE su D-1..D-3: (a) stazioni che il realtime non pubblica
 *    (o non pubblica quel giorno) → aggiunte con il totale ufficiale, marcate
 *    `src:'arpa-ufficiale'`; (b) stazioni con realtime INCOMPLETO (h<24) e valore
 *    diverso oltre 1 mm → sostituite con l'ufficiale (le "perdite vere" tipo
 *    Rifugio Mondovì 11/8: 29,4 nostri contro 57,4 ufficiali); (c) t/w presi
 *    dall'ufficiale dove i nostri mancano (t:[tmin,tmax], w:[vmedia,vraffica]
 *    ×3,6 — l'ufficiale è in m/s, verificato: rapporto 3,60 sulla raffica);
 *    (d) quota `q` da anagrafica ufficiale per TUTTE le stazioni (prima 0);
 *    (e) tutto il resto loggato (stampa `CONFRONTO`) per misurare in test;
 *  - giunzione per `codice_stazione` (= station_code del realtime), verificata
 *    273/273 il 17/8, zero nomi o coordinate diverse. MAI per nome.
 *  - `DRY_RUN=1`: fa tutto ma non scrive nessun file (per provare in locale).
 *
 * Il file di OGGI resta come prima (solo realtime, senza ufficiale: non esiste
 * ancora). Retention 730 giorni invariata.
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'piemonte');
const MAX_DAYS = 730;
const API_BASE = 'https://utility.arpa.piemonte.it/api_realtime';
const OFF_BASE = 'https://utility.arpa.piemonte.it/meteoidro';
const RICALCOLA_GIORNI = 3;          // D-1..D-3 dal realtime + ufficiale
const DRY_RUN = !!process.env.DRY_RUN;
const SOGLIA_SOST_MM = 1;            // sostituisci solo se |nostro-ufficiale| > 1 mm e h<24

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

function todayItaly() {
  const now = new Date();
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  return italy.toISOString().substring(0, 10);
}

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    return process.env.DATE_OVERRIDE.trim();
  }
  return todayItaly();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (mappa-precipitazioni)' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  tentativo ${i+1}/${retries} fallito: ${e.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('fetch fallito dopo ' + retries + ' tentativi');
}

// ── Realtime: record orari di un giorno solare italiano ─────────────
async function fetchRealtimeDay(day) {
  let all = [];
  let page = 1;
  while (true) {
    const url = API_BASE + '/data_pie?date_from=' + encodeURIComponent(day + 'T00:00')
      + '&date_to=' + encodeURIComponent(day + 'T23:59')
      + '&page=' + page + '&page_size=10000';
    const raw = await fetchJSON(url);
    const records = Array.isArray(raw) ? raw : (raw.data || raw.results || []);
    all = all.concat(records);
    if (records.length < 10000) break;
    page++;
  }
  return all;
}

// Temperatura e vento dal realtime (11/8/2026): wind/gust GIÀ in km/h.
const MIN_ORE_METEO = 20;
function aggregaMeteoPie(records) {
  const acc = {};
  records.forEach(m => {
    const id = m.station_code;
    if (!id) return;
    const a = acc[id] = acc[id] || { tmin: Infinity, tmax: -Infinity, nT: 0, ffSum: 0, nFF: 0, fxMax: -Infinity, nFX: 0 };
    const t = parseFloat(m.air_temperature);
    if (!isNaN(t) && t >= -45 && t <= 50) { if (t < a.tmin) a.tmin = t; if (t > a.tmax) a.tmax = t; a.nT++; }
    const ff = parseFloat(m.wind);
    if (!isNaN(ff) && ff >= 0 && ff < 216) { a.ffSum += ff; a.nFF++; }
    const fx = parseFloat(m.gust_of_wind);
    if (!isNaN(fx) && fx >= 0 && fx < 324) { if (fx > a.fxMax) a.fxMax = fx; a.nFX++; }
  });
  const out = {};
  Object.keys(acc).forEach(id => {
    const a = acc[id], m = {};
    if (a.nT >= MIN_ORE_METEO && a.tmax > -Infinity)
      m.t = [Math.round(a.tmin * 10) / 10, Math.round(a.tmax * 10) / 10];
    if (a.nFF >= MIN_ORE_METEO)
      m.w = [Math.round(a.ffSum / a.nFF * 10) / 10,
             a.nFX > 0 ? Math.round(a.fxMax * 10) / 10 : null];
    if (m.t || m.w) out[id] = m;
  });
  return out;
}

/** Dai record orari di un giorno → lista stazioni {id,n,lat,lon,q,p,mm,h,t?,w?}. */
function buildDay(records, stIndex, quote) {
  const rain = {}, ore = {};
  records.forEach(m => {
    const id = m.station_code;
    if (!id) return;
    const v = parseFloat(m.cum_rain_1h);
    if (isNaN(v) || v < 0) return;
    rain[id] = (rain[id] || 0) + v;
    ore[id] = (ore[id] || 0) + 1;
  });
  const meteo = aggregaMeteoPie(records);
  const out = [];
  Object.keys(rain).forEach(id => {
    const s = stIndex[id];
    if (!s) return;
    const lat = parseFloat(s.lat);
    const lon = parseFloat(s.lng || s.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    if (lat < 43.8 || lat > 46.5 || lon < 6.6 || lon > 9.3) return;
    let mm = Math.round(rain[id] * 10) / 10;
    if (mm > 300) mm = 0;
    const rec = {
      id, n: s.name || id,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q: (quote && quote[id] != null) ? quote[id] : (parseInt(s.altitude || 0) || 0),
      p: s.province || '—',
      mm,
      h: Math.min(24, ore[id])
    };
    if (meteo[id]) Object.assign(rec, meteo[id]);
    out.push(rec);
  });
  return out;
}

// ── Ufficiale: anagrafica (una volta) e giornaliero (una chiamata/giorno) ──
/** id realtime → {q, lat, lon, n, p} dall'anagrafica ufficiale (stazioni attive). */
async function fetchAnagraficaUfficiale() {
  const out = {};
  let url = OFF_BASE + '/stazione_meteorologica/?page_size=1000';
  while (url) {
    const j = await fetchJSON(url);
    (j.results || []).forEach(s => {
      if (s.data_fine) return;                       // dismessa
      const id = String(s.codice_stazione || '').trim();
      if (!id) return;
      out[id] = {
        q: (s.quota_stazione != null) ? Math.round(s.quota_stazione) : null,
        lat: s.latitudine_n_wgs84_d, lon: s.longitudine_e_wgs84_d,
        n: s.denominazione, p: s.sigla_prov ? ('PROVINCIA DI ' + provinciaEstesa(s.sigla_prov)) : '—',
        pm: (s.fk_id_punto_misura_meteo || '').replace(/\/$/, '').split('/').pop()  // PIE-xxxxxx-900
      };
    });
    url = j.next || null;
  }
  return out;
}
function provinciaEstesa(sigla) {
  return { TO: 'TORINO', CN: 'CUNEO', AL: 'ALESSANDRIA', AT: 'ASTI', BI: 'BIELLA',
           NO: 'NOVARA', VC: 'VERCELLI', VB: 'VERBANO-CUSIO-OSSOLA' }[sigla] || sigla;
}

/** giorno → { PIE-xxxxxx-900: {ptot,tmin,tmax,vmedia,vraffica} } (solo righe con almeno un dato). */
async function fetchUfficialeGiorno(day) {
  const out = {};
  let url = OFF_BASE + '/dati_giornalieri_meteo/?data_min=' + day + '&data_max=' + day + '&page_size=1000';
  let n = 0;
  while (url) {
    const j = await fetchJSON(url);
    (j.results || []).forEach(r => {
      const pm = (r.fk_id_punto_misura_meteo || '').replace(/\/$/, '').split('/').pop();
      if (!pm) return;
      out[pm] = { ptot: r.ptot, tmin: r.tmin, tmax: r.tmax, vmedia: r.vmedia, vraffica: r.vraffica };
      n++;
    });
    url = j.next || null;
  }
  return { rows: out, n };
}

/**
 * Applica l'ufficiale al giorno: stazioni mancanti aggiunte, realtime incompleto
 * corretto, t/w riempiti. Restituisce {stations, stat} — non scrive.
 */
function consolida(day, stations, anag, uff) {
  const byId = {};
  stations.forEach(s => { byId[s.id] = s; });
  const pmToId = {};
  Object.keys(anag).forEach(id => { if (anag[id].pm) pmToId[anag[id].pm] = id; });

  const stat = { aggiunte: 0, zeriNonAggiunti: 0, sostituite: 0, tw: 0, diffAttese: 0, uguali: 0, senzaAnag: 0, dettagli: [] };
  Object.keys(uff.rows).forEach(pm => {
    const u = uff.rows[pm];
    const id = pmToId[pm];
    if (!id) { stat.senzaAnag++; return; }
    const a = anag[id];
    const mine = byId[id];
    const ptot = (u.ptot == null) ? null : Math.round(u.ptot * 10) / 10;

    if (!mine) {
      // Stazione che il realtime non ha (mai, o non quel giorno): entra dall'ufficiale.
      // ⚠️ SOLO se ha il pluviometro E quel giorno segna pioggia: una stazione
      // solo-termometro scritta con mm=0, o un pluviometro fermo che l'archivio
      // scrive come zero (Omegna Lago d'Orta ad agosto 2026: 1,6 mm in 16 giorni
      // con Cicogna a 50 mm il 16/8), sarebbe un falso punto asciutto per l'IDW e
      // per il veto locale. Di queste stazioni non abbiamo il realtime per capire
      // se il sensore vive: gli zeri restano fuori (loggati), la pioggia entra.
      if (ptot == null) return;
      if (ptot <= 0) { stat.zeriNonAggiunti++; stat.dettagli.push(`0 ${a.n} (${id}) ptot=0, non aggiunta`); return; }
      if (a.lat == null || a.lon == null) return;
      if (a.lat < 43.8 || a.lat > 46.5 || a.lon < 6.6 || a.lon > 9.3) return;
      const rec = { id, n: a.n, lat: Math.round(a.lat * 10000) / 10000, lon: Math.round(a.lon * 10000) / 10000,
                    q: a.q != null ? a.q : 0, p: a.p, mm: ptot, h: 24, src: 'arpa-ufficiale' };
      if (u.tmin != null && u.tmax != null) rec.t = [u.tmin, u.tmax];
      if (u.vmedia != null) rec.w = [Math.round(u.vmedia * 36) / 10, u.vraffica != null ? Math.round(u.vraffica * 36) / 10 : null];
      stations.push(rec); byId[id] = rec;
      stat.aggiunte++;
      stat.dettagli.push(`+ ${a.n} (${id}) ptot=${ptot}`);
      return;
    }

    // Quota ufficiale su tutte
    if (a.q != null) mine.q = a.q;

    // Pioggia
    if (ptot != null) {
      const diff = Math.abs((mine.mm || 0) - ptot);
      if (diff <= SOGLIA_SOST_MM) stat.uguali++;
      else if ((mine.h || 0) < 24) {
        stat.dettagli.push(`~ ${mine.n} (${id}) h=${mine.h} nostro=${mine.mm} → ufficiale=${ptot}`);
        mine.mm = ptot; mine.src = 'arpa-ufficiale';
        stat.sostituite++;
      } else {
        // realtime completo e valore diverso: quasi sempre pioggia fra le 00 e le 02
        // (giorno UTC ufficiale). Attesa, non si tocca. Loggata per misurare.
        stat.diffAttese++;
        stat.dettagli.push(`= ${mine.n} (${id}) h=24 nostro=${mine.mm} ufficiale=${ptot} (Δ${(mine.mm - ptot).toFixed(1)}, atteso da giorno UTC)`);
      }
    }
    // Temperatura e vento dove mancano
    let tw = false;
    if (!mine.t && u.tmin != null && u.tmax != null) { mine.t = [u.tmin, u.tmax]; tw = true; }
    if (!mine.w && u.vmedia != null) { mine.w = [Math.round(u.vmedia * 36) / 10, u.vraffica != null ? Math.round(u.vraffica * 36) / 10 : null]; tw = true; }
    if (tw) stat.tw++;
  });
  return { stations, stat };
}

/** Merge fra file esistente e nuovo calcolo realtime: vince chi ha più ore. */
function mergePerOre(nuove, esistenti) {
  const map = {};
  (esistenti || []).forEach(s => { map[s.id || s.n] = s; });
  const out = nuove.map(s => {
    const prev = map[s.id || s.n];
    if (!prev) return s;
    delete map[s.id || s.n];
    if ((prev.h || 0) > (s.h || 0)) return prev;      // il vecchio aveva più ore: tienilo
    // stesse ore o più: il nuovo comanda, ma non perdere t/w già presenti
    const m = { ...s };
    if (!m.t && prev.t) m.t = prev.t;
    if (!m.w && prev.w) m.w = prev.w;
    return m;
  });
  // stazioni che erano nel vecchio file e nel nuovo realtime non ci sono (es. aggiunte dall'ufficiale)
  Object.keys(map).forEach(k => { out.push(map[k]); });
  return out;
}

function leggiFile(day) {
  const f = path.join(DATA_DIR, day + '.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
function scriviFile(day, stations, extra) {
  const f = path.join(DATA_DIR, day + '.json');
  const data = Object.assign({ date: day, collected: new Date().toISOString(), count: stations.length, stations }, extra || {});
  if (DRY_RUN) { console.log(`  [DRY_RUN] non scrivo ${f} (${stations.length} stazioni)`); return; }
  fs.writeFileSync(f, JSON.stringify(data), 'utf8');
}

async function main() {
  const targetDate = getTargetDate();
  console.log('\n=== Raccolta dati Piemonte per ' + targetDate + (DRY_RUN ? ' [DRY_RUN]' : '') + ' ===\n');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Step 1: anagrafica realtime ─────────────────────────────
  console.log('Carico anagrafica stazioni (realtime)...');
  const anagRaw = await fetchJSON(API_BASE + '/pie_anag?page_size=10000');
  const stazioni = Array.isArray(anagRaw) ? anagRaw : (anagRaw.data || anagRaw.results || []);
  const stIndex = {};
  stazioni.forEach(s => { if (s.station_code) stIndex[s.station_code] = s; });
  console.log('  Stazioni realtime: ' + stazioni.length);

  // ── Step 1b: anagrafica ufficiale (quota, coordinate) — se cade, si va avanti senza ──
  let anagUff = {};
  try {
    anagUff = await fetchAnagraficaUfficiale();
    console.log('  Stazioni ufficiali attive: ' + Object.keys(anagUff).length);
  } catch (e) { console.warn('  Anagrafica ufficiale non disponibile: ' + e.message); }
  const quote = {};
  Object.keys(anagUff).forEach(id => { if (anagUff[id].q != null) quote[id] = anagUff[id].q; });

  // ── Step 2: OGGI dal realtime ────────────────────────────────
  console.log('Carico misure di oggi ' + targetDate + '...');
  const recOggi = await fetchRealtimeDay(targetDate);
  console.log('  Record: ' + recOggi.length);
  const oggi = buildDay(recOggi, stIndex, quote);
  console.log('  Stazioni con dati: ' + oggi.length);
  if (oggi.length < 5) {
    console.warn('Poche stazioni oggi (' + oggi.length + '), salto il salvataggio di oggi.');
  } else {
    scriviFile(targetDate, oggi);
    console.log('Salvato oggi: ' + targetDate + ' (' + oggi.length + ' stazioni)');
  }

  // ── Step 3: D-1..D-3 — realtime ricalcolato + ufficiale ─────
  if (!process.env.DATE_OVERRIDE || process.env.RICALCOLA_ANCHE_CON_OVERRIDE) {
    for (let k = 1; k <= RICALCOLA_GIORNI; k++) {
      const day = addDays(targetDate, -k);
      console.log('\n— Giorno D-' + k + ' = ' + day);
      let stations = null;
      const esistente = leggiFile(day);
      try {
        const rec = await fetchRealtimeDay(day);
        console.log('  Record realtime: ' + rec.length);
        if (rec.length < 1000) {
          console.log('  Troppo pochi record (' + rec.length + '): tengo il file esistente.');
          stations = esistente ? esistente.stations : null;
        } else {
          const nuove = buildDay(rec, stIndex, quote);
          stations = mergePerOre(nuove, esistente ? esistente.stations : []);
          const complete = stations.filter(s => (s.h || 0) >= 24).length;
          console.log('  Realtime: ' + nuove.length + ' stazioni, ' + complete + ' con 24 ore; dopo merge ' + stations.length);
        }
      } catch (e) {
        console.warn('  Realtime non disponibile per ' + day + ': ' + e.message);
        stations = esistente ? esistente.stations : null;
      }
      if (!stations || stations.length < 5) { console.log('  Niente da scrivere per ' + day); continue; }

      // Ufficiale
      let extra = {};
      try {
        const uff = await fetchUfficialeGiorno(day);
        if (uff.n === 0) {
          console.log('  Ufficiale: non ancora pubblicato per ' + day);
        } else {
          const r = consolida(day, stations, anagUff, uff);
          stations = r.stations;
          const s = r.stat;
          console.log(`  UFFICIALE ${day}: ${uff.n} righe · aggiunte ${s.aggiunte} (zeri esclusi ${s.zeriNonAggiunti}) · sostituite ${s.sostituite} · t/w riempiti ${s.tw} · uguali(≤1mm) ${s.uguali} · diff attese(h=24) ${s.diffAttese} · senza anagrafica ${s.senzaAnag}`);
          s.dettagli.slice(0, 40).forEach(d => console.log('    ' + d));
          if (s.dettagli.length > 40) console.log('    … altre ' + (s.dettagli.length - 40));
          extra = { ufficiale: { letto: new Date().toISOString(), aggiunte: s.aggiunte, sostituite: s.sostituite, tw: s.tw } };
        }
      } catch (e) { console.warn('  Ufficiale non disponibile: ' + e.message); }

      scriviFile(day, stations, extra);
      console.log('  Scritto ' + day + ' (' + stations.length + ' stazioni)');
    }
  }

  // ── Step 4: pulizia file > 730 giorni ────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json', '') < cutoffStr) { if (!DRY_RUN) fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; }
  });
  console.log('\nPulizia: ' + deleted + ' eliminati, ' + (allFiles.length - deleted) + ' rimanenti');
  console.log('\n=== Completato! ===\n');
}

main().catch(function(e) {
  console.error('Errore fatale:', e);
  process.exit(1);
});
