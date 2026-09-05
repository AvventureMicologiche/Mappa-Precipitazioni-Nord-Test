#!/usr/bin/env node
/**
 * Scrive `sitemap.xml` (un INDICE) e le quattro sitemap di famiglia.
 *
 * PERCHE' UN INDICE, dal 4/9/2026. Con 1.106 indirizzi in un file solo, il
 * rapporto Pagine di Search Console li conta tutti insieme: non si vede se le
 * 948 localita' entrano nell'indice e le 114 zone no, o viceversa. Diviso per
 * famiglia, ognuna ha la sua riga con «scoperte / indicizzate / escluse», che
 * e' il numero su cui si decide se una famiglia ha un problema. Non accelera
 * niente da sola: serve a MISURARE. Il limite del formato e' 50.000 indirizzi
 * per file, quindi non e' il peso il motivo.
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

// ⚠️ LE DATE STANNO IN `pagine-lastmod.json`, e sono l'ultima volta che il
// GUSCIO di quella famiglia e' stato riscritto — non il giorno in cui arrivano
// dati nuovi: i numeri li scarica il browser e l'HTML resta identico. Se ci si
// mettesse la data di oggi a ogni giro, a Google risulterebbe un sito che
// riscrive mille pagine ogni notte e smetterebbe di crederci.
// Le aggiorna da solo `rinnova-pagine.js` (una volta a stagione), e si possono
// cambiare a mano quando si tocca un modello.
const LASTMOD = JSON.parse(fs.readFileSync(path.join(__dirname, 'pagine-lastmod.json'), 'utf8'));
const NASCITA_REGIONI = LASTMOD.regioni;
const NASCITA_FUNGHI = LASTMOD.funghi;
const NASCITA_LOCALITA = LASTMOD.localita;
const NASCITA_ZONE = LASTMOD.zone;

function scriviSitemap(SITO, RADICE) {
  const { REGIONI } = require('./genera-pagine-regione.js');
  const c_e = rel => fs.existsSync(path.join(RADICE, rel));

  // Quattro famiglie, quattro file. La prima tiene anche la home e le fonti:
  // sono due pagine, non meritano una sitemap loro.
  const fam = { mappa: [], funghi: [], localita: [], zone: [] };
  const voci = fam.mappa;

  voci.push({ loc: SITO + '/', lastmod: '2026-08-14', freq: 'daily', pri: '1.0' });
  voci.push({ loc: SITO + '/fonti.html', lastmod: '2026-08-07', freq: 'monthly', pri: '0.5' });

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
      fam.funghi.push({ loc: `${SITO}/funghi/${k}/`, lastmod: NASCITA_FUNGHI, freq: 'weekly', pri: '0.7' });
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
      fam.localita.push({ loc: `${SITO}/funghi/${k}/${d}/`, lastmod: NASCITA_LOCALITA, freq: 'weekly', pri: '0.6' });
    }
  }

  // Le pagine di ZONA (Garfagnana, Val Trebbia...), dal 3/9/2026. Stessa
  // priorita' delle localita': sono risposte strette come loro, e per lo
  // stesso motivo si elencano guardando la cartella invece che un elenco.
  const zone = path.join(RADICE, 'funghi', 'zone');
  if (fs.existsSync(zone)) {
    for (const d of fs.readdirSync(zone).sort()) {
      if (!c_e(path.join('funghi', 'zone', d, 'index.html'))) continue;
      fam.zone.push({ loc: SITO + '/funghi/zone/' + d + '/', lastmod: NASCITA_ZONE, freq: 'weekly', pri: '0.6' });
    }
  }

  const voce = v => `  <url>\n    <loc>${v.loc}</loc>\n    <lastmod>${v.lastmod}</lastmod>\n` +
                    `    <changefreq>${v.freq}</changefreq>\n    <priority>${v.pri}</priority>\n  </url>`;
  const INTESTA = `<!-- Generata da .github/scripts/genera-sitemap.js — non modificare a mano.\n` +
    `     lastmod = quando cambia la PAGINA, non quando arrivano dati nuovi: le\n` +
    `     pagine sono gusci statici, i numeri li scarica il browser. -->`;

  // ⚠️ Le figlie si scrivono SOLO se hanno voci, e l'indice elenca solo quelle
  // scritte: un repo che non ha ancora una famiglia (il test, quando una
  // famiglia nasce in produzione) dichiarerebbe un file inesistente.
  const NOMI = { mappa: 'sitemap-mappa.xml', funghi: 'sitemap-funghi.xml',
                 localita: 'sitemap-localita.xml', zone: 'sitemap-zone.xml' };
  const figlie = [];
  let totale = 0;
  for (const k of Object.keys(NOMI)) {
    const v = fam[k];
    if (!v.length) continue;
    const testo = `<?xml version="1.0" encoding="UTF-8"?>\n${INTESTA}\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      v.map(voce).join('\n') + `\n</urlset>\n`;
    fs.writeFileSync(path.join(RADICE, NOMI[k]), testo.replace(/\r\n/g, '\n'), 'utf8');
    figlie.push({ nome: NOMI[k], lastmod: v.map(x => x.lastmod).sort().slice(-1)[0] });
    totale += v.length;
  }

  const indice = `<?xml version="1.0" encoding="UTF-8"?>\n${INTESTA}\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    figlie.map(f => `  <sitemap>\n    <loc>${SITO}/${f.nome}</loc>\n` +
                    `    <lastmod>${f.lastmod}</lastmod>\n  </sitemap>`).join('\n') +
    `\n</sitemapindex>\n`;
  fs.writeFileSync(path.join(RADICE, 'sitemap.xml'), indice.replace(/\r\n/g, '\n'), 'utf8');
  return totale;
}

module.exports = { scriviSitemap };
