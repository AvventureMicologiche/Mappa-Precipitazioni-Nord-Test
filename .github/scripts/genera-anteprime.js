#!/usr/bin/env node
/**
 * genera-anteprime.js — le anteprime della mappa per le pagine regione (20/8/2026).
 *
 * PERCHE'. Chi arriva su /toscana/ da Google non ha idea di cosa trovera'
 * cliccando: legge due numeri e un pulsante. Un'immagine della mappa vera fa
 * capire in un colpo d'occhio che dall'altra parte c'e' qualcosa che vale.
 *
 * DOVE FINISCONO, ed e' il punto: su un RAMO A SE', `anteprime`, che il
 * workflow riscrive da capo a ogni giro. Le pagine le leggono da
 * raw.githubusercontent (che serve qualunque ramo), come gia' fanno coi JSON
 * delle piogge, quindi aggiornarle NON fa scattare un deploy Netlify.
 *
 * ⚠️ PERCHE' UN RAMO SEPARATO E NON `data/` SU MAIN. Le 23 immagini pesano
 * ~8 MB e git conserva PER SEMPRE ogni versione di ogni file: a un giro ogni
 * tre giorni sarebbero ~975 MB l'anno aggiunti alla storia del repo, che oggi
 * ne pesa 44 in tutto (le foto non si comprimono fra loro come il testo, ogni
 * giro e' peso nuovo). Sul ramo dedicato invece si riscrive un commit solo e
 * si forza il push: il repo cresce di 8 MB una volta e resta li'.
 *
 * COME. Si apre il sito con `?r=<regione>&da=…&a=…`, cioe' lo stesso indirizzo
 * del pulsante «Apri la mappa»: l'anteprima e' letteralmente quello che l'utente
 * vedra' cliccando. Si aspetta che il pannello periodo dica «✅», si scatta, e
 * ffmpeg riduce a 1600 px (mostrati a 800: nitidi anche sui telefoni retina).
 *
 * USO:
 *   node .github/scripts/genera-anteprime.js [regione1,regione2|tutte]
 *   OUT=<cartella>    dove scriverle (default: cartella temporanea)
 *   CHROME=<percorso>  browser da usare (in CI lo mette puppeteer)
 *   GIORNI=20          finestra della mappa
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) { puppeteer = require('puppeteer-core'); }

const SITO = process.env.SITO || 'https://precipitazioni.avventuremicologiche.it/';
// Fuori dall'albero di lavoro: le immagini NON devono finire per sbaglio in un
// commit di main (vedi sopra). Il workflow le raccoglie da qui e le mette sul
// ramo dedicato; in locale servono solo a guardarle.
const OUT_DIR = process.env.OUT || path.join(require('os').tmpdir(), 'anteprime-mappa');
const GIORNI = parseInt(process.env.GIORNI || '20', 10);
const LARGHEZZA = 1600;          // pixel del file finale
const QUALITA = '4';             // -q:v di ffmpeg: 4 sta sotto i 400 KB
const W = 1600, H = 1000;        // finestra del browser (×2 per il retina)

// Le chiavi sono quelle di genera-pagine-regione.js. Si usa `?r=`, che la mappa
// interpreta da sola: niente da sapere sui nomi delle caselle, e i combo
// Piemonte-VdA e Trentino-A.A. si risolvono lato sito.
const REGIONI = ['lombardia','piemonte','valledaosta','liguria','emilia','veneto','friuli',
  'trentino','altoadige','toscana','umbria','marche','lazio','molise','campania','puglia',
  'basilicata','calabria','sicilia','sardegna','svizzera','austria','slovenia'];

const p2 = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const giornoFa = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

/* ── LA MAPPA PULITA, per la striscia in cima alle pagine funghi (20/10/2026, scheda 89) ──
   Oltre all'anteprima di sempre (la pagina intera, coi pannelli), la sola mappa senza niente sopra:
   <k>-mappa.webp + <k>-mappa.json. Il JSON dice dove sta l'immagine nel mondo (zoom e pixel dell'angolo
   in alto a sinistra, proiezione di Leaflet), cosi' ogni pagina ne ritaglia il pezzo attorno al SUO punto
   (lib-striscia.js): una immagine per regione invece di 908 scatti al giorno. 1 pixel = 1 pixel CSS della
   mappa (scala 0,5 dello scatto a doppia densita'), WebP perche' la pagina la scarica in cima, subito.
   Con BOSCHI=1 si scatta la mappa boschi (?boschi=1) e SOLO la versione pulita: non cambia mai, si lancia a
   mano quando cambiano le tessere, e i file vanno in tessere-boschi/anteprime/. */
async function scattaPulita(page, k, nome, meta) {
  nome = nome || 'mappa';
  await page.addStyleTag({ content: 'body *{visibility:hidden !important} #map .leaflet-map-pane, #map .leaflet-map-pane *{visibility:visible !important}' });
  await new Promise(r => setTimeout(r, 500));
  const g = await page.evaluate(() => {
    const mp = window._mapDebug, el = document.getElementById('map');
    if (!mp || !el) return null;
    const r = el.getBoundingClientRect(), pb = mp.getPixelBounds();
    let b = null;   // il confine della regione: i layer senza riempimento
    mp.eachLayer(l => { if (l.options && l.options.fill === false && l.getBounds) { const x = l.getBounds(); if (x.isValid()) b = b ? b.extend(x) : L.latLngBounds(x.getSouthWest(), x.getNorthEast()); } });
    return { x: r.left, y: r.top, w: Math.round(r.width), h: Math.round(r.height), z: mp.getZoom(), x0: Math.round(pb.min.x), y0: Math.round(pb.min.y),
             reg: b ? { n: +b.getNorth().toFixed(4), s: +b.getSouth().toFixed(4), w: +b.getWest().toFixed(4), e: +b.getEast().toFixed(4) } : null };
  });
  if (!g || !g.w) throw new Error('mappa pulita: niente _mapDebug o #map');
  await page.screenshot({ path: path.join(OUT_DIR, k + '-' + nome + '.webp'), type: 'webp', quality: 72,
    clip: { x: g.x, y: g.y, width: g.w, height: g.h, scale: 0.5 } });
  fs.writeFileSync(path.join(OUT_DIR, k + '-' + nome + '.json'), JSON.stringify(Object.assign({ z: g.z, x0: g.x0, y0: g.y0, w: g.w, h: g.h, reg: g.reg,
    tipo: process.env.BOSCHI ? 'boschi' : 'pioggia', da: process.env.BOSCHI ? null : iso(giornoFa(GIORNI)), a: process.env.BOSCHI ? null : iso(giornoFa(1)) },
    meta || {}, { generato: new Date().toISOString() })) + '\n');
  return Math.round(fs.statSync(path.join(OUT_DIR, k + '-' + nome + '.webp')).size / 1024);
}

/* LA PIOGGIA DI IERI, pulita (20/10/2026): per la striscia in cima alle pagine PIOGGE (regioni e zone), che parlano
   di ieri e non dei 20 giorni. <k>-ieri.webp + <k>-ieri.json, stesso formato della mappa pulita. */
async function scattaIeri(browser, k) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('novitaVista', '2099'); } catch (e) {} });
  const ieri = iso(giornoFa(1));
  try {
    await page.goto(SITO + '?r=' + k + '&da=' + ieri + '&a=' + ieri, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => { const s = document.getElementById('tp-status'); return s && s.textContent.indexOf('✅') === 0; }, { timeout: 180000, polling: 500 });
    await new Promise(r => setTimeout(r, 3000));
    return ', ieri ' + await scattaPulita(page, k, 'ieri', { tipo: 'ieri', da: ieri, a: ieri }) + ' KB';
  } catch (e) {
    return ', ieri FALLITA (' + e.message.slice(0, 60) + ')';
  } finally { await page.close(); }
}

async function scattaBoschi(browser, k) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('novitaVista', '2099'); } catch (e) {} });
  try {
    await page.goto(SITO + '?r=' + k + '&boschi=1', { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise(r => setTimeout(r, 8000));   // le tessere dei boschi arrivano dopo la mappa
    const kb = await scattaPulita(page, k);
    console.log('  ' + k.padEnd(13) + ' boschi ok, ' + kb + ' KB');
    return true;
  } catch (e) {
    console.warn('  ' + k.padEnd(13) + ' FALLITA: ' + e.message.slice(0, 90));
    return false;
  } finally { await page.close(); }
}

async function scatta(browser, k) {
  const url = SITO + '?r=' + k + '&da=' + iso(giornoFa(GIORNI)) + '&a=' + iso(giornoFa(1));
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  const errori = [];
  page.on('pageerror', e => errori.push(e.message.slice(0, 120)));
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
    // fine del disegno: il pannello periodo passa a "✅ <etichetta>"
    await page.waitForFunction(() => {
      const s = document.getElementById('tp-status');
      return s && s.textContent.indexOf('✅') === 0;
    }, { timeout: 180000, polling: 500 });
    await new Promise(r => setTimeout(r, 3500));   // ridisegni di sicurezza + tile

    // il box del canale copre l'angolo in alto a destra: fuori dall'anteprima
    await page.evaluate(() => {
      const el = document.getElementById('channel-logo');
      if (el) el.style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 400));

    const stat = await page.evaluate(() => ({
      staz: (document.getElementById('sst') || {}).textContent,
      max: (document.getElementById('smx') || {}).textContent
    }));
    const png = path.join(OUT_DIR, k + '.png');
    await page.screenshot({ path: png });
    // ffmpeg: in CI lo installa il workflow (le immagini ubuntu-24.04 non
    // ce l'hanno piu'), in locale e' quello di sistema o la variabile FFMPEG.
    execFileSync(process.env.FFMPEG || 'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=' + LARGHEZZA + ':-2', '-q:v', QUALITA,
       path.join(OUT_DIR, k + '.jpg')]);
    fs.unlinkSync(png);
    const kb = Math.round(fs.statSync(path.join(OUT_DIR, k + '.jpg')).size / 1024);
    // la mappa pulita per la striscia: se fallisce, l'anteprima di sempre resta buona
    let pulita = '';
    try { pulita = ', pulita ' + await scattaPulita(page, k) + ' KB'; } catch (e) { pulita = ', pulita FALLITA (' + e.message.slice(0, 60) + ')'; }
    pulita += await scattaIeri(browser, k);
    console.log('  ' + k.padEnd(13) + ' ok, ' + kb + ' KB' + pulita + ', max ' + (stat.max || '?') + ' mm' +
                (errori.length ? '  [' + errori.length + ' errori di pagina]' : ''));
    return true;
  } catch (e) {
    console.warn('  ' + k.padEnd(13) + ' FALLITA: ' + e.message.slice(0, 90));
    return false;
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const arg = (process.argv[2] || 'tutte').trim();
  const lista = (arg === 'tutte') ? REGIONI : arg.split(',').map(s => s.trim()).filter(Boolean);
  const ignote = lista.filter(k => REGIONI.indexOf(k) < 0);
  if (ignote.length) throw new Error('regioni sconosciute: ' + ignote.join(', '));

  console.log('=== anteprime mappa, ' + GIORNI + ' giorni, ' + lista.length + ' regioni ===');
  const opts = { headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] };
  if (process.env.CHROME) opts.executablePath = process.env.CHROME;
  const browser = await puppeteer.launch(opts);
  let fatte = 0;
  for (const k of lista) { if (await (process.env.BOSCHI ? scattaBoschi : scatta)(browser, k)) fatte++; }
  await browser.close();

  console.log('\n' + fatte + ' su ' + lista.length + ' generate in ' + OUT_DIR);
  // Una regione che fallisce tiene la sua immagine precedente: meglio vecchia
  // di qualche giorno che assente. Si esce in errore solo se non ne riesce
  // NESSUNA, cioe' se e' rotto il meccanismo e non la singola regione.
  if (!fatte) process.exit(1);
})().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
