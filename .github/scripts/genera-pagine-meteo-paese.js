#!/usr/bin/env node
/**
 * LE PAGINE «METEO <PAESE>»: meteo/<regione>/<paese>/index.html (28/10/2026, TEST su 20 posti).
 *
 * PERCHE' ESISTONO. Suo, 28/10/2026: «trasformo definitivamente la sezione meteo in un sito vero», e poi «facciamo 20
 * pagine meteo paese di prova, così abbiamo dei dati da studiare, prendi i paesi più cliccati; giustamente non devono
 * andare in conflitto con le pagine funghi». I grandi (ilMeteo, 3B) ragionano per comune: questa e' la famiglia che
 * porta il volume. I 20 posti sono METEO_PAESI in genera-pagine-meteo-zona.js (le pagine paese funghi con piu' clic da
 * Google in 28 giorni), con la loro sitemap (sitemap-meteo-paesi.xml) per misurarli da soli in Search Console.
 *
 * ⚠️ NIENTE CONFLITTO CON LE PAGINE FUNGHI: due domande diverse, due titoli diversi.
 *   funghi  «Funghi a Sassello oggi: stanno nascendo?»   /funghi/liguria/sassello/   (la pioggia che conta)
 *   meteo   «Meteo Sassello: previsioni a 7 giorni»      /meteo/liguria/sassello/    ← questa (il tempo che fara')
 * Qui «funghi» non compare nel titolo ne' nella descrizione, e la pagina funghi porta qui col link di linkMeteoPaese,
 * cosi' Google sa quale delle due risponde a cosa. Da qui si va solo SULLA MAPPA: radar, previsioni e pluviometri
 * della regione, tre bottoni con l'anteprima (suo, 28/10: «i funghi è inutile», «le altre pagine sono troppo simili»).
 *
 * COSA C'E' DENTRO: la pagina di zona (genera-pagine-meteo-zona.js, stesso stile e stesso codice del browser, con
 * C.solo) centrata su UN posto: la scheda ora per ora si apre da sola sul paese, i 7 giorni e il «punto di stamattina»
 * sono del paese, mappa e tabella dei paesi intorno (gli stessi di «Che tempo farà» della pagina funghi:
 * /api/previsioni?paese=<reg>/<slug>, data/paesi-localita/<reg>.json), il grafico con la pioggia caduta AL PLUVIOMETRO
 * (data/funghi/<reg>-giorni.json, 25 giorni, lo stesso file della pagina funghi) e i 7 giorni previsti.
 *
 * Uso: node .github/scripts/genera-pagine-meteo-paese.js     (SOLO=sassello: una pagina sola, sitemap non toccata)
 * Si lancia DOPO genera-pagine-regione.js: il foglio di stile si prende dalla pagina regione, come le zone.
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { regioneDati } = require('./lib-posti.js');
const { confineDi } = require('./genera-pagine-adesso.js');   // il confine della regione nelle anteprime dei bottoni
const { quotePaesi, chiave } = require('./lib-quota-paesi.js');
const MZ = require('./genera-pagine-meteo-zona.js');
const { senzaCommenti } = require('./lib-senza-commenti.js');   // i commenti restano qui, non nelle pagine (2/11/2026)
const { METEO_PAESI_TUTTI, CSS, CSS_ANT, clientePagina, mappeHtml, nastroHtml, scrivi, esc, agenziaDi, indirizzoMeteoPaese,
  SITO, RAW, RILIEVO, GA_ID, CANALE, POSTI, SLUG_REG, MV_CSS, altreMeteo, tabellaFissa } = MZ;

const RADICE = path.join(__dirname, '..', '..');

// l'ordine delle citta' nell'anteprima «Previsioni» (i capoluoghi di provincia prima) e la testata del sito: comuni
const { ordineCitta } = require('./lib-capoluoghi.js');
const { TESTATA_CSS, testata } = require('./lib-testata.js');

function pagina(p, QUOTE_DI) {
  const [reg, locSlug] = p.loc.split('/');
  const casa = REGIONI.find(x => x.k === reg);
  if (!casa) throw new Error('regione sconosciuta: ' + reg);
  const id = Object.keys(SLUG_REG[reg]).find(k => SLUG_REG[reg][k] === locSlug);
  const anag = id && POSTI[reg].find(x => String(x[0]) === id);
  if (!anag) throw new Error('nessun pluviometro per ' + p.loc + ' in funghi-posti.json');
  const lista = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', 'paesi-localita', reg + '.json'), 'utf8'))[locSlug];
  if (!lista || !lista.length) throw new Error('nessun paese per ' + p.loc + ' in data/paesi-localita/' + reg + '.json');
  const serie = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', 'funghi', reg + '-giorni.json'), 'utf8')).serie || {};
  if (!serie[id]) console.log('  ⚠️ ' + p.loc + ': il pluviometro ' + id + ' non e\' nel file dei 25 giorni, il grafico restera\' vuoto');

  const nomeDi = x => (p.nomi && p.nomi[x.n]) || x.n;
  const quote = {};
  for (const x of lista) quote[nomeDi(x)] = x.qui ? x.q : QUOTE_DI[chiave(x.lat, x.lon)];
  const intorno = lista.map(nomeDi).filter(n => n !== p.n);
  const ente = agenziaDi(regioneDati(reg, anag)) || '';
  const alPluv = 'al pluviometro ' + (p.pluv || p.di);
  const ga = 'meteo-paese-' + p.slug;
  const NREG = casa.nomeTitolo || casa.nome;
  const ALTRE = altreMeteo(casa, ga, indirizzoMeteoPaese(p));   // le altre pagine meteo della regione, vuoto se non ce ne sono

  const TITOLO = `Meteo ${p.n}: previsioni a 7 giorni, ora per ora`;
  // ⚠️ 31/10/2026 (scheda 104 bis): la descrizione passava i 250 caratteri e Google la taglia verso 155
  const DESCR = [
    `Previsioni meteo ${p.dove} per i prossimi 7 giorni, ora per ora: pioggia e probabilità, minime e massime, e il tempo nei paesi intorno (${intorno.slice(0, 2).join(', ')}).`,
    `Previsioni meteo ${p.dove} per i prossimi 7 giorni, ora per ora: pioggia e probabilità, minime e massime, e il tempo nei paesi intorno.`,
    `Previsioni meteo ${p.dove} per i prossimi 7 giorni, ora per ora: pioggia, minime e massime.`,
  ].find(t => t.length <= 155) || `Meteo ${p.n}: previsioni a 7 giorni, ora per ora.`;

  const modello = path.join(RADICE, casa.k, 'index.html');
  if (!fs.existsSync(modello)) { console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-regione.js'); process.exit(1); }
  const m = fs.readFileSync(modello, 'utf8');
  let STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));
  const iMeteo = STILE.indexOf('/* ── IL METEO NELLE PAGINE REGIONE');
  if (iMeteo >= 0) STILE = STILE.slice(0, iMeteo);

  const C = { sito: SITO, raw: RAW, slug: 'paese-' + p.slug, reg, dove: p.dove, valle: 'zona', inValle: p.dove, diValle: '',
    sat: MZ.SAT, quote, pluv: [], solo: true, paese: p.loc, giorni: 'funghi/' + reg + '-giorni.json', id,
    nomi: p.nomi || null, primo: p.primo || null, intorno: p.n + ' e i paesi intorno', alPluv, evento: 'meteo_paese',
    nastro: p.n,   // il blocco rosso della barra sotto la mappa: «METEO SASSELLO», come il titolo della pagina
    ant: Object.assign({ confine: confineDi(casa) }, ordineCitta(reg)) };
  // ⚠️ Niente zona del pluviometro nei bottoni: quella delle pagine funghi a volte e' larga (Sassello sta nella «Val
  // Bormida», ma e' in valle dell'Erro). Le tre anteprime: mappeHtml in genera-pagine-meteo-zona.js.

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${indirizzoMeteoPaese(p)}">
<meta property="og:title" content="${esc(TITOLO)}">
<meta property="og:description" content="${esc(DESCR)}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:url" content="${indirizzoMeteoPaese(p)}">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], ['Previsioni meteo', `${SITO}/previsioni/`], ['Meteo ' + p.n, null]])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<link rel="stylesheet" href="/lib/leaflet/1.9.4/leaflet.css">
<style>${STILE}${CSS}${CSS_ANT}${ALTRE && !STILE.includes('.mv-c{') ? MV_CSS : ''}${TESTATA_CSS}</style>
</head>
<body>
${testata({ sito: SITO, canale: CANALE, reg, ga, attiva: 'previsioni' })}
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › <a href="${SITO}/previsioni/">Previsioni meteo</a> › ${esc(p.n)}</p>
<h1>Meteo ${esc(p.n)}</h1>
<p class="sotto"><b>Che tempo farà ${esc(p.dove)} nei prossimi 7 giorni</b>, ora per ora, e nei paesi intorno, ${intorno.length > 3 ? intorno.slice(0, 3).map(esc).join(', ') + ' e altri ' + (intorno.length - 3) : intorno.map(esc).join(', ')}, ognuno alla sua quota; e quanta pioggia è già caduta ${esc(alPluv)}.</p>

<div class="pz-cerca"><input id="cerca" type="search" autocomplete="off" placeholder="Cerca il tuo paese, anche una frazione" aria-label="Cerca un paese o una frazione"><div class="pz-drop" id="drop"></div></div>
${nastroHtml(p.n)}
<section class="pz-scheda" id="scheda" aria-live="polite"></section>

<div class="pz-punto" id="punto"><span class="pz-quando">Il punto di stamattina</span> Sto leggendo previsioni e pluviometro…</div>

<h2>I prossimi 7 giorni ${esc(p.dove)}</h2>
<p class="nota" style="margin-top:0">Tocca un giorno: la mappa e la tabella dei paesi intorno passano a quel giorno. 💧 è la probabilità di pioggia.</p>
<div class="pz-giorni" id="giorni"></div>
<p class="pz-tot" id="tot"></p>

<div class="pz-mappa-testa"><span class="dove" id="mappa-giorno"></span></div>
<div id="pz-mappa"></div>
<p class="nota" id="mappa-nota" style="margin-top:2px">Tocca un paese per vederlo ora per ora.</p>

<h2>${esc(p.n)} e i paesi intorno</h2>
<p class="nota" style="margin-top:0">Dal più in basso al più in alto (quota del terreno, ~). Tocca un paese per le ore; scorri di lato per tutti i giorni. 💧 è la probabilità di pioggia.</p>
<div class="pz-scorri"><table class="pz-tab" id="tab">${tabellaFissa([p.n].concat(intorno), quote)}</table></div>

<h2>La pioggia caduta e quella in arrivo</h2>
<p class="nota" style="margin-top:0">Gli ultimi 25 giorni misurati ${esc(alPluv)}${ente ? ' (' + esc(ente) + ')' : ''} e i 7 giorni previsti ${esc(p.dove)}. Tocca una barra.</p>
<div class="pz-graf" id="graf"></div>
<div class="pz-graf-date" id="graf-date"></div>
<div class="pz-graf-info" id="graf-info"></div>
<div class="pz-leg"><span><i style="background:#1a5fa8"></i>misurata</span><span><i style="background:repeating-linear-gradient(45deg,#7fb0e0,#7fb0e0 3px,#b9d4ef 3px,#b9d4ef 6px)"></i>prevista</span><span id="leg-date"></span></div>
<div class="griglia" style="margin-top:14px">
  <div class="card"><h3 id="r1h">Ieri</h3><div class="numerone" id="r1">…</div><div id="r1t"></div></div>
  <div class="card"><h3>Ultimi 7 giorni</h3><div class="numerone" id="r7">…</div><div id="r7t"></div></div>
</div>

${mappeHtml({ reg, nomeReg: NREG, ga })}
${ALTRE}
<h2>Come funziona questa pagina</h2>
<p>Le previsioni sono quelle del modello ECMWF, distribuite da MET Norway (CC BY 4.0), chieste per ${esc(p.n)} e per ognuno dei paesi intorno alla sua quota, e aggiornate più volte al giorno. La pioggia caduta è misurata ${esc(alPluv)}${ente ? ', rete ' + esc(ente) : ''}: non è una stima. Le due cose stanno separate anche nel grafico, perché una è un dato e l'altra una previsione.</p>
</main>

<footer>
  Previsioni: MET Norway (ECMWF) · Pioggia misurata: ${esc(ente || casa.nome)} ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="${SITO}/guida/">guida alla mappa</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a>
</footer>

<script src="/lib/leaflet/1.9.4/leaflet.js"></script>
<script>
(${clientePagina.toString()})(${JSON.stringify(C)});
</script>
</body>
</html>
`;
}

if (require.main === module) {
  (async () => {
    const SOLO = process.env.SOLO;
    const posti = METEO_PAESI_TUTTI.filter(p => !SOLO || p.slug === SOLO);   // i primi 20 e, dal 2/11/2026, i 20 del gruppo B
    if (!posti.length) throw new Error('nessun posto con SOLO=' + SOLO);
    const punti = [];
    for (const p of posti) {
      const [reg, s] = p.loc.split('/');
      const l = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', 'paesi-localita', reg + '.json'), 'utf8'))[s] || [];
      punti.push(...l.filter(x => !x.qui));
    }
    const QUOTE_DI = await quotePaesi(punti);
    for (const p of posti) {
      const html = pagina(p, QUOTE_DI);
      // lo script della pagina deve girare (i nomi con l'apostrofo: «Santo Stefano d'Aveto»), come genera-pagine-localita.js
      for (const s of html.match(/<script>[\s\S]*?<\/script>/g) || []) new Function(s.slice(8, -9));
      const [reg] = p.loc.split('/');
      scrivi(path.join(RADICE, 'meteo', reg, p.slug, 'index.html'), senzaCommenti(html));
      console.log('  meteo/' + reg + '/' + p.slug + '/');
    }
    if (SOLO) { console.log(`1 pagina scritta (SOLO=${SOLO}), sitemap non toccata.`); return; }
    // (la pagina madre /meteo/ non c'e' piu' dal 28/10/2026 sera: la madre e' la mappa delle previsioni, /previsioni/)
    const { scriviSitemap } = require('./genera-sitemap.js');
    const tot = scriviSitemap(SITO, RADICE);
    console.log(`${posti.length} pagine «Meteo <paese>» scritte, sitemap.xml con ${tot} indirizzi.`);
  })().catch(e => { console.error(e); process.exit(1); });
}
