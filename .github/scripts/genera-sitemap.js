#!/usr/bin/env node
/**
 * Scrive `sitemap.xml`.
 *
 * PERCHE' STA IN UN FILE SUO. Fino al 2/9/2026 la sitemap la scriveva
 * `genera-pagine-regione.js`, che era l'unico a fare pagine. Da quando ci sono
 * anche le pagine «Piogge per funghi» le famiglie sono due, e lasciarla di la'
 * avrebbe voluto dire che rigenerando SOLO le pagine funghi la sitemap restava
 * indietro senza dirlo. Adesso la chiamano tutt'e due i generatori: qualunque
 * si lanci, la sitemap esce giusta.
 *
 * ⚠️ SI ELENCA SOLO QUELLO CHE C'E' DAVVERO. Ogni voce viene scritta solo se il
 * suo `index.html` esiste in questo repo. Serve perche' i due repo non hanno le
 * stesse pagine nello stesso momento — le pagine funghi vivono sul test prima
 * che in produzione — e una sitemap che dichiara venti indirizzi inesistenti e'
 * un regalo a nessuno: Google li prova, prende 404, e impara che il sito
 * dichiara cose false.
 *
 * ⚠️ `lastmod` E' LA DATA DELLA PAGINA, NON DEI DATI. Sono gusci statici: i
 * numeri li scarica il browser a ogni visita, l'HTML non cambia mai. Se ci si
 * mettesse la data di oggi, a Google risulterebbe un sito che riscrive venti
 * pagine ogni notte e non gli si crederebbe piu'. Per questo le date sono
 * FISSE e scritte qui: quella di nascita di ogni famiglia.
 *
 * ⚠️ FINE RIGA A LF. Il repo le ha miste: gli HTML a CRLF, sitemap.xml e
 * robots.txt a LF. Scrivendo la sitemap a CRLF il diff passa da 20 righe a 144.
 *
 * Non fa niente da solo: lo chiamano `genera-pagine-regione.js` e
 * `genera-pagine-funghi.js`, che gli passano il dominio (l'unica cosa che
 * cambia fra il repo di produzione e quello di test).
 */

const fs = require('fs');
const path = require('path');
// ⚠️ LA REGIONI SI CHIEDE DENTRO LA FUNZIONE, non qui in cima. I due si
// richiedono a vicenda (genera-pagine-regione.js chiama questo per la sitemap,
// questo gli chiede l'anagrafe): con un require in cima, quando Node carica
// questo file l'altro non ha ancora riempito i suoi module.exports e REGIONI
// arriva `undefined`. Chiedendola al momento dell'uso il giro e' gia' chiuso.

const FUNGHI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));

// Le date di nascita, fisse. Home e fonti.html tengono le loro dall'8/8/2026,
// quando la sitemap fu scritta a mano la prima volta.
const NASCITA_REGIONI = '2026-08-14';
const NASCITA_FUNGHI = '2026-09-02';
const NASCITA_LOCALITA = '2026-09-02';
const NASCITA_ZONE = '2026-09-03';

function scriviSitemap(SITO, RADICE) {
  const { REGIONI } = require('./genera-pagine-regione.js');
  const c_e = rel => fs.existsSync(path.join(RADICE, rel));

  const voci = [
    { loc: SITO + '/', lastmod: '2026-08-14', freq: 'daily', pri: '1.0' },
    { loc: SITO + '/fonti.html', lastmod: '2026-08-07', freq: 'monthly', pri: '0.5' },
  ];

  for (const r of REGIONI) {
    if (c_e(path.join(r.k, 'index.html')))
      voci.push({ loc: `${SITO}/${r.k}/`, lastmod: NASCITA_REGIONI, freq: 'weekly', pri: '0.8' });
  }
  // Le pagine funghi restano a 0.7: la priorita' e' solo un peso RELATIVO
  // dentro il sito, e la pagina regione e' quella che vogliamo far uscire
  // quando uno cerca «pioggia in Liguria». Questa e' la risposta a una domanda
  // piu' stretta.
  for (const k of Object.keys(FUNGHI)) {
    if (c_e(path.join('funghi', k, 'index.html')))
      voci.push({ loc: `${SITO}/funghi/${k}/`, lastmod: NASCITA_FUNGHI, freq: 'weekly', pri: '0.7' });
  }

  // Le pagine di LOCALITA', dal 2/9/2026. Si trovano guardando le cartelle,
  // non un elenco: e' lo stesso principio del resto del file, «si elenca solo
  // quello che c'e' davvero». Cosi' aprire una regione nuova in `lib-nomi.js`
  // non richiede di ricordarsi anche di questo file.
  // ⚠️ Priorita' 0.6, sotto le funghi (0.7) e le regione (0.8): la priorita' e'
  // un peso RELATIVO dentro il sito, e queste sono le risposte piu' strette.
  for (const k of Object.keys(FUNGHI)) {
    const base = path.join(RADICE, 'funghi', k);
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).sort()) {
      if (!c_e(path.join('funghi', k, d, 'index.html'))) continue;
      voci.push({ loc: `${SITO}/funghi/${k}/${d}/`, lastmod: NASCITA_LOCALITA, freq: 'weekly', pri: '0.6' });
    }
  }

  // Le pagine di ZONA (Garfagnana, Val Trebbia...), dal 3/9/2026. Stessa
  // priorita' delle localita': sono risposte strette come loro, e per lo
  // stesso motivo si elencano guardando la cartella invece che un elenco.
  const zone = path.join(RADICE, 'funghi', 'zone');
  if (fs.existsSync(zone)) {
    for (const d of fs.readdirSync(zone).sort()) {
      if (!c_e(path.join('funghi', 'zone', d, 'index.html'))) continue;
      voci.push({ loc: SITO + '/funghi/zone/' + d + '/', lastmod: NASCITA_ZONE, freq: 'weekly', pri: '0.6' });
    }
  }

  const voce = v => `  <url>\n    <loc>${v.loc}</loc>\n    <lastmod>${v.lastmod}</lastmod>\n` +
                    `    <changefreq>${v.freq}</changefreq>\n    <priority>${v.pri}</priority>\n  </url>`;
  const testo = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- Generata da .github/scripts/genera-sitemap.js — non modificare a mano.\n` +
    `     lastmod = quando cambia la PAGINA, non quando arrivano dati nuovi: le\n` +
    `     pagine sono gusci statici, i numeri li scarica il browser. -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    voci.map(voce).join('\n') + `\n</urlset>\n`;

  fs.writeFileSync(path.join(RADICE, 'sitemap.xml'), testo.replace(/\r\n/g, '\n'), 'utf8');
  return voci.length;
}

module.exports = { scriviSitemap };
