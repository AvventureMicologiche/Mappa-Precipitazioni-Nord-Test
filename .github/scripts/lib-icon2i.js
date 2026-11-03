/**
 * lib-icon2i.js — LA PIOGGIA DEL MODELLO ICON-2I, dai file aperti di MeteoHub
 * ===========================================================================
 *
 * Nata il 26/10/2026 dentro collect-abruzzo.js (l'Abruzzo senza Open-Meteo), spostata qui il 2/11/2026 (scheda 111)
 * perche' serve anche a tappare i buchi delle altre reti al posto di Open-Meteo (check-meteohub-gaps.js,
 * check-gaps-nord.js): il piano gratuito di Open-Meteo vieta i siti con pubblicita' o abbonamenti. ICON-2I e' il
 * modello di ItaliaMeteo a 2,2 km, CC BY 4.0. Confronto coi pluviometri d'Abruzzo dal 20/10 all'1/11/2026 (81
 * pluviometri, 953 coppie): errore medio ICON 2,2 mm contro 2,0 di Open-Meteo, ma nei giorni da 5 mm in su ICON
 * arriva a 0,9 del vero e Open-Meteo a 0,5 (totali x1,1 contro x0,7). Banco di lavoro, `abruzzo-prova\`.
 *
 * COME SI LEGGE SENZA LIBRERIE (misurato il 26/10/2026 sulla corsa del 25/10 alle 00):
 *  - un file per corsa (00 e 12 UTC), ~760 MB; l'elenco e' anonimo su /api/datasets/<id>/opendata e lo
 *    scarico anonimo su /api/opendata/<file>, che accetta le richieste Range;
 *  - dentro, 656 messaggi GRIB2: 8 variabili x 73 passi e IN FONDO i 72 messaggi della pioggia `tp`
 *    (0/1/52, template 4.8, accumulo di UN'ora: il passo s e' la pioggia fra +s e +s+1 ore), tutti lunghi
 *    1.158.452 byte;
 *  - griglia regolare 761x761, 3,0-22,0 E passo 0,025, 33,7-48,9 N passo 0,02, da sud a nord,
 *    impacchettamento semplice a 16 bit senza bitmap: valore = (R + X*2^E) / 10^D, in mm.
 *  Per un'ora bastano due richieste piccole: l'intestazione del messaggio (R, E, D, e il controllo che sia
 *  davvero `tp` di quel passo) e le sole RIGHE sopra i punti chiesti (l'Abruzzo ~114 KB invece di 1,2 MB).
 *  ⚠️ La posizione si calcola dalla FINE del file. Se l'intestazione non torna (file fatto in un altro modo)
 *  si scorre il file messaggio per messaggio: lento (~3 minuti a corsa) ma giusto.
 *
 * IL GIORNO ITALIANO: le ore che finiscono in (mezzanotte, mezzanotte] italiane. Ogni ora si prende dalla
 * corsa piu' recente partita PRIMA di lei (anticipo piu' corto = previsione migliore).
 *
 * IL VALORE DI UN PUNTO e' la media delle 3x3 celle intorno (~7 km): un modello a 2,2 km sbaglia di qualche km
 * dove mette il temporale, e la cella singola raddoppierebbe l'errore. Il confronto qui sopra e' fatto cosi'.
 *
 * ⚠️ I file aperti restano ~8 giorni: un buco piu' vecchio non si tappa piu' con ICON, resta buco.
 */
const { finestraGiorno } = require('./lib-giorno-italiano.js');

const MH = 'https://meteohub.agenziaitaliameteo.it';
const ICON_DS = 'ICON_2I_SURFACE_PRESSURE_LEVELS';
const UA = { 'User-Agent': 'avventuremicologiche-mappa-pluviometrica' };

// La griglia ICON-2I (vedi sopra). Se cambiasse, l'intestazione lo dice e la lettura si ferma.
const G = { ni: 761, nj: 761, lon0: 3.0, dlon: 0.025, lat0: 33.7, dlat: 0.02 };
const TP_LEN = 1158452, TP_PASSI = 72;

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
const testate = {};   // 'file|passo' -> {off, m}: due regioni nello stesso giro non rileggono l'intestazione
// La pioggia di UN'ora (passo s della corsa in `file`) sui punti chiesti: array di mm.
async function oraIcon(file, s, punti, rig) {
  let t = testate[file + '|' + s];
  if (!t) {
    if (!dimensioni[file]) dimensioni[file] = (await intervallo(file, 0, 0)).tot;
    const tot = dimensioni[file];
    let off = tot - (TP_PASSI - s) * TP_LEN;
    let { buf } = await intervallo(file, off, off + 511);
    let m = intestazione(buf);
    if (!m || m.cat !== 1 || m.num !== 52 || m.tpl !== 8 || m.passo !== s) {
      // capita (2/11/2026: la corsa del 31/10 alle 00): l'indice si fa una volta, ~2 minuti, poi serve a tutti i passi
      if (!indici[file]) console.log(`   ⚠️ ${file.slice(0, 24)}: la pioggia non e' dove ci si aspetta, scorro il file`);
      off = (await scorri(file, tot))[s];
      if (off === undefined) throw new Error(`passo ${s} assente`);
      ({ buf } = await intervallo(file, off, off + 511));
      m = intestazione(buf);
    }
    if (m.ni !== G.ni || m.nj !== G.nj || m.pack !== 0 || m.bit !== 16 || m.bitmap !== 255) {
      throw new Error(`griglia o impacchettamento diversi (${m.ni}x${m.nj}, template ${m.pack}, ${m.bit} bit, bitmap ${m.bitmap})`);
    }
    t = testate[file + '|' + s] = { off, m };
  }
  const { off, m } = t;
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
  const r = await fetch(`${MH}/api/datasets/${ICON_DS}/opendata`, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sull\'elenco delle corse ICON');
  return (await r.json()).map(e => ({ rif: Date.parse(e.date + 'T' + e.run + ':00Z'), file: e.filename }))
    .sort((a, b) => b.rif - a.rif);   // dalla piu' recente
}

// La pioggia del giorno italiano sui punti ({i, j} di griglia, vedi cella()): {mm: [...], corse: [...]}, oppure
// null se anche una sola ora non e' coperta dalle corse rimaste sui server (niente stima del giorno, non mezza).
async function iconGiorno(giorno, corse, punti) {
  const { start, end } = finestraGiorno(giorno);
  const rig = { j0: Math.min(...punti.map(p => p.j)) - 1, j1: Math.max(...punti.map(p => p.j)) + 1 };
  const somma = new Array(punti.length).fill(0);
  const usate = new Set();
  for (let fine = start + 3600000; fine <= end; fine += 3600000) {
    // la corsa piu' recente partita prima dell'ora, con quell'ora dentro i suoi 72 passi
    const c = corse.find(x => x.rif <= fine - 3600000 && (fine - x.rif) / 3600000 <= TP_PASSI);
    if (!c) return null;
    const s = (fine - c.rif) / 3600000 - 1;
    const v = await oraIcon(c.file, s, punti, rig);
    v.forEach((x, k) => { somma[k] += x; });
    usate.add(new Date(c.rif).toISOString().slice(0, 13));
  }
  return { mm: somma.map(x => Math.round(x * 10) / 10), corse: [...usate].sort() };
}

// La cella di griglia di un punto, o null se il punto sta fuori (servono anche le 8 celle intorno).
function cella(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const i = Math.round((lon - G.lon0) / G.dlon), j = Math.round((lat - G.lat0) / G.dlat);
  return (i >= 1 && i <= G.ni - 2 && j >= 1 && j <= G.nj - 2) ? { i, j } : null;
}

// LE STIME PER I BUCHI (2/11/2026): ICON sulle coordinate di ogni stazione ({id, lat, lon}). Ritorna
// {mm: Map id -> mm, corse}, o null se il giorno non e' piu' (o non ancora) tutto sui server. Una stazione fuori dalla
// griglia non ha valore e il chiamante non la scrive: assente non e' zero.
async function stimaIcon(stazioni, giorno, corse) {
  const punti = [];
  for (const s of stazioni) { const c = cella(s.lat, s.lon); if (c) punti.push({ id: s.id, ...c }); }
  if (!punti.length) return { mm: new Map(), corse: [] };
  const r = await iconGiorno(giorno, corse, punti);
  if (!r) return null;
  return { mm: new Map(punti.map((p, k) => [p.id, r.mm[k]])), corse: r.corse };
}

module.exports = { MH, UA, G, TP_LEN, TP_PASSI, corseIcon, oraIcon, iconGiorno, cella, stimaIcon };
