#!/usr/bin/env node
/**
 * Scrive le pagine «Piogge per funghi»: funghi/<regione>/index.html
 *
 * COSA SONO. Una pagina per regione che dice DOVE E' PIOVUTO nelle zone da
 * bosco, con i millimetri veri di un pluviometro pubblico e la data. E' la
 * nostra risposta a 3bmeteo.com/meteo-funghi, che nella stessa pagina mette
 * quindici righe con un'etichetta a parole («Scarsa o Localizzata»), zero
 * numeri, e dichiara di essere sperimentale. La promessa qui e' DIVERSA, non
 * la stessa in altra grafica: noi i funghi non li prevediamo, diciamo dov'e'
 * piovuto e quanto.
 *
 * ⚠️ NON SONO ISTANTANEE. I numeri non sono cotti dentro: la pagina li legge
 * da data/funghi/<regione>.json, che scrive genera-funghi.js una volta al
 * giorno. Se quel file manca o e' stato scritto piu' di 36 ore fa, la pagina si
 * ricalcola tutto da sola dai file giornalieri. Le due strade devono restare
 * gemelle: stesse finestre, stessa soglia, stesso modo di contare.
 *
 * ⚠️ L'ANAGRAFE NON SI RICOPIA: le cartelle dati, i nomi e le agenzie vengono
 * da `genera-pagine-regione.js`, i posti da `funghi-posti.json`. Qui dentro c'e'
 * solo la lingua (il genitivo del nome della regione), che nell'anagrafe non
 * c'e' e serve a una frase sola.
 *
 * ⚠️ NIENTE ABRUZZO: non abbiamo una fonte aperta per quella regione (POLARIS
 * e' dietro un login, email del 19/8/2026 senza risposta). NIENTE MOLISE:
 * nessuno dei suoi 24 pluviometri in fascia di quota arriva al 37% di bosco (il
 * piu' boscoso e' Capracotta, 35%), e una pagina vuota e' peggio di nessuna
 * pagina. Restano 19 regioni.
 *
 * ⚠️ QUESTE PAGINE FANNO PARTIRE UN DEPLOY: stanno fuori da `data/` e da
 * `.github/`, quindi non sono nella regola ignore di netlify.toml. Pubblicarle
 * costa ~15 crediti Netlify, che e' giusto — sono il sito — ma non si fa a
 * ogni giro: i numeri cambiano in `data/`, i gusci no.
 *
 * Uso: `node .github/scripts/genera-pagine-funghi.js` (nessun parametro).
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, navAltre, briciolaJson } = require('./genera-pagine-regione.js');
const { LOCALITA, bello, slug, slugRegione } = require('./lib-nomi.js');
const { rigaStagione } = require('./lib-stagione.js');
// 24/9/2026: verdetto, barre e finestra comuni con le pagine di zona
const { STILE_NUOVO, JS_COMUNE } = require('./lib-pagina-funghi.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
// Le zone, per non lasciarle orfane: fino al 3/9/2026 le 114 pagine di zona
// non le linkava NESSUNO e le trovava solo la sitemap. E' lo stesso errore
// delle 42 pagine di agosto, ripetuto identico.
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const RADICE = path.resolve(__dirname, '..', '..');
const SITO = 'https://avventurepluvio-test.netlify.app';
const { haBoschi, cartaBreve, cartaDi, fonteNota } = require('./lib-boschi.js');

// Solo la lingua: «della Liguria», «delle Marche». Nell'anagrafe delle pagine
// regione c'e' la preposizione semplice (prep), che basta per «in Liguria» ma
// non per «l'acqua DELLA Liguria». Non e' un secondo elenco di regioni: se una
// chiave qui non c'e', il generatore si ferma invece di scrivere una frase
// storta.
const GENITIVO = {
  lombardia: 'della Lombardia', piemonte: 'del Piemonte', valledaosta: "della Valle d'Aosta",
  liguria: 'della Liguria', emilia: "dell'Emilia-Romagna", veneto: 'del Veneto',
  friuli: 'del Friuli Venezia Giulia', trentino: 'del Trentino', altoadige: "dell'Alto Adige",
  toscana: 'della Toscana', umbria: "dell'Umbria", marche: 'delle Marche', lazio: 'del Lazio',
  campania: 'della Campania', puglia: 'della Puglia', basilicata: 'della Basilicata',
  calabria: 'della Calabria', sicilia: 'della Sicilia', sardegna: 'della Sardegna',
};

// ⚠️ ARPA PIEMONTE PUBBLICA I NOMI TUTTI IN MAIUSCOLO («ALA DI STURA»), ed e'
// l'unica delle diciannove: sono tutti e 97 i suoi posti, e in una tabella da
// leggere gridano. Si riscrivono in tondo SOLO quando il nome e' interamente
// maiuscolo, cosi' le altre diciotto non si toccano e un domani un nome con una
// sigla dentro resta com'e'. Le particelle restano minuscole: «Cellio con
// Breia», non «Cellio Con Breia».
// Non si tocca `funghi-posti.json`, che deve restare fedele alla fonte: questa
// e' presentazione, e sta nel generatore delle pagine.
// ⚠️ `bello()` e `PARTICELLE` stavano qui e adesso stanno in `lib-nomi.js`:
// dal 2/9/2026 servono anche a `genera-pagine-localita.js` e a
// `genera-funghi.js`, che scrive l'anagrafe dentro il file dei giorni.

function pagina(r, posti) {
  const nome = r.nomeTitolo || r.nome;
  // La forma corta: se l'anagrafe non ne ha una, si toglie la parentesi finale
  // («ARPA Liguria (OMIRL)» → «ARPA Liguria»). Cosi' non si tocca l'anagrafe
  // condivisa, che e' anche quella delle pagine regione gia' in produzione.
  const corta = r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, "");
  const gen = GENITIVO[r.k];
  // ⚠️ 13/9/2026: LA DOMANDA E' «DOVE ANDARE A FUNGHI». Search Console, 28
  // giorni: questa pagina in un mese e' comparsa su Google UNA volta, mentre le
  // zone col titolo stretto escono in prima pagina su «funghi in garfagnana
  // oggi». La pioggia di 13-20 giorni fa e' il mezzo, la risposta e' dove
  // andare. Tetto 62 caratteri: si accorcia solo dove il nome non ci sta.
  // ⚠️ «OGGI» NEL TITOLO SI', TUTTO L'ANNO (deciso da lui il 13/9/2026): e' la
  // ricerca in cui vogliamo entrare. A tutelarci a gennaio ci pensa la riga
  // di stagione SUBITO SOTTO IL TITOLO (lib-stagione.js), che fuori stagione
  // lo dice in chiaro. Scartati il titolo senza «oggi» e quello che cambia
  // con la stagione.
  // ⚠️ 24/9/2026: stesso schema delle pagine di paese e di zona, deciso da
  // lui. Davanti «Funghi <regione> oggi», la forma delle ricerche vere.
  const titolo = [
    `Funghi ${r.prep} ${nome} oggi: dove stanno nascendo?`,
    `Funghi ${r.prep} ${nome} oggi`,
  ].find(t => t.length <= 62) || `Funghi ${r.prep} ${nome} oggi`;
  const descr = [
    `Dove stanno nascendo funghi ${r.prep} ${nome}? Le piogge degli ultimi 25 giorni nei posti da bosco, zona per zona, misurate dai pluviometri. Aggiornato ogni mattina.`,
    `Dove stanno nascendo funghi ${r.prep} ${nome}? Le piogge degli ultimi 25 giorni nei posti da bosco, zona per zona.`,
  ].find(t => t.length <= 158);
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titolo}</title>
<meta name="description" content="${descr}">
<link rel="canonical" href="${SITO}/funghi/${r.k}/">
<meta property="og:title" content="Funghi ${r.prep} ${nome} oggi: dove stanno nascendo?">
<meta property="og:description" content="Dove e' caduta l'acqua nelle zone da bosco, misurata dai pluviometri. Non previsioni: pioggia vera.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/funghi/${r.k}/">
<meta property="og:type" content="website">
${briciolaJson([
  ['Piogge per funghi', `${SITO}/funghi/`],
  [nome, null],
])}
<!-- Google tag: come nelle pagine regione, il config sta dietro al controllo
     sull'HOSTNAME, se no questa copia sul test manderebbe eventi alla
     proprieta' vera. -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-9R7MXXS0V4"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', 'G-9R7MXXS0V4');
  }
</script>
<style>
:root{--blu:#1b3f6e;--blu-scuro:#123252;--grigio:#f0f4fb;--bordo:#d0d8e8;--verde:#2e7d32;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#222;background:#fff;font-size:17px;line-height:1.6;}
header{background:var(--blu);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:nowrap;}
header a{color:#fff;text-decoration:none;}
header .logo{font-weight:600;font-size:15px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}
header .yt{margin-left:auto;background:#e12b2b;font-size:13px;font-weight:600;padding:6px 11px;border-radius:7px;white-space:nowrap;flex:none;}
/* ⚠️ 25/9/2026, sua schermata da Android: sotto i ~430 px logo e tasto rosso
   non ci stavano sulla stessa riga e il tasto andava a capo, raddoppiando la
   testata. Sul telefono via «· piogge» e «Canale»: resta «▶ YouTube». */
@media(max-width:440px){header{padding:10px 12px;gap:8px;} header .logo span,header .yt .yt-l{display:none;}}
main{max-width:860px;margin:0 auto;padding:22px 16px 40px;}
h1{color:var(--blu-scuro);font-size:30px;line-height:1.25;margin-bottom:8px;}
h2{color:var(--blu-scuro);font-size:21px;margin:32px 0 8px;}
p,li,.patto,.metodo div,.avviso,.nota{text-wrap:pretty;}
h1,h2,.capo .gr{text-wrap:balance;}
.sotto{color:#555;font-size:17px;margin-bottom:18px;}
.patto{background:var(--grigio);border:1px solid var(--bordo);border-left:4px solid var(--verde);
  border-radius:8px;padding:13px 16px;margin:18px 0 24px;font-size:16px;}
.patto b{color:var(--blu-scuro);}
.patto p+p{margin-top:7px;}
.spiega{background:var(--grigio);border:1px solid var(--bordo);border-left:4px solid var(--blu);
  border-radius:8px;padding:12px 15px;margin:14px 0 10px;font-size:16px;color:#333;}
.spiega b{color:var(--blu-scuro);}
.capo{background:#0f2d4d;color:#fff;border-radius:10px;padding:16px 18px;margin:18px 0 6px;}
.capo .et{font-size:14px;letter-spacing:.2px;opacity:.8;}
.capo .gr{font-size:25px;font-weight:700;line-height:1.25;margin-top:3px;}
.capo .pic{font-size:15px;opacity:.85;margin-top:5px;}
.capo-btns{display:flex;gap:9px;flex-wrap:wrap;margin-top:13px;}
.capo-btn{display:inline-block;text-decoration:none;color:#0f2d4d;font-weight:700;font-size:14.5px;
  padding:9px 15px 10px;border-radius:9px;border:1px solid #b9c7da;
  background:linear-gradient(180deg,#ffffff 0%,#f5f8fd 48%,#e8eef8 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(15,45,77,.07),
             0 3px 0 #aebfd4, 0 6px 13px rgba(0,0,0,.28);
  text-shadow:0 1px 0 rgba(255,255,255,.7);transition:transform .06s, box-shadow .06s;}
.capo-btn:active{transform:translateY(2px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 1px 0 #aebfd4, 0 3px 7px rgba(0,0,0,.25);}
table{width:100%;border-collapse:collapse;font-size:15.5px;margin-top:6px;}
th{background:var(--blu);color:#fff;font-weight:600;font-size:12.5px;text-align:left;padding:8px 7px;
  text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;}
td{padding:8px 7px;border-bottom:1px solid var(--bordo);vertical-align:middle;}
tr:nth-child(even) td{background:#fafcff;}
td.pos{color:#8a97ad;font-size:13px;width:26px;text-align:right;}
td b{color:var(--blu-scuro);}
.loc{text-decoration:none;display:block;}
.loc b::after{content:' \\2197';font-size:11px;color:#7a93b5;opacity:0;transition:opacity .12s;}
.loc:hover b{text-decoration:underline;}
.loc:hover b::after{opacity:1;}
.com{display:block;color:#6a7789;font-size:13px;}
.forte-m{display:none;}
/* ⚠️ DUE VERSIONI DELL'INTESTAZIONE. Non e' vezzo: le intestazioni non
   vanno a capo (serve, se no restano appese le codine «fa» e «gg»), e a
   360 px erano LORO a tenere aperte le colonne, non i numeri. Con la
   scritta lunga il nome della localita' aveva 99 px e «San Colombano
   Certenoli» andava su quattro righe. */
.hd-c{display:none;}
td.mm{position:relative;min-width:118px;}
.barra{position:absolute;left:7px;top:50%;transform:translateY(-50%);height:20px;
  min-width:3px;background:#cfe0f5;border-radius:4px;}
.mm .v{position:relative;font-weight:700;color:var(--blu-scuro);padding-left:7px;}
.mm .v.zero{color:#a0aab8;font-weight:400;}
td.ultima{font-size:14px;color:#42506a;white-space:nowrap;}
.q2{color:var(--blu-scuro);font-weight:600;}
.vuoto{color:#a0aab8;}
.metodo{border:1px solid var(--bordo);border-radius:8px;overflow:hidden;margin-top:6px;}
.metodo div{padding:11px 15px;border-bottom:1px solid var(--bordo);font-size:16px;}
.metodo div:last-child{border-bottom:0;}
.metodo b{color:var(--blu-scuro);}
.metodo .n{display:inline-block;background:var(--blu);color:#fff;width:22px;height:22px;border-radius:50%;
  text-align:center;line-height:22px;font-size:13px;font-weight:700;margin-right:8px;}
.nota{color:#6a7789;font-size:14.5px;margin-top:10px;}
.avviso{background:#fff6e5;border:1px solid #f0d9a8;border-radius:8px;padding:12px 15px;font-size:15px;margin:24px 0 0;}
.avviso b{color:var(--blu-scuro);}
/* ⚠️ IL PIE' DI PAGINA NON AVEVA NESSUNA REGOLA (corretto il 3/9/2026). Il
   tag <footer> c'era su tutte e tre le famiglie di pagine, ma niente lo
   nominava: il browser lo disegnava a modo suo, tutto a sinistra, senza
   riga di separazione e coi link viola da «gia' visitato». Sono le stesse
   regole che le pagine regione hanno da sempre.
   ⚠️ Questo foglio di stile lo COPIANO anche le pagine di paese e di zona
   (lo leggono da qui, vedi genera-pagine-localita.js): una regola scritta
   qui vale per tutte e 1.081. */
footer{border-top:1px solid var(--bordo);margin-top:8px;padding:14px 16px 24px;
  font-size:14px;color:#555;text-align:center;}
footer a{color:var(--blu);}
footer nav.altre{border-top:none;margin-top:0;padding-top:0;}
.vai-mappa{display:block;text-align:center;color:#fff;font-size:19px;font-weight:700;
  padding:15px 18px 17px;border-radius:10px;margin:14px 0 4px;border:1px solid #12365c;
  background:linear-gradient(180deg,#2a5a91 0%,#1b3f6e 48%,#153558 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.2),
             0 4px 0 #0e2b4a, 0 8px 16px rgba(15,45,77,.35);
  text-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .06s, box-shadow .06s;}
a:active .vai-mappa{transform:translateY(2px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.24), 0 2px 0 #0e2b4a, 0 4px 10px rgba(15,45,77,.3);}
/* La riga di stagione: c'e' solo nei mesi in cui la pagina non serve a
   molto, e lo dice invece di far finta di niente. */
#stagione{display:none;background:#eef2f8;border:1px solid #ccd7e6;border-left:4px solid #7a93b5;
  border-radius:8px;padding:12px 15px;font-size:15.5px;color:#42506a;margin:0 0 20px;}
#stagione b{color:var(--blu-scuro);}
#attesa{color:#6a7789;font-size:16px;padding:18px 0;}
#guasto{display:none;background:#fdecea;border:1px solid #f5c2bd;border-radius:8px;
  padding:13px 16px;font-size:16px;color:#8a2b20;margin-top:10px;}
@media(max-width:640px){
  body{font-size:16px;} h1{font-size:24px;} main{padding:16px 12px 30px;}
  .capo .gr{font-size:21px;}
  table{font-size:14px;} th{font-size:11px;padding:7px 4px;} td{padding:7px 4px;}
  th.tagl,td.tagl{display:none;}
  /* ⚠️ 110 px per colonna schiacciavano il nome a un centinaio di pixel e
     «San Colombano Certenoli» andava su QUATTRO righe. Le barre non hanno
     bisogno di tutto quello spazio: a 74 px il nome ne guadagna 72. */
  td.mm{min-width:74px;}
  .hd-l{display:none;}
  .hd-c{display:inline;}
  td.mm .v{padding-left:5px;font-size:13.5px;}
  .forte-m{display:block;color:#42506a;}
  /* ⚠️ Sul telefono i tre tasti vanno a capo comunque, e larghi a misura del
     testo restavano di tre lunghezze diverse: sembravano di importanza
     diversa. Impilati e tutti larghi uguale si leggono come tre scelte
     alla pari, che e' quello che sono. */
  .capo-btns{flex-direction:column;}
  .capo-btn{width:100%;text-align:center;}
}
nav.altre{border-top:1px solid var(--bordo);margin-top:30px;padding-top:14px;font-size:15px;color:#555;}
ol.zone-dove{list-style:none;margin:10px 0 26px;padding:0;counter-reset:z;}
ol.zone-dove li{counter-increment:z;display:flex;align-items:baseline;gap:10px;padding:8px 2px;border-bottom:1px solid var(--bordo);}
ol.zone-dove li:before{content:counter(z);min-width:22px;text-align:right;color:#8a97a6;font-size:13px;}
ol.zone-dove a{font-weight:600;color:var(--blu);text-decoration:none;}
ol.zone-dove .zmm{margin-left:auto;font-weight:700;white-space:nowrap;}
nav.altre b{display:block;color:var(--blu-scuro);font-size:16px;margin:14px 0 2px;}
nav.altre p{line-height:1.9;}
nav.altre a{color:var(--blu);}
${STILE_NUOVO}
</style>
</head>
<body>
<header>
  <a href="https://precipitazioni.avventuremicologiche.it/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>
  <a href="https://www.youtube.com/@avventuremicologiche" target="_blank" rel="noopener" class="yt">▶ <span class="yt-l">Canale </span>YouTube</a>
</header>
<main>

${/* La briciola verso la radice della famiglia, dall'8/9/2026. Stessa forma di
     quella che le pagine di paese hanno verso qui: e' il solo link che le 19
     regioni mandano all'indice, e senza di lui l'indice sarebbe una pagina che
     nessuno nomina. */''}
<p class="nota" style="margin-bottom:6px"><a href="${SITO}/funghi/" style="color:var(--blu)">‹ Piogge per funghi, tutte le regioni</a></p>
${/* ⚠️ LA FINESTRA E LA CLASSIFICA NELLE PRIME TRE RIGHE (9/9/2026), come
     sull'indice. Prima il titolo diceva «Piogge per funghi in Umbria» e sotto
     «quanta acqua e' caduta davvero nelle zone da bosco»: chi arrivava da
     Google non capiva ne' che sta guardando la pioggia di due settimane fa, ne'
     che sotto c'e' una classifica. Il perche' dei 13-20 giorni stava solo nel
     riquadro sopra la tabella, cioe' dopo il patto e dopo l'attesa.
     ⚠️ SMENTITO IL 13/9/2026 quello che stava scritto qui, cioe' che «Piogge
     per funghi <regione>» fosse la frase con cui la gente cerca: in 28 giorni
     questa pagina e' comparsa su Google una volta. La gente cerca «dove andare
     a funghi», e titolo e H1 adesso lo dicono. */''}
<h1>Funghi ${r.prep} ${nome} oggi: dove stanno nascendo?</h1>
${rigaStagione()}

<div id="attesa">Sto leggendo i pluviometri…</div>
<div id="guasto"></div>
<div id="verdetto"></div>

<h2>Le piogge degli ultimi 25 giorni ${r.prep} ${nome}</h2>
<div id="grafico"></div>
<p class="nota">Media dei pluviometri da bosco ${gen}, giorno per giorno.</p>

<h2 id="h-conta">Però attenzione: la pioggia che conta è quella caduta da 13 a 20 giorni fa</h2>
<p class="breve" id="p-conta">Il fungo spunta 12-13 giorni dopo una bella pioggia: i funghi di oggi nascono da queste otto giornate.</p>
<div id="finestra"></div>

<h2>Dove è andata meglio? Apri le mappe</h2>
<div class="tasti">
  <a class="forte" id="t-conta" href="${SITO}/?r=${r.k}&amp;g=20">13-20 gg fa</a>
  <a href="${SITO}/?r=${r.k}&amp;g=1">Ieri</a>
  <a href="${SITO}/?r=${r.k}&amp;g=7">Ultimi 7 gg</a>
  <a href="${SITO}/?r=${r.k}&amp;g=20">Ultimi 20 gg</a>
  <a href="${SITO}/?r=${r.k}&amp;g=30">Ultimi 30 gg</a>
  <a href="${SITO}/?r=${r.k}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'funghi-${r.k}-radar'})}catch(e){}">📡 Radar adesso</a>
</div>
<div id="testa" style="display:none"></div>

${(function(){
  /* ⚠️ LE ZONE DOVE ANDARE, IN CIMA (13/9/2026). I nomi e i link sono cotti
     qui, in ordine alfabetico: e' quello che legge Google. Il javascript della
     pagina scrive i millimetri e SPOSTA le righe dalla piu' bagnata. Prima
     queste zone stavano in fondo, dopo la mappa e l'elenco dei paesi. */
  const zz = ZONE.filter(z => z.reg === r.k).sort((a, b) => a.n.localeCompare(b.n, 'it'));
  if (!zz.length) return '';
  /* ⚠️ OGNI PLUVIOMETRO PORTA LA SUA REGIONE. Una zona sul crinale ha meta' dei
     pluviometri dall'altra parte (la Garfagnana ne ha dell'Emilia), e contando
     solo quelli di casa la lista diceva un numero e la pagina della zona un
     altro: il 13/9/2026, prima di pubblicare, 41 zone su 114 non tornavano
     (Montefeltro 24,6 mm in lista e 7,9 aprendola). */
  const regDi = {};
  Object.keys(POSTI).forEach(k => POSTI[k].forEach(p => { regDi[p[0]] = k; }));
  return `
<h2>Le zone dove andare a funghi ${gen}</h2>
<p class="nota">Le valli da bosco ${gen}, <b>dalla più bagnata</b>. Il numero è la pioggia
caduta da 13 a 20 giorni fa, in media sui pluviometri della zona: lo stesso che trovi
aprendola.</p>
<ol class="zone-dove" id="zone-dove">
` + zz.map(z =>
  `<li data-posti="${z.posti.filter(id => regDi[id]).map(id => regDi[id] + ':' + id).join(',')}"><a href="${SITO}/funghi/zone/${slug(z.n)}/">${z.n}</a><span class="zmm"></span></li>`).join('\n') + `
</ol>`;
}())}

<h2>Piogge per funghi: i posti da bosco più bagnati ${gen}</h2>
<div class="spiega" id="finestra2"></div>
<div id="tabella"></div>
<p class="nota" id="notaforte"></p>
<div id="meteo"></div>

<h2>Ecco cosa vedi sulla mappa</h2>
<a href="https://precipitazioni.avventuremicologiche.it/?r=${r.k}" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'funghi-${r.k}-anteprima'})}catch(e){}">
  <img src="https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime/${r.k}.jpg"
       alt="La mappa delle piogge ${r.prep} ${nome}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"
       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">
  <span class="vai-mappa">Apri la mappa ${r.prep} ${nome} →</span>
</a>
<p class="nota" style="text-align:center;margin-bottom:26px;">Più il colore è acceso, più acqua è
caduta. Ogni pallino è un pluviometro: cliccalo e vedi il suo storico.</p>
${haBoschi(r.k) ? `
<h2>Che boschi ci sono ${r.prep} ${nome}?</h2>
<p>La pioggia dice <i>quando</i> andare, il bosco dice <i>dove</i>: faggete, castagneti, querceti
e abetaie non danno gli stessi funghi. La mappa boschi colora i boschi ${r.prep} ${nome} per tipo,
con i disegni ${cartaDi(r.k)}. Avvicinati sulla zona che ti interessa.</p>
<a href="${SITO}/?r=${r.k}&amp;boschi=1" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'funghi-${r.k}-boschi'})}catch(e){}">
  <img src="${SITO}/tessere-boschi/anteprime/${r.k}.jpg"
       alt="La mappa boschi ${r.prep} ${nome}: faggete, castagneti, querceti e abetaie colorati per tipo"
       width="1600" height="1000" loading="lazy"
       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">
  <span class="vai-mappa">Guarda i boschi ${r.prep} ${nome} →</span>
</a>
<p class="nota" style="margin-bottom:26px;">La fonte è ${fonteNota(r.k)}: dice che bosco
c'è, non se quest'anno ci sono nati funghi.</p>
` : ''}




<div class="noioso">
<h2>Come funziona questa pagina</h2>
<p>I millimetri li misurano i pluviometri di ${corta} nei posti da bosco ${gen}: un pluviometro vero,
quota fra 200 e 1600 metri, almeno il 37% di bosco entro 3 km sulle mappe di OpenStreetMap. I numeri in
cima sono la media di questi pluviometri, giorno per giorno, aggiornata ogni mattina.</p>
<p>Perché da 13 a 20 giorni fa: dopo una pioggia il fungo impiega almeno dodici o tredici giorni
a spuntare, di più se fa freddo. La pioggia di ieri serve ai funghi fra due settimane.</p>
<p>Ti serve un altro periodo? Per ieri e gli ultimi 30 giorni c’è
<a href="${SITO}/${r.k}/">dove ha piovuto ${r.prep} ${nome}</a>.</p>
<p><b>Ricordati</b> che in molte regioni per raccogliere funghi serve il tesserino, e che nei parchi
valgono regole proprie.</p>
<p>Dati di ${r.agenzia} via il nostro archivio. Il bosco è calcolato su dati OpenStreetMap, licenza ODbL.
La provincia viene dai confini provinciali ISTAT.</p>
</div>

${LOCALITA.includes(r.k) ? `
${/* ⚠️ Il titolo dice «quanto ha piovuto» perche' sono le parole con cui la
     gente cerca davvero («quanto ha piovuto a Imperia»), e questa e' una
     intestazione che Google legge. Prima diceva «Tutti i posti da bosco»:
     giusto ma muto, senza la parola pioggia e senza un verbo. Il criterio
     del bosco resta spiegato piu' sotto, dove si racconta come scegliamo. */''}
<h2 style="margin-top:30px">Quanto ha piovuto? Trova la località più vicina</h2>
<p class="nota">Ogni posto ha la sua pagina, con la pioggia giorno per giorno e i
pluviometri vicini. Sono i pluviometri in mezzo al bosco ${gen}.</p>
<nav class="altre"><p>${(function(){
  const sl = slugRegione(posti);
  return posti.map(p => [bello(p[1]), sl[p[0]]])
    .sort((a, b) => a[0].localeCompare(b[0], 'it'))
    .map(([n, s]) => `<a href="${SITO}/funghi/${r.k}/${s}/">${n}</a>`).join(' · ');
}())}</p></nav>` : ''}


<h2 style="margin-top:30px">Tutta la pioggia ${r.prep} ${nome}</h2>
<p>Questa pagina guarda solo i pluviometri in mezzo al bosco. Per la regione intera, pianura compresa, c'è <a href="${SITO}/${r.k}/">dove ha piovuto ${r.prep} ${nome}</a>: ${r.staz} pluviometri di ${r.agenzia}.</p>

${navAltre('funghi')}
</main>

<script>
(function(){
  /* I posti che passano i tre criteri, cotti dentro: cambiano una volta
     l'anno, non ogni giorno. Vengono da .github/scripts/funghi-posti.json, la
     stessa anagrafe che usa genera-funghi.js per i numeri.
     [ id, nome, sigla provincia, quota, lat, lon, bosco% ]
     ⚠️ LA PROVINCIA VIENE DALLE COORDINATE, non dal campo del comune: quel
        campo vuol dire cose diverse in ogni rete (sigla in Lombardia, «PROVINCIA
        DI...» in Piemonte, il comune in Liguria, la sigla della REGIONE nelle
        dieci reti MeteoHub). Il prezzo e' che si legge «Reppia — GE» e non
        «Reppia (Ne)»: uniforme su diciannove regioni, un'informazione in meno
        qui. Deciso il 2/9/2026. */
  var POSTI = ${JSON.stringify(posti.map(p => [p[0], bello(p[1])].concat(p.slice(2))))};

  var REG = '${r.k}', DIRS = ${JSON.stringify(r.dirs)}, NOME = ${JSON.stringify(nome)};
  /* In locale i dati si leggono dalla cartella del repo, sul sito dal raw di
     GitHub. Stesso trucco del tag di Google qui sopra: si guarda l'HOSTNAME.
     Serve perche' le prove si fanno con \`node server-locale.js\` sul repo, a
     zero deploy e zero crediti, e senza questo si sarebbe dovuta doctorare una
     copia della pagina apposta — cioe' provare un file diverso da quello che
     poi si pubblica. */
  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var BASE = LOCALE ? '/data/'
    : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var MAPPA = 'https://precipitazioni.avventuremicologiche.it/';
  var QUANTI = 15, FORTE = 30;
${JS_COMUNE}

  function meno(n){ var d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-n); return d; }
  function menoDaI(s, n){ return iso(menoDa(s, n)); }

  /* La riga di stagione non sta piu' qui: dal 13/9/2026 la scrive
     lib-stagione.js subito sotto il titolo, uguale per regioni e zone. */

  /* ── STRADA NORMALE: i numeri gia' fatti, UNA richiesta ──────────────────
     Fino al 2/9/2026 questa pagina scaricava i 25 file giornalieri e si faceva
     il conto nel browser del visitatore. Misurato sulle 19 regioni: 500
     richieste e 10,1 MB in tutto, e casi grotteschi — la Sicilia scaricava
     1.387 KB per mostrare NOVE posti. Adesso il conto lo fa una volta al giorno
     genera-funghi.js e qui arriva gia' pronto: pochi KB invece di mezzo mega.
     ⚠️ LA FRESCHEZZA SI MISURA SU QUANDO E' STATO SCRITTO (36 ore), non
        sull'ultimo giorno che contiene: la Puglia ha giornate che MeteoHub non
        consegna, e un file sanissimo puo' finire due giorni indietro. Sopra le
        36 ore vuol dire invece workflow fermo, e allora si ricalcola.
     ⚠️ LE DATE DELLA FINESTRA VENGONO DAL FILE (\`oggi\`), non dall'orologio del
        visitatore: se il file e' di ieri, le etichette devono dire la finestra
        su cui quei millimetri sono stati sommati davvero. */
  function fresco(j){
    if (!j || !j.generato || !j.posti || !j.oggi) return false;
    var eta = Date.now() - new Date(j.generato).getTime();
    return eta >= 0 && eta < 36*3600*1000;
  }

  /* ── IN CIMA (24/9/2026): verdetto, barre e finestra sulla MEDIA dei posti
     da bosco della regione, dal file dei giorni che usano anche le pagine di
     paese. Se non arriva, sotto la pagina resta com'era: zone e posti. */
  fetch(BASE + 'funghi/' + REG + '-giorni.json')
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; })
    .then(function(j){
      if (!j || !j.serie || !j.oggi) return;
      var ids = POSTI.map(function(p){ return p[0]; }).filter(function(id){ return j.serie[id]; });
      if (!ids.length) return;
      var s = [], sT = [];
      for (var i = 0; i < GIORNI; i++) {
        var t = 0, n = 0, a = 0, b = 0, m = 0;
        ids.forEach(function(id){ var v = j.serie[id][i]; if (v != null) { t += v; n++; }
          var tt = ((j.serieT || {})[id] || [])[i]; if (tt) { a += tt[0]; b += tt[1]; m++; } });
        s.push(n ? uno(t / n) : 0); sT.push(m ? [uno(a / m), uno(b / m)] : null);
      }
      var o = j.oggi, daG = iso(menoDa(o,20)), aG = iso(menoDa(o,13)), ieri = iso(menoDa(o,1));
      var lk = function(dal, al){ return MAPPA + '?r=' + REG + '&da=' + dal + '&a=' + al; };
      scriviVerdetto(s, o, lk(daG, ieri), 'in media, negli ultimi 20 giorni');
      var ax = scriviBarre(s, o);
      scriviFinestra(s, o, null, 'in media');
      document.getElementById('t-conta').href = lk(daG, aG);
      if (sT.some(function(x){ return x; })) scriviTemperatura(sT, ax, 'media dei posti da bosco');
    });

  fetch(BASE + 'funghi/' + REG + '.json')
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; })
    .then(function(j){
      if (j && fresco(j)) {
        var righe = [];
        POSTI.forEach(function(p){
          var v = j.posti[p[0]];
          if (!v) return;        // posto aggiunto dopo l'ultimo giro: si salta
          righe.push({ id:p[0], n:p[1], sig:p[2], q:p[3], lat:p[4], lon:p[5],
            mm:v[0], mm7:v[1], mm25:v[2], forte: v[3] ? { g:v[3], mm:v[4] } : null });
        });
        if (righe.length) { mostra(righe, j.oggi); return; }
      }
      return daiFile();
    })
    .catch(function(){ return daiFile(); });

  /* ── RIPIEGO: i giorni uno per uno, come faceva la pagina fino al 2/9/2026 ──
     Serve se il file dei numeri manca o e' vecchio. Un giorno che manca non e'
     un guasto: capita che il piu' recente non ci sia ancora.
     ⚠️ QUESTA E' LA COPIA: quella che lavora tutti i giorni sta in
        genera-funghi.js. Le due devono restare gemelle — stesse finestre,
        stessa soglia, stesso modo di contare. */
  function daiFile(){
    var nn = [];
    for (var n = 1; n <= GIORNI; n++) nn.push(n);
    return Promise.all(nn.map(function(n){
      var g = iso(meno(n));
      /* Una regione puo' leggere PIU' CARTELLE: il Friuli somma l'OSMER e la
         rete regionale via MeteoHub, e con una cartella sola il ripiego
         mostrerebbe meta' pluviometri senza dirlo. Si uniscono per id, che
         dopo il filtro delle gemelle e' univoco: i doppioni sono gia' fuori
         dall'anagrafe, tolti una volta sola da funghi-posti.json. */
      return Promise.all(DIRS.map(function(dir){
        return fetch(BASE + dir + '/' + g + '.json')
          .then(function(r){ return r.ok ? r.json() : null; })
          .catch(function(){ return null; });
      })).then(function(parti){
        var m = null;
        parti.forEach(function(j){
          if (!j || !j.stations || !j.stations.length) return;
          if (!m) m = {};
          j.stations.forEach(function(s){ if (s.mm != null) m[s.id] = (m[s.id] || 0) + s.mm; });
        });
        return { n:n, m:m };
      });
    })).then(function(res){
      var buoni = res.filter(function(x){ return x.m; });
      if (buoni.length < 5) { guasto(buoni.length); return; }

      var perGiorno = {};
      buoni.forEach(function(x){ perGiorno[x.n] = x.m; });
      function somma(da, a, id){
        var t = 0;
        for (var n = da; n >= a; n--) if (perGiorno[n] && perGiorno[n][id] != null) t += perGiorno[n][id];
        return uno(t);
      }
      function ultimaForte(id){
        for (var n = 1; n <= GIORNI; n++)
          if (perGiorno[n] && perGiorno[n][id] >= FORTE) return { g:n, mm:uno(perGiorno[n][id]) };
        return null;
      }
      mostra(POSTI.map(function(p){
        return { id:p[0], n:p[1], sig:p[2], q:p[3], lat:p[4], lon:p[5],
          mm:somma(20,13,p[0]), mm7:somma(7,1,p[0]), mm25:somma(GIORNI,1,p[0]),
          forte:ultimaForte(p[0]) };
      }), iso(meno(0)));
    });
  }

  function guasto(quanti){
    document.getElementById('attesa').style.display='none';
    var g=document.getElementById('guasto');
    g.style.display='block';
    g.innerHTML='⚠️ Non riesco a leggere l’archivio delle piogge in questo momento'
      + (quanti ? ' (trovati solo '+quanti+' giorni su '+GIORNI+')' : '')
      + '. Non dipende da te: riprova fra qualche minuto, oppure vai direttamente '
      + '<a href="'+MAPPA+'?r='+REG+'">sulla mappa</a>.';
  }

  /* LE ZONE DOVE ANDARE (13/9/2026). Qui si scrivono i millimetri e si
     RIORDINANO i nodi, non si rifa la lista con innerHTML: i link devono
     restare quelli cotti, che sono quelli che Google legge anche dopo il
     rendering. Si chiama PRIMA del taglio ai primi 15 posti.
     ⚠️ IL NUMERO E LA MEDIA DI TUTTI I PLUVIOMETRI DELLA ZONA, anche di altre
     regioni: e quello che mostra la pagina della zona, e chi clicca deve
     ritrovarlo uguale. I file delle regioni vicine sono pochi chilobyte e si
     chiedono solo se una zona li nomina. */
  function ordinaZone(tutte){
    var lista = document.getElementById('zone-dove');
    if (!lista) return;
    var mm = {};
    mm[REG] = {};
    tutte.forEach(function(r){ mm[REG][r.id] = r.mm; });
    var voci = [].slice.call(lista.children);
    var altre = {};
    voci.forEach(function(li){
      li.posti = li.getAttribute('data-posti').split(',').filter(Boolean)
        .map(function(x){ var k = x.split(':'); return { reg: k[0], id: k[1] }; });
      li.posti.forEach(function(q){ if (q.reg !== REG) altre[q.reg] = 1; });
    });
    Promise.all(Object.keys(altre).map(function(reg){
      return fetch(BASE + 'funghi/' + reg + '.json')
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; })
        .then(function(j){
          mm[reg] = {};
          if (j && j.posti) Object.keys(j.posti).forEach(function(id){ mm[reg][id] = j.posti[id][0]; });
        });
    })).then(function(){
      voci.forEach(function(li){
        var v = li.posti.map(function(q){ return (mm[q.reg] || {})[q.id]; })
          .filter(function(x){ return x != null; });
        li.valore = v.length ? v.reduce(function(a,b){ return a + b; }, 0) / v.length : null;
        li.querySelector('.zmm').textContent =
          li.valore == null ? '' : uno(li.valore).toFixed(1).replace('.', ',') + ' mm';
      });
      voci.sort(function(a,b){
        if (a.valore == null) return 1;
        if (b.valore == null) return -1;
        return b.valore - a.valore;
      }).forEach(function(li){ lista.appendChild(li); });
    });
  }

  function mostra(righe, oggiISO){
    ordinaZone(righe);
    righe = righe.sort(function(a,b){ return b.mm - a.mm; }).slice(0, QUANTI);
    var maxMm = Math.max.apply(null, righe.map(function(r){ return Math.max(r.mm, r.mm7, r.mm25); }).concat([1]));

    var daG = menoDaI(oggiISO,20), aG = menoDaI(oggiISO,13), a20 = menoDaI(oggiISO,1);
    function link(r, dal, al){
      return MAPPA + '?r=' + REG + '&da=' + dal + '&a=' + al
        + (r ? '&z=11&c=' + r.lat.toFixed(4) + ',' + r.lon.toFixed(4) : '');
    }
    function luogo(r){ return r.sig ? esc(r.sig) : ''; }
    function cella(v, cls){
      return '<td class="mm ' + (cls||'') + '">'
        + (v > 0 ? '<span class="barra" style="width:' + Math.round(v/maxMm*100) + '%"></span>' : '')
        + '<span class="v' + (v > 0 ? '' : ' zero') + '">' + (v > 0 ? v : '—') + '</span></td>';
    }

    var primo = righe[0];
    document.getElementById('testa').innerHTML =
      '<div class="capo"><div class="et">Dove ha piovuto di più 13-20 giorni fa?</div>'
      + '<div class="gr">' + esc(primo.n) + ', ' + primo.mm + ' mm</div>'
      + '<div class="pic">' + luogo(primo) + ' · ' + primo.q + ' MT'
      + (primo.forte ? ' · ultima pioggia forte ' + (primo.forte.g===1?'ieri':primo.forte.g+' giorni fa')
                        + ' (' + primo.forte.mm + ' mm)' : '') + '</div>'
      + '<div class="capo-btns">'
      + '<a class="capo-btn" href="' + link(primo, daG, aG) + '">Apri mappa · 13-20 gg fa</a>'
      + '<a class="capo-btn" href="' + link(primo, daG, a20) + '">Apri mappa · ultimi 20 gg</a>'
      + '<a class="capo-btn" href="' + link(null, daG, a20) + '">' + NOME + ' · ultimi 20 gg</a>'
      + '</div></div>';

    /* ⚠️ NIENTE APOSTROFI DRITTI QUI DENTRO: il testo esce da un template
       literal del generatore, e un ' verrebbe consumato lasciando la stringa
       spezzata e la pagina bianca. Si usa quello tipografico. */
    /* ⚠️ QUI NON SI RIPETE LA REGOLA DEI 12-13 GIORNI: dal 9/9/2026 sta nelle
       tre righe in cima, ed e' la prima cosa che si legge. Scritta due volte a
       mezza pagina di distanza sembrava che la pagina si fosse dimenticata di
       averla gia' detta. Qui restano le DATE, che in cima non ci possono
       stare: cambiano ogni giorno e il titolo e' cotto nel guscio. */
    document.getElementById('finestra2').innerHTML =
      'Gli otto giorni della finestra sono fra il <b>' + gg(daG) + '</b> e il <b>' + gg(aG)
      + '</b>. Sono millimetri misurati a terra dai pluviometri, non una previsione.';

    var trs = righe.map(function(r, i){
      var quando = r.forte
        ? (r.forte.g===1?'ieri':r.forte.g+' giorni fa') + ' <span class="q2">' + r.forte.mm + ' mm</span>'
        : '<span class="vuoto">niente di forte</span>';
      return '<tr><td class="pos">' + (i+1) + '</td>'
        + '<td><a class="loc" href="' + link(r, daG, aG) + '" title="Apri la mappa su ' + esc(r.n) + '">'
        + '<b>' + esc(r.n) + '</b><span class="com">' + luogo(r) + ' · ' + r.q + ' MT</span>'
        /* ⚠️ SUL TELEFONO la colonna «ultima pioggia forte» e' nascosta, e senza
           questa riga la nota che la spiega parlava di una cosa invisibile.
           Qui sotto il nome lo spazio c'e', e il dato e' piu' utile della
           colonna dei 25 giorni che resta comunque fuori. */
        + '<span class="com forte-m">' + (r.forte
             ? 'forte ' + (r.forte.g===1?'ieri':r.forte.g+' gg') + ' · ' + r.forte.mm + ' mm'
             : 'niente di forte') + '</span>'
        + '</a></td>'
        + cella(r.mm) + cella(r.mm7) + cella(r.mm25, 'tagl')
        + '<td class="ultima tagl">' + quando + '</td></tr>';
    }).join('');

    document.getElementById('tabella').innerHTML =
      '<table><thead><tr><th class="num"></th><th>Località</th>'
      + '<th><span class="hd-l">mm range 13-20 gg fa</span><span class="hd-c">13-20 gg fa</span></th>'
      + '<th><span class="hd-l">Ultimi 7 gg</span><span class="hd-c">7 gg</span></th>'
      + '<th class="tagl">Ultimi 25 gg</th><th class="tagl">Ultima pioggia forte</th>'
      + '</tr></thead><tbody>' + trs + '</tbody></table>';

    /* ⚠️ «15 dei primi 15» era un modo storto di dire «tutti»: quando il conto
       coincide col totale si scrive cosi', se no «12 posti su 15». */
    var conForte = righe.filter(function(r){ return r.forte; }).length;
    var quanti = (conForte === righe.length)
      ? 'Tutti e ' + righe.length + ' i posti in elenco ne hanno avuta una'
      : (conForte === 0)
        ? 'Nessuno dei ' + righe.length + ' posti in elenco ne ha avuta una'
        : conForte + ' posti su ' + righe.length + ' ne hanno avuta una';
    document.getElementById('notaforte').innerHTML =
      '«Pioggia forte» vuol dire almeno ' + FORTE + ' mm in un giorno solo: è quella che bagna '
      + 'davvero il terreno. ' + quanti + ' negli ultimi ' + GIORNI + ' giorni.';

    document.getElementById('attesa').style.display = 'none';
  }
}());
</script>
</body>
</html>`;
}

if (require.main === module) {
  let scritte = 0;
  for (const k of Object.keys(POSTI)) {
    const r = REGIONI.find(x => x.k === k);
    if (!r) { console.error(`⚠️ «${k}» non e' in genera-pagine-regione.js`); process.exit(1); }
    if (!GENITIVO[k]) { console.error(`⚠️ manca il genitivo di «${k}»`); process.exit(1); }
    const html = pagina(r, POSTI[k]);

    // ⚠️ SI CONTROLLA CHE LO SCRIPT DELLA PAGINA GIRI, prima di scriverla.
    // Il 2/9/2026 la Valle d'Aosta usciva con NOME = 'Valle d'Aosta': apostrofo
    // dritto dentro una stringa a virgolette singole, script morto, pagina
    // bianca ferma su «Sto leggendo i pluviometri». Un guscio che non gira e'
    // peggio di un guscio che manca, perche' sembra pubblicato. Un nome nuovo
    // con un apostrofo lo rifarebbe: adesso il generatore si ferma invece.
    const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
    try { new Function(html.slice(i + 8, j)); }
    catch (e) {
      console.error(`⚠️ ${k}: lo script della pagina non gira — ${e.message}`);
      process.exit(1);
    }

    const dir = path.join(RADICE, 'funghi', k);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    scritte++;
    console.log(`  /funghi/${k}/`.padEnd(26) + String(POSTI[k].length).padStart(4) + ' posti  ' +
      r.dirs.join('+'));
  }
  // La sitemap la scrivono tutt'e due i generatori: cosi' rigenerando solo
  // queste pagine non resta indietro. Elenca solo quello che esiste davvero in
  // questo repo, quindi in produzione le voci funghi non compariranno finche'
  // le pagine non ci sono.
  const voci = scriviSitemap(SITO, RADICE);
  console.log(`\n${scritte} pagine scritte, sitemap.xml con ${voci} indirizzi.`);
}
