#!/usr/bin/env node
/**
 * LA TESTATA DEL SITO NELLE DUE PAGINE FATTE A MANO: guida/index.html e fonti.html (28/10/2026).
 * Le altre famiglie la prendono dal loro generatore (lib-testata.js); queste due non hanno generatore, quindi
 * quando cambia lib-testata.js si rilancia questo: toglie la testata e lo stile di un giro precedente e li rimette.
 *   node .github/scripts/testata-pagine-a-mano.js
 * - guida: la testata sopra la sua fascia blu, che perde «← Torna alla mappa» (ci porta il logo); colonna 1080 e 20;
 * - fonti: il titolo passa dalla vecchia barra blu dentro la pagina; colonna 860 e 16.
 */
const fs = require('fs'), path = require('path');
const RADICE = path.join(__dirname, '..', '..');
const { TESTATA_CSS, testata } = require('./lib-testata.js');
const SITO = 'https://precipitazioni.avventuremicologiche.it', CANALE = 'https://www.youtube.com/@avventuremicologiche?sub_confirmation=1';
const SEGNO = '/* ── LA TESTATA (lib-testata.js, 28/10/2026) ── */';

function metti(file, { ga, colonna, togli, prima, extra }) {
  const f = path.join(RADICE, file);
  let h = fs.readFileSync(f, 'utf8');
  const crlf = h.includes('\r\n');
  if (crlf) h = h.replace(/\r\n/g, '\n');
  // lo stile: tolto quello di un giro precedente, poi in fondo all'ultimo <style>
  const a = h.indexOf(SEGNO);
  if (a >= 0) h = h.slice(0, a) + h.slice(h.indexOf('</style>', a));
  const fine = h.lastIndexOf('</style>');
  h = h.slice(0, fine) + TESTATA_CSS.trim() + '\n' + colonna + '\n' + (extra || '') + '\n' + h.slice(fine);
  // la testata: tolta quella di un giro precedente, poi al suo posto
  h = h.replace(/<header class="tB">[\s\S]*?<\/header>\n<script>\(function\(\)\{var a=document\.querySelector\('\.tB [^\n]*<\/script>\n/, '');
  for (const [da, a2] of togli) { if (!h.includes(da) && !h.includes(a2)) throw new Error(file + ': non trovo ' + da.slice(0, 60)); h = h.replace(da, a2); }
  const i = h.indexOf(prima); if (i < 0) throw new Error(file + ': non trovo ' + prima);
  h = h.slice(0, i) + testata({ sito: SITO, canale: CANALE, reg: '', ga, attiva: '' }) + '\n' + h.slice(i);
  if (crlf) h = h.replace(/\n/g, '\r\n');
  fs.writeFileSync(f, h);
  console.log('  ' + file);
}

metti('guida/index.html', {
  ga: 'guida', colonna: 'header.tB{--t-max:1080px;--t-pad:20px}',
  extra: '.top .dentro{padding-top:22px}   /* senza la riga «← Torna alla mappa» il titolo restava attaccato in alto */',
  togli: [['  <div class="barra"><a href="/">← Torna alla mappa</a></div>\n', '']],
  prima: '<header class="top">',
});
metti('fonti.html', {
  ga: 'fonti', colonna: 'header.tB{--t-max:860px}',
  extra: 'main > h1{font-size:28px;line-height:1.2;font-weight:700;color:#123252;margin:0 0 14px}',
  togli: [['<header>\n  <a href="/" title="Torna alla mappa">← Mappa</a>\n  <h1>Fonti e licenze</h1>\n</header>\n<main>\n', '<main>\n<h1>Fonti e licenze</h1>\n']],
  prima: '<main>',
});
