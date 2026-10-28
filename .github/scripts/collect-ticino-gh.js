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
 * Dall'11/8/2026 sono escluse anche le 9 stazioni di PROPRIETÀ MeteoSvizzera
 * (Cadenazzo, Cevio, Comprovasco, Locarno, Lugano, Piotta, Robiei,
 * S.Bernardino, Stabio): le condizioni d'uso OASI vietano di ripubblicarne i
 * dati grezzi. Le stesse identiche stazioni fisiche arrivano ora dal collector
 * MeteoSwiss OGD (CC BY, whitelist TI_SMN_DA_OASI) nella cartella
 * data/svizzera; lo storico in data/ticino è stato ripulito lo stesso giorno
 * (script una tantum migra-ti-smn-da-oasi-a-ogd.js).
 *
 * Licenza dati OASI: uso e pubblicazione liberi citando la fonte (oasi.ti.ch).
 *
 * TEMPERATURA E VENTO (dall'11/8/2026 — grafici stazione):
 * dagli stessi endpoint, parametri `T` (°C), `RH` (%, dal 18/8/2026), `WS` e `WSgust` (m/s ×3,6) a
 * letture da 10 minuti (resolution=h) → t: [min,max] °C · w: [media,raffica]
 * km/h, scritti solo con ore coperte ≥ MIN_ORE_METEO. Censimento 11/8: 15
 * stazioni con T, 7 anche col vento; le pluvio UCA non hanno altri sensori.
 * ⚠️ Le stazioni di proprietà MeteoSvizzera si SALTANO: le condizioni d'uso
 * OASI vietano di ripubblicare i dati grezzi MeteoSvizzera (per quelle, la
 * strada pulita è MeteoSwiss OGD, CC BY). Se T non dà righe si saltano anche
 * WS/WSgust: al censimento nessuna stazione aveva il vento senza termometro.
 * Tutta la parte meteo sta in un try per giorno: un suo guasto non tocca
 * mai la raccolta pioggia.
 *
 * ⚠️ MENO RICHIESTE E DUE STRADE (27/10/2026). Dal 21/10 OASI non risponde piu' ai runner di GitHub
 * (`connect ETIMEDOUT` gia' sull'elenco stazioni), dal PC si' in 2 s: il tappabuchi ha messo le stime su
 * 21-23/10, recuperate a mano dal PC il 27/10 (commit c69189c6c4). Due rimedi insieme:
 *  - MENO RICHIESTE. Prima si chiedeva una stazione per GIORNO (+ T/RH/WS/WSgust su tutte e 43): ~280
 *    richieste a giro, 1.000-2.000 al giorno coi quattro cron e i rilanci del guardiano, ~700 in un giro con
 *    sei giorni da riparare. OASI accetta i PERIODI (misurato il 27/10: `resolution=d` da D-30 a ieri = UNA
 *    richiesta da 2 KB; `resolution=h` due giorni = una richiesta da 295 righe). Ora: una richiesta per
 *    stazione per tutta la finestra (la riparazione dei 30 giorni non costa niente in piu'), i 10 minuti solo
 *    per IERI quando il giornaliero non c'e' ancora, e il meteo solo sulle stazioni che i sensori li hanno
 *    davvero (si legge dai file recenti), su un periodo solo. Giri da 4 a 2 al giorno (ticino.yml).
 *    Un giro normale: ~75 richieste, ~120 di notte col ripiego dei 10 minuti. Il log le conta.
 *  - DUE STRADE, come Liguria e Piemonte: l'elenco stazioni si chiede prima DIRETTO (un tentativo, 15 s) e,
 *    se non risponde, dal worker Cloudflare fissato a Milano (TRAMITE_URL + TRAMITE_CHIAVE, gli stessi del
 *    Piemonte). Dal PC, senza le due variabili, solo diretto. OASI_DIRETTO serve solo alle prove: un
 *    indirizzo che non risponde finge il blocco.
 * CENSIMENTO=1 riprova T su tutte le stazioni (per trovare un sensore nuovo).
 */

const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '../..', 'data', 'ticino');
const RIPARA_GIORNI   = 30;   // auto-riparazione fino a D-30, giorni stimati compresi (26/10/2026)
const METEO_GIORNI    = 8;    // t/w/u al massimo sugli ultimi 8 giorni scritti (i 10 minuti pesano: 144 righe al giorno)
const OASI_HOST = 'https://www.oasi.ti.ch';
const OASI_DIRETTO = (process.env.OASI_DIRETTO || OASI_HOST).replace(/\/$/, '');
const TRAMITE_URL = (process.env.TRAMITE_URL || '').replace(/\/$/, '');
const TRAMITE_CHIAVE = process.env.TRAMITE_CHIAVE || '';
let viaTramite = false;              // lo accende scegliStrada
let richieste = 0;                   // le contiamo: e' il numero che decide se ci bloccano
const BASE_URL = OASI_HOST + '/web/rest';
function instrada(url) {
  return url.indexOf(OASI_HOST) === 0 ? (viaTramite ? TRAMITE_URL : OASI_DIRETTO) + url.slice(OASI_HOST.length) : url;
}

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

function giornoDopo(g) {
  const d = new Date(g + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function fetchRaw(url, tetto = 30000) {
  const headers = { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  if (viaTramite) headers['X-Chiave'] = TRAMITE_CHIAVE;
  richieste++;
  const res = await fetch(instrada(url), { headers, signal: AbortSignal.timeout(tetto) });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** L'elenco stazioni DIRETTO e, se non risponde, dal tramite; il resto del giro va dalla strada vincente. */
async function scegliStrada(url) {
  try {
    const t = await fetchRaw(url, 15000);
    console.log('  Strada: diretta');
    return t;
  } catch (e) {
    if (!TRAMITE_URL) throw e;
    console.log(`  Diretta non risponde (${e.message}), provo dal tramite Cloudflare`);
  }
  viaTramite = true;
  const t = await fetchRaw(url);
  console.log('  Strada: tramite Cloudflare');
  return t;
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

/**
 * La pioggia di TUTTI i giorni chiesti, una richiesta per stazione sul periodo [da, a] (27/10/2026: prima una
 * per stazione e per giorno). Torna { giorno: [record] }.
 * Il totale giornaliero di ieri OASI lo pubblica solo a meta' mattina (~08:30): fino ad allora la riga esiste ma
 * e' vuota. Solo per IERI, allora, il ripiego: somma delle letture da 10 minuti, disponibili in tempo quasi reale
 * (validato: scarto ~3% dal giornaliero ufficiale), una richiesta in piu' per stazione. I giri dopo sovrascrivono
 * col valore ufficiale.
 */
async function raccogliPioggia(stations, giorni, ieri, da, a) {
  const perGiorno = {};
  giorni.forEach(g => { perGiorno[g] = []; });
  let ripieghi = 0;
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    try {
      const csv = await fetchRaw(`${BASE_URL}/measure/csv?domain=meteo&resolution=d&parameter=Prec&from=${da}&to=${a}&location=${encodeURIComponent(s.code)}`);
      const valori = new Map(parseOasiCsv(csv).map(r => [r.date, r.mm]));
      for (const g of giorni) {
        let mm = valori.has(g) ? valori.get(g) : null;
        if (mm === null && g === ieri) {
          // ⚠️ DUE GIORNI, NON UNO (27/10/2026). Chiedendo from=g&to=g d'estate OASI restituisce le letture dalle
          // 23:05 del giorno prima alle 22:55 (bordi in ora solare, vedi aggiungiMeteoOasi): col filtro sulla data
          // mancava l'ultima ora di pioggia. Fino al giorno dopo, g esce intero.
          const hRows = parseOasiCsv(await fetchRaw(`${BASE_URL}/measure/csv?domain=meteo&resolution=h&parameter=Prec&from=${g}&to=${giornoDopo(g)}&location=${encodeURIComponent(s.code)}`))
            .filter(r => r.date === g);
          // 144 letture attese (10 min): accetta solo giornate quasi complete
          // per non scrivere sottostime grossolane da buchi di trasmissione.
          if (hRows.length >= 120) { mm = hRows.reduce((t, r) => t + r.mm, 0); ripieghi++; }
        }
        if (mm === null) continue;
        mm = Math.round(mm * 10) / 10;
        if (mm >= 0 && mm <= 500) perGiorno[g].push({ id: s.code, n: s.name, lat: s.lat, lon: s.lon, q: s.q, p: 'TI', mm });
      }
      process.stdout.write(`  pioggia: ${i+1}/${stations.length} stazioni\r`);
      await sleep(150);
    } catch(e) {
      console.warn(`\n  Warn: stazione ${s.code} (${s.name}) fallita: ${e.message}`);
    }
  }
  console.log('');
  if (ripieghi > 0) console.log(`  (${ripieghi} stazioni da somma 10-min per ${ieri}, giornaliero non ancora pubblicato)`);
  return perGiorno;
}

// ── Temperatura e vento (letture 10 min, resolution=h) ───────────────
const MIN_ORE_METEO = 20;

/** Righe {hh, v} divise per giorno da un CSV OASI a 10 minuti: { 'AAAA-MM-GG': [...] }. */
function parseOasiOrePerGiorno(csv) {
  const out = {};
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('data;')) continue;
    const parts = t.split(';');
    if (parts.length < 2) continue;
    const m = parts[0].match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2})/);
    if (!m) continue;
    const v = parseFloat(parts[1]);
    if (!isNaN(v)) (out[`${m[3]}-${m[2]}-${m[1]}`] = out[`${m[3]}-${m[2]}-${m[1]}`] || []).push({ hh: m[4], v });
  }
  return out;
}

async function serieMeteo(code, param, da, a) {
  const url = `${BASE_URL}/measure/csv?domain=meteo&resolution=h&parameter=${param}`
            + `&from=${da}&to=${a}&location=${encodeURIComponent(code)}`;
  return parseOasiOrePerGiorno(await fetchRaw(url));
}

const oreDi = rows => new Set(rows.map(r => r.hh)).size;

/**
 * Quali sensori ha ogni stazione, dai file degli ultimi 14 giorni (27/10/2026): chi non ha mai avuto t, u o w
 * non si interroga. Prima si chiedeva T a tutte e 43 ogni giorno per scoprire che 28 non l'hanno. Con
 * CENSIMENTO=1, o senza file, si torna a provare T dappertutto.
 */
function sensoriDaiFile() {
  if (process.env.CENSIMENTO) return null;
  const files = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-14);
  if (!files.length) return null;
  const s = {};
  for (const f of files) {
    try {
      for (const r of JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')).stations || []) {
        const k = s[r.id] = s[r.id] || {};
        if (r.t) k.t = 1; if (r.u) k.u = 1; if (r.w) k.w = 1;
      }
    } catch (e) {}
  }
  return s;
}

/**
 * Aggiunge t/w/u ai record di `giorni` (tutti dentro [da, a]): una richiesta per sensore per stazione.
 * ⚠️ OASI CONTA I BORDI DEL PERIODO IN ORA SOLARE FISSA, ma scrive le ore in ora locale (misurato il 27/10/2026
 * su air_auto_275): d'estate from=20&to=21 va dalle 23:05 del 19 alle 22:55 del 21, d'inverno dalle 00:05 alle
 * 23:55; i giorni IN MEZZO sono sempre interi. Il collector vecchio chiedeva un giorno solo e d'estate perdeva
 * l'ultima ora (minime e massime di qualche decimo diverse sui giorni prima del cambio d'ora). Per questo il
 * periodo si chiede fino al giorno DOPO `a` (oggi, se `a` e' ieri): le sue righe si buttano, `a` resta intero.
 */
async function aggiungiMeteoOasi(stations, perGiorno, giorni, da, a) {
  a = giornoDopo(a);
  const sens = sensoriDaiFile();
  const conta = {};
  giorni.forEach(g => { conta[g] = { t: 0, w: 0, u: 0 }; });
  for (const s of stations) {
    // Licenza OASI: i dati grezzi MeteoSvizzera non si possono ripubblicare
    if (s.owner === 'MeteoSvizzera') continue;
    const k = sens ? sens[s.code] : { t: 1 };
    if (!k || !(k.t || k.u || k.w)) continue;
    const rec = {};
    giorni.forEach(g => { rec[g] = perGiorno[g].find(r => r.id === s.code); });
    try {
      let vT = {};
      if (k.t) {
        vT = await serieMeteo(s.code, 'T', da, a);
        if (!sens && !Object.keys(vT).length) { await sleep(80); continue; } // censimento: niente termometro → niente altri sensori
      }
      const conTermo = Object.keys(vT).length > 0;
      const vU = (k.u || (!sens && conTermo)) ? await serieMeteo(s.code, 'RH', da, a) : {};
      const vWS = (k.w || (!sens && conTermo)) ? await serieMeteo(s.code, 'WS', da, a) : {};
      const vGU = Object.keys(vWS).length ? await serieMeteo(s.code, 'WSgust', da, a) : {};
      for (const g of giorni) {
        const r = rec[g];
        if (!r) continue;
        const t = (vT[g] || []).filter(x => x.v >= -45 && x.v <= 50);
        if (oreDi(t) >= MIN_ORE_METEO) {
          r.t = [Math.round(Math.min(...t.map(x => x.v)) * 10) / 10, Math.round(Math.max(...t.map(x => x.v)) * 10) / 10];
          conta[g].t++;
        }
        // Umidita' relativa (dal 18/8/2026): parametro OASI `RH` (%), stesse letture da 10 minuti di T
        const u = (vU[g] || []).filter(x => x.v >= 0 && x.v <= 100);
        if (oreDi(u) >= MIN_ORE_METEO) {
          r.u = [Math.round(Math.min(...u.map(x => x.v))), Math.round(Math.max(...u.map(x => x.v)))];
          conta[g].u++;
        }
        const ws = (vWS[g] || []).filter(x => x.v >= 0 && x.v < 60);
        if (oreDi(ws) >= MIN_ORE_METEO) {
          const gu = (vGU[g] || []).filter(x => x.v >= 0 && x.v < 90);
          r.w = [Math.round(ws.reduce((t2, x) => t2 + x.v, 0) / ws.length * 3.6 * 10) / 10,
                 gu.length ? Math.round(Math.max(...gu.map(x => x.v)) * 3.6 * 10) / 10 : null];
          conta[g].w++;
        }
      }
      await sleep(120);
    } catch (e) {
      console.warn(`  Warn meteo ${s.code}: ${e.message}`);
    }
  }
  for (const g of giorni) {
    console.log(`  Meteo t/w/u ${g}: ${conta[g].t} stazioni con temperatura, ${conta[g].w} col vento, ${conta[g].u} con umidita'`);
  }
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
  const locs = JSON.parse(await scegliStrada(`${BASE_URL}/locations?domain=meteo`));

  const stations = locs
    .filter(l => {
      const o = (l.simpleOwner || l.owner || '');
      // ARPA: zone già coperte dai nostri collector. MeteoSvizzera: licenza
      // OASI (vedi intestazione) — quelle stazioni arrivano da MeteoSwiss OGD.
      return !o.toUpperCase().includes('ARPA') && o !== 'MeteoSvizzera';
    })
    .map(l => {
      const c = l.coordinates || {};
      if (typeof c.x !== 'number' || typeof c.y !== 'number') return null;
      const w = lv95ToWgs84(c.x, c.y);
      return {
        code: l.code,
        name: l.name,
        owner: l.simpleOwner || l.owner || '',
        lat: Math.round(w.lat * 10000) / 10000,
        lon: Math.round(w.lon * 10000) / 10000,
        q:   Math.round(c.z || 0)
      };
    })
    .filter(Boolean);

  console.log(`  Stazioni OASI utilizzabili (escluse ARPA): ${stations.length}`);
  if (stations.length < 10) throw new Error(`Troppo poche stazioni: ${stations.length}`);

  // DATE_OVERRIDE raccoglie solo quel giorno specifico (per backfill manuale);
  // altrimenti: ieri (primo dato disponibile) + altroieri (consolidamento) + i giorni da riparare.
  const now = new Date();
  const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const noon = new Date(fmtDate(italyNow) + 'T12:00:00Z').getTime();
  const giornoFa = i => fmtDate(new Date(noon - i * 24 * 3600000));
  let giorni, ieri;
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    ieri = process.env.DATE_OVERRIDE.trim();
    giorni = [ieri];
    console.log(`  Raccolgo ${ieri} (DATE_OVERRIDE)...`);
  } else {
    ieri = giornoFa(1);
    giorni = [ieri, giornoFa(2)];
    console.log(`  Raccolgo ieri (${ieri}) e consolido l'altroieri (${giorni[1]})`);
    // ── Auto-riparazione: recupera dall'archivio OASI i giorni mancanti, corti
    // o STIMATI degli ultimi 30. Possibile solo perche' le query storiche OASI
    // funzionano.
    // ⚠️ 26/10/2026: anche i giorni STIMATI (source open-meteo, li scrive
    // check-gaps-nord.js dopo 3 giorni di buco) si rifanno col dato vero. Prima
    // si riparavano solo i file mancanti fino a D-7, e una stima, una volta
    // scritta, restava per sempre. Nato da OASI giu' dal 21/10 per piu' di una
    // settimana. Dal 27/10 non costa piu' niente: il periodo della richiesta si allunga e basta (niente piu'
    // tetto di 8 giorni a giro).
    for (let i = 3; i <= RIPARA_GIORNI; i++) {
      const dStr = giornoFa(i);
      const f = path.join(DATA_DIR, `${dStr}.json`);
      let motivo = fs.existsSync(f) ? '' : 'mancante';
      if (!motivo) {
        try {
          const j = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (/open-meteo/.test(j.source || '')) motivo = 'stimato (' + j.source + ')';
          else if ((j.count || 0) < 30) motivo = 'corto (' + (j.count || 0) + ' stazioni)';
        } catch(e) { motivo = 'illeggibile'; }
      }
      if (motivo) {
        console.log(`  Auto-riparazione: recupero ${dStr} dall'archivio, giorno ${motivo}`);
        giorni.push(dStr);
      }
    }
  }
  giorni.sort().reverse();
  const da = giorni[giorni.length - 1], a = giorni[0];
  const perGiorno = await raccogliPioggia(stations, giorni, ieri, da, a);
  // t/w/u solo sugli ultimi METEO_GIORNI: oltre, una riparazione lontana prenderebbe settimane di 10 minuti
  const giorniMeteo = giorni.filter(g => g >= giornoFa(METEO_GIORNI) || g === ieri);
  try { await aggiungiMeteoOasi(stations, perGiorno, giorniMeteo, giorniMeteo[giorniMeteo.length - 1], giorniMeteo[0]); }
  catch (e) { console.warn('  Warn: meteo t/w/u saltato: ' + e.message); }
  for (const g of giorni) writeDay(g, perGiorno[g]);
  console.log(`  Richieste a OASI in questo giro: ${richieste}${viaTramite ? ' (dal tramite Cloudflare)' : ''}`);

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

  console.log('=== collect-ticino-gh completato ===');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
