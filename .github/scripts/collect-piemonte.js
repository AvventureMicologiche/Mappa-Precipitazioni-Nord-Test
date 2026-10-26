/**
 * collect-piemonte.js — v2 (17 agosto 2026, in prova nel test; IN PRODUZIONE dal 18 agosto 2026)
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
const { creaOre, segna, intensita } = require('./lib-intensita.js');
const { creaDir, segnaDir, direzione, daSettore } = require('./lib-direzione.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'piemonte');
const MAX_DAYS = 730;
// ⚠️ DUE STRADE PER ARPA PIEMONTE, LA SCEGLIE OGNI GIRO (24/10/2026). Dalla sera del 23/10 ARPA non risponde piu'
// ai runner di GitHub («fetch failed» gia' sull'anagrafica), dal PC si' in 0,2 s: lo stesso blocco di OMIRL in
// Liguria, che risponde solo dall'Italia. Il workflow passa TRAMITE_URL (il worker omirl-tramite, fissato a Milano,
// copia in .github/cloudflare/omirl-tramite.js) e TRAMITE_CHIAVE. L'anagrafica si chiede PRIMA DIRETTA (un solo
// tentativo, 15 s), e solo se non risponde dal tramite (`scegliStrada`): il giorno che ARPA sblocca GitHub si torna
// diretti da soli. Senza le due variabili, cioe' dal PC, si va solo diretti. Ogni indirizzo passa da `instrada`,
// anche i `next` dell'archivio ufficiale, che arrivano con l'host diretto scritto dentro.
// ARPA_DIRETTO serve solo alle prove: un indirizzo che non risponde finge il blocco.
const ARPA_HOST = 'https://utility.arpa.piemonte.it';
const ARPA_DIRETTO = (process.env.ARPA_DIRETTO || ARPA_HOST).replace(/\/$/, '');
const TRAMITE_URL = (process.env.TRAMITE_URL || '').replace(/\/$/, '');
const TRAMITE_CHIAVE = process.env.TRAMITE_CHIAVE || '';
let viaTramite = false;              // lo accende scegliStrada
const API_BASE = ARPA_HOST + '/api_realtime';
const OFF_BASE = ARPA_HOST + '/meteoidro';
function instrada(url) {
  return url.indexOf(ARPA_HOST) === 0 ? (viaTramite ? TRAMITE_URL : ARPA_DIRETTO) + url.slice(ARPA_HOST.length) : url;
}
const RICALCOLA_GIORNI = 3;          // D-1..D-3 dal realtime + ufficiale
const DRY_RUN = !!process.env.DRY_RUN;
const SOGLIA_SOST_MM = 1;            // sostituisci solo se |nostro-ufficiale| > 1 mm e h<24
const MAX_ORA_MM = 150;              // un'ora sopra questo e' un guasto, non pioggia: si scarta l'ora (bug 4, 19/10/2026)
const SOGLIA_UFF_SEMPRE_MM = 300;    // giorno eccezionale: vince l'ufficiale anche con h=24 (bug 4, 19/10/2026)

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

async function fetchJSON(url, retries = 3, tetto = 30000) {
  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (mappa-precipitazioni)' };
  if (viaTramite) headers['X-Chiave'] = TRAMITE_CHIAVE;
  url = instrada(url);
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(tetto) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  tentativo ${i+1}/${retries} fallito: ${e.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('fetch fallito dopo ' + retries + ' tentativi');
}

/** Chiede l'anagrafica diretta e, se non risponde, dal tramite; il resto del giro va dalla strada vincente. */
async function scegliStrada(via) {
  try {
    const anag = await fetchJSON(via, 1, 15000);
    console.log('  Strada: diretta');
    return anag;
  } catch (e) {
    if (!TRAMITE_URL) throw e;
    console.log('  Diretta non risponde, provo dal tramite Cloudflare');
  }
  viaTramite = true;
  const anagT = await fetchJSON(via);
  console.log('  Strada: tramite Cloudflare');
  return anagT;
}

// ── Realtime: record orari di un giorno solare italiano ─────────────
// ⚠️ LA MARCA E' A FINE ORA (26/10/2026, scheda 95). Il record delle 00:00 e' la pioggia fra le 23 e mezzanotte del
// giorno PRIMA, quello delle 00:00 del giorno dopo e' l'ultima ora di questo (vedi l'archivio ufficiale qui in cima:
// «record dalle 03:00 di G alle 02:00 di G+1»). Fino al 26/10 si chiedevano i record dalle 00:00 alle 23:59, cioe'
// il giorno spostato indietro di un'ora: la pioggia fra le 23 e mezzanotte finiva sul giorno dopo. Trovato
// confrontando con MeteoHub dpcn-piemonte (stessi pluviometri, marca a fine ora): ora per ora identici a sfasamento 0
// (559 ore bagnate su 560), e sommandoli con la vecchia finestra si ritrovavano i nostri file del 18-21/10 in 864 casi
// su 875, con la finestra giusta in 191. Adesso si chiede fino alle 00:00 del giorno dopo (l'API ragiona in ora locale
// e include le due estremita') e si tiene (inizio, fine] con finestraGiorno, che sa dei giorni da 23 e 25 ore.
const { finestraGiorno } = require('./lib-giorno-italiano.js');
async function fetchRealtimeDay(day) {
  let all = [];
  let page = 1;
  while (true) {
    const url = API_BASE + '/data_pie?date_from=' + encodeURIComponent(day + 'T00:00')
      + '&date_to=' + encodeURIComponent(addDays(day, 1) + 'T00:00')
      + '&page=' + page + '&page_size=10000';
    const raw = await fetchJSON(url);
    const records = Array.isArray(raw) ? raw : (raw.data || raw.results || []);
    all = all.concat(records);
    if (records.length < 10000) break;
    page++;
  }
  const f = finestraGiorno(day);
  return all.filter(m => { const t = Date.parse(m.date); return t > f.start && t <= f.end; });
}

// Temperatura e vento dal realtime (11/8/2026): wind/gust GIÀ in km/h.
const MIN_ORE_METEO = 20;
function aggregaMeteoPie(records) {
  const acc = {};
  records.forEach(m => {
    const id = m.station_code;
    if (!id) return;
    const a = acc[id] = acc[id] || { tmin: Infinity, tmax: -Infinity, nT: 0, ffSum: 0, nFF: 0, fxMax: -Infinity, nFX: 0, umin: Infinity, umax: -Infinity, nU: 0, dir: creaDir() };
    const t = parseFloat(m.air_temperature);
    if (!isNaN(t) && t >= -45 && t <= 50) { if (t < a.tmin) a.tmin = t; if (t > a.tmax) a.tmax = t; a.nT++; }
    const ff = parseFloat(m.wind);
    if (!isNaN(ff) && ff >= 0 && ff < 216) { a.ffSum += ff; a.nFF++; }
    // Direzione del vento (2/10/2026): `wind_direction` in gradi negli stessi record, pesata su `wind`.
    if (!isNaN(ff) && ff >= 0 && ff < 216) segnaDir(a.dir, m.date || a.nFF, (m.wind_direction == null || m.wind_direction === '') ? null : parseFloat(m.wind_direction), ff);
    const fx = parseFloat(m.gust_of_wind);
    if (!isNaN(fx) && fx >= 0 && fx < 324) { if (fx > a.fxMax) a.fxMax = fx; a.nFX++; }
    // Umidità relativa (18/8/2026): campo `humidity` (%) negli stessi record.
    const u = parseFloat(m.humidity);
    if (!isNaN(u) && u >= 0 && u <= 100) { if (u < a.umin) a.umin = u; if (u > a.umax) a.umax = u; a.nU++; }
  });
  const out = {};
  Object.keys(acc).forEach(id => {
    const a = acc[id], m = {};
    if (a.nT >= MIN_ORE_METEO && a.tmax > -Infinity)
      m.t = [Math.round(a.tmin * 10) / 10, Math.round(a.tmax * 10) / 10];
    if (a.nFF >= MIN_ORE_METEO)
      m.w = [Math.round(a.ffSum / a.nFF * 10) / 10,
             a.nFX > 0 ? Math.round(a.fxMax * 10) / 10 : null];
    if (a.nU >= MIN_ORE_METEO && a.umax > -Infinity)
      m.u = [Math.round(a.umin), Math.round(a.umax)];
    const wd = direzione(a.dir);
    if (wd !== null) m.wd = wd;
    if (m.t || m.w || m.u || m.wd !== undefined) out[id] = m;
  });
  return out;
}

/** Dai record orari di un giorno → lista stazioni {id,n,lat,lon,q,p,mm,h,t?,w?}. */
function buildDay(records, stIndex, quote) {
  const rain = {}, ore = {};
  // Intensita' (12/9/2026): i record SONO orari e portano la loro marca in
  // `date`, che fa da chiave dell'ora. Nessuna richiesta in piu'.
  const secchielli = {};
  records.forEach(m => {
    const id = m.station_code;
    if (!id) return;
    const v = parseFloat(m.cum_rain_1h);
    if (isNaN(v) || v < 0) return;
    // ⚠️ IL GUASTO SI CERCA NELL'ORA, NON NEL GIORNO (19/10/2026, quinto check, bug 4). Un'ora sopra
    // MAX_ORA_MM non e' pioggia: si scarta lei sola e non conta fra le ore, cosi' il giorno resta con h<24
    // e l'ufficiale lo sostituisce appena esce (consolida). Vedi sotto il vecchio tetto dei 300 mm.
    if (v > MAX_ORA_MM) { console.warn(`  ora scartata: ${id} ${m.date} cum_rain_1h=${v}`); return; }
    rain[id] = (rain[id] || 0) + v;
    ore[id] = (ore[id] || 0) + 1;
    if (!secchielli[id]) secchielli[id] = creaOre();
    segna(secchielli[id], m.date || ore[id], v);
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
    /* ⚠️ NIENTE TETTO SUL GIORNO (19/10/2026, quinto check, bug 4). Qui c'era `if (mm > 300) mm = 0`
       (3/5/2026, filtro generico): il giorno piu' bagnato diventava ASCIUTTO, e con h=24 l'ufficiale non lo
       riparava piu'. Alla fonte, il 2/10/2020 (tempesta Alex) 16 pluviometri su 297 sopra i 300 mm: Limone
       Pancani 553, Sambughetto 511, Piedicavallo 477, Candoglia 472, Oropa 427. Sarebbero stati i 16 punti
       asciutti nel cuore dell'alluvione. I guasti si fermano ora per ora (MAX_ORA_MM, sopra) e un giorno sopra
       SOGLIA_UFF_SEMPRE_MM lo rivede comunque l'ufficiale (consolida). */
    const mm = Math.round(rain[id] * 10) / 10;
    const rec = {
      id, n: s.name || id,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q: (quote && quote[id] != null) ? quote[id] : (parseInt(s.altitude || 0) || 0),
      p: provinciaPulita(s.province) || '—',
      mm,
      h: Math.min(24, ore[id])
    };
    const inte = secchielli[id] && intensita(secchielli[id]);
    if (inte) rec.i = inte;
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
        n: s.denominazione, p: s.sigla_prov ? provinciaPulita('PROVINCIA DI ' + provinciaEstesa(s.sigla_prov)) : '—',
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
/* ⚠️ IL VERBANO-CUSIO-OSSOLA HA UN NOME SOLO (19/10/2026, quinto check, bug 8). L'anagrafe del realtime tronca il
   campo a 30 caratteri e scrive «PROVINCIA DEL VERBANO CUSIO OS» (29 stazioni su 32; 3 hanno la forma intera),
   l'ufficiale qui sopra darebbe «PROVINCIA DI VERBANO-CUSIO-OSSOLA»: tre scritture per la stessa provincia, e
   la pagina /piemonte/ stampava «Sambughetto (Provincia del verbano cusio os)». */
function provinciaPulita(p) {
  return p && /VERBANO/i.test(p) ? 'PROVINCIA DEL VERBANO-CUSIO-OSSOLA' : p;
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
      out[pm] = { ptot: r.ptot, tmin: r.tmin, tmax: r.tmax, vmedia: r.vmedia, vraffica: r.vraffica, umin: r.umin, umax: r.umax, dir: r.settore_prevalente };
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
      if (u.umin != null && u.umax != null) rec.u = [Math.round(u.umin), Math.round(u.umax)];
      if (daSettore(u.dir) !== null) rec.wd = daSettore(u.dir);   // settore prevalente ufficiale
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
      // sopra SOGLIA_UFF_SEMPRE_MM vince l'ufficiale anche col realtime completo: in un giorno eccezionale
      // si vuole il numero validato da ARPA (bug 4, 19/10/2026)
      // ⚠️ MA SOLO SE CI SMENTISCE (25/10/2026). L'ufficiale conta il giorno in UTC: preso sempre, nel giorno
      // dell'alluvione perdeva la pioggia fra le 00 e le 02 italiane e prendeva quella del giorno dopo, che il
      // realtime mette gia' nel file di G+1 (contata due volte). Sotto la meta' del nostro e' un sensore guasto
      // (140 mm l'ora per 24 ore passa il tetto orario): vince l'ufficiale. Se no si tiene il giorno italiano.
      else if ((mine.h || 0) < 24 || ((mine.mm || 0) > SOGLIA_UFF_SEMPRE_MM && ptot < (mine.mm || 0) * 0.5)) {
        stat.dettagli.push(`~ ${mine.n} (${id}) h=${mine.h} nostro=${mine.mm} → ufficiale=${ptot}`);
        mine.mm = ptot; mine.src = 'arpa-ufficiale';
        // ⚠️ L'intensita' veniva dal realtime INCOMPLETO (h<24) che qui stiamo
        // scartando: descriveva un altro numero. Meglio niente che una durata
        // calcolata su meno ore di quelle che il totale ufficiale contiene.
        delete mine.i;
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
    if (!mine.u && u.umin != null && u.umax != null) { mine.u = [Math.round(u.umin), Math.round(u.umax)]; tw = true; }
    if (mine.wd === undefined && daSettore(u.dir) !== null) { mine.wd = daSettore(u.dir); tw = true; }
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
    if (!m.u && prev.u) m.u = prev.u;
    // ⚠️ l'intensita' NON si eredita (19/10/2026, quinto check, bug 15): segue il calcolo nuovo, fatto su almeno le
    // stesse ore. Ereditata, restava quella di prima quando ARPA correggeva le ore: Montaldo Scarampi 10/9, 2,3 mm
    // diventati 0,2 il 13/9 (sotto 0,5 l'intensita' non si scrive) con «punta 2,1» rimasta.
    if (m.wd === undefined && prev.wd !== undefined) m.wd = prev.wd;
    return m;
  });
  // stazioni che erano nel vecchio file e nel nuovo realtime non ci sono (es. aggiunte dall'ufficiale)
  Object.keys(map).forEach(k => { out.push(map[k]); });
  return out;
}

/* ── RIPIEGO METEOHUB (26/10/2026, scheda 95) ────────────────────────────────────────────────────────────────────
   Dalle 22 del 24/10/2026 ARPA non pubblica piu' niente (realtime e archivio, anche dal PC) e il 25/10 mancava. Gli
   STESSI pluviometri arrivano su MeteoHub, rete dpcn-piemonte (Protezione Civile), per un'altra strada: ora per ora
   identici ad ARPA (559 ore bagnate su 560 il 22-24/10), e il 25/10 c'erano tutti. Quando ARPA non da' il giorno
   intero (meno di meta' delle stazioni con tutte le ore, o nessun file) il giorno si prende da MeteoHub con la ricetta
   di collect-meteohub.js (pioggia, temperatura, vento, umidita', intensita'), e ogni stazione porta `src:'meteohub'`.
   ⚠️ LE STAZIONI SI RICONOSCONO CON UNA TABELLA FISSA (`piemonte-meteohub.json`), non con la distanza: MeteoHub sposta
   le coordinate fino a 2 km e a 500 m si abbinavano solo 205 stazioni su 278. Le coppie della tabella sono riconosciute
   dai dati (pioggia del 18-24/10 identica sulla settimana, o ora per ora). Una stazione nuova di MeteoHub non entra.
   Vince chi ha piu' ore, e a parita' ARPA: quando ARPA ripubblica il giorno intero, i suoi valori tornano da soli.
   MeteoHub da anonimi tiene ~10 giorni (al massimo 3 per richiesta): qui si chiede un giorno alla volta, D-1..D-3. */
let meteohub = null, tabellaMH = null;
async function giornoDaMeteoHub(day) {
  if (!meteohub) { meteohub = require('./collect-meteohub.js'); tabellaMH = require('./piemonte-meteohub.json').stazioni; }
  const grezze = meteohub.togliPicchiFalsi(
    await meteohub.collectDay({ net: 'dpcn-piemonte', sigla: 'PIE' }, day, { ore: true, quote: false }), day);
  const out = [];
  let fuori = 0;
  grezze.forEach(r => {
    const a = tabellaMH[r.id];
    if (!a) { fuori++; return; }
    const rec = { id: a.id, n: a.n, lat: a.lat, lon: a.lon, q: a.q, p: a.p, mm: r.mm, h: r.h };
    if (r.i) rec.i = r.i;
    ['t', 'u'].forEach(k => { if (r[k] !== undefined) rec[k] = r[k]; });
    // ⚠️ IL VENTO MEDIO DI METEOHUB E' SBAGLIATO SU MOLTE STAZIONI (26/10/2026): su 42 su 72 e' quello di ARPA diviso
    // per 3,6 (conversione km/h -> m/s fatta due volte a monte; raffica e direzione invece identiche). Il fattore e'
    // misurato stazione per stazione in tabella (`fv`): 3.6 si moltiplica, 1 giusto, 0 o assente = vento non usato.
    const fv = a.fv || 0;
    if (r.w && fv) {
      rec.w = [Math.round(r.w[0] * fv * 10) / 10, r.w[1]];
      if (r.wd !== undefined) rec.wd = r.wd;
      if (r.wp) rec.wp = 1;   // vento senza raffica: lo sistema unisciRipiego
    }
    rec.src = 'meteohub';
    out.push(rec);
  });
  console.log(`  MeteoHub dpcn-piemonte: ${grezze.length} stazioni complete, ${out.length} riconosciute, ${fuori} fuori tabella`);
  return out;
}
/** Il giorno di MeteoHub sopra quello che c'e': vince chi ha piu' ore, a parita' chi c'era (ARPA o un giro prima). */
function unisciRipiego(daMH, esistenti) {
  const map = {};
  (esistenti || []).forEach(s => { map[s.id] = s; });
  const out = daMH.map(s => {
    const prev = map[s.id];
    if (prev) delete map[s.id];
    if (prev && (prev.h || 0) >= (s.h || 0)) return prev;
    const m = { ...s };
    // [media, null] senza raffica: se c'era gia' un vento (con la sua raffica) si tiene quello, come fa collect-meteohub
    if (m.wp) { delete m.wp; if (prev && prev.w) { m.w = prev.w; if (prev.wd !== undefined) m.wd = prev.wd; else delete m.wd; } }
    if (prev) {
      if (!m.t && prev.t) m.t = prev.t;
      if (!m.w && prev.w) m.w = prev.w;
      if (!m.u && prev.u) m.u = prev.u;
      if (m.wd === undefined && prev.wd !== undefined) m.wd = prev.wd;
    }
    return m;
  });
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
  // Se ARPA non risponde per niente si va avanti col solo ripiego MeteoHub (26/10/2026); il giro fallisce lo stesso
  // se alla fine non ha scritto niente da MeteoHub, cosi' il guasto resta rosso su GitHub.
  console.log('Carico anagrafica stazioni (realtime)...');
  let arpaGiu = false, ripieghi = 0;
  const stIndex = {};
  try {
    const anagRaw = await scegliStrada(API_BASE + '/pie_anag?page_size=10000');
    const stazioni = Array.isArray(anagRaw) ? anagRaw : (anagRaw.data || anagRaw.results || []);
    stazioni.forEach(s => { if (s.station_code) stIndex[s.station_code] = s; });
    console.log('  Stazioni realtime: ' + stazioni.length);
  } catch (e) {
    arpaGiu = true;
    console.warn('  ARPA non risponde (' + e.message + '): niente realtime, solo il ripiego MeteoHub');
  }

  // ── Step 1b: anagrafica ufficiale (quota, coordinate) — se cade, si va avanti senza ──
  let anagUff = {};
  try {
    if (arpaGiu) throw new Error('ARPA non risponde');
    anagUff = await fetchAnagraficaUfficiale();
    console.log('  Stazioni ufficiali attive: ' + Object.keys(anagUff).length);
  } catch (e) { console.warn('  Anagrafica ufficiale non disponibile: ' + e.message); }
  const quote = {};
  Object.keys(anagUff).forEach(id => { if (anagUff[id].q != null) quote[id] = anagUff[id].q; });

  // ── Step 2: OGGI dal realtime ────────────────────────────────
  console.log('Carico misure di oggi ' + targetDate + '...');
  const recOggi = arpaGiu ? [] : await fetchRealtimeDay(targetDate);
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
        if (arpaGiu) throw new Error('ARPA non risponde');
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
      // Ripiego MeteoHub: ARPA non ha dato il giorno intero (le ore piene sono 23 a fine marzo, 24 negli altri giorni)
      const f = finestraGiorno(day), piene = Math.min(24, Math.round((f.end - f.start) / 3600000));
      const complete = (stations || []).filter(s => (s.h || 0) >= piene).length;
      if (!stations || stations.length < 5 || complete < stations.length / 2) {
        console.log(`  ARPA non ha il giorno intero (${complete} stazioni complete su ${(stations || []).length}): provo MeteoHub`);
        try {
          const daMH = await giornoDaMeteoHub(day);
          if (daMH.length >= 5) {
            stations = unisciRipiego(daMH, stations);
            ripieghi++;
            console.log(`  Ripiego: ${stations.filter(s => s.src === 'meteohub').length} stazioni da MeteoHub su ${stations.length}`);
          }
        } catch (e) { console.warn('  Ripiego MeteoHub non riuscito: ' + e.message); }
      }
      if (!stations || stations.length < 5) { console.log('  Niente da scrivere per ' + day); continue; }

      // Ufficiale
      let extra = {};
      try {
        if (arpaGiu) throw new Error('ARPA non risponde');
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
  if (arpaGiu && !ripieghi) throw new Error('ARPA non risponde e MeteoHub non ha dato niente da scrivere');
  console.log('\n=== Completato! ===\n');
}

main().catch(function(e) {
  console.error('Errore fatale:', e);
  process.exit(1);
});
