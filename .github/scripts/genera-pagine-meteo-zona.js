#!/usr/bin/env node
/**
 * LE PAGINE «PREVISIONI METEO <ZONA>»: meteo/<zona>/index.html (24/10/2026, TEST su 11 zone).
 *
 * PERCHE' ESISTONO. Chi cerca «meteo Garfagnana» o «previsioni Val Brembana» trova 3B Meteo e ilMeteo, che di una
 * valle danno il capoluogo e basta. Noi i paesi della zona li chiediamo gia' uno per uno (/api/previsioni?zona=, la
 * stessa domanda del blocco «Che tempo farà» delle pagine di zona) e abbiamo i pluviometri veri: questa pagina mette
 * insieme le due cose per rispondere a una TERZA domanda, diversa da quelle delle altre due famiglie:
 *   piogge  «Dove ha piovuto in…»     /zone/<zona>/
 *   funghi  «Funghi in… oggi»          /funghi/zone/<zona>/
 *   meteo   «Previsioni meteo…»        /meteo/<zona>/          ← questa
 *
 * ⚠️ E' UN TEST, deciso dall'utente il 24/10/2026: le 10 zone piu' viste in GA4 negli ultimi 28 giorni piu' la Val
 * Brembana (il campione rifinito con lui, prove/meteo-zone/). Una sitemap loro (sitemap-meteo.xml) per misurarle in
 * Search Console dopo una decina di giorni. NON tutte le 114: l'elenco e' ZONE_METEO qui sotto.
 *
 * COSA C'E' DENTRO (tutto deciso guardando il campione, vedi prove/meteo-zone/LEGGIMI.md):
 *  - casella «Cerca il tuo paese, anche una frazione»: elenco dei comuni del sito + frazioni dal geocoder Open-Meteo;
 *    il posto scelto apre la SCHEDA QUI, sempre su OGGI con le ore, e da li' sei bottoni verso la mappa;
 *  - «Il punto di stamattina», scritto dai numeri (niente redattore);
 *  - i 7 giorni della valle, da toccare: mappa, titolo della mappa e colonna della tabella passano a quel giorno;
 *  - la mappa: dal 30/10/2026 la FOTO DAL SATELLITE schiarita della vista a etichette della mappa (prima OpenStreetMap +
 *    il RILIEVO TINITALY), etichette come quelle della mappa (pillola bianca: icona del cielo SEMPRE, nome, minima blu,
 *    massima rossa, 💧 solo se piove; il paese della scheda in blu), che non escono dalla mappa e non si sovrappongono;
 *  - paese per paese dal piu' basso al piu' alto, il grafico 30 giorni misurati + 7 previsti, ieri e 7 giorni.
 *
 * ⚠️ LE QUOTE DEI PAESI SI CUOCIONO QUI (lib-quota-paesi.js), il browser non chiede niente a Open-Meteo.
 * ⚠️ IL CODICE DEL BROWSER (clientePagina) E' SOLO ES5: la pagina lo copia con toString(), come meteoClient.
 * ⚠️ Le richieste vanno al SITO STESSO (/api/previsioni, /data/elenco-paesi.txt, /lib/leaflet); il riepilogo dei
 *    pluviometri come la pagina zona piogge (raw, o /data/ in locale).
 *
 * Le pagine di zona hanno il percorso «Mappa pluviometrica › Previsioni meteo › <zona>», dove «Previsioni meteo» e' la
 * mappa delle previsioni (/previsioni/): la pagina madre meteo/index.html c'e' stata solo il 28/10/2026 (vedi in fondo).
 *
 * Uso: node .github/scripts/genera-pagine-meteo-zona.js        (SOLO=garfagnana: una pagina sola, sitemap non toccata)
 * Si lancia DOPO genera-pagine-regione.js: il foglio di stile si prende dalla pagina regione, come le zone piogge.
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione, elenco, diZona, postiDellaZona, diEnte } = require('./lib-nomi.js');
const { retiDei, regioneDati } = require('./lib-posti.js');
const { quotePaesi, chiave } = require('./lib-quota-paesi.js');
const { ordineCitta } = require('./lib-capoluoghi.js');   // l'ordine delle citta' nell'anteprima «Previsioni»
const { TESTATA_CSS, testata } = require('./lib-testata.js');
const { senzaCommenti } = require('./lib-senza-commenti.js');   // i commenti restano qui, non nelle pagine (2/11/2026)

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const SLUG_REG = {};
for (const [k, v] of Object.entries(POSTI)) SLUG_REG[k] = slugRegione(v);

const SITO = 'https://avventurepluvio-test.pages.dev';
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
// il rilievo del sito, la stessa versione fissata che usa la mappa boschi (index.html)
const RILIEVO = 'https://cdn.jsdelivr.net/gh/AvventureMicologiche/Mappa-Precipitazioni-Tessere@e19f7b19852573d067391c5e46b62bf65473b2db/rilievo/';
/* IL SATELLITE DELLA MAPPA (30/10/2026, scheda 101 bis; suo, il 29/10: «dentro le pagine meteo la mappa deve diventare
   come quella nuova», e il 30/10, con la vista a etichette in prod: «dobbiamo rifare ovunque compaiono immagini meteo»).
   La stessa foto della vista a etichette di index.html: Esri World_Imagery con la chiave del sito (SAT_FOTO, referrer del
   dominio, scade il 29/9/2027) e la stessa luce (LUCE_SAT: +6% a tacca). Si leggono da index.html: se cambiano basta
   rigenerare. Senza chiave (repo di test) il servizio pubblico, come esri() della mappa. */
const INDEX = fs.readFileSync(path.join(RADICE, 'index.html'), 'utf8');
const SAT = (/var SAT_FOTO='([^']+)'/.exec(INDEX) || [])[1] || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LUCE = +(1 + 0.06 * +((/var LUCE_SAT=(\d+)/.exec(INDEX) || [])[1] || 5)).toFixed(2);
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';

// ⚠️ LE ZONE DEL TEST, IN DUE GRUPPI (24/10/2026, suo). A: le 10 zone piu' viste in GA4 (28 gg) + la Val Brembana del
// campione, sitemap-meteo.xml. B: le 20 successive per visite, aggiunte lo stesso giorno («mi sembrano belle, ancora un
// po' di zone»), con la LORO sitemap (sitemap-meteo-b.xml) per misurarle a parte in Search Console. Non aggiungerne
// altre senza aver letto i numeri dei due gruppi.
const ZONE_METEO = ['garfagnana', 'lunigiana', 'casentino', 'valsassina', 'valdarno', 'mugello', 'nebrodi',
  'val-bormida', 'colline-metallifere-grossetane', 'val-d-aveto', 'val-brembana'];
const ZONE_METEO_B = ['valle-po', 'valle-di-viu', 'colline-livornesi', 'val-trebbia', 'sila-grande', 'alpi-apuane',
  'val-trompia', 'cilento', 'colline-metallifere', 'val-di-taro', 'val-di-vara', 'valle-germanasca', 'monti-reatini',
  'val-loana', 'monti-lattari', 'val-di-non', 'media-valle-del-serchio', 'monti-sibillini', 'valtiberina', 'valdinievole'];
// C (30/10/2026, scheda 101 bis, suo: «sì, prepara le valli»): le 20 successive per visite GA4 (28 gg, pagine zona piogge
// + zona funghi, `scratchpad 79554e37 zone-ga4.py`), dalla Riviera di Levante (44) ai Monti Sabini (18). Preparate in
// locale il 30/10; si pubblicano dopo la prima lettura dei numeri di A e B (~3-4/11). Sitemap loro, sitemap-meteo-c.xml.
const ZONE_METEO_C = ['riviera-di-levante', 'monti-cantari', 'val-di-merse', 'monti-del-partenio', 'valmalenco', 'carnia',
  'sabina', 'valle-sabbia', 'valdelsa', 'val-veddasca', 'altopiano-del-tesino', 'romagna-toscana',
  'val-di-luce', 'serre-calabresi', 'val-nure', 'monti-prenestini', 'val-borbera', 'monti-sabini'];
const ZONE_METEO_TUTTE = ZONE_METEO.concat(ZONE_METEO_B, ZONE_METEO_C);
// ⚠️ DUE ZONE DEL GRUPPO C TOLTE (1/11/2026, scheda 105 bis, analisi delle famiglie di pagine, suo «procedi come hai
// detto»): Val Serina aveva 8 paesi su 12 in comune con la Val Brembana, Candalla 7 su 9 con le Alpi Apuane. Due pagine
// quasi uguali si rubano le ricerche a vicenda. Le loro pagine meteo non ci sono piu' (rimando 301 in _redirects) e le
// pagine zona piogge e zona funghi di quelle due zone linkano la pagina meteo che le contiene (linkMeteo).
const METEO_ASSORBITE = { 'val-serina': 'val-brembana', candalla: 'alpi-apuane' };

// ⚠️ LE PAGINE «METEO <PAESE>» DEL TEST (28/10/2026, suo: «20 pagine meteo paese di prova, i paesi più cliccati»): le
// 20 pagine paese funghi con piu' clic da Google negli ultimi 28 giorni (Search Console; GA4 dice lo stesso). Le scrive
// genera-pagine-meteo-paese.js in meteo/<regione>/<slug>/, sitemap-meteo-paesi.xml a parte. Stanno QUI e non la' perche'
// le chiedono anche la pagina madre /meteo/ e il link nelle pagine paese funghi (linkMeteoPaese). Campi: loc = la pagina
// funghi del pluviometro (e /api/previsioni?paese=), n = il nome nel titolo, dove/di = le preposizioni («sul
// Mottarone»), nomi = come chiamare un punto dell'elenco dei paesi (il pluviometro ha il nome della rete), primo = il
// paese da mettere in testa quando il pluviometro sta fuori dal centro, pluv = «al pluviometro <pluv>».
const METEO_PAESI = [
  { loc: 'liguria/sassello', slug: 'sassello', n: 'Sassello', dove: 'a Sassello', di: 'di Sassello' },
  { loc: 'piemonte/mottarone-baita-cai', slug: 'mottarone', n: 'Mottarone', dove: 'sul Mottarone', di: 'del Mottarone', nomi: { 'Mottarone - Baita Cai': 'Mottarone' } },
  { loc: 'toscana/pizzorne', slug: 'pizzorne', n: 'Pizzorne', dove: 'sulle Pizzorne', di: 'delle Pizzorne' },
  { loc: 'toscana/pratomagno', slug: 'pratomagno', n: 'Pratomagno', dove: 'sul Pratomagno', di: 'del Pratomagno' },
  { loc: 'toscana/monticiano-la-pineta', slug: 'monticiano', n: 'Monticiano', dove: 'a Monticiano', di: 'di Monticiano', nomi: { 'Monticiano La Pineta': 'La Pineta' }, primo: 'Monticiano', pluv: 'della Pineta di Monticiano' },
  { loc: 'emilia/albareto-parma', slug: 'albareto', n: 'Albareto', dove: 'ad Albareto', di: 'di Albareto', nomi: { 'Albareto Parma': 'Albareto' } },
  { loc: 'liguria/barbagelata', slug: 'barbagelata', n: 'Barbagelata', dove: 'a Barbagelata', di: 'di Barbagelata' },
  { loc: 'piemonte/druogno', slug: 'druogno', n: 'Druogno', dove: 'a Druogno', di: 'di Druogno' },
  { loc: 'toscana/vallombrosa', slug: 'vallombrosa', n: 'Vallombrosa', dove: 'a Vallombrosa', di: 'di Vallombrosa' },
  { loc: 'trentino/tremalzo', slug: 'tremalzo', n: 'Tremalzo', dove: 'al Tremalzo', di: 'del Tremalzo' },
  { loc: 'piemonte/coazze', slug: 'coazze', n: 'Coazze', dove: 'a Coazze', di: 'di Coazze' },
  { loc: 'liguria/santo-stefano-d-aveto', slug: 'santo-stefano-d-aveto', n: "Santo Stefano d'Aveto", dove: "a Santo Stefano d'Aveto", di: "di Santo Stefano d'Aveto" },
  { loc: 'trentino/folgaria', slug: 'folgaria', n: 'Folgaria', dove: 'a Folgaria', di: 'di Folgaria' },
  { loc: 'toscana/capanne-di-sillano', slug: 'capanne-di-sillano', n: 'Capanne di Sillano', dove: 'a Capanne di Sillano', di: 'di Capanne di Sillano' },
  { loc: 'liguria/calizzano', slug: 'calizzano', n: 'Calizzano', dove: 'a Calizzano', di: 'di Calizzano' },
  { loc: 'toscana/bagni-di-lucca', slug: 'bagni-di-lucca', n: 'Bagni di Lucca', dove: 'a Bagni di Lucca', di: 'di Bagni di Lucca' },
  { loc: 'piemonte/bobbio-pellice', slug: 'bobbio-pellice', n: 'Bobbio Pellice', dove: 'a Bobbio Pellice', di: 'di Bobbio Pellice' },
  { loc: 'liguria/urbe-vara-sup', slug: 'urbe', n: 'Urbe', dove: 'a Urbe', di: 'di Urbe', nomi: { 'Urbe - Vara Sup.': 'Vara Superiore' }, primo: 'Urbe', pluv: 'di Vara Superiore, a Urbe' },
  { loc: 'toscana/badia-prataglia', slug: 'badia-prataglia', n: 'Badia Prataglia', dove: 'a Badia Prataglia', di: 'di Badia Prataglia' },
  { loc: 'liguria/cabanne', slug: 'cabanne', n: 'Cabanne', dove: 'a Cabanne', di: 'di Cabanne' },
];
// ⚠️ IL SECONDO GRUPPO DI PAESI (2/11/2026, scheda 112 ter, fase B, suo «sì, tutta»): scelti con un criterio diverso dai
// primi 20. Quelli erano le pagine funghi con piu' clic, ma le loro ricerche sono «meteo funghi <posto>», che restano
// apposta alla pagina funghi: al 2/11 meta' non erano mai uscite su Google. Questi sono i paesi per cui Google mostrava
// GIA' la nostra pagina funghi a chi cercava «meteo <paese>» SENZA «funghi» (Search Console 3/10-1/11: Serravalle di
// Carda 182 viste, Giffone 101, Rofrano 47...), con zero clic: la domanda c'e', la pagina giusta no. Sitemap loro,
// sitemap-meteo-paesi-b.xml, per misurarli a parte. Druogno e Albareto, che stavano nell'elenco, c'erano gia'.
const METEO_PAESI_B = [
  { loc: 'marche/serravalle-di-carda', slug: 'serravalle-di-carda', n: 'Serravalle di Carda', dove: 'a Serravalle di Carda', di: 'di Serravalle di Carda' },
  { loc: 'calabria/giffone', slug: 'giffone', n: 'Giffone', dove: 'a Giffone', di: 'di Giffone' },
  { loc: 'campania/rofrano', slug: 'rofrano', n: 'Rofrano', dove: 'a Rofrano', di: 'di Rofrano' },
  { loc: 'lazio/licenza', slug: 'licenza', n: 'Licenza', dove: 'a Licenza', di: 'di Licenza' },
  { loc: 'basilicata/lagonegro', slug: 'lagonegro', n: 'Lagonegro', dove: 'a Lagonegro', di: 'di Lagonegro' },
  { loc: 'marche/sefro', slug: 'sefro', n: 'Sefro', dove: 'a Sefro', di: 'di Sefro' },
  { loc: 'lazio/rocca-di-papa', slug: 'rocca-di-papa', n: 'Rocca di Papa', dove: 'a Rocca di Papa', di: 'di Rocca di Papa' },
  { loc: 'toscana/badia-agnano', slug: 'badia-agnano', n: 'Badia Agnano', dove: 'a Badia Agnano', di: 'di Badia Agnano' },
  { loc: 'lombardia/porlezza-torrente', slug: 'porlezza', n: 'Porlezza', dove: 'a Porlezza', di: 'di Porlezza', nomi: { 'Porlezza torrente': 'Porlezza' } },
  { loc: 'lazio/turano-a-rocca-sinibalda', slug: 'rocca-sinibalda', n: 'Rocca Sinibalda', dove: 'a Rocca Sinibalda', di: 'di Rocca Sinibalda', nomi: { 'Turano a Rocca Sinibalda': 'Rocca Sinibalda' }, pluv: 'del Turano, a Rocca Sinibalda' },
  { loc: 'trentino/val-di-breguzzo-ponte-arno', slug: 'val-di-breguzzo', n: 'Val di Breguzzo', dove: 'in Val di Breguzzo', di: 'della Val di Breguzzo', nomi: { 'Val di Breguzzo (Ponte Arnò)': 'Val di Breguzzo' }, pluv: 'di Ponte Arnò, in Val di Breguzzo' },
  { loc: 'emilia/lago-ballano', slug: 'lago-ballano', n: 'Lago Ballano', dove: 'al Lago Ballano', di: 'del Lago Ballano' },
  { loc: 'calabria/gambarie', slug: 'gambarie', n: 'Gambarie', dove: 'a Gambarie', di: 'di Gambarie' },
  { loc: 'piemonte/roccaforte-mondovi', slug: 'roccaforte-mondovi', n: 'Roccaforte Mondovì', dove: 'a Roccaforte Mondovì', di: 'di Roccaforte Mondovì' },
  { loc: 'sicilia/caronia-pomiere-sias', slug: 'caronia', n: 'Caronia', dove: 'a Caronia', di: 'di Caronia', nomi: { 'Caronia Pomiere SIAS': 'Pomiere' }, primo: 'Caronia', pluv: 'di Pomiere, nel bosco di Caronia' },
  { loc: 'piemonte/cellio-con-breia', slug: 'cellio-con-breia', n: 'Cellio con Breia', dove: 'a Cellio con Breia', di: 'di Cellio con Breia' },
  { loc: 'campania/solofra', slug: 'solofra', n: 'Solofra', dove: 'a Solofra', di: 'di Solofra' },
  { loc: 'campania/cervinara', slug: 'cervinara', n: 'Cervinara', dove: 'a Cervinara', di: 'di Cervinara' },
  { loc: 'calabria/fabrizia', slug: 'fabrizia', n: 'Fabrizia', dove: 'a Fabrizia', di: 'di Fabrizia' },
  { loc: 'friuli/paluzza', slug: 'paluzza', n: 'Paluzza', dove: 'a Paluzza', di: 'di Paluzza' },
];
const METEO_PAESI_TUTTI = METEO_PAESI.concat(METEO_PAESI_B);
const indirizzoMeteoPaese = p => `${SITO}/meteo/${p.loc.split('/')[0]}/${p.slug}/`;

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function scrivi(dest, testo) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, testo.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
}
const agenziaDi = k => { const r = REGIONI.find(x => x.k === k); return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null; };

/* Il link «Previsioni meteo <Zona> →» dentro il blocco «Che tempo farà» delle pagine zona piogge e zona funghi
   (genera-pagine-zona-piogge.js e genera-pagine-zona.js lo chiedono qui, cosi' l'elenco resta uno solo). Serve a dire
   a Google quale delle tre pagine della zona e' quella delle previsioni. Vuoto per le zone fuori dal test. */
function linkMeteo(zslug, nome, ga) {
  if (METEO_ASSORBITE[zslug]) {
    const dentro = ZONE.find(z => slug(z.n) === METEO_ASSORBITE[zslug]);
    if (dentro) { nome = dentro.n; zslug = METEO_ASSORBITE[zslug]; }
  }
  if (!ZONE_METEO_TUTTE.includes(zslug)) return '';
  return `<p class="mk-meteo-zona" style="margin:12px 0 2px;font-size:16px;font-weight:700"><a href="${SITO}/meteo/${zslug}/"`
    + ` onclick="try{gtag('event','apri_meteo_zona',{da:'${ga}'})}catch(e){}">Previsioni meteo ${esc(nome)} →</a></p>`;
}
// Lo stesso per le pagine paese funghi dei 20 posti del test (28/10/2026): «Meteo Sassello» e' la pagina del tempo,
// «Funghi a Sassello oggi» quella della pioggia che conta. Vuoto per gli altri posti. loc = '<regione>/<slug funghi>'.
function linkMeteoPaese(loc, ga) {
  const p = METEO_PAESI_TUTTI.find(x => x.loc === loc);
  if (!p) return '';
  return `<p class="mk-meteo-zona" style="margin:12px 0 2px;font-size:16px;font-weight:700"><a href="${indirizzoMeteoPaese(p)}"`
    + ` onclick="try{gtag('event','apri_meteo_paese',{da:'${ga}'})}catch(e){}">Meteo ${esc(p.n)}: previsioni ora per ora →</a></p>`;
}
/* «Previsioni meteo valle per valle» (30/10/2026, scheda 101 bis, suo: «sì, tutti e due»): le pagine meteo di zona e di
   paese di UNA regione, per le pagine «adesso» (genera-pagine-adesso.js). Link veri nell'HTML: le «adesso» sono su
   Google da subito e portano li' le pagine meteo. Stile .mv nella pagina che lo chiede. Vuoto se la regione non ne ha:
   compare da solo quando ne arriva una. Ordine alfabetico, «Meteo <nome>» come il titolo delle pagine.
   ⚠️ 31/10/2026 (scheda 104 bis, controllo SEO del cloud, suo «sì, le pagine meteo»): anche nelle pagine meteo stesse
   (`salta` = l'indirizzo della pagina, che non linka se stessa), nelle 23 regioni e nelle 19 regioni funghi. Prima le
   71 pagine meteo non linkavano nessun'altra pagina meteo e ne ricevevano 2-3 link a testa. Stile: MV_CSS. */
function linkMeteoRegione(reg, ga, salta) {
  const voce = (href, n, ev) => `<a class="mv-c" href="${href}" onclick="try{gtag('event','${ev}',{da:'${ga}'})}catch(e){}">Meteo ${esc(n)}</a>`;
  const per = (a, b) => a.n.localeCompare(b.n, 'it');
  const zone = ZONE_METEO_TUTTE.map(s => ZONE.find(z => slug(z.n) === s))
    .filter(z => z && z.reg === reg && `${SITO}/meteo/${slug(z.n)}/` !== salta).sort(per);
  const paesi = METEO_PAESI_TUTTI.filter(p => p.loc.split('/')[0] === reg && indirizzoMeteoPaese(p) !== salta).sort(per);
  if (!zone.length && !paesi.length) return '';
  return (zone.length ? `<h3 class="cit-tit">Previsioni meteo valle per valle</h3>
<p class="nota mv-nota">I paesi di ogni valle, ognuno alla sua quota: previsioni a 7 giorni, ora per ora.</p>
<div class="mv">${zone.map(z => voce(`${SITO}/meteo/${slug(z.n)}/`, z.n, 'apri_meteo_zona')).join('')}</div>\n` : '')
    + (paesi.length ? `<h3 class="cit-tit">Previsioni meteo paese per paese</h3>
<div class="mv">${paesi.map(p => voce(indirizzoMeteoPaese(p), p.n, 'apri_meteo_paese')).join('')}</div>\n` : '');
}
// le pillole di linkMeteoRegione, le stesse regole delle pagine «adesso» (STILE_ADESSO di genera-pagine-adesso.js)
const MV_CSS = `
.cit-tit{font-size:18px;color:var(--blu-scuro);margin:22px 0 2px;}
.mv-nota{margin:0 0 10px;}
.mv{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px;}
.mv-c{display:inline-block;padding:8px 14px;border:1px solid #c9d6e6;border-radius:20px;background:#fff;color:var(--blu);font-weight:700;font-size:15px;text-decoration:none;}
.mv-c:hover{background:#eef4fd;}
.mv-c::after{content:" →";}
`;
// ⚠️ 31/10/2026 (scheda 104 bis, proposta 2 del cloud): I NOMI DEI PAESI SCRITTI NELL'HTML. Prima arrivavano solo con
// le previsioni, e nel testo che Google legge subito non ce n'era nessuno: «meteo poppi» non portava al Casentino.
// La tabella nasce coi nomi e le quote (dal piu' basso, come la riempie il browser); disegnaTab la riscrive tutta
// quando arrivano le previsioni. Le righe scritte qui non hanno data-n: prima delle previsioni non si aprono.
function tabellaFissa(nomi, quote) {
  const righe = nomi.slice().sort((a, b) => (quote[a] || 0) - (quote[b] || 0))
    .map(n => `<tr><td>${esc(n)}<span class="q">~ ${quote[n] != null ? quote[n].toLocaleString('it-IT') : '–'} m</span></td><td>…</td></tr>`);
  return `<thead><tr><th>Paese</th><th>7 giorni</th></tr></thead><tbody>${righe.join('')}</tbody>`;
}
// «a Bibbiena, Castel Focognano, Chiusi della Verna e negli altri 9 paesi della valle»
function aiPaesi(nomi, dove) {
  return nomi.length > 4 ? `a ${nomi.slice(0, 3).map(esc).join(', ')} e negli altri ${nomi.length - 3} paesi ${dove}`
    : `a ${nomi.slice(0, -1).map(esc).join(', ')}${nomi.length > 1 ? ' e ' : ''}${esc(nomi[nomi.length - 1])}`;
}
// in fondo alle pagine meteo di zona e di paese: le altre della stessa regione, sotto un titolo loro
function altreMeteo(r, ga, salta) {
  const blocco = linkMeteoRegione(r.k, ga, salta);
  return blocco ? `<h2>Previsioni meteo ${r.prep} ${esc(r.nomeTitolo || r.nome)}</h2>\n${blocco}` : '';
}

const CSS = `
.bric{font-size:14px;color:#666;margin-bottom:6px;}
.bric a{color:var(--blu);}
/* ── pagina «Previsioni meteo <zona>» (campione 24/10/2026, prove/meteo-zone/) ── */
.pz-cerca{position:relative;margin:14px 0 4px}
.pz-cerca input{width:100%;box-sizing:border-box;font-size:16px;padding:12px 14px 12px 40px;border:2px solid #1a5fa8;border-radius:12px;outline:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%231a5fa8' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E") no-repeat 13px center}
.pz-drop{display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid #c9d5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:1000;overflow:hidden}
.pz-drop.on{display:block}
.pz-drop .r{padding:10px 14px;cursor:pointer;border-bottom:1px solid #eef2f6;display:flex;justify-content:space-between;gap:10px}
.pz-drop .r:hover,.pz-drop .r.sel{background:#eef5fb}
.pz-drop .r small{color:#7a8796}
.pz-drop .t{padding:10px 14px;color:#5a6b7d;font-size:14px}
.pz-punto{background:#eef5fb;border-left:4px solid #1a5fa8;border-radius:8px;padding:12px 14px;margin:14px 0 6px;font-size:15.5px;line-height:1.5}
.pz-punto b{color:#0f3d6e}
.pz-punto .pz-quando{display:block;font-size:12px;color:#5a6b7d;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.pz-giorni{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:10px 0 4px}
.pz-g{background:#fff;border:1px solid #d8e2ec;border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer;font:inherit;color:inherit;transition:transform .1s}
.pz-g:hover{border-color:#1a5fa8}
.pz-g.sel{background:#1a5fa8;border-color:#1a5fa8;color:#fff}
.pz-g.sel .t .mn,.pz-g.sel .t .mx,.pz-g.sel .p,.pz-g.sel .n{color:#fff}
.pz-g .n{font-size:12px;font-weight:700;color:#333;text-transform:capitalize}
.pz-g .ic{font-size:26px;line-height:1.3}
.pz-g .t{font-size:13px}.pz-g .t .mn{color:#1a5fa8}.pz-g .t .mx{color:#c4501a;font-weight:700}
.pz-g .p{font-size:13px;font-weight:700;color:#1a5fa8;margin-top:4px;min-height:17px}
.pz-g .p.zero{opacity:.6;font-weight:400}
/* LA % DI PIOGGIA (25/10/2026): la GOCCIA come weather.com e Google (sua scelta), e i millimetri scritti «mm». Tre toni
   come la mappa del sito: sotto il 10% grigia, dal 60% rossa. Nei giorni e' la piu' alta fra i paesi della zona */
.pz-g .pc{font-size:12.5px;font-weight:700;color:#1a5fa8;margin-top:2px;min-height:16px}
.pz-g .pc.z,.pz-scheda .giorni .pc.z,table.pz-tab td .pc.z{color:#9aa3ad;font-weight:500}
.pz-g .pc.alta,.pz-scheda .giorni .pc.alta,table.pz-tab td .pc.alta,.pz-et .pp.alta{color:#c21f1f}
.pz-g.sel .pc,.pz-g.sel .pc.z,.pz-g.sel .pc.alta{color:#fff}
.pz-g .barra{height:4px;background:#e3edf7;border-radius:2px;margin:4px 6px 0;overflow:hidden}
.pz-g .barra i{display:block;height:100%;background:#1a5fa8}
.pz-g.sel .barra{background:rgba(255,255,255,.3)}.pz-g.sel .barra i{background:#fff}
.pz-tot{font-size:14px;color:#333;margin:6px 0 0}
.pz-mappa-testa{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.pz-mappa-testa .dove{font-weight:700;color:#0f3d6e}
#pz-mappa{height:460px;border-radius:12px;border:1px solid #c9d5e1;margin:8px 0 4px;z-index:1}
/* la foto dal satellite (SAT nel generatore) schiarita come nella mappa; sotto, mentre le tessere arrivano, il fondo
   scuro della vista Italia invece del grigio di Leaflet */
#pz-mappa.sat{background:#3e526b}#pz-mappa.sat .leaflet-tile-pane{filter:brightness(${LUCE}) saturate(1.1)}
/* LA BARRA CHE SCORRE (30/10/2026, suo: «sì, la barra»): la stessa della vista Italia della mappa (#vi-nastro di
   index.html: fascia gialla, filetti rossi, blocco rosso tagliato in diagonale). ⚠️ STA SOPRA LA SCHEDA ORA PER ORA,
   come la sua testata, nella stessa cornice blu (suo, fra tre posizioni provate: «C, sopra la scheda»). Sotto la mappa
   «è un po' sprecata, è il nostro pezzo wow e uno deve scrollare tutto» (al telefono stava a 2.750 px); in cima sotto il
   menu e attaccata in alto scorrendo le altre due, scartate. Toccando un paese la scheda li' sotto passa a quel paese.
   Con la scheda chiusa (×) la barra ha la cornice intera. touch-action pan-y: col dito in su e in giu' la pagina
   scorre, di lato si trascina la barra (naGira in clientePagina) */
.pz-nastro{position:relative;height:44px;overflow:hidden;background:#ffd400;border:2px solid #1a5fa8;border-bottom:0;border-radius:14px 14px 0 0;margin:14px 0 0;scroll-margin-top:12px;display:flex;align-items:center;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.pz-nastro:not([hidden]) + .pz-scheda{margin-top:0;border-top-left-radius:0;border-top-right-radius:0}
.pz-nastro:has(+ .pz-scheda:not(.on)){border-bottom:2px solid #1a5fa8;border-radius:14px}
.pz-nastro[hidden]{display:none}
.pz-nastro .lab{position:absolute;left:0;top:0;bottom:0;z-index:2;display:flex;align-items:center;gap:8px;padding:0 30px 0 16px;background:#c8102e;color:#fff;clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%);font:900 13px/1.1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.05em;white-space:nowrap}
.pz-nastro .lab span{font-size:12px;font-weight:800;color:#ffe36b;letter-spacing:.06em}
.pz-nastro .lab b{font-weight:900}.pz-nastro .lab em{font-style:normal}.pz-nastro .lab.corto em{display:none}
.pz-nastro .t{display:flex;white-space:nowrap;will-change:transform;cursor:grab}
.pz-nastro .v{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;border:0;background:none;color:#111;font:700 14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:0 16px;border-right:2px solid #c8102e;cursor:pointer}
.pz-nastro .v b{font-weight:900;text-transform:uppercase;letter-spacing:.03em}.pz-nastro .v .ic{font-size:18px}
.pz-nastro .v small{font-weight:600;color:#6d5800;font-size:11px}
.pz-nastro .v .mn{color:#5c4a00;font-weight:700}.pz-nastro .v .mx{color:#111;font-weight:900}
@media (max-width:600px){.pz-nastro{height:40px}
  .pz-nastro .lab{flex-direction:column;align-items:flex-start;justify-content:center;gap:0;font-size:10.5px;line-height:1.05;padding:0 22px 0 10px;white-space:normal;max-width:38%}.pz-nastro .lab span{font-size:10px}
  .pz-nastro .v{font-size:13px;padding:0 12px;gap:5px}.pz-nastro .v .ic{font-size:15px}}
.pz-pt{position:relative}
/* ⚠️ L'ETICHETTA STA SUL PAESE (24/10/2026 sera, suo, dopo tre prove bocciate con puntino + etichetta spostata + lineetta:
   «niente di quello che mi hai proposto funziona, guarda come fanno gli altri»). Come la mappa di 3B Meteo: il
   riquadro e' CENTRATO sul punto del paese, niente puntino a parte, niente lineette; se due si toccherebbero non se ne
   sposta nessuna, si NASCONDE il paese meno importante, e ingrandendo la mappa ricompare. */
/* COME LE ETICHETTE DELLA MAPPA (30/10/2026, .ve-et di index.html): bianco pieno e ombra piu' scura per staccare dalla
   foto, minima blu e massima rossa; nella mappa grande al computer su UNA riga (icona, nome, minima, massima, poi 💧 e
   millimetri), al telefono su due come la mappa sulla regione; il paese della scheda aperta in BLU (.scelto) */
.pz-et{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;cursor:pointer;text-align:center;line-height:1.12;background:#fff;border-radius:8px;padding:2px 7px 3px;box-shadow:0 1px 4px rgba(0,0,0,.45);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111}
.pz-et .r1{display:block;font-size:12px;font-weight:800}
.pz-et .ic{font-size:16px;vertical-align:-3px;margin-right:2px}
.pz-et .mn{color:#1856b8}.pz-et .mx{color:#c21f1f}
.pz-et .gc{color:#1856b8;margin-left:4px}.pz-et .gc.bagnato{background:#1856b8;color:#fff;border-radius:999px;padding:0 5px}
.pz-et .pp{color:#1856b8;margin-left:4px}
.pz-et .nm{display:block;font-size:11px;font-weight:700;color:#111}
.pz-et.via{display:none}
#pz-mappa .pz-et{display:inline-flex;align-items:center;gap:4px;padding:2px 8px 2px 4px}#pz-mappa .pz-et.via{display:none}
#pz-mappa .pz-et .r1{display:contents}
#pz-mappa .pz-et .ic{order:0;margin:0;font-size:17px;vertical-align:0}#pz-mappa .pz-et .nm{order:1;font-size:12.5px;font-weight:800}
#pz-mappa .pz-et .mn{order:2}#pz-mappa .pz-et .mx{order:3}#pz-mappa .pz-et .pp,#pz-mappa .pz-et .gc{order:4;margin-left:0}
.pz-et.scelto{background:#1f6fd1}.pz-et.scelto .nm,.pz-et.scelto .pp{color:#fff}.pz-et.scelto .mn,.pz-et.scelto .gc{color:#cfe3ff}.pz-et.scelto .mx{color:#ffd0d0}
.pz-et.scelto .gc.bagnato{background:#fff;color:#1f6fd1}
@media (max-width:600px){.pz-et{padding:1px 5px 2px}.pz-et .r1{font-size:11px}.pz-et .ic{font-size:14px}.pz-et .nm{font-size:10px}
  #pz-mappa .pz-et{flex-direction:column;gap:0;padding:1px 5px 2px}#pz-mappa .pz-et .r1{display:flex;align-items:center;gap:3px}
  #pz-mappa .pz-et .ic{font-size:14px}#pz-mappa .pz-et .nm{font-size:10px}}
.pz-zoom{color:#1a5fa8;font-weight:700}
.pz-scorri{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0}
table.pz-tab{border-collapse:collapse;min-width:640px;width:100%;font-size:13px}
table.pz-tab th,table.pz-tab td{padding:6px 4px;border-bottom:1px solid #e6ecf2;text-align:center;white-space:nowrap}
table.pz-tab th:first-child,table.pz-tab td:first-child{text-align:left;position:sticky;left:0;background:#fff;padding-right:10px}
table.pz-tab tbody tr{cursor:pointer}table.pz-tab tbody tr:hover td{background:#f4f8fc}
table.pz-tab td:first-child{color:#1a5fa8;font-weight:700;text-decoration:underline;text-decoration-color:#bcd2e8}
table.pz-tab .col-sel{background:#eef5fb}
table.pz-tab th.col-sel{color:#1a5fa8}
table.pz-tab td .q{display:block;font-size:11px;color:#7a8796;font-weight:400;text-decoration:none}
table.pz-tab td .ic{font-size:17px}
table.pz-tab td .mn{color:#1a5fa8}table.pz-tab td .mx{color:#c4501a;font-weight:700}
table.pz-tab td .mm{display:block;font-size:11.5px;color:#1a5fa8;font-weight:700;min-height:14px}
table.pz-tab td .pc{display:block;font-size:11.5px;color:#1a5fa8;font-weight:700}
.pz-scheda{display:none;border:2px solid #1a5fa8;border-radius:14px;padding:12px 14px;margin:14px 0;background:#fff;scroll-margin-top:12px}
.pz-scheda.on{display:block}
.pz-scheda .testa{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.pz-scheda h3{margin:0;font-size:19px;color:#0f3d6e}
.pz-scheda .sub{font-size:12.5px;color:#5a6b7d;margin-top:2px}
.pz-scheda .chiudi{border:0;background:#eef2f6;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;flex:none}
.pz-scheda .giorni{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(66px,1fr);gap:6px;overflow-x:auto;margin:10px 0 6px;padding-bottom:4px}
.pz-scheda .giorni button{border:1px solid #d8e2ec;background:#fff;border-radius:10px;padding:6px 4px;font:inherit;font-size:12.5px;cursor:pointer;text-align:center}
.pz-scheda .giorni button.sel{background:#1a5fa8;color:#fff;border-color:#1a5fa8}
.pz-scheda .giorni b{display:block;text-transform:capitalize}
.pz-scheda .giorni .pc{display:block;font-weight:700;color:#1a5fa8}.pz-scheda .giorni button.sel .pc{color:#fff}
/* LE ORE A RIGHE, come 3B (29/10/2026, suo, scelta fra tre bozze: «La A»): prima erano caselle in fila e «non c'e' la
   tabella oraria». Una riga per ora: ora, icona e parola, temperatura, mm solo se piove e la %, vento con freccia e
   direzione. Al telefono la parola sparisce (come 3B) e la % va sotto i mm. */
.tv-nota{margin:8px 0 0;font-size:12.5px;color:#5a6b7d}
.tv{width:100%;border-collapse:collapse;margin:6px 0 8px;font-size:14px;font-variant-numeric:tabular-nums}
.tv td{padding:9px 6px;border-bottom:1px solid #e6edf4;text-align:left;white-space:nowrap;vertical-align:middle}
.tv .h{font-weight:700;color:#0f3d6e;width:48px}
.tv .h b{display:block;font-size:12px;letter-spacing:-.2px}
.tv tr.f6 .h{font-weight:500;color:#5a6b7d}
.tv .ic{font-size:22px;line-height:1;margin-right:8px;vertical-align:middle}
.tv .pa{color:#33475b;vertical-align:middle}
.tv .t{font-weight:700;font-size:16px;color:#0f2b46;text-align:right;padding-right:14px}
.tv .mmv{color:#1a5fa8}.tv .z{color:#9aa3ad}
/* la % di pioggia, ora per ora: gli stessi tre toni della mappa (sotto il 10% grigia, dal 60% rossa) */
.tv .pc{font-weight:700;color:#1a5fa8;font-size:12.5px}.tv .pc.z{color:#9aa3ad;font-weight:500}.tv .pc.alta{color:#c21f1f}
.tv .piove .pc{margin-left:8px}
.tv .ve{color:#33475b}.tv .ve small{color:#7a8796;font-size:12px}
.tv .fr{display:inline-block;font-style:normal;color:#1a5fa8;font-weight:700;margin-right:5px;line-height:1}
.tv .sep td{background:#eef4fa;color:#0f3d6e;font-weight:700;font-size:12.5px;padding:6px;border-bottom:1px solid #d8e2ec}
@media(max-width:560px){.tv .pa{display:none}.tv td{padding:8px 4px}.tv .piove .pc{display:block;margin:0;font-size:12px}.tv .t{padding-right:8px}}
/* righe tutte alte uguali e scritte centrate (28/10/2026, regola delle simmetrie): i due della pioggia vanno su due righe */
.pz-porte{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;gap:6px;margin-top:8px}
.pz-porte a{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px solid #c9d5e1;border-radius:10px;padding:8px 4px;text-decoration:none;color:#0f3d6e;font-size:12.5px;font-weight:700}
.pz-porte a span{display:block;font-size:20px}
.pz-porte a small{display:block;font-size:11.5px;font-weight:500;color:#4a5d72}
@media(max-width:380px){.pz-porte a{font-size:12px;padding:8px 2px}}
.pz-graf{position:relative;display:flex;align-items:flex-end;gap:2px;height:130px;margin:34px 0 0;padding-bottom:2px;border-bottom:1px solid #c9d5e1}
/* misurata e prevista (28/10/2026): i giorni previsti su un fondo azzurro chiaro col filo a sinistra, i due nomi in
   maiuscoletto sopra, le date e la pillola «oggi» sotto l'asse. Le barre stanno sopra il fondo (position:relative) */
.pz-fut{position:absolute;top:-28px;bottom:-1px;right:0;margin-left:-1px;background:#eef4fb;border-left:1px solid #9db4cc;border-radius:0 10px 0 0;pointer-events:none}
.pz-gt{position:absolute;left:0;top:-24px;font-size:10.5px;line-height:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7a8a9b;white-space:nowrap;pointer-events:none}
.pz-gt.pre{margin-left:8px;color:#2f6aa6}
.pz-graf-date{position:relative;height:22px;margin:0 0 4px;font-size:11.5px;color:#5a6b7d}
.pz-graf-date span{position:absolute;top:4px;transform:translateX(-50%);white-space:nowrap}
.pz-graf-date span.d{transform:translateX(-100%)}.pz-graf-date span.s{transform:none}
.pz-graf-date span.oggi{top:3px;background:#0f3d6e;color:#fff;font-weight:700;font-size:11px;line-height:15px;border-radius:999px;padding:0 8px}
.pz-graf .b{position:relative;flex:1;background:#1a5fa8;border-radius:2px 2px 0 0;min-height:2px;cursor:pointer}
.pz-graf .b:hover,.pz-graf .b.sel{background:#c4501a}
.pz-graf .b.prev{background:repeating-linear-gradient(45deg,#7fb0e0,#7fb0e0 3px,#b9d4ef 3px,#b9d4ef 6px)}
.pz-graf .b.prev.sel,.pz-graf .b.prev:hover{background:#c4501a}
.pz-graf-info{font-size:14px;min-height:20px;color:#0f3d6e;margin-top:6px}
.pz-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#4a5866;margin-top:4px}
.pz-leg i{display:inline-block;width:12px;height:10px;margin-right:5px;vertical-align:-1px;border-radius:2px}
.pz-radar{display:block;background:#1a5fa8;color:#fff!important;text-decoration:none;border-radius:12px;padding:14px 16px;margin:18px 0;font-weight:700}
.pz-radar small{display:block;font-weight:400;opacity:.9;margin-top:2px}
.pz-vai{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.pz-vai a{display:block;border:1px solid #c9d5e1;border-radius:10px;padding:12px;text-decoration:none;color:#0f3d6e;font-weight:700;background:#fff}
.pz-vai a small{display:block;font-weight:400;color:#5a6b7d;margin-top:3px}
@media (max-width:600px){.pz-giorni{gap:4px}.pz-g{padding:6px 2px}.pz-g .ic{font-size:22px}.pz-g .t,.pz-g .p{font-size:12px}.pz-vai{grid-template-columns:1fr}#pz-mappa{height:480px}
  /* al telefono la casella del giorno e' larga ~48 px: «5,8 mm» andava a capo (25/10/2026), e sotto adesso c'e' la % */
  .pz-g .p,.pz-g .pc{font-size:11.5px;letter-spacing:-.3px;white-space:nowrap}}
@media (max-width:380px){.pz-g .p,.pz-g .pc{font-size:11px}}
`;

/* ⚠️ GIRA NEL BROWSER: la pagina la copia con toString() e la chiama con la sua configurazione (C).
   SOLO ES5: niente frecce, let, const, backtick. E' il codice del campione (prove/meteo-zone/costruisci.js) con la
   sola variante F delle etichette, senza interruttore pioggia/temperature e con le richieste al sito stesso.
   LE PAGINE «METEO <PAESE>» (28/10/2026, genera-pagine-meteo-paese.js) usano lo stesso codice con C.solo: i 7 giorni, il
   punto e il grafico sono quelli del PRIMO posto dell'elenco (il paese della pagina), mappa e tabella i paesi intorno;
   C.paese = la domanda all'API (paese=<reg>/<slug>), C.giorni + C.id = la pioggia caduta del pluviometro dal file delle
   pagine paese funghi, C.nomi / C.primo = nomi e ordine dei punti (vedi METEO_PAESI). Senza, e' la pagina di zona. */
function clientePagina(C) {
  var SITO = C.sito, REG = C.reg;
  var API = '/api/previsioni';
  var BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/data/' : C.raw;
  var RIP = BASE + (C.giorni || 'riepiloghi/zone/' + C.slug + '.json');
  var QUOTE = C.quote, PLUV = C.pluv;
  var GS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'], GL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var ICONE = [[/clearsky_day|fair_day/, '☀️'], [/clearsky_night|fair_night/, '🌙'], [/partlycloudy_day/, '⛅'], [/partlycloudy_night|^cloudy|fog/, '☁️'],
               [/thunder/, '⛈️'], [/heavyrain|heavysleet/, '🌧️'], [/rain|sleet|drizzle/, '🌦️'], [/snow/, '🌨️']];
  function icona(s) { for (var i = 0; i < ICONE.length; i++) if (ICONE[i][0].test(s || '')) return ICONE[i][1]; return '☁️'; }
  function iso(ms) { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); }
  function piu(s, n) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n, 12)).toISOString().slice(0, 10); }
  var OGGI = iso(Date.now()), DOMANI = piu(OGGI, 1), IERI = piu(OGGI, -1);
  function d(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function nome(s, lungo) { var x = d(s); return s === OGGI ? 'oggi' : s === DOMANI ? 'domani' : s === IERI ? 'ieri' : (lungo ? GL : GS)[x.getDay()] + ' ' + x.getDate(); }
  function maiusc(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function mm(n) { return n === 0 ? '0' : n < 10 ? num(n) : String(Math.round(n)); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  // la % di pioggia: la goccia e i tre toni (vedi .pz-g .pc nello stile)
  function tonoPc(p) { return p == null ? '' : p < 10 ? ' z' : p >= 60 ? ' alta' : ''; }
  function pcTesto(p) { return p == null ? '' : '💧 ' + p + '%'; }
  function finoAl(p) { return (/^(8|11$|1$)/.test(String(p)) ? "fino all'" : 'fino al ') + p + '%'; }
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function $(id) { return document.getElementById(id); }
  function ga(azione) { try { gtag('event', C.evento || 'meteo_zona', { zona: C.slug, azione: azione }); } catch (e) {} }
  var J = null, G = [], RIPJ = null, SEL = OGGI, mappa = null, strato = null, PAESI = [];

  /* ── i 7 giorni della valle ── */
  function giorniDi() {
    var per = {};
    (C.solo ? PAESI.slice(0, 1) : PAESI).forEach(function (c) { c.giorni.forEach(function (g) { if (g.g < OGGI) return; (per[g.g] = per[g.g] || []).push({ c: c, g: g }); }); });
    return Object.keys(per).sort().slice(0, 7).map(function (k) {
      var l = per[k], conti = {}, top = null, mmS = 0, mmMax = 0, dove = '';
      l.forEach(function (x) { var i = icona(x.g.s); conti[i] = (conti[i] || 0) + 1; mmS += x.g.mm; if (x.g.mm > mmMax) { mmMax = x.g.mm; dove = x.c.n; } });
      Object.keys(conti).forEach(function (i) { if (!top || conti[i] > conti[top]) top = i; });
      var mn = Math.min.apply(null, l.map(function (x) { return x.g.mn; })), mx = Math.max.apply(null, l.map(function (x) { return x.g.mx; }));
      // la % del giorno nella zona = la piu' alta fra i paesi, e dove
      var pc = null, dpc = '';
      l.forEach(function (x) { if (x.g.pc != null && (pc == null || x.g.pc > pc)) { pc = x.g.pc; dpc = x.c.n; } });
      return { g: k, ic: top, mn: mn, mx: mx, dmn: l.filter(function (x) { return x.g.mn === mn; })[0].c.n, dmx: l.filter(function (x) { return x.g.mx === mx; })[0].c.n, mm: mmS / l.length, mmMax: mmMax, dove: dove, pc: pc, dpc: dpc };
    });
  }
  function disegnaGiorni() {
    var maxMm = Math.max(5, Math.max.apply(null, G.map(function (x) { return x.mm; })));
    var conPc = G.some(function (x) { return x.pc != null; });
    $('giorni').innerHTML = G.map(function (x) {
      return '<button class="pz-g' + (x.g === SEL ? ' sel' : '') + '" data-g="' + x.g + '"><div class="n">' + nome(x.g) + '</div><div class="ic">' + x.ic + '</div>'
        + '<div class="t"><span class="mn">' + x.mn + '°</span> / <span class="mx">' + x.mx + '°</span></div>'
        + '<div class="p' + (x.mm < 0.1 ? ' zero' : '') + '">' + (x.mm < 0.1 ? 'asciutto' : mm(x.mm) + ' mm') + '</div>'
        + (conPc ? '<div class="pc' + tonoPc(x.pc) + '"' + (x.pc != null ? ' title="probabilità di pioggia' + (C.solo ? ' a ' : ', la più alta fra i paesi: ') + esc(x.dpc) + '"' : '') + '>' + pcTesto(x.pc) + '</div>' : '')
        + '<div class="barra"><i style="width:' + Math.min(100, x.mm / maxMm * 100) + '%"></i></div></button>';
    }).join('');
  }
  function totale() {
    var tot = G.reduce(function (a, x) { return a + x.mm; }, 0), picco = G.slice().sort(function (a, b) { return b.mmMax - a.mmMax; })[0];
    $('tot').innerHTML = tot < 0.5 ? 'Nei prossimi 7 giorni <b>non è prevista pioggia</b> che conti ' + C.inValle + '.'
      : C.solo ? 'In tutta la settimana sono previsti <b>' + mm(tot) + ' mm</b> ' + C.dove + '; il giorno più bagnato è <b>' + nome(picco.g, true) + '</b>, con ' + mm(picco.mmMax) + ' mm.'
      : 'In tutta la settimana sono previsti in media <b>' + mm(tot) + ' mm</b>; il giorno più bagnato è <b>' + nome(picco.g, true) + '</b>, fino a ' + mm(picco.mmMax) + ' mm a ' + esc(picco.dove) + '.';
    return tot;
  }
  function sceglie(g) {
    SEL = g; disegnaGiorni(); disegnaMappa(); disegnaTab(); disegnaNastro();
    var x = G.filter(function (y) { return y.g === g; })[0];
    var quando = g === OGGI ? 'oggi' : g === DOMANI ? 'domani' : nome(g, true);
    $('mappa-giorno').textContent = C.solo ? C.intorno + ', ' + quando
      : 'La ' + C.valle + ' ' + quando + (x ? ': ' + (x.mm < 0.1 ? 'asciutto' : mm(x.mm) + ' mm in media') : '');
  }

  /* ── la mappa della valle ── */
  function disegnaMappa() {
    if (!window.L || !J) return;
    if (!mappa) {
      // ⚠️ AL TELEFONO UN DITO FA SCORRERE LA PAGINA, NON LA MAPPA (24/10/2026, suo «la mappa si sposta se scrolli col
      // dito: fissala»): sugli schermi touch niente trascinamento a un dito; restano il pizzico a due dita (che sposta
      // anche), i bottoni + e − e i tocchi sui paesi. Si guarda il PUNTATORE, non la larghezza, come il tasto «La mia
      // posizione» della mappa: un computer con la finestra stretta resta col mouse.
      var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      mappa = L.map('pz-mappa', { scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.25, dragging: !touch });
      /* LA FOTO DAL SATELLITE, COME LA MAPPA (30/10/2026; prima OpenStreetMap col rilievo TINITALY in «multiply»): la
         foto schiarita, come viFondo della vista a etichette. Il rilievo a parte non serve piu': la foto ce l'ha.
         ⚠️ A OGNI ZOOM dal 31/10/2026 (suo: «zoomando scompare il satellite», poi «sistema anche le 71 pagine meteo»):
         fino ad allora oltre lo zoom 13,5 tornava la cartina coi nomi delle strade, come faceva viFondo */
      var sat = L.tileLayer(C.sat, { maxNativeZoom: 17, maxZoom: 15, attribution: 'Foto: Esri, Vantor, Earthstar Geographics' });
      var fondo = function () { $('pz-mappa').classList.add('sat'); if (!mappa.hasLayer(sat)) sat.addTo(mappa); };
      // le lineette in un pannello SOTTO le etichette: ogni marcatore ha il suo livello, e una lineetta lunga passava
      // sopra la pillola di un altro paese (24/10/2026, Garfagnana al telefono)
      mappa.createPane('linee'); mappa.getPane('linee').style.zIndex = 590;
      // il margine e' mezza etichetta per lato: le etichette stanno CENTRATE sul paese, e un paese sul bordo ne avrebbe meta' fuori (e sparirebbe)
      mappa.fitBounds(L.latLngBounds(PAESI.map(function (c) { return [c.lat, c.lon]; })), { padding: innerWidth <= 600 ? [58, 26] : [80, 34], maxZoom: 12 });
      // ⚠️ NON SI RIMPICCIOLISCE FINO AL MONDO (2/11/2026, scheda 109, check notturno): senza minimo la cartina arrivava
      // allo zoom 0, il planisfero. Si scende al massimo di 4 livelli sotto l'inquadratura, e mai sotto il 6 (l'Italia).
      mappa.setMinZoom(Math.max(6, Math.floor(mappa.getZoom()) - 4));
      fondo();
      mappa.on('zoomend', function () { fondo(); sistemaEtichette(); });
      // ⚠️ NIENTE PALLINI DEI PLUVIOMETRI su questa mappa (24/10/2026, suo «sì toglili»): la mappa dice solo «che tempo
      // farà nei paesi», e i puntini verdi della pioggia misurata confondevano. I pluviometri stanno nel blocco della
      // pioggia caduta (nomi cliccabili) e nella pagina piogge della zona.
    }
    if (strato) mappa.removeLayer(strato);
    strato = L.layerGroup().addTo(mappa);
    PAESI.forEach(function (c, n) {
      var g = c.giorni.filter(function (x) { return x.g === SEL; })[0]; if (!g) return;
      // icona del cielo e temperature SEMPRE (suo, 24/10), i millimetri solo se piove; sotto il nome.
      // ⚠️ DAL 25/10 LA GOCCIA E' LA %, NON I MILLIMETRI (sua scelta, come weather.com): «💧40%» dal 10% in su (sotto
      // e' rumore, e ogni pezzo in piu' allarga la pillola e nasconde un paese), poi «0,8 mm» col suo nome
      var r1 = '<span class="r1"><span class="ic">' + icona(g.s) + '</span><span class="mn">' + g.mn + '°</span> <span class="mx">' + g.mx + '°</span>'
        + (g.pc != null && g.pc >= 10 ? '<span class="pp' + tonoPc(g.pc) + '" title="probabilità di pioggia">💧' + g.pc + '%</span>' : '')
        + (g.mm >= 0.1 ? '<span class="gc' + (g.mm >= 1 ? ' bagnato' : '') + '" title="' + mm(g.mm) + ' mm di pioggia">' + mm(g.mm) + ' mm</span>' : '') + '</span>';
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="pz-pt"><span class="pz-et' + (c.n === SCELTO ? ' scelto' : '') + '" data-n="' + n + '">' + r1 + '<span class="nm">' + esc(c.n) + '</span></span></div>', iconSize: [0, 0] }), zIndexOffset: 1000 - n })
        .addTo(strato).on('click', function () { apri(posto(c), 'mappa'); });
    });
    sistemaEtichette();
  }
  /* DIRADARE, NON SPOSTARE (24/10/2026 sera, vedi lo stile .pz-et). Le etichette si passano in ordine di importanza
     (l'ordine dell'elenco dei paesi della zona: prima i comuni dei pluviometri e i piu' grandi); ognuna resta centrata
     sul suo paese se non tocca quelle gia' tenute e sta dentro la mappa, se no si nasconde. Ingrandendo ricompaiono:
     si rifa' a ogni zoom. Sotto la mappa si dice quanti paesi sono nascosti. */
  function sistemaEtichette() {
    var bordo = $('pz-mappa').getBoundingClientRect(), messi = [], nascosti = 0;
    var E = [].slice.call(document.querySelectorAll('#pz-mappa .pz-et'));
    E.forEach(function (l) { l.classList.remove('via'); });
    // il paese in blu per primo: e' quello della scheda aperta, non si nasconde
    E.sort(function (a, b) { return b.classList.contains('scelto') - a.classList.contains('scelto') || a.getAttribute('data-n') - b.getAttribute('data-n'); }).forEach(function (l) {
      var r = l.getBoundingClientRect();
      var fuori = r.left < bordo.left + 2 || r.right > bordo.right - 2 || r.top < bordo.top + 2 || r.bottom > bordo.bottom - 18;
      var tocca = messi.some(function (m) { return !(r.right + 3 < m.left || r.left - 3 > m.right || r.bottom + 3 < m.top || r.top - 3 > m.bottom); });
      if (fuori || tocca) { l.classList.add('via'); nascosti++; } else messi.push(r);
    });
    var nota = $('mappa-nota');
    if (nota) nota.innerHTML = 'Tocca un paese per vederlo ora per ora. 💧 è la probabilità di pioggia, scritta dal 10% in su.' + (nascosti ? ' <span class="pz-zoom">Ingrandisci la mappa (+) per vedere '
      + (nascosti === 1 ? "l'altro paese" : 'gli altri ' + nascosti + ' paesi') + '.</span>' : '');
  }

  /* ── LA BARRA CHE SCORRE sopra la scheda ora per ora (30/10/2026, suo: «sì, la barra», poi «C, sopra la scheda»):
     quella della vista Italia della mappa (#vi-nastro e naGira di index.html), col blocco rosso «METEO <ZONA>» e il
     giorno scelto nei 7 giorni (cambia toccando un giorno o una barra del grafico). Nelle ZONE i paesi vanno dal
     piu' basso al piu' alto coi metri: si legge la valle che sale e la temperatura che scende. Nelle pagine PAESE prima il
     paese, poi quelli intorno dal piu' vicino, coi km (come la vista a etichette della mappa). Scorre a 45 px/s, si
     trascina col dito o col mouse e lasciandola prosegue con lo slancio; un tocco senza trascinare (meno di 6 px) apre la
     scheda ora per ora. Ferma col mouse sopra, fuori dallo schermo (batteria) e con «riduci movimento» del telefono.
     Il contenuto e' ripetuto quanto serve a riempire la fascia e scorre di una copia: il giro si chiude senza salti. ── */
  var NA = { pos: 0, w: 0, t0: 0, v: 0, presa: null, sopra: false, giro: 0, vista: true, largo: 0 };
  var FERMO = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function km(a, b) { var r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371; }
  function naGira(t) {
    var na = $('nastro'), tr = na && na.querySelector('.t');
    if (!tr || na.hidden || !NA.vista) { NA.giro = 0; NA.t0 = 0; return; }
    var dt = NA.t0 ? Math.min(64, t - NA.t0) : 16; NA.t0 = t;
    if (!NA.presa) {
      if (Math.abs(NA.v) > 0.05) { NA.pos += NA.v * dt; NA.v *= Math.pow(0.94, dt / 16); }   // lo slancio, in px al millisecondo
      else { NA.v = 0; if (!NA.sopra && !FERMO) NA.pos -= 0.045 * dt; } }
    if (NA.w > 0) { NA.pos %= NA.w; if (NA.pos > 0) NA.pos -= NA.w; }
    tr.style.transform = 'translate3d(' + NA.pos.toFixed(1) + 'px,0,0)';
    // con «riduci movimento» il giro si ferma appena la barra e' ferma; riparte toccandola
    if (FERMO && !NA.presa && !NA.v) { NA.giro = 0; NA.t0 = 0; return; }
    NA.giro = requestAnimationFrame(naGira);
  }
  function naParti() { if (!NA.giro && NA.vista) { NA.t0 = 0; NA.giro = requestAnimationFrame(naGira); } }
  // un nome che non ci sta (al telefono piu' di due righe, al computer piu' di meta' barra: «Colline Metallifere
  // grossetane») lascia nel blocco rosso solo METEO e il giorno: il nome e' gia' nel titolo della pagina
  function taglia() {
    var na = $('nastro'), lab = na && na.querySelector('.lab'); if (!lab) return;
    lab.classList.remove('corto');
    var alto = lab.querySelector('b').offsetHeight + lab.querySelector('span').offsetHeight;
    if (alto > lab.clientHeight || lab.offsetWidth > na.clientWidth * 0.45) lab.classList.add('corto');
  }
  function disegnaNastro() {
    var na = $('nastro'); if (!na || !J) return;
    var lista = PAESI.map(function (c, i) { return { c: c, i: i, g: c.giorni.filter(function (x) { return x.g === SEL; })[0] }; }).filter(function (x) { return x.g; });
    if (!lista.length) { na.hidden = true; return; }
    if (C.solo) { lista.forEach(function (x) { x.k = x.i ? km(PAESI[0], x.c) : -1; }); lista.sort(function (a, b) { return a.k - b.k; }); }
    else lista.sort(function (a, b) { return (QUOTE[a.c.n] != null ? QUOTE[a.c.n] : 1e4) - (QUOTE[b.c.n] != null ? QUOTE[b.c.n] : 1e4); });
    var quando = SEL === OGGI ? 'OGGI' : SEL === DOMANI ? 'DOMANI' : nome(SEL).toUpperCase();
    var vv = lista.map(function (x) {
      var q = QUOTE[x.c.n], sotto = C.solo ? (x.k >= 0 ? Math.max(1, Math.round(x.k)) + ' km' : '') : (q != null ? q.toLocaleString('it-IT') + ' m' : '');
      return '<button class="v" data-n="' + esc(x.c.n) + '"><b>' + esc(x.c.n) + '</b>' + (sotto ? '<small>' + sotto + '</small>' : '')
        + '<span class="ic">' + icona(x.g.s) + '</span><span class="mn">' + x.g.mn + '°</span><span class="mx">' + x.g.mx + '°</span></button>';
    }).join('');
    na.hidden = false;
    na.innerHTML = '<div class="lab"><b>METEO<em> ' + esc(C.nastro.toUpperCase()) + '</em></b><span>' + esc(quando) + '</span></div><div class="t">' + vv + '</div>';
    taglia();
    // il primo paese parte DOPO il blocco rosso, non sotto: la stessa distanza resta in ogni copia, e il giro e' di una copia
    var tr = na.querySelector('.t'), P = na.querySelector('.lab').offsetWidth, una, copie = 2;
    tr.style.paddingLeft = P + 'px';
    una = tr.scrollWidth - P;
    while (una > 0 && P + una * copie < na.clientWidth + una && copie < 12) copie++;
    tr.innerHTML = new Array(copie + 1).join(vv);
    NA.w = una; NA.pos = 0; NA.v = 0; NA.largo = innerWidth; naParti();
  }
  (function () {
    var na = $('nastro'); if (!na) return;
    function apriDa(b) { var c = b && PAESI.filter(function (x) { return x.n === b.getAttribute('data-n'); })[0]; if (c) apri(posto(c), 'nastro'); }
    na.addEventListener('pointerdown', function (ev) { if (ev.button > 0) return; NA.v = 0; NA.presa = { x: ev.clientX, pos: NA.pos, mosso: false, ux: ev.clientX, ut: ev.timeStamp }; naParti(); });
    na.addEventListener('pointermove', function (ev) { var p = NA.presa; if (!p) return;
      if (!p.mosso && Math.abs(ev.clientX - p.x) > 6) { p.mosso = true; try { na.setPointerCapture(ev.pointerId); } catch (e) {} }
      if (!p.mosso) return;
      NA.pos = p.pos + (ev.clientX - p.x);
      var dt = ev.timeStamp - p.ut; if (dt > 0) { NA.v = (ev.clientX - p.ux) / dt; p.ux = ev.clientX; p.ut = ev.timeStamp; } });
    na.addEventListener('pointerup', function (ev) { var p = NA.presa; NA.presa = null; if (!p) return;
      if (!p.mosso) { NA.v = 0; var b = document.elementFromPoint(ev.clientX, ev.clientY); apriDa(b && b.closest ? b.closest('#nastro .v') : null); return; }
      if (ev.timeStamp - p.ut > 90) NA.v = 0;   // fermata prima di lasciarla: niente slancio
      NA.v = Math.max(-3, Math.min(3, NA.v)); naParti(); });
    // col dito in su o in giu' il browser scorre la pagina e la presa si annulla: niente scheda aperta per sbaglio
    na.addEventListener('pointercancel', function () { NA.presa = null; });
    // ferma solo col MOUSE sopra: col dito «enter» arriva senza «leave» e resterebbe ferma
    na.addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') NA.sopra = true; });
    na.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') NA.sopra = false; });
    // da tastiera (Tab e Invio) il clic arriva senza puntatore (detail 0); quelli del puntatore li ha gia' visti pointerup
    na.addEventListener('click', function (e) { if (e.detail === 0) apriDa(e.target.closest('.v')); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { NA.vista = e[e.length - 1].isIntersecting; if (NA.vista) naParti(); }).observe(na);
    // si rifa' solo se cambia la LARGHEZZA: al telefono la barra degli indirizzi che sparisce scorrendo e' un resize
    var rt = 0; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (innerWidth !== NA.largo) { taglia(); disegnaNastro(); } }, 200); });
    taglia();   // gia' sul blocco scritto nell'HTML, prima che arrivino le previsioni
  })();

  /* ── la tabella paese per paese ── */
  function disegnaTab() {
    if (!J) return;
    var date = G.map(function (x) { return x.g; });
    var righe = PAESI.slice().sort(function (a, b) { return (QUOTE[a.n] || 0) - (QUOTE[b.n] || 0); });
    var conPc = G.some(function (x) { return x.pc != null; });
    $('tab').innerHTML = '<thead><tr><th>Paese</th>' + date.map(function (g) { return '<th class="' + (g === SEL ? 'col-sel' : '') + '">' + nome(g) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + righe.map(function (c) {
        var per = {}; c.giorni.forEach(function (g) { per[g.g] = g; });
        return '<tr data-n="' + esc(c.n) + '"><td>' + esc(c.n) + '<span class="q">~ ' + (QUOTE[c.n] != null ? QUOTE[c.n].toLocaleString('it-IT') : '–') + ' m</span></td>'
          + date.map(function (g) { var x = per[g], k = g === SEL ? ' class="col-sel"' : ''; if (!x) return '<td' + k + '>–</td>';
              return '<td' + k + '><span class="ic">' + icona(x.s) + '</span><br><span class="mn">' + x.mn + '°</span>/<span class="mx">' + x.mx + '°</span><span class="mm">' + (x.mm >= 0.1 ? mm(x.mm) + ' mm' : '') + '</span>'
                + (conPc ? '<span class="pc' + tonoPc(x.pc) + '">' + pcTesto(x.pc) + '</span>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  /* ── la scheda del posto: 7 giorni e ore ── */
  var SCHEDA = null, AVVIO = false, SCELTO = null;   // SCELTO: il paese della scheda, in blu sulla mappa
  function posto(c) { return { n: c.n, lat: c.lat, lon: c.lon, quota: QUOTE[c.n], reg: c.r || REG }; }
  function FASCIA(h) { return h < 6 ? 'notte' : h < 12 ? 'mattina' : h < 18 ? 'pomeriggio' : 'sera'; }
  /* ── le ore a righe, come 3B (29/10/2026, vedi .tv nello stile) ── */
  var DIR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  function dir(vd) { return vd == null ? '' : DIR[Math.round((((vd % 360) + 360) % 360) / 22.5) % 16]; }
  // MET da' da dove VIENE il vento: la freccia punta dove va (↓ = vento da nord)
  function freccia(vd) { return vd == null ? '' : '<i class="fr" style="transform:rotate(' + Math.round(vd) + 'deg)">↓</i>'; }
  var PAROLE = [[/thunder/, 'Temporale'], [/heavyrainshowers/, 'Rovesci forti'], [/lightrainshowers/, 'Rovesci deboli'], [/rainshowers/, 'Rovesci'],
                [/heavyrain/, 'Pioggia forte'], [/lightrain/, 'Pioggia debole'], [/rain|drizzle/, 'Pioggia'], [/sleet/, 'Pioggia e neve'],
                [/heavysnow/, 'Neve forte'], [/lightsnow/, 'Neve debole'], [/snow/, 'Neve'], [/fog/, 'Nebbia'], [/clearsky/, 'Sereno'],
                [/fair/, 'Poco nuvoloso'], [/partlycloudy/, 'Nubi sparse'], [/cloudy/, 'Nuvoloso']];
  function parola(s) { for (var i = 0; i < PAROLE.length; i++) if (PAROLE[i][0].test(s || '')) return PAROLE[i][1]; return ''; }
  // OGGI = il resto della giornata, come 3B, ma ALMENO 8 RIGHE: la sera si continua con le prime ore di domani (alle 22
  // fino alle 6). Le 24 ore da adesso, come ilMeteo, «allungano troppo» (suo, 29/10/2026); col solo resto di oggi alle 23
  // restava una riga. Gli altri giorni: le loro ore, o le fasce di 6 ore dove MET da' solo quelle (dal terzo giorno)
  function oreDi(j, g, ora) {
    var tutte = j.ore || [];
    if (g !== OGGI) return tutte.filter(function (o) { return o.g === g; });
    var out = [];
    for (var i = 0; i < tutte.length; i++) {
      var o = tutte[i];
      if (o.g < OGGI || (o.g === OGGI && o.h < ora && !o.h6)) continue;
      if (o.g !== OGGI && (out.length >= 8 || o.h6)) break;
      out.push(o);
    }
    return out;
  }
  function righeOre(ore, conPc) {
    var prima = ore[0] && ore[0].g;
    return ore.map(function (o) {
      // mm solo se piove, la % sempre (come «assente» di 3B): quasi sempre una riga sola
      var pc = conPc && o.pc != null ? '<span class="pc' + tonoPc(o.pc) + '">' + pcTesto(o.pc) + '</span>' : '';
      return (o.g !== prima ? (prima = o.g, '<tr class="sep"><td colspan="5">' + maiusc(nome(o.g, true)) + '</td></tr>') : '')
        + '<tr' + (o.h6 ? ' class="f6"' : '') + '><td class="h">' + (o.h6 ? '<b>' + FASCIA(o.h) + '</b>' + o.h + '-' + ((o.h + 6) % 24) : String(o.h).padStart(2, '0')) + '</td>'
        + '<td><span class="ic">' + icona(o.s) + '</span><span class="pa">' + parola(o.s) + '</span></td><td class="t">' + Math.round(o.t) + '°</td>'
        + '<td' + (o.mm >= 0.1 ? ' class="piove"><b class="mmv">' + mm(o.mm) + ' mm</b>' + pc : '>' + (pc || '<span class="z">–</span>')) + '</td>'
        + '<td class="ve">' + freccia(o.vd) + (o.v != null ? Math.round(o.v * 3.6) + ' km/h' : '') + ' <small>' + dir(o.vd) + '</small></td></tr>';
    }).join('');
  }
  function porte(x) {
    var pl = '&pl=' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4) + '&pn=' + encodeURIComponent(x.n);
    // via le temperature (28/10/2026, suo: «sono quelle di ieri e loro stanno vedendo le attuali»), al loro posto la
    // pioggia a 30 giorni accanto a quella a 7, cosi' restano sei, tre per riga
    return [['☀️', 'Vai alla mappa', '/previsioni/?r=' + x.reg + pl, 'previsioni'], ['💧', 'Pioggia caduta<small>ultimi 7 giorni</small>', '/?r=' + x.reg + '&g=7' + pl, 'pioggia-7'], ['💧', 'Pioggia caduta<small>ultimi 30 giorni</small>', '/?r=' + x.reg + '&g=30' + pl, 'pioggia-30'],
            ['📡', 'Radar piogge', '/?r=' + x.reg + '&radar=ora' + pl, 'radar'], ['🌲', 'Mappa boschi', '/?r=' + x.reg + '&boschi=1' + pl, 'boschi'], ['🛰️', 'Boschi + satellite', '/?r=' + x.reg + '&boschi=1&sat=1' + pl, 'satellite']]
      .map(function (p) { return '<a href="' + SITO + p[2] + '" onclick="try{gtag(\'event\',\'apri_mappa\',{da:\'meteo-' + C.slug + '-scheda-' + p[3] + '\'})}catch(e){}"><span>' + p[0] + '</span>' + p[1] + '</a>'; }).join('');
  }
  function disegnaScheda(g) {
    var s = SCHEDA, j = s.j;
    var giorni = (j.giorni || []).filter(function (x) { return x.g >= OGGI; }).slice(0, 7);
    if (!giorni.some(function (x) { return x.g === g; })) g = giorni[0] && giorni[0].g;
    var ora = +new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }) % 24;
    var ore = oreDi(j, g, ora);
    var q = s.x.quota != null ? s.x.quota : (j.q != null ? Math.round(j.q) : null);
    var conPc = ore.some(function (o) { return o.pc != null; });
    $('scheda').innerHTML = '<div class="testa"><div><h3>' + esc(s.x.n) + '</h3><div class="sub">' + (q != null ? '~ ' + q + ' m · ' : '') + 'previsioni ora per ora' + (conPc ? ' · 💧 probabilità di pioggia' : '') + (AVVIO ? ' · tocca un altro paese o cercalo per cambiarlo' : '') + '</div></div><button class="chiudi" aria-label="Chiudi">×</button></div>'
      + '<div class="giorni">' + giorni.map(function (x) { return '<button data-g="' + x.g + '" class="' + (x.g === g ? 'sel' : '') + '"><b>' + nome(x.g) + '</b>' + icona(x.s) + ' ' + x.mn + '°/' + x.mx + '°<br>' + (x.mm >= 0.1 ? mm(x.mm) + ' mm' : '–') + (x.pc != null ? '<span class="pc' + tonoPc(x.pc) + '">' + pcTesto(x.pc) + '</span>' : '') + '</button>'; }).join('') + '</div>'
      // la % ora per ora (25/10/2026): la % del giorno da sola non basta per programmare un'uscita («ti da 100% per la
      // pioggia della sera ma devi programmare di giorno», suo). Nelle fasce di 6 ore e' la piu' alta (maxProb)
      + (ore.length ? (g !== OGGI && ore.some(function (o) { return o.h6; }) ? '<p class="tv-nota">Da qui in poi il modello dà le previsioni a fasce di 6 ore.</p>' : '')
          + '<table class="tv"><tbody>' + righeOre(ore, conPc) + '</tbody></table>'
        : '<p class="nota">Ore non disponibili per questo giorno.</p>')
      + '<div class="pz-porte">' + porte(s.x) + '</div>';
  }
  // da === 'avvio': la scheda che si apre DA SOLA sul paese principale (24/10/2026, suo: «se non clicchi un paese il
  // report orario non si vede»): niente scorrimento della pagina e niente evento GA, non e' un gesto di chi legge
  function apri(x, da) {
    var sc = $('scheda'); sc.classList.add('on'); AVVIO = da === 'avvio';
    // il paese della scheda in blu, come la mappa (un posto cercato fuori dalla mappa non ne accende nessuno)
    SCELTO = x.n; [].forEach.call(document.querySelectorAll('#pz-mappa .pz-et'), function (l) { l.classList.toggle('scelto', (PAESI[+l.getAttribute('data-n')] || {}).n === x.n); });
    if (window.L && $('pz-mappa')) sistemaEtichette();
    sc.innerHTML = '<p class="nota">Sto leggendo le previsioni di ' + esc(x.n) + '…</p>';
    // si porta in vista la barra che scorre, che e' la testata della scheda (se le previsioni non sono arrivate e' nascosta)
    var su = $('nastro') && !$('nastro').hidden ? $('nastro') : sc;
    if (!AVVIO) { su.scrollIntoView({ behavior: 'smooth', block: 'start' }); ga('scheda-' + da); }
    fetch(API + '?lat=' + (+x.lat).toFixed(3) + '&lon=' + (+x.lon).toFixed(3) + (x.quota != null ? '&q=' + x.quota : ''))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { SCHEDA = { x: x, j: j }; disegnaScheda(OGGI); })   // sempre su OGGI, con le ore (suo, 24/10)
      .catch(function () { sc.innerHTML = '<div class="testa"><p class="nota">Previsioni di ' + esc(x.n) + ' non disponibili ora, riprova fra poco.</p><button class="chiudi" aria-label="Chiudi">×</button></div>'; });
  }
  $('scheda').addEventListener('click', function (e) {
    if (e.target.closest('.chiudi')) { $('scheda').classList.remove('on'); return; }
    var b = e.target.closest('.giorni button'); if (b && SCHEDA) disegnaScheda(b.getAttribute('data-g'));
  });

  /* ── la casella: elenco dei comuni del sito + frazioni dal geocoder ── */
  var ELENCO = null, ARRIVO = null;
  function carica() {
    if (ELENCO) return Promise.resolve(ELENCO);
    if (!ARRIVO) ARRIVO = fetch('/data/elenco-paesi.txt').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
      ELENCO = t.split('\n').map(function (r) { var p = r.split('|'); return p.length < 6 ? null : { n: p[0], lat: +p[1], lon: +p[2], sg: p[3], reg: p[4], pop: +p[5] || 0, qn: norm(p[0]) }; }).filter(Boolean);
      return ELENCO;
    }).catch(function (e) { ARRIVO = null; throw e; });
    return ARRIVO;
  }
  function frazioni(t) {
    return fetch('/api/cerca?name=' + encodeURIComponent(t) + '&count=8&language=it&countryCode=IT').then(function (r) { return r.json(); })   // GeoNames dal sito, non piu' Open-Meteo (25/10/2026)
      .then(function (j) { return (j.results || []).map(function (x) { return { n: x.name, lat: x.latitude, lon: x.longitude, quota: x.elevation != null ? Math.round(x.elevation) : null, reg: REG, fraz: 'frazione · ' + (x.admin2 || x.admin1 || '').replace(/^Provincia (di )?/, ''), qn: norm(x.name) }; }); });
  }
  var righe = [], sel = -1, giro = 0;
  function mostra(t) {
    var qq = norm(t), drop = $('drop'); sel = -1; if (qq.length < 2) { drop.classList.remove('on'); return; }
    righe = (ELENCO || []).filter(function (x) { var i = x.qn.indexOf(qq); return i === 0 || (i > 0 && x.qn.charAt(i - 1) === ' '); })
      .sort(function (a, b) { return (b.reg === REG) - (a.reg === REG) || b.pop - a.pop; }).slice(0, 6);
    var mio = ++giro;
    function disegna() { drop.innerHTML = righe.length ? righe.map(function (x, i) { return '<div class="r" data-i="' + i + '"><span>' + esc(x.n) + '</span><small>' + esc(x.fraz || (x.sg + ' · ' + x.reg)) + '</small></div>'; }).join('') : '<div class="t">Cerco anche fra le frazioni…</div>'; drop.classList.add('on'); }
    disegna();
    if (righe.length < 6 && qq.length >= 3) setTimeout(function () {
      if (mio !== giro) return;
      frazioni(t.trim()).then(function (f) { if (mio !== giro) return; var visti = {}; righe.forEach(function (x) { visti[x.qn] = 1; });
        righe = righe.concat(f.filter(function (x) { return !visti[x.qn]; })).slice(0, 7); if (righe.length) disegna(); else drop.innerHTML = '<div class="t">Nessun posto con questo nome</div>'; })
        .catch(function () { if (mio === giro && !righe.length) drop.innerHTML = '<div class="t">Le frazioni non rispondono: prova con il nome del comune</div>'; });
    }, 350);
  }
  function scegli(x) { $('cerca').value = x.n; $('drop').classList.remove('on'); apri(x, 'cerca'); }
  $('cerca').addEventListener('focus', function () { carica().catch(function () {}); });
  $('cerca').addEventListener('input', function () { var v = this.value; carica().catch(function () {}).then(function () { mostra(v); }); });
  $('cerca').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (righe.length) scegli(righe[sel >= 0 ? sel : 0]); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var rs = $('drop').querySelectorAll('.r'); if (!rs.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rs.length) % rs.length; for (var i = 0; i < rs.length; i++) rs[i].classList.toggle('sel', i === sel); }
  });
  $('drop').addEventListener('click', function (e) { var r = e.target.closest('.r'); if (r) scegli(righe[+r.getAttribute('data-i')]); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.pz-cerca')) $('drop').classList.remove('on'); });

  /* ── il grafico, la pioggia caduta, il punto ── */
  var BARRE = [];
  function disegnaGraf() {
    var serie = RIPJ && RIPJ.serie ? RIPJ.serie.slice(0, 30).reverse() : [];
    var ultimo = RIPJ ? (RIPJ.ultimoGiorno || (RIPJ.periodi && RIPJ.periodi['1'] ? RIPJ.periodi['1'].ultimo : IERI)) : IERI;
    BARRE = serie.map(function (v, i) { return { g: piu(ultimo, i - serie.length + 1), mm: v, prev: false }; })
      .concat(G.map(function (x) { return { g: x.g, mm: x.mm, prev: true, mx: x.mmMax, dove: x.dove, pc: x.pc }; }));
    var mx = Math.max(5, Math.max.apply(null, BARRE.map(function (b) { return b.mm || 0; })));
    /* MISURATA E PREVISTA, CON LE DATE (28/10/2026, suo: «il grafico deve avere le date e dire dove finisce ieri e inizia
       adesso», e poi: «ieri e oggi così è brutto, fai una cosa che sembri più di design»). I giorni previsti stanno su un
       FONDO azzurro chiaro con un filo a sinistra, e sopra le due parti c'e' il loro nome in maiuscoletto (MISURATA,
       PREVISTA); sotto l'asse una data ogni 7 giorni da ieri all'indietro, la pillola «oggi» sulla prima barra prevista e
       l'ultimo giorno previsto. Le posizioni sono in % della larghezza: le barre sono tutte larghe uguali. */
    var n = BARRE.length, k = 0;
    while (k < n && !BARRE[k].prev) k++;
    function dove(i) { return ((i + 0.5) / n * 100).toFixed(2) + '%'; }
    function breve(g) { return d(g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); }
    var diviso = k > 0 && k < n, pk = (k / n * 100).toFixed(2) + '%';
    $('graf').innerHTML = (diviso ? '<div class="pz-fut" style="left:' + pk + '"></div><span class="pz-gt">Misurata</span><span class="pz-gt pre" style="left:' + pk + '">Prevista</span>' : '')
      + BARRE.map(function (b, i) { return '<div class="b' + (b.prev ? ' prev' : '') + '" data-i="' + i + '" style="height:' + ((b.mm || 0) / mx * 100) + '%"></div>'; }).join('');
    var tacche = [];
    for (var i = k - 8; i >= 0; i -= 7) tacche.push(i);   // la pillola «oggi» sta sulla barra dopo ieri: si parte da una settimana prima
    if (diviso && k < n - 2) tacche.push(n - 1);
    if ($('graf-date')) $('graf-date').innerHTML = tacche.map(function (i) {
      var p = (i + 0.5) / n, sp = p > 0.88 ? ' class="d"' : p < 0.1 ? ' class="s"' : '';
      return '<span' + sp + ' style="left:' + dove(i) + '">' + breve(BARRE[i].g) + '</span>';
    }).join('') + (diviso && BARRE[k].g === OGGI ? '<span class="oggi" style="left:' + dove(k) + '">oggi</span>' : '');
    if (BARRE.length) $('leg-date').textContent = 'dal ' + d(BARRE[0].g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' a ' + nome(BARRE[BARRE.length - 1].g, true);
  }
  $('graf').addEventListener('click', function (e) {
    var el = e.target.closest('.b'); if (!el) return;
    var b = BARRE[+el.getAttribute('data-i')], tutte = $('graf').querySelectorAll('.b');
    for (var i = 0; i < tutte.length; i++) tutte[i].classList.toggle('sel', tutte[i] === el);
    var giorno = d(b.g).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('graf-info').innerHTML = b.prev ? '<b>' + giorno + '</b>: previsti ' + (C.solo ? '' : 'in media ') + '<b>' + mm(b.mm) + ' mm</b>' + (!C.solo && b.mx >= 0.1 ? ', fino a ' + mm(b.mx) + ' a ' + esc(b.dove) : '')
        + (b.pc != null ? '; probabilità di pioggia ' + finoAl(b.pc) : '')
      : '<b>' + giorno + '</b>: ' + (C.solo ? (b.mm == null ? 'nessun dato dal pluviometro' : 'misurati <b>' + mm(b.mm) + ' mm</b> ' + C.alPluv)
        : b.mm == null ? 'nessun dato dai pluviometri' : 'misurati in media <b>' + mm(b.mm) + ' mm</b> dai pluviometri ' + C.diValle);
    if (b.prev) sceglie(b.g);
  });
  function disegnaCaduta() {
    var link = {}; PLUV.forEach(function (p) { link[p.n] = p.url; });
    [['1', 'r1'], ['7', 'r7']].forEach(function (p) {
      var x = RIPJ && RIPJ.periodi ? RIPJ.periodi[p[0]] : null;
      if (!x) { $(p[1]).textContent = '–'; return; }
      $(p[1]).innerHTML = mm(x.media) + (C.solo ? ' <small>mm</small>' : ' <small>mm di media</small>');
      $(p[1] + 't').innerHTML = (x.top || []).slice(0, 3).map(function (t) { return '<div class="nota" style="margin:2px 0">' + (link[t.n] ? '<a href="' + link[t.n] + '">' + esc(t.n) + '</a>' : esc(t.n)) + ': <b>' + mm(t.mm) + ' mm</b></div>'; }).join('');
    });
    if (RIPJ && RIPJ.periodi && RIPJ.periodi['1'] && RIPJ.periodi['1'].ultimo !== IERI) $('r1h').textContent = maiusc(nome(RIPJ.periodi['1'].ultimo, true));
  }
  function punto(tot) {
    var p = [];
    var i = RIPJ && RIPJ.periodi ? RIPJ.periodi['1'] : null, s = RIPJ && RIPJ.periodi ? RIPJ.periodi['7'] : null;
    if (i && s) {
      // pluviometro fuori dal paese (C.primo: Monticiano, Urbe, Caronia, 2/11/2026, scheda 113): la pioggia caduta si dice
      // dove e' stata misurata, «Ieri al pluviometro di Pomiere, nel bosco di Caronia,» e non «Ieri a Caronia» (15 km, 1.482 m)
      var doveMis = C.primo ? C.alPluv + (C.alPluv.indexOf(',') >= 0 ? ',' : '') : C.dove;
      p.push((i.ultimo === IERI ? 'Ieri' : maiusc(nome(i.ultimo, true))) + ' ' + doveMis + ' ' + (i.media < 0.1 ? '<b>non è piovuto</b>'
        : 'sono caduti ' + (C.solo ? '' : 'in media ') + '<b>' + mm(i.media) + ' mm</b>' + (i.top && i.top[0] ? ' (' + esc(i.top[0].n) + ' ' + mm(i.top[0].mm) + ')' : '')) + '; negli ultimi 7 giorni <b>' + mm(s.media) + ' mm</b>.');
    }
    var picco = G.slice().sort(function (a, b) { return b.mmMax - a.mmMax; })[0];
    p.push(tot < 0.5 ? 'Nei prossimi 7 giorni <b>non è prevista pioggia</b>.' : 'Nei prossimi 7 giorni sono previsti ' + (C.solo ? '' : 'in media ') + '<b>' + mm(tot) + ' mm</b>, soprattutto ' + nome(picco.g, true) + '.');
    // la % piu' alta della settimana, e dove (25/10/2026)
    var rischio = G.filter(function (x) { return x.pc != null; }).sort(function (a, b) { return b.pc - a.pc; })[0];
    // con C.solo il posto e' sempre lo stesso, gia' detto in apertura: «-4° sul Mottarone» e non «a Mottarone» ogni volta
    function aDove(n) { return C.solo ? '' : ' a ' + esc(n); }
    if (rischio) p.push(rischio.pc < 30 ? 'La probabilità di pioggia resta <b>sotto il 30%</b> per tutta la settimana.'
      : 'La probabilità di pioggia più alta è ' + nome(rischio.g, true) + ', <b>' + rischio.pc + '%</b>' + aDove(rischio.dpc) + '.');
    var fr = G.slice().sort(function (a, b) { return a.mn - b.mn; })[0], cal = G.slice().sort(function (a, b) { return b.mx - a.mx; })[0];
    p.push('La notte più fredda è ' + nome(fr.g, true) + ', con <b>' + fr.mn + '°</b>' + aDove(fr.dmn) + '; il giorno più caldo ' + nome(cal.g, true) + ', <b>' + cal.mx + '°</b>' + aDove(cal.dmx) + '.');
    $('punto').innerHTML = '<span class="pz-quando">Il punto di stamattina</span> ' + p.join(' ');
  }

  /* ── LE ANTEPRIME DEI TRE BOTTONI (pagine «Meteo <paese>», C.ant, 28/10/2026): radar, previsioni e pluviometri della
     regione, ognuno porta alla sua funzione sulla mappa. Vive e vere: l'ultima immagine del radar (LibreWXR / OPERA,
     come il tasto della mappa), il tempo di oggi nelle citta' della regione (/api/previsioni?capoluoghi=, come le
     pagine regione), la mappa della pioggia di ieri (l'anteprima delle pagine regione, ramo «anteprime»). Si
     caricano quando i bottoni arrivano vicino allo schermo; se una non arriva resta il fondo grigio e il bottone va. */
  // larga = [[sud, ovest], [nord, est]] al posto del confine della regione (il radar)
  // sat: la foto dal satellite come la mappa grande (l'anteprima «Previsioni», 30/10/2026); il radar resta sulla cartina
  function miniMappa(id, larga, sat) {
    var m = L.map(id, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0.25 });
    // la fonte in alto a sinistra: in basso c'e' l'etichetta gialla, che la copriva
    L.control.attribution({ prefix: false, position: 'topleft' }).addTo(m);
    if (sat) { $(id).classList.add('sat'); L.tileLayer(C.sat, { maxNativeZoom: 17, maxZoom: 12, attribution: 'Foto: Esri' }).addTo(m); }
    else L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap' }).addTo(m);
    var b = larga ? L.latLngBounds(larga)
      // sulla foto il confine bianco: il blu scuro sul mare scuro non si vedeva
      : L.geoJSON(C.ant.confine, { interactive: false, style: sat ? { color: '#fff', weight: 1.5, fill: false, opacity: 0.75 } : { color: '#1b3f6e', weight: 2, fill: false, opacity: 0.9 } }).addTo(m).getBounds();
    // l'etichetta gialla sta SOTTO l'anteprima, non sopra (28/10/2026: copriva la Sicilia nel radar e le citta' della
    // costa nelle previsioni); in alto a sinistra c'e' la fonte, a destra l'ora
    m.fitBounds(b, { paddingTopLeft: [10, 26], paddingBottomRight: [10, 10] });
    return m;
  }
  /* ⚠️ IL RADAR SU TUTTA ITALIA E UN PEZZO D'EUROPA, uguale per tutte le pagine (28/10/2026, suo: «il radar non dice
     nulla, perché quasi sempre senza nuvole: facciamolo con tutta l'Italia e anche un pezzo di Nord Europa, almeno
     qualche nuvola si vede»). Sulla sola regione era quasi sempre una cartina vuota. */
  function antRadar() {
    var m = miniMappa('ant-radar', [[37.2, 6.5], [50.2, 18.5]]);
    m.createPane('radar'); m.getPane('radar').style.zIndex = 450;
    fetch('https://api.librewxr.net/public/weather-maps.json').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) {
      var p = (j.radar && j.radar.past) || [], f = p[p.length - 1]; if (!f) return;
      L.tileLayer(j.host + f.path + '/256/{z}/{x}/{y}/2/1_1.png', { pane: 'radar', opacity: 0.95, maxNativeZoom: 6, maxZoom: 12, attribution: 'radar LibreWXR / OPERA (CC BY)' }).addTo(m);
      $('ant-radar-q').textContent = 'radar delle ' + new Date(f.time * 1000).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
    }).catch(function () {});
  }
  function antPrev() {
    var m = miniMappa('ant-prev', null, true);
    fetch(API + '?capoluoghi=' + REG).then(function (r) { return r.json(); }).then(function (j) {
      /* ⚠️ L'ORDINE LO DA' IL GENERATORE (C.ant.ord, 28/10/2026, suo: «i capoluoghi di provincia si devono vedere sempre,
         è più importante Savona di Millesimo»): il capoluogo di regione, quelli di provincia, poi gli altri, ognuno dal
         piu' abitato. Prima si guardava «s», ma e' la SIGLA della provincia: Millesimo e Savona hanno tutte e due SV, e
         nell'ordine dell'API (alfabetico) Millesimo si prendeva il posto e Savona, che la toccava, spariva. I primi
         C.ant.cap dell'elenco sono i capoluoghi: non si tolgono mai (vedi sotto). */
      var ORD = C.ant.ord || [], rk = function (c) { var i = ORD.indexOf(c.n); return i < 0 ? 999 : i; };
      var cc = (j.capoluoghi || []).slice().sort(function (a, b) { return (b.c ? 1 : 0) - (a.c ? 1 : 0) || rk(a) - rk(b); });
      // inquadrate le CITTA', non il confine: in Toscana le isole dell'arcipelago rimpicciolivano tutto
      // ⚠️ senza animazione (28/10/2026): le etichette si misurano subito qui sotto, e durante lo zoom animato erano a
      // meta' strada (al telefono Arezzo spariva senza toccare niente)
      if (cc.length > 1) m.fitBounds(L.latLngBounds(cc.map(function (c) { return [c.lat, c.lon]; })), { paddingTopLeft: [34, 40], paddingBottomRight: [34, 22], animate: false });
      cc.forEach(function (c, n) {
        var g = (c.giorni || []).filter(function (x) { return x.g === OGGI; })[0]; if (!g) return;
        L.marker([c.lat, c.lon], { interactive: false, zIndexOffset: 1000 - n, icon: L.divIcon({ className: '', iconSize: [0, 0],
          html: '<div class="pz-pt"><span class="pz-et" data-n="' + n + '"' + (c.c || rk(c) < (C.ant.cap || 0) ? ' data-cap="1"' : '') + '><span class="r1"><span class="ic">' + icona(g.s) + '</span><span class="mn">' + g.mn + '°</span> <span class="mx">' + g.mx + '°</span></span><span class="nm">' + esc(c.n) + '</span></span></div>' }) }).addTo(m);
      });
      /* ⚠️ TUTTE LE CITTA', NON DUE (28/10/2026, suo: «se metti solo 2 zone fa ridere»). Mai spostare un'etichetta
         (la regola delle pagine meteo), ma prima di toglierla si RIMPICCIOLISCE: col nome, poi senza nome (icona e
         gradi), poi solo icona e massima. Si nasconde solo se non ci sta nemmeno cosi'. L'etichetta gialla e la
         scritta in alto contano come gia' messe. */
      var box = $('ant-prev'), bordo = box.getBoundingClientRect(), messi = [box.parentNode.querySelector('.pz-ant-t').getBoundingClientRect()];
      $('ant-prev-q').textContent = 'oggi'; messi.push($('ant-prev-q').getBoundingClientRect());
      // l'etichetta con questa forma: il suo riquadro se ci sta (dentro e senza toccare quelle gia' messe), se no null
      function ciSta(l, forma, gia) {
        l.className = forma;
        var r = l.getBoundingClientRect();
        var fuori = r.left < bordo.left + 2 || r.right > bordo.right - 2 || r.top < bordo.top + 2 || r.bottom > bordo.bottom - 2;
        var tocca = gia.some(function (q) { return !(r.right + 2 < q.left || r.left - 2 > q.right || r.bottom + 2 < q.top || r.top - 2 > q.bottom); });
        return fuori || tocca ? null : r;
      }
      var tutte = [].slice.call(box.querySelectorAll('.pz-et'));
      var cap = tutte.filter(function (l) { return l.hasAttribute('data-cap'); });
      /* I CAPOLUOGHI PRIMA DI TUTTI E COL NOME (28/10/2026): tutti interi o tutti senza la minima, la forma con cui ne
         stanno di piu' col nome (al telefono Savona intera tocca Genova: senza minima ci stanno tutti e quattro), cosi'
         restano uguali fra loro. Forzarli tutti non va: in Toscana Prato, Pistoia, Lucca e Pisa finivano uno sopra
         l'altro. Chi col nome non ci sta si rimpicciolisce come gli altri, ma prima degli altri paesi. */
      var forma = 'pz-et', quanti = -1;
      ['pz-et', 'pz-et nome'].forEach(function (f) {
        var gia = messi.slice(), n = 0;
        cap.forEach(function (l) { var r = ciSta(l, f, gia); if (r) { gia.push(r); n++; } });
        if (n > quanti) { quanti = n; forma = f; }
      });
      var senza = [];
      cap.forEach(function (l) { var r = ciSta(l, forma, messi); if (r) messi.push(r); else senza.push(l); });
      // poi i capoluoghi rimasti fuori e gli altri paesi: interi (solo se lo sono i capoluoghi), senza nome, solo icona
      // e massima, se no via. Un paese piccolo non e' mai piu' grande di un capoluogo.
      var riservati = [];
      senza.concat(tutte.filter(function (l) { return !l.hasAttribute('data-cap'); })).forEach(function (l) {
        var capo = l.hasAttribute('data-cap'), forme = capo ? [] : [forma];
        if (forma === 'pz-et') forme.push('pz-et corta');
        forme.push('pz-et mini');
        for (var f = 0; f < forme.length; f++) { var r = ciSta(l, forme[f], capo ? messi : messi.concat(riservati)); if (r) { messi.push(r); return; } }
        // il posto di un capoluogo che non ci sta resta vuoto: li' non va un paese piu' piccolo (al telefono Siena non
        // ci stava per un pixel e al suo posto compariva Montepulciano)
        if (capo) { l.className = forma; riservati.push(l.getBoundingClientRect()); }
        l.className = 'pz-et via';
      });
    }).catch(function () {});
  }
  /* la pioggia degli ULTIMI 7 GIORNI (28/10/2026, suo: «le piogge invece metti ultimi 7 gg»): <reg>-7g.webp, che
     genera-anteprime.js scatta per le regioni di queste pagine; finche' non c'e', quella di ieri */
  function antPluvio() {
    var b = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/_anteprime-prova/' : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime/';
    function prova(f) { return fetch(b + REG + '-' + f + '.json').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { j.f = f; return j; }); }
    prova('7g').catch(function () { return prova('ieri'); }).then(function (j) {
      $('ant-pluvio').style.backgroundImage = 'url(' + b + REG + '-' + j.f + '.webp' + (j.generato ? '?v=' + encodeURIComponent(j.generato.slice(0, 13)) : '') + ')';
      var corto = function (g) { return d(g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
      if (j.da && j.a) $('ant-pluvio-q').textContent = j.da === j.a ? (j.a === IERI ? 'ieri' : corto(j.a)) : 'dal ' + corto(j.da) + ' al ' + corto(j.a);
    }).catch(function () {});
  }
  if (C.ant && $('ant') && window.L) {
    var antFatte = false;
    var antVia = function () { if (antFatte) return; antFatte = true; antRadar(); antPrev(); antPluvio(); };
    if ('IntersectionObserver' in window) {
      var antIO = new IntersectionObserver(function (e) { if (e.some(function (x) { return x.isIntersecting; })) { antIO.disconnect(); antVia(); } }, { rootMargin: '400px' });
      antIO.observe($('ant'));
    } else setTimeout(antVia, 2500);
  }

  /* ── i comandi ── */
  $('giorni').addEventListener('click', function (e) { var b = e.target.closest('.pz-g'); if (b) { sceglie(b.getAttribute('data-g')); ga('giorno'); } });
  $('tab').addEventListener('click', function (e) {
    var tr = e.target.closest('tbody tr'); if (!tr || !J) return;
    var c = PAESI.filter(function (x) { return x.n === tr.getAttribute('data-n'); })[0];
    if (c) apri(posto(c), 'tabella');
  });

  function guasto() { if ($('nastro')) $('nastro').hidden = true; $('punto').innerHTML = '<span class="pz-quando">Il punto di stamattina</span> Le previsioni dei paesi non rispondono in questo momento: riprova fra qualche minuto, o <a href="' + SITO + '/previsioni/?r=' + REG + '">guardale sulla mappa</a>.'; }
  /* la pioggia del PLUVIOMETRO del paese (pagine «Meteo <paese>»): il file dei 25 giorni delle pagine paese funghi, serie
     dal piu' vecchio al piu' nuovo, messa nella forma del riepilogo di zona (serie dal piu' nuovo, periodi 1 e 7) */
  function daPluviometro(j) {
    var s = j && j.serie ? j.serie[C.id] : null;
    if (!s || !s.length) return null;
    var n = s.length, sette = 0, conti = 0;
    for (var i = Math.max(0, n - 7); i < n; i++) if (s[i] != null) { sette += s[i]; conti++; }
    return { serie: s.slice().reverse(), ultimoGiorno: j.ultimo, periodi: {
      '1': s[n - 1] == null ? null : { media: s[n - 1], ultimo: j.ultimo, top: [] },
      '7': conti ? { media: sette, ultimo: j.ultimo, top: [] } : null } };
  }
  Promise.all([fetch(API + (C.paese ? '?paese=' + C.paese : '?zona=' + C.slug) + '&pr=1').then(function (r) { return r.json(); }),
               fetch(RIP).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]).then(function (x) {
    J = x[0]; RIPJ = C.giorni ? daPluviometro(x[1]) : x[1];
    PAESI = (J && J.capoluoghi || []).filter(function (c) { return c.giorni && c.giorni.length; });
    if (C.nomi) PAESI.forEach(function (c) { if (C.nomi[c.n]) c.n = C.nomi[c.n]; });
    for (var k = 1; C.primo && k < PAESI.length; k++) if (PAESI[k].n === C.primo) { PAESI.unshift(PAESI.splice(k, 1)[0]); break; }
    G = PAESI.length ? giorniDi() : [];
    disegnaCaduta();
    if (!G.length) { guasto(); return; }
    var tot = totale(); disegnaGraf(); punto(tot); sceglie(G[0].g);
    apri(posto(PAESI[0]), 'avvio');   // le ore si vedono subito, sul primo paese dell'elenco (il principale della zona)
  }).catch(function () { guasto(); disegnaCaduta(); });
}

/* ⚠️ «GUARDA LE NOSTRE MAPPE»: TRE BOTTONI, CON L'ANTEPRIMA, UNO SOTTO L'ALTRO, E TUTTI VERSO LA MAPPA (28/10/2026, nati
   sulle pagine «Meteo <paese>», suo: «i pulsanti devono essere meno, i funghi è inutile, basta radar, previsioni Liguria,
   pluvio Liguria»; e poi: «rimandi a un'altra pagina tipo dove ha piovuto, ma per chi legge è una pagina troppo simile:
   quei 3 pulsanti ti devono mandare sulle rispettive funzioni sulla mappa»). Lo stesso giorno anche nelle zone, al posto
   del bottone del radar e delle «altre pagine» (zona piogge, zona funghi, mappa, previsioni). Le anteprime le disegna il
   browser (clientePagina, C.ant) quando arrivano sullo schermo. L'etichetta gialla all'85% come i riquadri delle pagine
   funghi, SOTTO la cartina viva (sopra copriva la Sicilia e le citta' della costa), che non si tocca (il clic va al link). */
const CSS_ANT = `
.pz-ant{display:grid;grid-template-columns:1fr;gap:14px;margin:12px 0 22px}
.pz-ant-c{position:relative;display:block;border-radius:14px;overflow:hidden;border:1px solid #c9d5e1;background:#fff;text-decoration:none;box-shadow:0 2px 10px rgba(15,61,110,.10)}
.pz-ant-v{position:relative;height:250px;pointer-events:none;background:#e8eef4 center/cover no-repeat}
.pz-ant-v.leaflet-container{background:#e8eef4}
.pz-ant-v.sat.leaflet-container{background:#3e526b}.pz-ant-v.sat .leaflet-tile-pane{filter:brightness(${LUCE}) saturate(1.1)}
.pz-ant-t{display:block;padding:10px 14px 11px;font-weight:800;font-size:16.5px;line-height:1.25;color:#3d1f04;background:linear-gradient(180deg,#f9c93e,#eda40c);border-top:1px solid rgba(160,106,8,.35)}
.pz-ant-t small{display:block;font-weight:600;font-size:12.5px;opacity:.92;margin-top:1px}
.pz-ant-q{position:absolute;top:8px;right:8px;z-index:1000;font-style:normal;font-size:12px;font-weight:700;background:rgba(255,255,255,.92);border-radius:6px;padding:2px 7px;color:#0f3d6e}
.pz-ant-q:empty{display:none}
.pz-ant-v .leaflet-control-attribution{font-size:10px;background:rgba(255,255,255,.7)}
/* le citta' dell'anteprima piu' piccole di quelle della mappa grande: e' un'anteprima, e cosi' ce ne stanno di piu' */
.pz-ant-v .pz-et{padding:1px 5px 2px}.pz-ant-v .pz-et .r1{font-size:10.5px}.pz-ant-v .pz-et .ic{font-size:13px}.pz-ant-v .pz-et .nm{font-size:9.5px}
/* quelle che col nome non ci stanno: prima senza nome, poi solo icona e massima (si toglie solo quella che non ci sta nemmeno cosi') */
.pz-ant-v .pz-et.corta .nm,.pz-ant-v .pz-et.mini .nm,.pz-ant-v .pz-et.mini .mn{display:none}
.pz-ant-v .pz-et.mini{padding:0 4px 1px}.pz-ant-v .pz-et.mini .ic{margin-right:1px}
/* i capoluoghi di provincia non perdono mai il nome: se non ci stanno perdono la minima (28/10/2026) */
.pz-ant-v .pz-et.nome .mn{display:none}
@media (min-width:700px){.pz-ant-v{height:300px}}
`;
// reg e nomeReg della regione della pagina, ga il prefisso degli eventi; nella pagina va anche C.ant (confine e ordine)
function mappeHtml({ reg, nomeReg, ga }) {
  const bottone = (href, k, testo, sotto) => `<a class="pz-ant-c" href="${href}" onclick="try{gtag('event','apri_mappa',{da:'${ga}-${k}'})}catch(e){}">`
    + `<div class="pz-ant-v" id="ant-${k}"></div><i class="pz-ant-q" id="ant-${k}-q"></i><span class="pz-ant-t">${testo}<small>${sotto}</small></span></a>`;
  return `<h2>Guarda le nostre mappe</h2>
<div class="pz-ant" id="ant">
  ${bottone(`${SITO}/?r=${reg}&amp;radar=ora`, 'radar', '📡 Radar piogge', 'Dove sta piovendo adesso, in Italia e in Europa')}
  ${bottone(`${SITO}/previsioni/?r=${reg}`, 'prev', `☀️ Previsioni ${esc(nomeReg)}`, 'Il tempo città per città, ora per ora')}
  ${bottone(`${SITO}/?r=${reg}&amp;g=7`, 'pluvio', `💧 Pluviometri ${esc(nomeReg)}`, 'La pioggia degli ultimi 7 giorni, pluviometro per pluviometro')}
</div>`;
}

// la barra che scorre sopra la scheda (vedi .pz-nastro): il blocco rosso c'e' gia' nell'HTML, cosi' la pagina non salta
// quando arrivano le previsioni; i paesi li scrive disegnaNastro. Lo stesso testo di C.nastro.
function nastroHtml(titolo) {
  return `<div class="pz-nastro" id="nastro"><div class="lab"><b>METEO<em> ${esc(titolo.toUpperCase())}</em></b><span>…</span></div><div class="t"></div></div>`;
}

function pagina(z, QUOTE_DI) {
  const zslug = slug(z.n);
  const paesi = require(path.join(RADICE, 'data', 'paesi-zone.json'))[zslug];
  if (!paesi || !paesi.length) throw new Error('nessun paese per ' + zslug + ' in data/paesi-zone.json');
  const { ids, regDi } = postiDellaZona(POSTI, z);
  const anag = id => POSTI[regDi[id]].find(p => String(p[0]) === String(id));
  const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regDi[ids[0]]);
  const nomeReg = casa.nomeTitolo || casa.nome;
  // l'ente delle reti (ottavo campo dei posti, retiDei): Bagnone sta in Toscana ma il pluviometro e' di OMIRL
  const agenzie = [...new Set(retiDei(ids.map(id => [regDi[id], anag(id)])).map(agenziaDi).filter(Boolean))];
  const ENTE = diEnte(elenco(agenzie));
  const NOME = z.n, DOVE = z.dove;
  const VALLE = z.t === 'valle' ? 'valle' : 'zona';
  const quote = {};
  for (const p of paesi) quote[p.n] = QUOTE_DI[chiave(p.lat, p.lon)];
  const pluv = ids.map(anag).filter(Boolean).sort((a, b) => bello(a[1]).localeCompare(bello(b[1]), 'it')).map(p => {
    const k = regDi[p[0]];
    // l'indirizzo della pagina del pluviometro: lo stesso della tabella della zona piogge (slugRegione)
    return { id: String(p[0]), n: bello(p[1]), url: `${SITO}/funghi/${k}/${SLUG_REG[k][p[0]]}/`, q: p[3], lat: +p[4], lon: +p[5], ente: agenziaDi(regioneDati(k, p)) || '' };
  });

  // ⚠️ 31/10/2026 (scheda 104 bis, suo «tutte e sei»): TITOLO E DESCRIZIONE CORTI, «METEO <ZONA>» IN TESTA.
  // Prima 52 titoli su 71 passavano i 60 caratteri (il piu' lungo 102) e le descrizioni i 227: Google li
  // tagliava e per «meteo casentino» il titolo l'aveva gia' riscritto da solo, col nostro og:title. La
  // ricerca e' «meteo <zona>», e ilMeteo e 3B, sopra di noi, cominciano proprio cosi'.
  const DV = VALLE === 'valle' ? 'della valle' : 'della zona';
  const TITOLO = [`Meteo ${NOME}: previsioni a 7 giorni, paese per paese`, `Meteo ${NOME}: previsioni a 7 giorni`]
    .find(t => t.length <= 62) || `Meteo ${NOME}`;
  const DESCR = [
    `Meteo ${NOME}: pioggia, minime e massime dei prossimi 7 giorni in ${paesi.length} paesi ${DV}, ognuno alla sua quota, ora per ora, e la pioggia già caduta.`,
    `Meteo ${NOME}: pioggia, minime e massime dei prossimi 7 giorni in ${paesi.length} paesi ${DV}, ora per ora, e la pioggia già caduta.`,
    `Meteo ${NOME}: pioggia, minime e massime dei prossimi 7 giorni in ${paesi.length} paesi, ora per ora.`,
  ].find(t => t.length <= 155) || `Meteo ${NOME}: le previsioni dei prossimi 7 giorni, paese per paese.`;
  const ALTRE = altreMeteo(casa, 'meteo-' + zslug, `${SITO}/meteo/${zslug}/`);   // vuoto se la regione non ne ha altre

  const modello = path.join(RADICE, casa.k, 'index.html');
  if (!fs.existsSync(modello)) { console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-regione.js'); process.exit(1); }
  const m = fs.readFileSync(modello, 'utf8');
  // il foglio della pagina regione SENZA il blocco del meteo, come le zone piogge (quelle regole sono per la sua testata)
  let STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));
  const iMeteo = STILE.indexOf('/* ── IL METEO NELLE PAGINE REGIONE');
  if (iMeteo >= 0) STILE = STILE.slice(0, iMeteo);

  const C = { sito: SITO, raw: RAW, slug: zslug, reg: casa.k, dove: DOVE, valle: VALLE, inValle: VALLE === 'valle' ? 'in valle' : 'nella zona',
    diValle: 'della ' + VALLE, sat: SAT, quote, pluv, nastro: NOME,
    // le tre anteprime (28/10/2026): il confine della regione e l'ordine delle citta'. confineDi si chiede qui e non in
    // cima: genera-pagine-adesso.js richiama genera-sitemap.js, che legge le zone di questo file (giro di require)
    ant: Object.assign({ confine: require('./genera-pagine-adesso.js').confineDi(casa) }, ordineCitta(casa.k)) };

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/meteo/${zslug}/">
<meta property="og:title" content="${esc(TITOLO)}">
<meta property="og:description" content="${esc(DESCR)}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:url" content="${SITO}/meteo/${zslug}/">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], ['Previsioni meteo', `${SITO}/previsioni/`], [NOME, null]])}
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
${testata({ sito: SITO, canale: CANALE, reg: casa.k, ga: 'meteo-' + zslug, attiva: 'previsioni' })}
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › <a href="${SITO}/previsioni/">Previsioni meteo</a> › ${esc(NOME)}</p>
<h1>Meteo ${esc(NOME)}: previsioni a 7 giorni</h1>
<p class="sotto"><b>Che tempo farà ${esc(DOVE)} nei prossimi 7 giorni</b> ${aiPaesi(paesi.map(p => p.n), DV)}, ognuno alla sua quota: pioggia, minime e massime, e quanta pioggia è già caduta nei pluviometri ${esc(ENTE)}.</p>

<div class="pz-cerca"><input id="cerca" type="search" autocomplete="off" placeholder="Cerca il tuo paese, anche una frazione" aria-label="Cerca un paese o una frazione"><div class="pz-drop" id="drop"></div></div>
${nastroHtml(NOME)}
<section class="pz-scheda" id="scheda" aria-live="polite"></section>

<div class="pz-punto" id="punto"><span class="pz-quando">Il punto di stamattina</span> Sto leggendo previsioni e pluviometri…</div>

<h2>I prossimi 7 giorni ${esc(DOVE)}</h2>
<p class="nota" style="margin-top:0">Tocca un giorno: la mappa e la tabella qui sotto passano a quel giorno. 💧 è la probabilità di pioggia, la più alta fra i paesi.</p>
<div class="pz-giorni" id="giorni"></div>
<p class="pz-tot" id="tot"></p>

<div class="pz-mappa-testa"><span class="dove" id="mappa-giorno"></span></div>
<div id="pz-mappa"></div>
<p class="nota" id="mappa-nota" style="margin-top:2px">Tocca un paese per vederlo ora per ora.</p>

<h2>Paese per paese</h2>
<p class="nota" style="margin-top:0">Dal più in basso al più in alto (quota del terreno, ~). Tocca un paese per le ore; scorri di lato per tutti i giorni. 💧 è la probabilità di pioggia.</p>
<div class="pz-scorri"><table class="pz-tab" id="tab">${tabellaFissa(paesi.map(p => p.n), quote)}</table></div>

<h2>La pioggia caduta e quella in arrivo</h2>
<p class="nota" style="margin-top:0">Gli ultimi 30 giorni misurati dai pluviometri ${esc(ENTE)} (media ${VALLE === 'valle' ? 'della valle' : 'della zona'}) e i 7 giorni previsti. Tocca una barra.</p>
<div class="pz-graf" id="graf"></div>
<div class="pz-graf-date" id="graf-date"></div>
<div class="pz-graf-info" id="graf-info"></div>
<div class="pz-leg"><span><i style="background:#1a5fa8"></i>misurata</span><span><i style="background:repeating-linear-gradient(45deg,#7fb0e0,#7fb0e0 3px,#b9d4ef 3px,#b9d4ef 6px)"></i>prevista</span><span id="leg-date"></span></div>
<div class="griglia" style="margin-top:14px">
  <div class="card"><h3 id="r1h">Ieri</h3><div class="numerone" id="r1">…</div><div id="r1t"></div></div>
  <div class="card"><h3>Ultimi 7 giorni</h3><div class="numerone" id="r7">…</div><div id="r7t"></div></div>
</div>

${mappeHtml({ reg: casa.k, nomeReg, ga: 'meteo-' + zslug })}
${ALTRE}
<h2>Come funziona questa pagina</h2>
<p>Le previsioni sono quelle del modello ECMWF, distribuite da MET Norway (CC BY 4.0), chieste per ognuno dei ${paesi.length} paesi e aggiornate più volte al giorno. La pioggia caduta è misurata dai pluviometri ${esc(ENTE)}: non è una stima. Le due cose stanno separate anche nel grafico, perché una è un dato e l'altra una previsione.</p>
</main>

<footer>
  Previsioni: MET Norway (ECMWF) · Pioggia misurata: ${esc(elenco(agenzie))} ·
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
/* LA PAGINA MADRE meteo/index.html NON C'E' PIU' (28/10/2026 sera, suo: «la pagina madre meteo, ma che roba è? e a cosa
   serve? la pagina madre dovrebbe essere la mappa»): la madre delle pagine meteo e' la mappa delle previsioni, /previsioni/.
   /meteo/ rimanda li' (301, _redirects) e il percorso delle pagine e' «Mappa pluviometrica › Previsioni meteo (/previsioni/)
   › <zona>». C'era dal 28/10 mattina (paginaIndice): le 31 zone per regione, i 20 paesi e il bottone verso /previsioni/.
   Google le zone e i paesi li trova dalle loro sitemap e dai link delle pagine piogge e funghi (linkMeteo, linkMeteoPaese). */

module.exports = { ZONE_METEO, ZONE_METEO_B, ZONE_METEO_C, ZONE_METEO_TUTTE, linkMeteo, METEO_PAESI, METEO_PAESI_B, METEO_PAESI_TUTTI, linkMeteoPaese, indirizzoMeteoPaese, linkMeteoRegione,
  MV_CSS, altreMeteo, tabellaFissa,
  // per genera-pagine-meteo-paese.js, che fa le pagine «Meteo <paese>» con lo stesso stile e lo stesso codice del browser
  CSS, CSS_ANT, clientePagina, mappeHtml, nastroHtml, scrivi, esc, agenziaDi, SITO, RAW, RILIEVO, SAT, GA_ID, CANALE, POSTI, ZONE, SLUG_REG };

if (require.main === module) {
  (async () => {
    const SOLO = process.env.SOLO;
    const tutti = require(path.join(RADICE, 'data', 'paesi-zone.json'));
    const zone = ZONE_METEO_TUTTE.filter(s => !SOLO || s === SOLO).map(s => {
      const z = ZONE.find(x => slug(x.n) === s);
      if (!z) throw new Error('zona sconosciuta: ' + s);
      return z;
    });
    const punti = [].concat(...zone.map(z => tutti[slug(z.n)] || []));
    const QUOTE_DI = await quotePaesi(punti);
    for (const z of zone) {
      scrivi(path.join(RADICE, 'meteo', slug(z.n), 'index.html'), senzaCommenti(pagina(z, QUOTE_DI)));
      console.log('  meteo/' + slug(z.n) + '/');
    }
    if (SOLO) { console.log(`1 pagina scritta (SOLO=${SOLO}), sitemap non toccata.`); return; }
    const { scriviSitemap } = require('./genera-sitemap.js');
    const tot = scriviSitemap(SITO, RADICE);
    console.log(`${zone.length} pagine «Previsioni meteo» scritte, sitemap.xml con ${tot} indirizzi.`);
  })().catch(e => { console.error(e); process.exit(1); });
}
