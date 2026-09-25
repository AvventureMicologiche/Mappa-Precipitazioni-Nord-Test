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
    console.log('  ' + k.padEnd(13) + ' ok, ' + kb + ' KB, max ' + (stat.max || '?') + ' mm' +
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
  for (const k of lista) { if (await scatta(browser, k)) fatte++; }
  await browser.close();

  console.log('\n' + fatte + ' su ' + lista.length + ' generate in ' + OUT_DIR);
  // Una regione che fallisce tiene la sua immagine precedente: meglio vecchia
  // di qualche giorno che assente. Si esce in errore solo se non ne riesce
  // NESSUNA, cioe' se e' rotto il meccanismo e non la singola regione.
  if (!fatte) process.exit(1);
})().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
