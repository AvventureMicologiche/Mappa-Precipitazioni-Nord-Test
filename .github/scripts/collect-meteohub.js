/**
 * collect-meteohub.js  —  GitHub Actions (PILOTA, solo repo di test)
 * Raccoglie precipitazioni giornaliere da MeteoHub (Agenzia ItaliaMeteo,
 * ex progetto Mistral) — rete DPCN dei centri funzionali regionali.
 *
 * Scopo del pilota (luglio 2026): valutare MeteoHub come fonte unica per
 * l'espansione della mappa a tutta Italia.
 *  - dpcn-lombardia era la regione di CONTROLLO (verità a terra via ARPA
 *    Socrata) — RIMOSSA il 27/7/2026: in mappa/prod la Lombardia usa ARPA.
 *  - dpcn-marche, dpcn-umbria: prime regioni nuove candidate
 *
 * API (verificata il 20/07/2026, nessun login richiesto):
 *   GET /api/observations?networks=<rete>&q=reftime: >=A,<=B;product:B13011;license:CCBY_COMPLIANT
 *   → JSON con serie di accumuli per stazione. B13011 = precipitazione (KG/M**2 = mm).
 *
 * ATTENZIONE — cose scoperte in fase di analisi:
 *  - I reftime sono UTC (verificato empiricamente: ultimo dato ≈ ora UTC attuale).
 *    Il giorno italiano D va quindi richiesto come finestra UTC [D-1 22:00 → D 22:00]
 *    in estate (23:00 in inverno), gestita con getItalyOffset.
 *  - Ogni lettura è un accumulo che TERMINA al proprio reftime: la lettura con
 *    ref esattamente all'inizio finestra appartiene al giorno precedente
 *    (si filtra con ref > inizio e ref <= fine).
 *  - La granularità VARIA per rete: Lombardia 10 min (trange "1,0,600"),
 *    Marche 15 min ("1,0,900"), Umbria 1 min ("1,0,60"). Si sceglie per ogni
 *    stazione la serie B13011 più fitta e si somma; completezza richiesta ≥85%
 *    delle letture attese (86400/passo) per non scrivere sottostime.
 *  - Senza login sono accessibili solo gli ultimi ~10 giorni: un run fallito
 *    si recupera (auto-riparazione fino a 7 giorni), oltre serve un account.
 *  - Metadati stazione: solo nome (B01019) e lat/lon — niente quota (q:0).
 *
 * Licenza dati: CC-BY compliant, citare la fonte (MeteoHub / Agenzia ItaliaMeteo).
 */

const fs   = require('fs');
const { creaOre, segna, intensita } = require('./lib-intensita.js');
const path = require('path');

const BASE_URL = 'https://meteohub.agenziaitaliameteo.it/api/observations';
const DATA_ROOT = path.join(__dirname, '../..', 'data');

// ⚠️ MeteoHub consegna certi nomi con l'ESCAPE UNICODE ROTTO, senza la barra:
//    arriva la stringa «Borgo Libertu00e0» invece di «Borgo Libertà». Non e'
//    un nostro errore di lettura (JSON.parse un escape vero lo scioglierebbe
//    da solo): e' scritto cosi' nella loro anagrafe. Colpiva sei stazioni fra
//    Puglia, Sicilia e Sardegna, e il nome sbagliato finiva in mappa nel
//    tooltip e nel pannello stazione. Trovato e corretto il 28/8/2026.
//    Si ricompongono solo le lettere accentate italiane: un decodificatore
//    generico rischierebbe di rovinare un nome che contiene «u00» per caso.
const ACCENTATE = { c0:'À', c8:'È', cc:'Ì', d2:'Ò', d9:'Ù',
                    e0:'à', e8:'è', e9:'é', ec:'ì', f2:'ò', f9:'ù' };
// Nomi che arrivano col carattere ROTTO (U+FFFD, la lettera e' persa a monte e non
// si puo' ricostruire da sola): si correggono uno per uno (17/10/2026).
// ⚠️ Fino al 15/9 la stessa stazione arrivava anche con l'escape rotto «ufffd» in lettere (20/10/2026,
// sesto check, bug 18): la regola delle accentate non la prende, e serve la chiave a parte. Stesso giro:
// la Sardegna ha avuto fino al 15/9 il nome TAGLIATO «Pranu San», dal 16/9 MeteoHub manda quello intero.
const NOMI_CORRETTI = {
  'Trinit� Diga R2': 'Trinità Diga R2',
  'Trinitufffd Diga R2': 'Trinità Diga R2',
  'S. Nicolò Gerrei - Pranu San': 'S. Nicolò Gerrei - Pranu Sangun',
};
// ⚠️ DUE STAZIONI ALLO STESSO PUNTO (19/10/2026, quinto check, bug 18). Nel Lazio MeteoHub pubblica
// alle stesse coordinate un idrometro e una stazione meteo («Tevere a Ripetta» e «Cassiodoro»), e
// il nostro id e' fatto con le sole coordinate: ogni giorno entra quella con la serie completa e il
// nome cambiava da un giorno all'altro (mai due nello stesso file). Il nome si fissa per id, con
// quello che compare piu' spesso nello storico (80-101 giorni contro 1-22).
// La tabella e' per id e vale per TUTTE le reti (collectDay la guarda prima del nome di MeteoHub):
// dal 20/10/2026 (sesto check, bug 19) c'e' anche la Puglia.
const NOMI_FISSI = {
  '41.99972_12.49139': 'Tevere a Castelgiubileo',   // anche «Fosso Cremera a Labaro»
  '41.93194_12.57611': 'Roma Est',                  // anche «Aniene a Ponte Mammolo»
  '42.40667_11.88111': 'Tuscania',                  // anche «Marta a Piantata»
  '41.94889_12.49139': 'Acqua Acetosa',             // anche «Tevere a Foro Italico»
  '41.91500_12.47444': 'Cassiodoro',                // anche «Tevere a Ripetta»
  '41.83028_12.49139': 'Roma EUR',                  // anche «Eur»
  '41.82300_15.24067': 'Fortore a Ripalta',         // Puglia, anche «Fiume Fortore a Ponte Ripalta» (4 giorni)
};
function ripulisciNome(s) {
  // il (?<!\\) protegge gli escape SCRITTI BENE, che vanno lasciati stare
  const n = String(s).replace(/(?<!\\)u00([0-9a-fA-F]{2})/g,
    (intero, hex) => ACCENTATE[hex.toLowerCase()] || intero);
  return NOMI_CORRETTI[n] || n;
}

const NETWORKS = [
  // Lombardia RIMOSSA il 27/7/2026: in mappa (e in produzione) la Lombardia usa
  // ARPA, non MeteoHub. La rete dpcn-lombardia serviva solo da CONTROLLO — la
  // cartella storica data/meteohub-lombardia resta nel repo ma non si aggiorna più.
  { net: 'dpcn-marche',     dir: 'meteohub-marche',     sigla: 'MAR' },
  { net: 'dpcn-umbria',     dir: 'meteohub-umbria',     sigla: 'UMB' },
  { net: 'dpcn-lazio',      dir: 'meteohub-lazio',      sigla: 'LAZ' },
  { net: 'dpcn-campania',   dir: 'meteohub-campania',   sigla: 'CAM' },
  { net: 'dpcn-puglia',     dir: 'meteohub-puglia',     sigla: 'PUG' },
  { net: 'dpcn-calabria',   dir: 'meteohub-calabria',   sigla: 'CAL' },
  { net: 'dpcn-sicilia',    dir: 'meteohub-sicilia',    sigla: 'SIC' },
  { net: 'dpcn-sardegna',   dir: 'meteohub-sardegna',   sigla: 'SAR' },
  { net: 'dpcn-basilicata', dir: 'meteohub-basilicata', sigla: 'BAS' },
  { net: 'dpcn-molise',     dir: 'meteohub-molise',     sigla: 'MOL' },
  // Friuli V.G. (19/8/2026): NON è una rete dpcn, è la rete idrometeorologica
  // completa di ARPA FVG. L'archivio OSMER che usiamo in mappa (data/friuli-osmer)
  // espone solo ~40 stazioni; qui ce ne sono 139, di cui 136 con la giornata
  // completa, 99 con temperatura, 44 col vento e 55 con l'umidità.
  // VALIDATA il 19/8/2026 col metodo delle stazioni gemelle: sulle 32 stazioni
  // presenti in entrambe le fonti la pioggia del 17/8 coincide al decimo
  // (Barcis 6,6=6,6; Codroipo 19,4=19,4; Tarvisio 24,1=24,1).
  { net: 'arpafvg',         dir: 'meteohub-friuli',     sigla: 'FVG', src: 'meteohub-arpafvg' },
];

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

// ── Account MeteoHub (19/8/2026) ──────────────────────────────────────────
// Senza login l'API serve solo gli ultimi ~10 giorni (il resto risponde 401).
// Con un account gratuito (MH_USER / MH_PASS, secret del repo) il token JWT
// apre l'archivio: arpafvg dal 26/7/2026, dpcn-lazio da maggio, sir-toscana
// dal 14/6 (dpcn-puglia ha la rete completa solo dal 21/7). Il token si chiede
// UNA volta per run e si passa come Bearer; se le credenziali mancano si
// lavora come prima, anonimi, e i cron quotidiani non cambiano.
let MH_TOKEN = null;
async function loginMeteoHub() {
  const user = (process.env.MH_USER || '').trim(), pass = process.env.MH_PASS || '';
  if (!user || !pass) return null;
  const r = await fetch('https://meteohub.agenziaitaliameteo.it/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: user, password: pass })
  });
  const testo = await r.text();
  if (!r.ok) throw new Error('login MeteoHub HTTP ' + r.status);
  let tok = testo.trim();
  try { const j = JSON.parse(testo); tok = j.token || j.access_token || j.accessToken || tok; } catch (e) {}
  return tok.replace(/^"|"$/g, '') || null;
}

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
      if (MH_TOKEN) headers['Authorization'] = 'Bearer ' + MH_TOKEN;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch(e) {
      if (i === retries - 1) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}

/** Finestra UTC del giorno di calendario italiano dateStr (YYYY-MM-DD). */
// ⚠️ Da lib-giorno-italiano (18/10/2026): prima il fuso era quello di mezzogiorno
// e la finestra durava sempre 24 ore, e il 25/10 l'ora 00-01 non finiva da nessuna parte.
function utcWindowForItalianDay(dateStr) {
  const f = require('./lib-giorno-italiano.js').finestraGiorno(dateStr);
  const start = new Date(f.start);
  const end   = new Date(f.end);
  const fmtQ   = d => d.toISOString().substring(0, 16).replace('T', ' '); // "YYYY-MM-DD HH:MM"
  const fmtRef = d => d.toISOString().substring(0, 19);                   // confronto stringa coi ref
  return { qFrom: fmtQ(start), qTo: fmtQ(end), refFrom: fmtRef(start), refTo: fmtRef(end) };
}

// Temperatura e vento (11/8/2026 — grafici stazione): prodotti B12101
// (temperatura, ⚠️ in KELVIN → v>100 ? v-273,15, come la Francia), B11002
// (vento medio, m/s → ×3,6) e B11041 (raffica, m/s — poche stazioni, null
// dove manca). Tre query in più per (rete, giorno); stazione identificata
// dallo stesso id lat_lon della pioggia. Serie più fitta per prodotto (come
// per B13011); completezza in ORE COPERTE ≥ MIN_ORE_METEO. Tutto in un try:
// un guasto delle query meteo non tocca mai la pioggia.
const MIN_ORE_METEO = 20;
/* ⚠️ VENTO MEDIO: TETTO A 40 m/s, NON 60 (19/10/2026, quinto check, bug 9). San Vito Lo Capo (15-17/10) e
   Manfredonia (16-17/10) hanno avuto l'anemometro bloccato su un gradino piatto di 41-52 m/s (150-185 km/h) per ore,
   con i vicini a 2-12 km/h: nei file 157,1 / 107,8 / 95,8 km/h di MEDIA del giorno. 60 m/s (216 km/h) non fermava
   niente. Una media di 10 minuti sopra i 144 km/h in Italia non si misura nemmeno nei medicane; il vento medio
   giornaliero piu' forte di tutto l'archivio (209.700 stazioni-giorno) e' 74,4 km/h in cima al Mont Aigoual.
   La raffica (B11041) resta a 90. Stesso tetto in collect-toscana-sir.js e backfill-meteo-meteohub.js. */
const VENTO_MAX_MS = 40;
const ORE_DOPO = 3;   // il meteo di un giorno e' definitivo se chiesto almeno 3 ore dopo la sua fine (fase 3, 27/10/2026)
const { creaDir, segnaDir, direzione } = require('./lib-direzione.js');
const { tieniMeteo } = require('./lib-tieni-meteo.js');
const { fattoreVento } = require('./lib-vento-meteohub.js');
function urlProdotto(netCfg, w, prod) {
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:${prod};license:CCBY_COMPLIANT`;
  return `${BASE_URL}?networks=${encodeURIComponent(netCfg.net)}&q=${encodeURIComponent(q)}`;
}
/** La serie piu' fitta di un prodotto per una stazione, contata DENTRO la finestra w (estremi compresi, come la
 *  richiesta all'API). Con la risposta di un giorno solo e' la scelta di sempre (tutta la serie sta nella finestra);
 *  con quella di due giorni (fase 3, 27/10/2026) la serie si sceglie giorno per giorno, come se li avessi chiesti a parte. */
function serieMigliore(entry, prod, w) {
  let best = null, nBest = -1;
  for (const pr of (entry.prod || [])) {
    if (pr.var !== prod || !Array.isArray(pr.val)) continue;
    const n = pr.val.filter(v => v.ref >= w.refFrom && v.ref <= w.refTo).length;
    if (n > nBest) { best = pr; nBest = n; }
  }
  return best;
}
function perIdDa(raw, prod, w) {
  const perId = {};
  for (const entry of (raw.data || [])) {
    const stat = entry.stat || {};
    if (typeof stat.lat !== 'number' || typeof stat.lon !== 'number') continue;
    const best = serieMigliore(entry, prod, w);
    if (!best) continue;
    const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
    if (!vals.length) continue;
    perId[`${stat.lat.toFixed(5)}_${stat.lon.toFixed(5)}`] = vals;
  }
  return perId;
}
// ⚠️ OGNI QUERY PER CONTO SUO (19/10/2026, quinto check, bug 6). Prima stavano tutte in UN try (quello di
// collectDay): se cadeva l'umidita' si perdevano anche temperatura e vento gia' arrivati. Ora una query che
// cade da' null, si salta solo il suo campo, e writeDay lo riprende dal file del giorno (lib-tieni-meteo.js).
const PRODOTTI_METEO = ['B12101', 'B11002', 'B11041', 'B11001', 'B13003'];
async function scaricaMeteo(netCfg, w) {
  const raw = {};
  for (const prod of PRODOTTI_METEO) {
    if (prod === 'B11002' || prod === 'B11001' || prod === 'B13003') await sleep(500);   // le pause di sempre
    try { raw[prod] = await fetchJSON(urlProdotto(netCfg, w, prod)); }
    catch (e) { console.warn(`  Warn ${prod} ${netCfg.net}: ${e.message}`); raw[prod] = null; }
  }
  return raw;
}
/** t/w/wd/u del giorno w dalle risposte di scaricaMeteo (anche di piu' giorni). `completo` = arrivate tutte e cinque. */
function meteoDelGiorno(rawMeteo, w) {
  const out = {};   // id → {t?, w?}
  const prendi = prod => (rawMeteo[prod] ? perIdDa(rawMeteo[prod], prod, w) : null);
  const oreDi = vals => new Set(vals.map(v => (v.ref || '').slice(11, 13))).size;

  const temp = prendi('B12101') || {};
  Object.keys(temp).forEach(id => {
    // ⚠️ FALSI ZERI (3/10/2026): in una serie in KELVIN uno 0 grezzo non e' una
    // temperatura (0 K), e' un dato non pervenuto. Con la sola conversione
    // `v>100 ? v-273.15 : v` passava come 0 °C: Benevento 0 / 29,2° a 234 m il
    // 30/9, 226 minime false in agosto-settembre sulle reti MeteoHub. Se la serie
    // e' in kelvin (almeno una lettura sopra 100, vedi sotto) si scarta tutto cio' che
    // sta sotto: senza minima valida resta il trattino, non lo zero.
    // ⚠️ BASTA UNA LETTURA SOPRA 100 (19/10/2026), non la maggioranza: il 12/10 MeteoHub ha
    // mandato zeri MINUTO PER MINUTO per un'ora e mezza su 15 stazioni siciliane (87 zeri contro
    // 51 letture vere a mezz'ora), gli zeri erano la maggioranza, la serie passava per gradi e
    // diventavano 0 °C (Mistretta 0 / 35,3; 25 minime false in ottobre). Una serie in gradi
    // non arriva mai a 100, quindi una lettura sopra basta a dire che e' in kelvin.
    const kelvin = temp[id].some(v => v.val > 100);
    if (temp[id].every(v => v.val === 0)) return;   // tutta zeri: termometro muto, trattino
    // ⚠️ SBALZI ISOLATI (4/10/2026): Favarella e Imera (Sicilia, 1/10) avevano UNA lettura a 0,0 °C
    // in kelvin (273,15) fra letture sopra i 15°: un valore valido per forma, falso per sostanza.
    // Una lettura che si stacca di oltre 10° sia dalla precedente sia dalla successiva non e' una
    // temperatura vera (fra due letture passano 10-60 minuti): si scarta. Vale per ogni sbalzo,
    // non solo lo zero.
    const serie = temp[id].filter(v => !kelvin || v.val > 100)
      .map(v => ({ ref: v.ref || '', c: v.val > 100 ? v.val - 273.15 : v.val })).filter(v => v.c >= -45 && v.c <= 50)
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    const vals = serie.filter((v, i) => !(i > 0 && i < serie.length - 1
      && Math.abs(v.c - serie[i - 1].c) > 10 && Math.abs(v.c - serie[i + 1].c) > 10)).map(v => v.c);
    if (vals.length && oreDi(temp[id]) >= MIN_ORE_METEO)
      (out[id] = out[id] || {}).t = [Math.round(Math.min(...vals) * 10) / 10,
                                     Math.round(Math.max(...vals) * 10) / 10];
  });
  /* SENZA LA RAFFICA il vento si scrive lo stesso, ma «provvisorio» (wp, 20/10/2026, settimo check, bug 10): prima si
     buttava tutto, e al primo salvataggio del giorno il file restava senza vento e direzione fino al giro dopo. Il
     segno wp lo legge writeDay: dove il file del giorno ha gia' un vento (con la sua raffica) si tiene quello, perche'
     [media, null] cancellerebbe la raffica gia' salvata; dove non c'e' niente si scrive [media, null]. */
  const ventoRaw = prendi('B11002');
  const raffica = prendi('B11041');
  const vento = ventoRaw || {}, senzaRaffica = !raffica;
  Object.keys(vento).forEach(id => {
    // ⚠️ le ore si contano sulle letture BUONE (19/10/2026, bug 9): con l'anemometro bloccato a 45 m/s tutto il giorno
    // le ore lette erano 24 anche se nessuna lettura era buona
    const buone = vento[id].filter(v => v.val >= 0 && v.val < VENTO_MAX_MS);
    const vals = buone.map(v => v.val);
    if (!vals.length || oreDi(buone) < MIN_ORE_METEO) return;
    // ⚠️ VENTO MEDIO DIVISO PER 3,6 SU ALCUNE STAZIONI (26/10/2026): fattore per stazione in meteohub-vento.json;
    // 0 = il vento di questa stazione non si usa (niente media, raffica ne' direzione)
    const fv = fattoreVento(id);
    if (!fv) return;
    const media = vals.reduce((a, v) => a + v, 0) / vals.length;
    const gu = ((raffica || {})[id] || []).map(v => v.val).filter(v => v >= 0 && v < 90);
    (out[id] = out[id] || {}).w = [Math.round(media * 3.6 * fv * 10) / 10,
                                   gu.length ? Math.round(Math.max(...gu) * 3.6 * 10) / 10 : null];
    if (senzaRaffica) out[id].wp = 1;
  });
  // Direzione del vento (2/10/2026): prodotto B11001 (gradi), una query in piu' per
  // rete/giorno. Si accoppia a B11002 per marca temporale e si fa la media
  // vettoriale pesata sulla velocita' (lib-direzione.js). In un try suo: se manca,
  // restano vento, temperatura e umidita'.
  try {
    const dirz = prendi('B11001') || {};
    Object.keys(dirz).forEach(id => {
      if (!out[id] || !out[id].w || !vento[id]) return;
      const perRef = {};
      dirz[id].forEach(v => { perRef[v.ref] = v.val; });
      const acc = creaDir();
      vento[id].forEach(v => { if (v.val >= 0 && v.val < VENTO_MAX_MS) segnaDir(acc, (v.ref || '').slice(11, 13), perRef[v.ref] !== undefined ? perRef[v.ref] : null, v.val); });
      const wd = direzione(acc);
      if (wd !== null) out[id].wd = wd;
    });
  } catch (e) { console.warn(`  Warn direzione ${netCfg.net}: ${e.message}`); }
  // Umidità relativa (18/8/2026): prodotto B13003 (%), una query in più per rete/giorno.
  const umid = prendi('B13003') || {};
  Object.keys(umid).forEach(id => {
    const vals = umid[id].map(v => v.val).filter(v => v >= 0 && v <= 100);
    if (vals.length && oreDi(umid[id]) >= MIN_ORE_METEO)
      (out[id] = out[id] || {}).u = [Math.round(Math.min(...vals)), Math.round(Math.max(...vals))];
  });
  return { out, completo: PRODOTTI_METEO.every(p => rawMeteo[p]) };
}
async function collectMeteoHub(netCfg, w) { return meteoDelGiorno(await scaricaMeteo(netCfg, w), w); }

// `opz` serve al ripiego del Piemonte (collect-piemonte.js, 26/10/2026): `ore` aggiunge `h` (ore lette, come nei file
// ARPA), `quote: false` salta la quota dal terreno (il Piemonte ha quella dell'ente). Senza `opz` non cambia niente.
// `opz.meteo: false` salta le cinque richieste meteo (fase 3, 27/10/2026): il ritorno al giorno singolo di collectDue
// le chiede solo per i giorni che non hanno ancora il meteo completo. Il ripiego del Piemonte non lo passa: come prima.
async function collectDay(netCfg, dateStr, opz = {}) {
  const w = utcWindowForItalianDay(dateStr);
  const out = pioggiaDaRaw(await fetchJSON(urlProdotto(netCfg, w, 'B13011')), w, netCfg, opz);
  // t/w: un guasto qui non deve mai far fallire la pioggia
  if (opz.meteo !== false) try {
    const meteo = await collectMeteoHub(netCfg, w);
    out.forEach(rec => { if (meteo.out[rec.id]) Object.assign(rec, meteo.out[rec.id]); });
    out.meteoCompleto = meteo.completo;   // proprieta' dell'array: writeDay non la scrive, la legge main
  } catch (e) { console.warn(`  Warn meteo ${netCfg.net}: ${e.message}`); }
  if (opz.quote !== false) await completaQuote(out);   // stazioni nuove, non ancora in quote-terreno.json (14/10/2026)
  return out;
}

/* ⚠️ IERI E L'ALTRO IERI IN UNA RICHIESTA SOLA (27/10/2026, fase 3 dell'alleggerimento delle fonti). Prima ogni giro
   chiedeva ogni prodotto un giorno per volta: 11 reti x 2 giorni x 6 prodotti = 132 richieste, quattro volte al giorno.
   Ora UNA richiesta di pioggia per rete copre i due giorni, che si dividono qui con la stessa finestra di prima, e le
   cinque del meteo si fanno solo per i giorni che non l'hanno ancora completo (`meteo_completo` nel file, vedi main).
   Misurato sulla storia di git (18-26/10): dopo il giro delle 4:30 pioggia e meteo di ieri non cambiano piu' (una
   stazione arpafvg ogni tanto, e la pioggia si richiede comunque a ogni giro).
   DUE DIFESE, cosi' il caso peggiore e' il giro di prima: se la richiesta doppia cade (dopo i suoi 3 tentativi), o se
   per un giorno porta meno stazioni della soglia della rete (una risposta tagliata a meta' senza errore), quel giorno
   si rifa' da solo con collectDay e si tiene il piu' ricco dei due.
   Il meteo si chiede DOPO la pioggia, una richiesta per prodotto per tutti i giorni che lo devono avere, e solo se il
   giorno ha abbastanza stazioni da essere scritto (con la Puglia del 26/10, una stazione sola, erano 5 richieste buttate).
   Di solito e' il solo ieri, cioe' la stessa richiesta di un giorno di prima: due giorni insieme solo la prima volta. */
async function collectDue(netCfg, giorni, meteoDi, soglia) {
  const ws = {}; giorni.forEach(d => { ws[d] = utcWindowForItalianDay(d); });
  const unisci = ds => ({
    qFrom: ds.map(d => ws[d].qFrom).sort()[0], qTo: ds.map(d => ws[d].qTo).sort().pop(),
    refFrom: ds.map(d => ws[d].refFrom).sort()[0], refTo: ds.map(d => ws[d].refTo).sort().pop() });
  let raw = null;
  try { raw = await fetchJSON(urlProdotto(netCfg, unisci(giorni), 'B13011')); }
  catch (e) { console.warn(`  Warn ${netCfg.net}: richiesta doppia caduta (${e.message}), torno al giorno per giorno`); }
  const ris = {};
  for (const d of giorni) {
    let out = raw ? pioggiaDaRaw(raw, ws[d], netCfg, {}) : null;
    if (!out || (soglia >= 10 && out.length < soglia)) {
      if (out) console.log(`  ${d}: ${out.length} stazioni dalla richiesta doppia, sotto la soglia ${soglia}: rifaccio il giorno da solo`);
      await sleep(1000);
      const singolo = await collectDay(netCfg, d, { meteo: false, quote: false });
      if (!out || singolo.length > out.length) out = singolo;
    }
    ris[d] = { stazioni: out };
  }
  const conMeteo = meteoDi.filter(d => ris[d].stazioni.length >= 10);   // sotto le 10 writeDay non scrive
  if (conMeteo.length) {
    await sleep(500);
    const rawMeteo = await scaricaMeteo(netCfg, unisci(conMeteo));
    for (const d of conMeteo) {
      try {   // t/w: un guasto qui non deve mai far fallire la pioggia
        const m = meteoDelGiorno(rawMeteo, ws[d]);
        ris[d].stazioni.forEach(rec => { if (m.out[rec.id]) Object.assign(rec, m.out[rec.id]); });
        ris[d].meteoCompleto = m.completo;
      } catch (e) { console.warn(`  Warn meteo ${netCfg.net} ${d}: ${e.message}`); ris[d].meteoCompleto = false; }
    }
  }
  for (const d of giorni) await completaQuote(ris[d].stazioni);   // stazioni nuove, non in quote-terreno.json (14/10/2026)
  return ris;
}

/** Le stazioni con la pioggia del giorno w da una risposta B13011 (di un giorno o di piu'). */
function pioggiaDaRaw(raw, w, netCfg, opz) {
  const out = [];
  for (const entry of (raw.data || [])) {
    const stat = entry.stat || {};
    if (typeof stat.lat !== 'number' || typeof stat.lon !== 'number') continue;
    // Serie B13011 più fitta per questa stazione (dentro il giorno: vedi serieMigliore)
    const best = serieMigliore(entry, 'B13011', w);
    if (!best) continue;
    // Passo in secondi dal trange "1,0,N" → letture attese nel giorno
    const stepSec = parseInt((best.trange || '').split(',')[2], 10);
    if (!stepSec || stepSec <= 0) continue;
    const expected = Math.round(86400 / stepSec);
    // Accumuli che TERMINANO dentro il giorno italiano: ref > inizio, ref <= fine
    const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
    if (vals.length < expected * 0.85) continue; // giornata troppo bucata: meglio nessun dato che una sottostima
    let mm = vals.reduce((a, v) => a + v.val, 0);
    mm = Math.round(mm * 10) / 10;
    if (mm < 0 || mm > 500) continue;
    const idStaz = `${stat.lat.toFixed(5)}_${stat.lon.toFixed(5)}`;
    const nome = NOMI_FISSI[idStaz] || ripulisciNome(((entry.stat.details || []).find(x => x.var === 'B01019') || {}).val || '—');
    const qTer = quotaTerreno(idStaz);
    const rec = {
      id:  idStaz,
      n:   nome,
      lat: Math.round(stat.lat * 10000) / 10000,
      lon: Math.round(stat.lon * 10000) / 10000,
      q:   qTer,
      p:   netCfg.sigla,
      mm
    };
    if (qTer !== null) rec.qt = 1;   // quota del terreno, non dichiarata dall'ente
    if (opz.ore) rec.h = Math.min(24, Math.round(vals.length * stepSec / 3600));
    const secchielli = creaOre();   // intensita' (12/9/2026)
    for (const v of vals) segna(secchielli, Math.floor((Date.parse(v.ref + 'Z') - 1) / 3600000), v.val);
    const inte = intensita(secchielli);
    if (inte) rec.i = inte;
    out.push(rec);
  }
  return out;
}

/* ── QUOTA DAL TERRENO (26/8/2026) ─────────────────────────────────────────
   Questa fonte l'altitudine non la pubblica: fino al 26/8 scrivevamo `q: 0`,
   cioe' dichiaravamo il livello del mare su pluviometri di montagna. La quota
   arriva da `data/quote-terreno.json` (altezza del TERRENO nel punto della
   stazione, vedi quote-terreno.js) e si porta dietro `qt: 1`, che il sito
   legge per mostrare il ~ davanti al numero.
   ⚠️ Se il file manca la quota resta `null`, cioe' «non lo sappiamo»: MAI 0,
   che vuol dire «sul mare» ed e' un'affermazione falsa.
   ✅ 14/10/2026: misurata contro la quota dichiarata su 1.848 stazioni del
   nord, scarto mediano 5 m: la quota vera dell'ente non serve piu' cercarla.
   Le stazioni che nel file non ci sono (comparse dopo) la chiedono a giro in
   corso: `completaQuote` in fondo a collectDay, vedi lib-quota-terreno.js. */
const { quotaNota: quotaTerreno, completaQuote } = require('./lib-quota-terreno.js');

/** Stazioni REALI (non stimate) presenti in un file già scritto. */
function realiInFile(j) {
  if (!j || !Array.isArray(j.stations)) return 0;
  return j.stations.filter(s => !s.om).length;
}
/** Il file contiene stime Open-Meteo? (copertura intera o integrazione parziale)
 *  ⚠️ 20/8/2026: guardava solo `open-meteo-gapfill`, cioe' i buchi tappati giorno
 *  per giorno, e NON `open-meteo-backfill-<regione>`, cioe' le giornate riempite
 *  in blocco prima che MeteoHub coprisse la regione. Quelle passavano per dato
 *  reale: il backfill a intervallo le saltava («0 giorni da raccogliere») e la
 *  soglia di sicurezza le contava fra i giorni sani. Ora prende tutta la
 *  famiglia `open-meteo*`. */
function haStime(j) {
  return !!j && ((j.source || '').startsWith('open-meteo') || !!j.gapfill ||
                 (Array.isArray(j.stations) && j.stations.some(s => s.om)));
}
function leggiFile(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
/** Quante stazioni reali porta di solito questa rete: mediana sui file recenti. */
function tipicoReali(dir, giorni) {
  const v = [];
  for (const d of giorni) {
    const j = leggiFile(path.join(dir, `${d}.json`));
    if (j && !haStime(j)) v.push(realiInFile(j));
  }
  if (v.length < 3) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/* ⚠️ PICCHI FALSI (17/10/2026). L'8/10/2026 Palermo Abela ha consegnato 471,2 mm
   («18 ore di pioggia», con 34° di massima e il 32% di umidita'), mentre UIR e
   SIAS a 2 km, Chiavelli e Partanna segnavano 0,0: nessuna notizia di nubifragi,
   previsioni di sole. Finiva in testa alla Sicilia a 20 e 30 giorni.
   Regola SEVERA apposta, suo ok: una bomba d'acqua vera fa differenze enormi in
   pochi km, ma lascia sempre qualcosa ai bordi. Si toglie il pluviometro dal
   giorno (assente, non zero: la mappa somma `mm||0`) solo se ha almeno PICCO_MM
   nel giorno E i vicini sono TUTTI sotto PICCO_ASCIUTTO mm, contando:
     - almeno 2 vicini entro 5 km (Abela: UIR e SIAS a 2 km), oppure
     - almeno 3 vicini entro 15 km (Monterosso Almo SP11, 9/10: 362,5 mm con
       Palazzolo Acreide a 8 km, Case Granvilla, Ferla e Noto tutti a 0; il
       giorno dopo pioveva su tutti e lui segnava 15 contro 12-47, cioe' sano).
   Sui 60 giorni di tutte le reti (17/10) prende solo questi due; l'alluvione
   delle Cevenne del 30/9 (300 mm, vicini 150-335) non la tocca. */
const PICCO_MM = 200, PICCO_ASCIUTTO = 1;
const PICCO_CERCHI = [[5, 2], [15, 3]];   // [km, vicini minimi]
function togliPicchiFalsi(stations, dateStr) {
  const km = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) * 111.2;
  return stations.filter(s => {
    if (!(s.mm >= PICCO_MM) || s.lat == null || s.lon == null) return true;
    for (const [r, minimi] of PICCO_CERCHI) {
      const vicini = stations.filter(x => x !== s && x.lat != null && x.mm != null && km(s, x) <= r);
      if (vicini.length >= minimi && vicini.every(x => x.mm < PICCO_ASCIUTTO)) {
        console.warn(`  ⚠️ ${dateStr}: ${s.n} ${s.mm} mm con ${vicini.length} vicini entro ${r} km tutti sotto ${PICCO_ASCIUTTO} mm: picco falso, tolto dal giorno`);
        return false;
      }
    }
    return true;
  });
}

// ⚠️ VENTI FALSI (19/10/2026, quinto check, bug 9): la regola sta in lib-venti-falsi.js dal 20/10/2026 (settimo check,
// bug 11), perche' la usa anche backfill-meteo-meteohub.js. Gira in writeDay DOPO tieniMeteo.
const { togliVentiFalsi } = require('./lib-venti-falsi.js');

// `meteoCompleto`: true = il meteo di questo giro e' completo e definitivo (si scrive `meteo_completo`), false = no,
// undefined = a questo giro il meteo non si e' chiesto e il segno resta quello del file (fase 3, 27/10/2026).
function writeDay(dir, dateStr, stations, net, soglia, src, meteoCompleto) {
  stations = togliPicchiFalsi(stations, dateStr);
  if (stations.length < 10) {
    console.warn(`  ${dateStr}: solo ${stations.length} stazioni, salto la scrittura`);
    return false;
  }
  const outFile = path.join(dir, `${dateStr}.json`);
  // Non peggiorare un giorno già coperto: se il file contiene stime Open-Meteo
  // (che coprono l'intera rete) lo si sostituisce solo quando la raccolta nuova
  // è abbastanza ricca da reggere da sola. Altrimenti si rimpiazzerebbero 130
  // stazioni stimate con le 2 o 3 vere che MeteoHub ha ripubblicato, lasciando
  // la mappa più vuota di prima.
  if (soglia) {
    const vecchio = leggiFile(outFile);
    if (haStime(vecchio) && stations.length < soglia) {
      console.log(`  ${dateStr}: ${stations.length} stazioni reali < soglia ${soglia}, tengo il file con le stime`);
      return false;
    }
    if (haStime(vecchio)) {
      console.log(`  ${dateStr}: dato reale tornato (${stations.length} stazioni), sostituisco le stime`);
    }
  }
  // t/w/u/wd che a questo giro mancano si riprendono dal file dello stesso giorno (bug 6, 19/10/2026):
  // prima il file si riscriveva da capo e una query meteo caduta cancellava i giri precedenti
  const prima = leggiFile(outFile);
  // il vento «provvisorio» (senza raffica, bug 10 del settimo check): dove il file ha gia' un vento si tiene quello
  const conVento = {}; ((prima && prima.stations) || []).forEach(s => { if (s.w) conVento[s.id] = 1; });
  stations.forEach(s => { if (!s.wp) return; delete s.wp; if (conVento[s.id]) { delete s.w; delete s.wd; } });
  const ripresi = prima ? tieniMeteo(stations, prima.stations) : 0;
  if (ripresi) console.log(`  ${dateStr}: t/w/u/wd ripresi dal file per ${ripresi} stazioni`);
  togliVentiFalsi(stations, dateStr);   // dopo tieniMeteo (bug 9, 19/10/2026)
  const segnoMeteo = meteoCompleto === undefined ? !!(prima && prima.meteo_completo) : meteoCompleto;
  fs.writeFileSync(outFile, JSON.stringify(Object.assign({
    date:      dateStr,
    collected: new Date().toISOString(),
    source:    src || 'meteohub-dpcn',
    network:   net,
  }, segnoMeteo ? { meteo_completo: true } : {}, {
    count:     stations.length,
    stations
  })));
  console.log(`  ✅ Scritto ${outFile} (${stations.length} stazioni)`);
  return true;
}

async function main() {
  console.log('=== collect-meteohub avviato (pilota) ===');
  try {
    MH_TOKEN = await loginMeteoHub();
    console.log(MH_TOKEN ? '  accesso MeteoHub con account (archivio aperto)' : '  accesso MeteoHub anonimo (ultimi ~10 giorni)');
  } catch (e) { console.warn('  Warn login MeteoHub: ' + e.message + ' — proseguo anonimo'); }

  const now = new Date();
  const italyNow = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const todayStr = fmtDate(italyNow);
  const noon = new Date(todayStr + 'T12:00:00Z').getTime();

  // SOLO_RETE=arpafvg → lavora su una rete sola. Serve alle prove a mano: senza
  // questo filtro un run di collaudo riscriverebbe anche le dieci cartelle dpcn,
  // che in produzione sono già a posto (19/8/2026).
  const soloRete = (process.env.SOLO_RETE || '').trim();
  const daFare = soloRete ? NETWORKS.filter(n => n.net === soloRete) : NETWORKS;
  if (soloRete && !daFare.length) throw new Error(`SOLO_RETE=${soloRete} non è fra le reti configurate`);

  for (const netCfg of daFare) {
    console.log(`--- Rete ${netCfg.net}`);
    const dir = path.join(DATA_ROOT, netCfg.dir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let targetDays;
    // Stazioni reali minime perché un giorno regga senza stime: mediana dei
    // giorni sani recenti, meno il 10%. La usa writeDay() per NON sostituire
    // una mappa di stime con una raccolta troppo scarsa.
    // ⚠️ Si calcola SEMPRE, anche con DATE_OVERRIDE (corretto il 20/8/2026):
    // prima stava solo nel ramo automatico, quindi un backfill a mano girava
    // con la rete di sicurezza spenta e una giornata parziale poteva svuotare
    // la mappa — esattamente le macchie asciutte false che la soglia evita.
    const recenti = [];
    for (let i = 1; i <= 10; i++) recenti.push(fmtDate(new Date(noon - i * 24 * 3600000)));
    let soglia = Math.floor(tipicoReali(dir, recenti) * 0.9); // 0 se la finestra è troppo scarna
    if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
      // Una data "YYYY-MM-DD" oppure un intervallo "YYYY-MM-DD:YYYY-MM-DD"
      // (backfill con account, 19/8/2026). Nell'intervallo i giorni già
      // scritti con dato reale si saltano: si può rilanciare senza rifare tutto.
      const ov = process.env.DATE_OVERRIDE.trim();
      if (ov.includes(':')) {
        const [da, a] = ov.split(':');
        targetDays = [];
        for (let t = new Date(da + 'T12:00:00Z').getTime(); t <= new Date(a + 'T12:00:00Z').getTime(); t += 86400000) {
          const dStr = new Date(t).toISOString().slice(0, 10);
          const j = leggiFile(path.join(dir, `${dStr}.json`));
          if (j && !haStime(j) && (j.count || 0) >= 10) continue;
          targetDays.push(dStr);
        }
        console.log(`  Intervallo ${da} → ${a}: ${targetDays.length} giorni da raccogliere`);
      } else {
        targetDays = [ov];
      }
    } else {
      // ieri + altroieri sempre; auto-riparazione 3-9 giorni indietro
      // (la finestra pubblica MeteoHub copre ~10 giorni: 9 lascia un giorno di
      // margine ed è più larga dei 7 di prima).
      //
      // Il campanello "questo giorno è venuto male" ora conta le stazioni
      // REALI, non le righe del file (30/7/2026). Prima bastava `count < 10`,
      // e siccome la copertura Open-Meteo scrive un file pieno (130 stazioni
      // stimate per la Puglia del 27/7), dal momento della toppa in poi il
      // giorno sembrava sano e non veniva più riprovato: ci chiudevamo da soli
      // la porta al dato reale, sprecando i giorni di finestra rimasti. Peggio
      // ancora i giorni parziali sopra le 10 stazioni (Molise 29/7: 23 su 28),
      // che non venivano riletti MAI.
      targetDays = [1, 2].map(i => fmtDate(new Date(noon - i * 24 * 3600000)));
      for (let i = 3; i <= 9; i++) {
        const dStr = fmtDate(new Date(noon - i * 24 * 3600000));
        const j = leggiFile(path.join(dir, `${dStr}.json`));
        const reali = realiInFile(j);
        let motivo = null;
        if (!j) motivo = 'file assente';
        else if ((j.count || 0) < 10) motivo = `solo ${j.count || 0} righe`;
        else if (haStime(j)) motivo = `contiene stime (${reali} stazioni reali)`;
        else if (soglia >= 10 && reali < soglia) motivo = `${reali} stazioni reali sotto la soglia ${soglia}`;
        if (motivo) { targetDays.push(dStr); console.log(`  ↻ ${dStr}: ${motivo}, riprovo`); }
      }
    }

    // Il meteo di un giorno si dichiara completo (`meteo_completo`) solo se chiesto almeno ORE_DOPO ore dopo la sua fine:
    // un giro che corre a cavallo della mezzanotte lo chiede, ma il giro dopo lo richiede ancora.
    const tardi = d => Date.now() >= Date.parse(utcWindowForItalianDay(d).refTo + 'Z') + ORE_DOPO * 3600000;
    let singoli = targetDays;
    if (!(process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim())) {
      // ieri + altroieri in una richiesta, col meteo solo dove manca (fase 3, 27/10/2026: vedi collectDue)
      const coppia = targetDays.slice(0, 2);
      singoli = targetDays.slice(2);
      const meteoDi = coppia.filter(d => { const j = leggiFile(path.join(dir, `${d}.json`)); return !(j && j.meteo_completo); });
      console.log(`  Raccolgo ${coppia.join(' + ')} in una richiesta, meteo ${meteoDi.length ? 'di ' + meteoDi.join(' + ') : 'gia\' completo: salto'}`);
      try {
        const ris = await collectDue(netCfg, coppia, meteoDi, soglia);
        for (const d of coppia) {
          const mc = ris[d].meteoCompleto;
          writeDay(dir, d, ris[d].stazioni, netCfg.net, soglia, netCfg.src, mc === undefined ? undefined : mc && tardi(d));
        }
      } catch (e) {
        console.warn(`  Warn: ${netCfg.net} ${coppia.join(' + ')} fallito: ${e.message}`);
      }
      await sleep(1000);
    }
    for (const dStr of singoli) {
      try {
        console.log(`  Raccolgo ${dStr}...`);
        const st = await collectDay(netCfg, dStr);
        writeDay(dir, dStr, st, netCfg.net, soglia, netCfg.src, !!st.meteoCompleto && tardi(dStr));
      } catch(e) {
        console.warn(`  Warn: ${netCfg.net} ${dStr} fallito: ${e.message}`);
      }
      await sleep(1000);
    }

    // ── Pulizia file > 730 giorni (retention finestra scorrevole) ──
    const MAX_DAYS = 730;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    const cutoffStr = cutoff.toISOString().substring(0, 10);
    let deleted = 0;
    fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .forEach(f => {
        if (f.replace('.json', '') < cutoffStr) { fs.unlinkSync(path.join(dir, f)); deleted++; }
      });
    if (deleted > 0) console.log(`  Pulizia retention: ${deleted} file oltre i ${MAX_DAYS} giorni eliminati`);
  }

  console.log('=== collect-meteohub completato ===');
}

// Lanciato da solo raccoglie; richiamato con require (ripiego del Piemonte) da' solo le funzioni.
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exit(1); });
module.exports = { collectDay, togliPicchiFalsi };
