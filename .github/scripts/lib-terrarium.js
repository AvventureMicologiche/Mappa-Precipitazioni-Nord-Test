/**
 * L'ALTEZZA DEL TERRENO DALLE TESSERE «TERRARIUM»  (25/10/2026)
 * =============================================================
 *
 * Al posto di Open-Meteo Elevation: il piano gratuito di Open-Meteo vieta i siti
 * con pubblicita' o abbonamenti (deciso il 25/10/2026 di toglierlo da tutto il
 * sito). Le Terrain Tiles di Mapzen sono open data su AWS: PNG a 256 px con la
 * quota nei colori, quota = R*256 + G + B/256 - 32768. Nessuna chiave, nessun
 * limite di richieste dichiarato, e una tessera serve tutte le stazioni che ci
 * cadono dentro.
 *
 * ⚠️ PERCHE' NON LE NOSTRE TESSERE TINITALY (10 m): sono WebP, e Node senza
 * librerie esterne il WebP non lo sa leggere (i collector girano con node e
 * basta, niente npm install). Le terrarium sono PNG e il PNG si legge con zlib.
 *
 * La usano lib-quota-terreno.js (a giro in corso), quote-terreno.js (a mano) e
 * lib-quota-paesi.js (pagine meteo di zona).
 *
 * MISURATA il 25/10/2026 su 537 pluviometri del nord con la quota DICHIARATA dall'ente
 * (scratchpad della scheda 93, misura-quote.py): scarto mediano 5 m, 90% entro 20 m, 2 oltre i 100 m.
 * Open-Meteo sugli stessi: 5 m, 26 m, 4. TINITALY (le nostre tessere): 3 m, 16 m, 2. Zoom 12 e 13 uguali.
 * I due peggiori sono gli stessi per tutte le fonti (Castione della Presolana, Valtorta: +130 m), cioe'
 * coordinate della stazione, non il modello.
 */
const zlib = require('zlib');

const Z = 12;   // ~27 m di pixel alle nostre latitudini: lo zoom 13 misura uguale e scarica quattro volte tanto
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const tessere = new Map();   // "z/x/y" -> {w, bpp, px}: una volta per giro

/* PNG a 8 bit, RGB o RGBA, con i cinque filtri: tutto quello che serve per le terrarium. */
function png(buf) {
  let p = 8, w = 0, h = 0, tipo = 0;
  const idat = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); tipo = d[9]; if (d[8] !== 8) throw new Error('PNG a ' + d[8] + ' bit'); }
    else if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const bpp = tipo === 6 ? 4 : tipo === 2 ? 3 : 0;
  if (!bpp) throw new Error('PNG di tipo ' + tipo);
  const raw = zlib.inflateSync(Buffer.concat(idat)), riga = w * bpp, px = Buffer.alloc(riga * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (riga + 1)], src = raw.subarray(y * (riga + 1) + 1, (y + 1) * (riga + 1)), o = y * riga;
    for (let x = 0; x < riga; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - riga + x] : 0, c = y && x >= bpp ? px[o - riga + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  return { w, bpp, px };
}

/**
 * punti: [{lat, lon}] -> array di metri (interi, anche negativi vicino al mare), nello stesso ordine.
 * Lancia se una tessera non arriva o se si supera `tettoMs` (0 = nessun tetto): chi chiama decide.
 */
async function quoteTerrarium(punti, tettoMs = 0) {
  const inizio = Date.now(), n = 2 ** Z, out = [];
  for (const pt of punti) {
    if (tettoMs && Date.now() - inizio > tettoMs) throw new Error('tetto di ' + tettoMs / 1000 + ' s superato');
    const x = (pt.lon + 180) / 360 * n, s = Math.sin(pt.lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = Math.floor(x), ty = Math.floor(y), k = Z + '/' + tx + '/' + ty;
    if (!tessere.has(k)) {
      const r = await fetch(URL(Z, tx, ty), { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('terrarium ' + r.status + ' su ' + k);
      tessere.set(k, png(Buffer.from(await r.arrayBuffer())));
    }
    const t = tessere.get(k), px = Math.min(255, Math.floor((x - tx) * 256)), py = Math.min(255, Math.floor((y - ty) * 256));
    const i = (py * t.w + px) * t.bpp;
    out.push(Math.round(t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768));
  }
  return out;
}

module.exports = { quoteTerrarium, FONTE: 'Terrain Tiles (Mapzen, open data su AWS)' };
