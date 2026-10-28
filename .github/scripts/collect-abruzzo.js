/**
 * collect-abruzzo.js — L'ABRUZZO SENZA OPEN-METEO  (PROVA del 26/10/2026, solo in locale)
 * =====================================================================================
 *
 * L'Abruzzo non pubblica i suoi pluviometri (Polaris ha 15 giorni di ritardo e vuole il login) e fino a
 * oggi la mappa lo calcolava dal vivo con Open-Meteo su 40 paesi: stime, e con un'API che vieta i siti con
 * pubblicita'. Questo collector scrive data/abruzzo/<giorno>.json con due famiglie di punti:
 *
 *  1. MeteoNetwork, rete `mnw` su MeteoHub (CC BY 4.0, attribuzione «MeteoNetwork Association OdV»): le
 *     stazioni amatoriali DENTRO l'Abruzzo, solo con almeno MIN_ORE ore lette. `rete:'mnw'`.
 *  2. Il modello ICON-2I di ItaliaMeteo (CC BY 4.0, file aperti di MeteoHub): ~145 punti sui paesi, uniformi
 *     su tutta la regione (vedi PUNTI_KM). `rete:'icon'` e `stima:1`. La MAPPA tiene solo quelli lontani da un
 *     pluviometro vero; qui si scrivono tutti, cosi' servono anche a misurare quanto sbaglia il modello
 *     dove una stazione c'e'.
 *
 * I pluviometri ufficiali delle regioni vicine (Lazio, Marche, Molise) NON stanno qui: la mappa li legge
 * dalle loro cartelle meteohub-*, come il Friuli fa con le cinque stazioni venete del Cadore.
 *
 * In piu', data/abruzzo/icon-pluviometri/<giorno>.json (27/10/2026): ICON nel punto esatto di ogni pluviometro
 * VERO (gli ufficiali di Lazio, Marche e Molise entro CONFINE_KM dal confine e le MeteoNetwork), stessa media 3x3.
 * La mappa non lo legge: serve al confronto ICON / Open-Meteo / pluviometri (claudio\abruzzo-prova\), che cosi' si
 * puo' fare quando si vuole e non entro gli ~8 giorni dei file ICON. Open-Meteo lo chiede il confronto, non questo
 * giro. Stessi id del confronto: '<cartella>:<id>' e 'mnw:<codice>'.
 *
 * ICON-2I, COME SI LEGGE SENZA LIBRERIE (misurato il 26/10/2026 sulla corsa del 25/10 alle 00):
 *  - un file per corsa (00 e 12 UTC), ~760 MB; l'elenco e' anonimo su /api/datasets/<id>/opendata e lo
 *    scarico anonimo su /api/opendata/<file>, che accetta le richieste Range;
 *  - dentro, 656 messaggi GRIB2: 8 variabili x 73 passi e IN FONDO i 72 messaggi della pioggia `tp`
 *    (0/1/52, template 4.8, accumulo di UN'ora: il passo s e' la pioggia fra +s e +s+1 ore), tutti lunghi
 *    1.158.452 byte;
 *  - griglia regolare 761x761, 3,0-22,0 E passo 0,025, 33,7-48,9 N passo 0,02, da sud a nord,
 *    impacchettamento semplice a 16 bit senza bitmap: valore = (R + X*2^E) / 10^D, in mm.
 *  Per un'ora bastano due richieste piccole: l'intestazione del messaggio (R, E, D, e il controllo che sia
 *  davvero `tp` di quel passo) e le sole RIGHE sopra l'Abruzzo, ~114 KB invece di 1,2 MB.
 *  ⚠️ La posizione si calcola dalla FINE del file. Se l'intestazione non torna (file fatto in un altro modo)
 *  si scorre il file messaggio per messaggio: lento (~3 minuti a corsa) ma giusto.
 *
 * IL GIORNO ITALIANO: le ore che finiscono in (mezzanotte, mezzanotte] italiane. Ogni ora si prende dalla
 * corsa piu' recente partita PRIMA di lei (anticipo piu' corto = previsione migliore).
 *
 * ⚠️ I file aperti di ICON restano ~8 giorni e MeteoNetwork da anonimi ~10: oltre non si recupera.
 *
 * Uso: node collect-abruzzo.js                (ieri e i due giorni prima)
 *      GIORNI=7 node collect-abruzzo.js       (gli ultimi 7)
 *      DATA=2026-10-24 node collect-abruzzo.js
 */
const fs = require('fs');
const path = require('path');
const { MIN_ORE, creaOre, segna, intensita } = require('./lib-intensita.js');
const { finestraGiorno } = require('./lib-giorno-italiano.js');
const { quoteTerrarium } = require('./lib-terrarium.js');

const RADICE = path.join(__dirname, '../..');
const CARTELLA = path.join(RADICE, 'data', 'abruzzo');
const ANAGRAFE = path.join(CARTELLA, 'anagrafe.json');   // nomi e quote, assegnati una volta e tenuti
const MH = 'https://meteohub.agenziaitaliameteo.it';
const ICON_DS = 'ICON_2I_SURFACE_PRESSURE_LEVELS';
const UA = { 'User-Agent': 'avventuremicologiche-mappa-pluviometrica' };

// La griglia ICON-2I (vedi sopra). Se cambiasse, l'intestazione lo dice e il collector si ferma.
const G = { ni: 761, nj: 761, lon0: 3.0, dlon: 0.025, lat0: 33.7, dlat: 0.02 };
const TP_LEN = 1158452, TP_PASSI = 72;
// I PUNTI DELLA STIMA stanno sui PAESI, non su una griglia (27/10/2026, suo: «i paesi piu' grandi, uniformi su
// tutto l'Abruzzo, una disposizione naturale»): la griglia ogni ~9 km in mappa si riconosceva a colpo d'occhio.
//  1. i comuni dal piu' popoloso: un comune si prende se dista almeno PUNTI_KM da quelli gia' presi;
//  2. i buchi: finche' un punto della regione resta oltre BUCO_KM da tutti, nel buco piu' largo va il posto
//     abitato (GeoNames, luoghi/: gli stessi della ricerca del sito) piu' popoloso entro 3,5 km; se non ce n'e',
//     un punto nel buco stesso col nome del posto piu' vicino.
// Misurato il 27/10: 145 punti (101 comuni, 44 nei buchi) contro i 148 della griglia, nessun punto della regione
// oltre 7,5 km; 23 comuni su 27 sopra i 10.000 abitanti hanno il loro punto (gli altri quattro stanno sulla costa a
// meno di 7 km da uno piu' grande). Prova col disegno: claudio\abruzzo-prova\scegli-punti-stima.py.
// Il valore di un punto e' la media delle 3x3 celle intorno (~7 km): un modello a 2,2 km sbaglia di qualche km
// dove mette il temporale, e la cella singola raddoppierebbe l'errore (pioggia dove non e' caduta, niente dove e'
// caduta). Se la regola cambia si alza PUNTI_VERSIONE: l'anagrafe rifa' i punti al giro dopo.
const PUNTI_KM = 7, BUCO_KM = 7.5, PUNTI_VERSIONE = 2;

// ─── Confine dell'Abruzzo e paesi (per i nomi) ─────────────────────────────
const geo = JSON.parse(fs.readFileSync(path.join(RADICE, 'italia-regioni-confine.geojson'), 'utf8'));
const feat = geo.features.find(f => /abruzz/i.test(f.properties.reg_name || ''));
const POLI = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
function inAnello(lon, lat, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inAbruzzo = (lat, lon) => POLI.some(p => inAnello(lon, lat, p[0]) && !p.slice(1).some(h => inAnello(lon, lat, h)));
const km = (a1, o1, a2, o2) => Math.hypot((o2 - o1) * Math.cos((a1 + a2) * Math.PI / 360) * 111.32, (a2 - a1) * 110.57);

const PAESI = fs.readFileSync(path.join(RADICE, 'data', 'elenco-paesi.txt'), 'utf8').split('\n')
  .map(r => r.split('|')).filter(c => c[4] === 'abruzzo')
  .map(c => ({ n: c[0], lat: +c[1], lon: +c[2], p: c[3], pop: +c[5] || 0 }));
function paeseVicino(lat, lon) {
  let best = null, d = Infinity;
  for (const p of PAESI) { const x = km(lat, lon, p.lat, p.lon); if (x < d) { d = x; best = p; } }
  return best;
}

// ─── Giorni ────────────────────────────────────────────────────────────────
function giorniDaFare() {
  if (process.env.DATA) return [process.env.DATA];
  const n = parseInt(process.env.GIORNI || '3', 10), out = [];
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  for (let g = 1; g <= n; g++) {
    const d = new Date(oggi + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - g);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function json(url, ms = 60000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' su ' + url);
  return r.json();
}

// ─── 1. MeteoNetwork ───────────────────────────────────────────────────────
// Un giorno a richiesta (da anonimi MeteoHub ne da' al massimo tre). Le letture sono accumuli che
// FINISCONO al loro reftime (UTC): l'ora e' quella di (ref - 1 ms), il giorno e' (inizio, fine].
async function meteoNetwork(giorno) {
  const { start, end } = finestraGiorno(giorno);
  const f = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const q = `reftime: >=${f(start)},<=${f(end)};product:B13011;license:CCBY_COMPLIANT`;
  const d = await json(`${MH}/api/observations?networks=mnw&q=${encodeURIComponent(q)}`, 120000);
  const out = [];
  for (const x of d.data || []) {
    const { lat, lon } = x.stat;
    if (!(lat > 41.6 && lat < 43.0 && lon > 13.0 && lon < 14.9) || !inAbruzzo(lat, lon)) continue;
    const cod = ((x.stat.details || []).find(v => v.var === 'B01019') || {}).val;
    if (!cod) continue;
    // la serie piu' fitta, come collect-meteohub.js
    const serie = (x.prod || []).filter(p => p.var === 'B13011').sort((a, b) => b.val.length - a.val.length)[0];
    if (!serie) continue;
    const ore = creaOre();
    let mm = 0;
    for (const v of serie.val) {
      const t = Date.parse(v.ref + 'Z');
      if (!(t > start && t <= end) || typeof v.val !== 'number') continue;
      const chiave = new Date(t - 1).toISOString().slice(0, 13);
      segna(ore, chiave, v.val);
      if (v.val > 0) mm += v.val;
    }
    const h = Object.keys(ore).length;
    if (h < MIN_ORE) continue;   // giornata bucata: meglio nessun pallino che un totale di mezza giornata
    out.push({ cod, lat, lon, h, mm: Math.round(mm * 10) / 10, i: intensita(ore) });
  }
  return out;
}

// ─── 2. ICON-2I ────────────────────────────────────────────────────────────
const u16 = (b, p) => b.readUInt16BE(p);
const sm16 = (b, p) => { const v = b.readUInt16BE(p); return (v & 0x8000) ? -(v & 0x7fff) : v; };   // segno e modulo

async function intervallo(file, a, b) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`${MH}/api/opendata/${file}`, { headers: { ...UA, Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(60000) });
      if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
      const tot = (r.headers.get('content-range') || '').split('/')[1];
      return { buf: Buffer.from(await r.arrayBuffer()), tot: tot ? +tot : null };
    } catch (e) {
      if (t === 3) throw e;
      await new Promise(ok => setTimeout(ok, 1500 * (t + 1)));
    }
  }
}

// Le sezioni 0-6 di un messaggio: che cosa e', e dove cominciano i suoi numeri.
function intestazione(b) {
  if (b.toString('ascii', 0, 4) !== 'GRIB' || b[7] !== 2) return null;
  const m = { len: Number(b.readBigUInt64BE(8)) };
  let p = 16;
  while (p + 5 <= b.length) {
    const L = b.readUInt32BE(p), num = b[p + 4];
    if (num === 3) { m.ni = b.readUInt32BE(p + 30); m.nj = b.readUInt32BE(p + 34); }
    if (num === 4) { m.tpl = u16(b, p + 7); m.cat = b[p + 9]; m.num = b[p + 10]; m.passo = b.readUInt32BE(p + 18); }
    if (num === 5) { m.pack = u16(b, p + 9); m.R = b.readFloatBE(p + 11); m.E = sm16(b, p + 15); m.D = sm16(b, p + 17); m.bit = b[p + 19]; }
    if (num === 6) m.bitmap = b[p + 5];
    if (num === 7) { m.dati = p + 5; return m; }
    if (L <= 0) return null;
    p += L;
  }
  return null;
}

const indici = {};   // file -> {passo: offset}, solo quando serve scorrere tutto
async function scorri(file, tot) {
  if (indici[file]) return indici[file];
  const idx = {};
  let off = 0;
  while (off < tot) {
    const { buf } = await intervallo(file, off, Math.min(tot - 1, off + 1023));
    const m = intestazione(buf);
    if (!m) break;
    if (m.cat === 1 && m.num === 52 && m.tpl === 8) idx[m.passo] = off;
    off += m.len;
  }
  return (indici[file] = idx);
}

const dimensioni = {};
// La pioggia di UN'ora (passo s della corsa in `file`) sui punti chiesti: array di mm.
async function oraIcon(file, s, punti, rig) {
  if (!dimensioni[file]) dimensioni[file] = (await intervallo(file, 0, 0)).tot;
  const tot = dimensioni[file];
  let off = tot - (TP_PASSI - s) * TP_LEN;
  let { buf } = await intervallo(file, off, off + 511);
  let m = intestazione(buf);
  if (!m || m.cat !== 1 || m.num !== 52 || m.tpl !== 8 || m.passo !== s) {
    console.log(`   ⚠️ ${file.slice(0, 24)}: il passo ${s} non e' dove ci si aspetta, scorro il file`);
    off = (await scorri(file, tot))[s];
    if (off === undefined) throw new Error(`passo ${s} assente`);
    ({ buf } = await intervallo(file, off, off + 511));
    m = intestazione(buf);
  }
  if (m.ni !== G.ni || m.nj !== G.nj || m.pack !== 0 || m.bit !== 16 || m.bitmap !== 255) {
    throw new Error(`griglia o impacchettamento diversi (${m.ni}x${m.nj}, template ${m.pack}, ${m.bit} bit, bitmap ${m.bitmap})`);
  }
  const riga = G.ni * 2;
  const a = off + m.dati + rig.j0 * riga, b = off + m.dati + (rig.j1 + 1) * riga - 1;
  const dati = (await intervallo(file, a, b)).buf;
  const sc = Math.pow(2, m.E), dc = Math.pow(10, -m.D);
  const val = (i, j) => (m.R + dati.readUInt16BE((j - rig.j0) * riga + i * 2) * sc) * dc;
  return punti.map(pt => {
    let t = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { t += val(pt.i + di, pt.j + dj); n++; }
    return Math.max(0, t / n);
  });
}

async function corseIcon() {
  const elenco = await json(`${MH}/api/datasets/${ICON_DS}/opendata`);
  return elenco.map(e => ({ rif: Date.parse(e.date + 'T' + e.run + ':00Z'), file: e.filename }))
    .sort((a, b) => b.rif - a.rif);   // dalla piu' recente
}

async function iconGiorno(giorno, corse, punti) {
  const { start, end } = finestraGiorno(giorno);
  const rig = { j0: Math.min(...punti.map(p => p.j)) - 1, j1: Math.max(...punti.map(p => p.j)) + 1 };
  const somma = new Array(punti.length).fill(0);
  const usate = new Set();
  for (let fine = start + 3600000; fine <= end; fine += 3600000) {
    // la corsa piu' recente partita prima dell'ora, con quell'ora dentro i suoi 72 passi
    const c = corse.find(x => x.rif <= fine - 3600000 && (fine - x.rif) / 3600000 <= TP_PASSI);
    if (!c) return null;   // un'ora scoperta: niente stima del giorno, non mezza
    const s = (fine - c.rif) / 3600000 - 1;
    const v = await oraIcon(c.file, s, punti, rig);
    v.forEach((x, k) => { somma[k] += x; });
    usate.add(new Date(c.rif).toISOString().slice(0, 13));
  }
  return { mm: somma.map(x => Math.round(x * 10) / 10), corse: [...usate].sort() };
}

// ─── Anagrafe: nomi e quote assegnati una volta ────────────────────────────
// I nomi devono restare uguali da un giorno all'altro (il grafico della scheda cerca la stazione per
// nome nei file dei giorni), quindi si scrivono la prima volta e poi si rileggono.
function caricaAnagrafe() {
  try { return JSON.parse(fs.readFileSync(ANAGRAFE, 'utf8')); } catch (e) { return { mnw: {}, icon: [] }; }
}
async function puntiIcon(an) {
  if (an.icon.length && an.iconV === PUNTI_VERSIONE) return an.icon;
  const pts = [];
  for (const c of [...PAESI].sort((a, b) => b.pop - a.pop)) {
    if (pts.every(p => km(c.lat, c.lon, p.lat, p.lon) >= PUNTI_KM)) pts.push({ n: c.n, lat: c.lat, lon: c.lon });
  }
  const luoghi = [];
  for (const f of fs.readdirSync(path.join(RADICE, 'luoghi')).filter(f => f.endsWith('.tsv'))) {
    for (const r of fs.readFileSync(path.join(RADICE, 'luoghi', f), 'utf8').split('\n')) {
      const c = r.split('\t');
      if (c[7] === 'Abruzzo' && /^PPL/.test(c[11] || '')) luoghi.push({ n: c[3], lat: +c[4], lon: +c[5], pop: +c[10] || 0 });
    }
  }
  const tutti = luoghi.concat(PAESI);
  // la regione a celle di ~1 km, e per ogni cella quanto dista il punto piu' vicino
  const celle = [];
  for (let lat = 41.66; lat <= 42.92; lat += 0.009) for (let lon = 13.0; lon <= 14.82; lon += 0.012) if (inAbruzzo(lat, lon)) celle.push([lat, lon]);
  const d = celle.map(([a, o]) => Math.min(...pts.map(p => km(a, o, p.lat, p.lon))));
  for (;;) {
    let k = 0;
    d.forEach((x, i) => { if (x > d[k]) k = i; });
    if (d[k] <= BUCO_KM) break;
    const [a, o] = celle[k];
    const cand = tutti.filter(l => km(a, o, l.lat, l.lon) <= 3.5 && inAbruzzo(l.lat, l.lon) &&
      pts.every(p => km(l.lat, l.lon, p.lat, p.lon) >= PUNTI_KM * 0.7))
      .sort((x, y) => (y.pop - x.pop) || (km(a, o, x.lat, x.lon) - km(a, o, y.lat, y.lon)));
    let p;
    if (cand.length) p = { n: cand[0].n, lat: cand[0].lat, lon: cand[0].lon };
    else {
      const v = tutti.reduce((m, l) => (km(a, o, l.lat, l.lon) < km(a, o, m.lat, m.lon) ? l : m));
      p = { n: v.n, lat: Math.round(a * 1000) / 1000, lon: Math.round(o * 1000) / 1000 };
    }
    pts.push(p);
    celle.forEach(([ca, co], i) => { const x = km(ca, co, p.lat, p.lon); if (x < d[i]) d[i] = x; });
  }
  const q = await quoteTerrarium(pts);
  const usati = {};
  an.icon = pts.map((pt, k) => {
    usati[pt.n] = (usati[pt.n] || 0) + 1;
    return { id: 'icon_' + pt.lat.toFixed(3) + '_' + pt.lon.toFixed(3), n: pt.n, lat: pt.lat, lon: pt.lon, q: q[k], p: paeseVicino(pt.lat, pt.lon).p };
  });
  // due punti con lo stesso nome (non capita il 27/10, ma GeoNames ha molte «San Martino»): il secondo prende un 2
  const conta = {};
  an.icon.forEach(pt => { if (usati[pt.n] > 1) { conta[pt.n] = (conta[pt.n] || 0) + 1; if (conta[pt.n] > 1) pt.n += ' ' + conta[pt.n]; } });
  an.iconV = PUNTI_VERSIONE;
  console.log(`📌 ${an.icon.length} punti di stima sui paesi (comuni ogni ${PUNTI_KM} km, buchi fino a ${BUCO_KM} km)`);
  return an.icon;
}
async function nomiMnw(an, staz) {
  const nuove = staz.filter(s => !an.mnw[s.cod]);
  if (!nuove.length) return;
  const q = await quoteTerrarium(nuove);
  nuove.forEach((s, k) => {
    const pv = paeseVicino(s.lat, s.lon);
    let n = pv.n;
    const presi = new Set(Object.values(an.mnw).map(x => x.n));
    for (let i = 2; presi.has(n); i++) n = pv.n + ' ' + i;
    an.mnw[s.cod] = { n, p: pv.p, q: q[k] };
  });
}

// ─── Le stazioni MeteoNetwork FERME ────────────────────────────────────────
// Una stazione amatoriale puo' restare a zero col pluviometro intasato o rotto: in mappa diventa un buco
// bianco in mezzo alla pioggia (L'Aquila abr034, 27/10/2026: 0,0 mm in 8 giorni contro 29,2 dei vicini).
// Stessa idea di check-stazioni-ferme.js, sui soli pluviometri VERI vicini (le altre MeteoNetwork e gli
// ufficiali di confine entro FERME_KM), su una finestra corta: si guardano i giorni con almeno due
// testimoni, si somma lei e si somma la mediana dei testimoni; FERMA se i testimoni fanno almeno
// FERME_MIN_MM e lei meno del FERME_QUOTA. Si rifa' a ogni giro: se torna a misurare, rientra da sola.
// Non tocca un dato: segna `ferma` nell'anagrafe e la mappa non la disegna.
// Misurato il 27/10 su 19 stazioni: fuori solo abr034; la piu' bassa dopo e' Castel di Sangro al 26% (piu'
// asciutta dei vicini di montagna del Molise, ma misura: resta).
const FERME_KM = 25, FERME_GIORNI = 30, FERME_MIN_MM = 20, FERME_QUOTA = 0.15, FERME_MIN_GIORNI = 3;
const VICINE = ['meteohub-lazio', 'meteohub-marche', 'meteohub-molise'];

// ─── ICON sui pluviometri veri, per il confronto ───────────────────────────
// Gli stessi pluviometri e gli stessi id di confronto-raccogli.js (banco di lavoro): gli ufficiali delle tre
// vicine entro CONFINE_KM dal confine abruzzese, dai file del giorno nel checkout (non le stime che coprono i
// buchi), e le MeteoNetwork del giorno. Se il file di una vicina non c'e' ancora, quei punti li prende il giro dopo.
const CONFINE_KM = 15;
const VERTICI = POLI.flatMap(p => p[0]).filter((_, i) => i % 3 === 0);
const distConfine = (lat, lon) => Math.min(...VERTICI.map(([lo, la]) => km(lat, lon, la, lo)));
function pluviometriVeri(giorno, mnw, prima) {
  const out = {};
  for (const dir of VICINE) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', dir, giorno + '.json'), 'utf8')); } catch (e) { continue; }
    if (/open-meteo/.test(d.source || '')) continue;
    for (const s of d.stations || []) {
      if (s.om || s.mm == null || s.lat == null || !(s.lat > 41.3 && s.lat < 43.2 && s.lon > 12.6 && s.lon < 15.3)) continue;
      if (distConfine(s.lat, s.lon) <= CONFINE_KM) out[dir + ':' + s.id] = s;
    }
  }
  ((prima && prima.stations) || []).concat(mnw).forEach(s => { if (s.cod) out['mnw:' + s.cod] = s; });   // solo le MeteoNetwork hanno cod
  return Object.entries(out).map(([id, s]) => ({ id, i: Math.round((s.lon - G.lon0) / G.dlon), j: Math.round((s.lat - G.lat0) / G.dlat) }));
}
// Un file per giorno: {id: mm di ICON}. Rifacendo un giorno si aggiorna, e un punto che stavolta manca resta.
function scriviIconPluviometri(giorno, veri, mm, corse) {
  const dir = path.join(CARTELLA, 'icon-pluviometri'), f = path.join(dir, giorno + '.json');
  fs.mkdirSync(dir, { recursive: true });
  let icon = {};
  try { icon = JSON.parse(fs.readFileSync(f, 'utf8')).icon || {}; } catch (e) {}
  veri.forEach((p, k) => { icon[p.id] = mm[k]; });
  fs.writeFileSync(f, JSON.stringify({ date: giorno, collected: new Date().toISOString(), icon_corse: corse, count: Object.keys(icon).length, icon }));
}

function segnaFerme(an) {
  const giorni = fs.readdirSync(CARTELLA).filter(f => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(-FERME_GIORNI).map(f => f.slice(0, 10));
  const mnw = {}, altri = {};
  for (const g of giorni) {
    const d = JSON.parse(fs.readFileSync(path.join(CARTELLA, g + '.json'), 'utf8'));
    for (const s of d.stations) {
      if (s.rete !== 'mnw') continue;
      (mnw[s.cod] = mnw[s.cod] || { lat: s.lat, lon: s.lon, mm: {} }).mm[g] = s.mm;
    }
    for (const dir of VICINE) {
      let v; try { v = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', dir, g + '.json'), 'utf8')); } catch (e) { continue; }
      if (/open-meteo/.test(v.source || '')) continue;
      for (const s of v.stations || []) {
        if (s.om || s.mm == null || s.lat == null || !(s.lat > 41.3 && s.lat < 43.3 && s.lon > 12.6 && s.lon < 15.3)) continue;
        (altri[dir + ':' + s.id] = altri[dir + ':' + s.id] || { lat: s.lat, lon: s.lon, mm: {} }).mm[g] = s.mm;
      }
    }
  }
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  for (const cod in mnw) {
    const s = mnw[cod], a = an.mnw[cod];
    if (!a) continue;
    const testi = Object.entries(mnw).filter(([k]) => k !== cod).map(([, v]) => v).concat(Object.values(altri))
      .filter(v => km(s.lat, s.lon, v.lat, v.lon) <= FERME_KM);
    let lei = 0, vicini = 0, n = 0;
    for (const g in s.mm) {
      const w = testi.filter(v => v.mm[g] != null).map(v => v.mm[g]).sort((x, y) => x - y);
      if (w.length < 2) continue;
      const h = w.length >> 1;
      vicini += w.length % 2 ? w[h] : (w[h - 1] + w[h]) / 2;
      lei += s.mm[g]; n++;
    }
    const ferma = n >= FERME_MIN_GIORNI && vicini >= FERME_MIN_MM && lei < FERME_QUOTA * vicini;
    if (ferma) {
      if (!a.ferma) console.log(`🚫 ${cod} ${a.n}: ${lei.toFixed(1)} mm contro ${vicini.toFixed(1)} dei vicini in ${n} giorni: fuori dalla mappa`);
      a.ferma = { dal: (a.ferma && a.ferma.dal) || oggi, lei: Math.round(lei * 10) / 10, vicini: Math.round(vicini * 10) / 10, giorni: n };
    } else if (a.ferma) {
      console.log(`✅ ${cod} ${a.n}: ${lei.toFixed(1)} mm contro ${vicini.toFixed(1)} dei vicini: rientra`);
      delete a.ferma;
    }
  }
}

// ─── Giro ──────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(CARTELLA, { recursive: true });
  const an = caricaAnagrafe();
  const punti = (await puntiIcon(an)).map(p => ({ ...p,
    i: Math.round((p.lon - G.lon0) / G.dlon), j: Math.round((p.lat - G.lat0) / G.dlat) }));
  let corse = [];
  try { corse = await corseIcon(); } catch (e) { console.log('⚠️ elenco ICON non disponibile:', e.message); }

  let errori = 0;
  for (const giorno of giorniDaFare()) {
    const file = path.join(CARTELLA, giorno + '.json');
    let prima = null;
    try { prima = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const vecchie = {};
    (prima && prima.stations || []).forEach(s => { vecchie[s.id] = s; });

    let mnw = [];
    try { mnw = await meteoNetwork(giorno); await nomiMnw(an, mnw); }
    catch (e) { errori++; console.log(`⚠️ ${giorno} MeteoNetwork:`, e.message); }

    // i punti della stima e, in coda, i pluviometri veri: una lettura sola dei file ICON per tutti e due
    const veri = pluviometriVeri(giorno, mnw, prima);
    let icon = null;
    try { if (corse.length) icon = await iconGiorno(giorno, corse, punti.concat(veri)); }
    catch (e) { errori++; console.log(`⚠️ ${giorno} ICON-2I:`, e.message); }
    if (icon) scriviIconPluviometri(giorno, veri, icon.mm.slice(punti.length), icon.corse);

    const st = {};
    for (const s of mnw) {
      const a = an.mnw[s.cod], id = 'mnw_' + s.cod;
      const v = vecchie[id];
      if (v && v.h > s.h) continue;   // vince chi ha letto piu' ore, come il Piemonte
      st[id] = { id, n: a.n, lat: s.lat, lon: s.lon, q: a.q, qt: 1, p: a.p, mm: s.mm, h: s.h, rete: 'mnw', cod: s.cod };
      if (s.i) st[id].i = s.i;
    }
    if (icon) punti.forEach((pt, k) => {
      st[pt.id] = { id: pt.id, n: pt.n, lat: pt.lat, lon: pt.lon, q: pt.q, qt: 1, p: pt.p, mm: icon.mm[k], rete: 'icon', stima: 1 };
    });
    // quello che non e' arrivato stavolta resta com'era (un giro andato male non cancella)
    for (const id in vecchie) if (!st[id] && !(icon && vecchie[id].rete === 'icon')) st[id] = vecchie[id];

    const stations = Object.values(st).sort((a, b) => (a.rete === b.rete ? 0 : a.rete === 'mnw' ? -1 : 1) || a.n.localeCompare(b.n, 'it'));
    if (!stations.length) { console.log(`— ${giorno}: niente da scrivere`); continue; }
    const out = {
      date: giorno, collected: new Date().toISOString(), source: 'meteonetwork+icon-2i',
      icon_corse: icon ? icon.corse : (prima && prima.icon_corse) || null,
      count: stations.length, stations,
    };
    fs.writeFileSync(file, JSON.stringify(out));
    const nm = stations.filter(s => s.rete === 'mnw'), ni = stations.filter(s => s.rete === 'icon');
    const media = a => a.length ? (a.reduce((t, s) => t + s.mm, 0) / a.length).toFixed(1) : '—';
    console.log(`✅ ${giorno}: MeteoNetwork ${nm.length} (media ${media(nm)} mm) · ICON ${ni.length} punti (media ${media(ni)} mm)` +
      (icon ? ` · corse ${icon.corse.join(', ')} · ICON su ${veri.length} pluviometri veri` : ' · ICON non disponibile'));
  }
  segnaFerme(an);
  fs.writeFileSync(ANAGRAFE, JSON.stringify(an, null, 1));
  if (errori) process.exitCode = 1;
}

// Lanciato da solo fa il giro; con require presta i pezzi (il confronto con Open-Meteo e coi pluviometri veri).
if (require.main === module) main().catch(e => { console.error('❌', e); process.exit(1); });
module.exports = { meteoNetwork, corseIcon, oraIcon, iconGiorno, inAbruzzo, km, G, segnaFerme, caricaAnagrafe, puntiIcon, ANAGRAFE };
