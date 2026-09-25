#!/usr/bin/env node
/**
 * Genera le pagine di una SINGOLA LOCALITA': /funghi/<regione>/<posto>/.
 *
 * PERCHE' ESISTONO. Le pagine regione rispondono a «dove ha piovuto in
 * Liguria», le pagine funghi a «piogge per funghi in Liguria». Nessuna delle
 * due risponde a «quanto ha piovuto a Imperia», che e' il modo in cui la gente
 * cerca davvero: col nome del posto dove abita. Misurato il 2/9/2026: nei dati
 * ci sono 5.647 stazioni con un nome, e nel TESTO delle 44 pagine del sito ne
 * comparivano TRE, di cui due per omonimia. Il sito misurava il pluviometro di
 * Imperia e non nominava Imperia da nessuna parte.
 *
 * ⚠️ SOLO LA LIGURIA, per ora: l'elenco e' `LOCALITA` in `lib-nomi.js`, e il
 * perche' sta scritto li'. Aggiungere una chiave la' dentro e rilanciare basta.
 *
 * COME SONO FATTE. Gusci statici come le altre: il testo non cambia mai, i
 * numeri li scarica il browser. **UNA sola richiesta**,
 * `data/funghi/<regione>-giorni.json`, che porta la serie dei 25 giorni di
 * tutti i posti della regione E l'anagrafe (nomi gia' in tondo, sigla, quota,
 * coordinate, bosco, slug). Da li' la pagina si calcola le tre finestre,
 * l'ultima pioggia forte, la classifica e i vicini: **non puo' discordare dalla
 * pagina regione**, perche' sono gli stessi giorni con le stesse finestre.
 *
 * ⚠️ L'ANAGRAFE STA NEL FILE DEI DATI, non cotta dentro ogni pagina. Cotta
 * dentro pesava ~7 KB a pagina: 780 KB sulla sola Liguria, 6,6 MB se un giorno
 * si facessero tutte e 948. E soprattutto: cambiando un nome bisognerebbe
 * rigenerare centododici pagine, cioe' un deploy, invece di riscrivere un file
 * in `data/` che di deploy non ne fa partire nessuno.
 *
 * ⚠️ VA LANCIATO DOPO `genera-pagine-funghi.js`: il foglio di stile lo legge
 * dalla pagina funghi della regione, per non tenerne due copie che divergono.
 * Se quella pagina non c'e', si ferma e lo dice.
 *
 *   node .github/scripts/genera-pagine-funghi.js
 *   node .github/scripts/genera-pagine-localita.js
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
// ⚠️ `slug` si chiama qui `slugDaNome`: dentro pagina() c'e' gia' un parametro
// che si chiama slug ed e' una STRINGA. Importandola col suo nome la funzione
// veniva coperta e usciva «slug is not a function» solo a generazione avviata,
// non al controllo di sintassi.
const { LOCALITA, bello, slug: slugDaNome, slugRegione } = require('./lib-nomi.js');
const { perLink } = require('./lib-vicine.js');
const { rigaStagione } = require('./lib-stagione.js');
const { haBoschi, cartaBreve, cartaDi, fonteNota } = require('./lib-boschi.js');
// Il ritratto del pluviometro, cotto dentro la pagina il giorno che si
// genera: totale dell'archivio, giorni di pioggia, giorno piu' bagnato,
// mese piu' piovoso. Il perche' sta in cima a lib-clima.js.
const { clima, buono, periodo, dataBella, meseBello, migliaia, virgola } = require('./lib-clima.js');
// La zona a cui appartiene il posto, se ce n'e' una. Serve a non lasciare
// orfane le pagine di zona, e a chi legge serve per allargare lo sguardo dal
// singolo pluviometro alla valle. `dove` e' gia' scritto con la preposizione
// giusta («in Garfagnana», «nelle Langhe»): non si ricostruisce, si usa.
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const ZONA_DI = {};
for (const z of ZONE) for (const id of z.posti) ZONA_DI[id] = z;
const { scriviSitemap } = require('./genera-sitemap.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));

const SITO = 'https://avventurepluvio-test.netlify.app';
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime';

// Il genitivo della regione, per «gli altri posti DELLA Liguria».
const GENITIVO = {
  lombardia: 'della Lombardia', piemonte: 'del Piemonte', valledaosta: "della Valle d'Aosta",
  liguria: 'della Liguria', emilia: "dell'Emilia-Romagna", veneto: 'del Veneto',
  friuli: 'del Friuli', trentino: 'del Trentino', altoadige: "dell'Alto Adige",
  toscana: 'della Toscana', umbria: "dell'Umbria", marche: 'delle Marche',
  lazio: 'del Lazio', campania: 'della Campania', puglia: 'della Puglia',
  basilicata: 'della Basilicata', calabria: 'della Calabria', sicilia: 'della Sicilia',
  sardegna: 'della Sardegna',
};

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// La stessa distanza che la pagina calcola col suo `km()`, qui a build time.
function kmFra(la, lo, lb, lob) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLa = r(lb - la), dLo = r(lob - lo);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(la)) * Math.cos(r(lb)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// «al Passo del Turchino», «a Reppia», «all'Alpe di Vobbia»: la preposizione
// giusta si sceglie dall'articolo che il nome si porta dietro.
function aPosto(n) {
  if (/^(Passo|Colle|Monte|Bric|Rifugio|Lago|Piano|Ponte|Bosco|Forte|Poggio)\b/.test(n)) return 'al ' + n;
  if (/^(Alpe|Isola|Alta|Valle|Villa|Cima)\b/.test(n)) return "all'" + n;
  // «ad Anterselva», «ad Aulla»: davanti alla a si scrive ad (13/9/2026, il
  // titolo nuovo comincia proprio da qui e «a Anterselva» si leggeva male).
  if (/^A/.test(n)) return 'ad ' + n;
  return 'a ' + n;
}

// «in 8 giornate bagnate. Nelle altre 69 non e' caduto niente»: singolare,
// plurale, e il caso di chi in tutto l'archivio non ha mai passato il
// millimetro in un giorno (5 posti su 948 il 4/9/2026, tutti al sud).
function bagnate(c) {
  // ⚠️ Meno di un millimetro in tutto l'archivio: scrivere «ha contato 0 mm»
  // sembra un guasto della pagina, e non lo e'. Sono i pluviometri del sud
  // entrati in archivio a luglio, in una delle estati piu' secche.
  if (c.mm < 1) return 'non ha misurato nemmeno un millimetro di pioggia.';
  const asciutti = c.giorni - c.piovosi;
  const testa = `ha contato <b>${migliaia(c.mm)} mm</b> di pioggia`;
  if (!c.piovosi) return testa + ', senza nemmeno una giornata sopra il millimetro.';
  const quante = c.piovosi === 1 ? '<b>una sola giornata</b> bagnata' : `<b>${c.piovosi} giornate</b> bagnate`;
  const coda = !asciutti ? ''
    : asciutti === 1 ? " Nell'unico altro giorno non è caduto niente."
    : ` Nelle altre ${asciutti} non è caduto niente, o così poco da non contare.`;
  return `${testa} in ${quante}.${coda}`;
}

function pagina(r, posto, slug, sl) {
  const [ID, nomePosto, sigla, quota, lat, lon, bosco] = posto;
  const REG = r.k;
  const NOME = r.nomeTitolo || r.nome;
  const AGENZIA = r.agenzia;
  const CORTA = r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '');
  const GEN = GENITIVO[REG];
  const DOVE = aPosto(nomePosto);

  // ⚠️ IL SEGNAPOSTO NEL LINK (3/9/2026). pl = coordinate, pn = nome: la mappa
  // ci mette la puntina, scrive il nome nella casella di ricerca e lo fa
  // comparire in cima alla tendina. Senza, chi cliccava da una pagina di paese
  // si trovava la regione intera senza sapere dove guardare. La mappa lo legge
  // anche sui link corti (senza date) solo dal 3/9: prima serviva il periodo.
  const PIN = 'pl=' + lat + ',' + lon + '&amp;pn=' + encodeURIComponent(nomePosto);
  // ⚠️ NON la sola regione di casa: un pluviometro sul confine ha meta' dei
  // vicini dall'altra parte, e chi arriva vede mezza mappa vuota. Stesso
  // criterio della ricerca per localita' del sito, stessa griglia (lib-vicine).
  const REGS = perLink(REG, lat, lon);

  // ⚠️ I CINQUE VICINI SI CUOCIONO, non si disegnano col javascript. Fino al
  // 4/9/2026 la tabella nasceva a pagina aperta: nell'HTML servito non c'era
  // NESSUN link verso le pagine sorelle, e ogni localita' aveva un solo link in
  // entrata in tutto il sito, quello dell'elenco della sua regione. Google i
  // link nel javascript li segue, ma dopo, e pesano meno. I mm restano al
  // javascript: quelli cambiano ogni giorno, i vicini no.
  const VICINI5 = POSTI[REG]
    .map(p => ({ id: p[0], n: bello(p[1]), sig: p[2], q: p[3], slug: sl[p[0]],
                 d: kmFra(lat, lon, p[4], p[5]) }))
    .filter(x => x.id !== ID)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .concat([{ id: ID, n: nomePosto, sig: sigla, q: quota, slug, d: 0, io: true }])
    .sort((a, b) => a.d - b.d);

  // Il ritratto dell'archivio. `null` se il pluviometro ha misurato troppo poco:
  // la sezione allora non si scrive proprio, invece di scrivere un numero fragile.
  const C = clima(r.dirs)[ID];
  const RITRATTO = buono(C) ? C : null;
  // La classifica ha senso solo fra pluviometri con lo STESSO periodo alle
  // spalle: uno entrato in archivio a meta' avrebbe meno millimetri per un
  // motivo che con la pioggia non c'entra niente.
  let POSTO_IN_CLASSIFICA = 0, QUANTI_CONFRONTABILI = 0;
  if (RITRATTO) {
    const tuttiC = clima(r.dirs);
    const pari = POSTI[REG].map(p => tuttiC[p[0]])
      .filter(x => x && x.giorni >= RITRATTO.giorni * 0.9 && x.giorni <= RITRATTO.giorni * 1.1)
      .sort((a, b) => b.mm - a.mm);
    if (pari.length >= 10) {
      QUANTI_CONFRONTABILI = pari.length;
      POSTO_IN_CLASSIFICA = pari.indexOf(RITRATTO) + 1;
    }
  }

  // ⚠️ Limiti che Google taglia: titolo <= 62 caratteri, descrizione <= 158.
  // Il nome di un posto puo' essere lungo, quindi la coda del titolo si toglie
  // invece di lasciarlo mozzare a meta' parola.
  // ⚠️ 13/9/2026: CATEGORIA FUNGHI. La domanda e' «funghi a Torriglia oggi»:
  // «oggi» nel titolo si', tutto l'anno, e a gennaio ci tutela la riga di
  // stagione sotto il titolo (lib-stagione.js). Per la pioggia e basta c'e' la
  // pagina piogge della zona, e il riquadro qui sotto ci manda.
  // ⚠️ 24/9/2026: «stanno nascendo?» in coda, deciso da lui. Davanti resta
  // «Funghi <posto> oggi», la forma delle ricerche vere (Search Console).
  const TITOLO = [
    `Funghi ${DOVE} oggi: stanno nascendo?`,
    `Funghi ${DOVE} oggi`,
  ].find(t => t.length <= 62) || `Funghi ${DOVE}`;
  const DESCR = [
    `Stanno nascendo funghi ${DOVE}? Le piogge degli ultimi 25 giorni, giorno per giorno, dal pluviometro di ${CORTA} a ${quota} metri. Aggiornato ogni mattina.`,
    `Stanno nascendo funghi ${DOVE}? Le piogge degli ultimi 25 giorni, giorno per giorno, misurate dal pluviometro. Aggiornato ogni mattina.`,
  ].find(t => t.length <= 158) || `Funghi ${DOVE} oggi: le piogge degli ultimi 25 giorni.`;
  const ZONA = ZONA_DI[ID];
  const PIOGGE_URL = ZONA ? `${SITO}/zone/${slugDaNome(ZONA.n)}/` : `${SITO}/${REG}/`;
  const PIOGGE_DOVE = ZONA ? ZONA.dove : `${r.prep} ${r.nomeTitolo || r.nome}`;

  // Il foglio di stile viene dalla pagina funghi della regione: una copia sola.
  const modello = path.join(RADICE, 'funghi', REG, 'index.html');
  if (!fs.existsSync(modello)) {
    console.error(`⚠️ manca ${modello}: lancia prima genera-pagine-funghi.js`);
    process.exit(1);
  }
  const m = fs.readFileSync(modello, 'utf8');
  const STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/funghi/${REG}/${slug}/">
<meta property="og:title" content="Funghi ${esc(DOVE)} oggi: stanno nascendo?">
<meta property="og:description" content="Le piogge degli ultimi 25 giorni, misurate dal pluviometro, giorno per giorno.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/funghi/${REG}/${slug}/">
<meta property="og:type" content="website">
${briciolaJson([
  ['Piogge per funghi', SITO + '/funghi/'],
  [NOME, SITO + '/funghi/' + REG + '/'],
  [bello(nomePosto), null],
])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
if(/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname))gtag('config','${GA_ID}');
</script>
<style>
${STILE}
/* ── il grafico giorno per giorno ─────────────────────────────────────── */
.gg{display:flex;align-items:flex-end;gap:3px;height:150px;margin:14px 0 4px;}
.gg .b{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative;}
.gg .b i{display:block;background:#b9cbe2;border-radius:3px 3px 0 0;min-height:2px;}
.gg .b.dentro i{background:var(--blu);}
.gg .b b{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:10.5px;
  font-weight:700;color:var(--blu-scuro);white-space:nowrap;}
.gg-x{display:flex;gap:3px;font-size:10.5px;color:#6b7a8d;}
.gg-x span{flex:1;text-align:center;}
.gg-leg{font-size:13.5px;color:#555;margin-top:8px;}
.gg-int{font-size:14.5px;color:#333;margin:8px 0 0;}
.gg-int:empty{display:none;}
.gg-int b{color:var(--blu-scuro);}
.gg-invito{display:block;font-size:13px;color:#6b7a8d;margin-top:2px;}
.gg .b{cursor:pointer;}
.gg .b.scelto i{box-shadow:0 0 0 2px #f0a000;}
.gg-leg i{display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:-1px;margin-right:4px;}
/* ⚠️ LA SCALA STA FUORI DALL'SVG: il disegno e' stirato in larghezza
   (preserveAspectRatio="none") e un testo dentro uscirebbe schiacciato. */
.tt-box{position:relative;padding-right:42px;margin:14px 0 2px;}
.tt{width:100%;height:150px;display:block;overflow:visible;}
.tt .griglia{stroke:#e6eaf0;stroke-width:1;vector-effect:non-scaling-stroke;}
.tt polyline{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round;
  vector-effect:non-scaling-stroke;}
.tt .max{stroke:#d1603d;}
.tt .min{stroke:#3a6ea8;}
.tt .vento{stroke:#ffd54f;}
.tt-y{position:absolute;top:0;right:0;width:42px;height:150px;pointer-events:none;}
.tt-y span{position:absolute;right:0;transform:translateY(-50%);font-size:11px;
  color:#6b7a8d;line-height:1;padding-left:5px;}
.tt-y .tt-u{position:absolute;top:auto;bottom:-19px;right:0;transform:none;
  font-size:11px;color:#8a97a6;}
.tt-x{padding-right:42px;}
.vic td:last-child,.vic th:last-child{text-align:right;}
.vic .qui{background:#eef4fd;}
.vic .qui b{color:var(--blu-scuro);}
nav.altre .io{font-weight:700;color:var(--blu-scuro);}
/* ── 24/9/2026: prima i dati, poi le spiegazioni ───────────────────────── */
.verdetto{background:#0f2d4d;color:#fff;border-radius:12px;padding:18px 18px 16px;margin:14px 0 8px;}
.verdetto .si{font-size:27px;font-weight:800;line-height:1.2;}
.verdetto .pallino{display:inline-block;width:15px;height:15px;border-radius:50%;margin-right:9px;vertical-align:2px;}
.verdetto .gr{font-size:44px;font-weight:800;line-height:1.1;margin-top:10px;}
.verdetto .gr small{font-size:18px;font-weight:600;opacity:.85;margin-left:6px;}
.verdetto .dett{font-size:16px;opacity:.9;margin-top:6px;}
.scala{display:flex;gap:4px;margin-top:14px;}
.scala div{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.18);}
.scala-t{display:flex;font-size:11.5px;opacity:.75;margin-top:4px;}
.scala-t span{flex:1;text-align:center;}
.breve{font-size:16px;color:#333;margin:6px 0 4px;}
.fin{display:flex;gap:6px;align-items:flex-end;height:170px;margin:16px 0 4px;}
.fin .c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;text-align:center;}
.fin .c i{display:block;background:var(--blu);border-radius:4px 4px 0 0;min-height:3px;}
.fin .c b{font-size:13px;color:var(--blu-scuro);margin-bottom:3px;}
.fin-x{display:flex;gap:6px;font-size:12px;color:#6b7a8d;}
.fin-x span{flex:1;text-align:center;line-height:1.25;}
.int{margin-top:12px;border:1px solid var(--bordo);border-radius:9px;overflow:hidden;}
.int div{padding:9px 13px;border-bottom:1px solid var(--bordo);font-size:15.5px;display:flex;gap:10px;align-items:baseline;}
.int div:last-child{border-bottom:0;}
.int .d{min-width:62px;color:#5a6b80;font-size:14px;}
.int .tag{margin-left:auto;font-size:12.5px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;}
.t-lenta{background:#e3f1e4;color:#2e7d32;} .t-media{background:#fff3d6;color:#8a6100;} .t-forte{background:#fde3df;color:#a33222;}
.img-mappa{width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);margin-top:10px;}
.tasti{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;}
.tasti a{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:14.5px;color:var(--blu-scuro);
  padding:11px 6px;border:1px solid #b9c7da;border-radius:9px;background:linear-gradient(180deg,#fff,#eef3fa);}
.tasti a.forte{background:var(--blu);color:#fff;border-color:var(--blu);}
@media(max-width:640px){.verdetto .gr{font-size:38px;} .tasti{grid-template-columns:repeat(2,1fr);}}
.noioso{margin-top:34px;padding-top:6px;border-top:1px solid var(--bordo);color:#555;font-size:15px;}
.noioso h2{font-size:17px;color:#445;margin:20px 0 6px;}
.noioso p{margin-bottom:8px;}
.noioso a{color:var(--blu);}
</style>
</head>
<body>

<header>
  <a href="${SITO}/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>
  <a class="yt" href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'localita-${REG}'})}catch(e){}">▶ <span class="yt-l">Canale </span>YouTube</a>
</header>

<main>
<p class="nota" style="margin-bottom:6px"><a href="${SITO}/funghi/" style="color:var(--blu)">‹ Piogge per funghi</a> <span style="color:#9aa7b8">›</span> <a href="${SITO}/funghi/${REG}/" style="color:var(--blu)">${esc(NOME)}</a></p>

${/* ⚠️ 24/9/2026, SCHEMA DETTATO DA LUI: prima i dati (ha piovuto abbastanza?
     le barre, la pioggia che conta, le mappe), poi in fondo le spiegazioni.
     Il titolo tiene davanti «Funghi <posto> oggi», che e' la forma che la
     gente cerca davvero (Search Console, 90 giorni), e aggiunge la domanda. */''}
<h1>Funghi ${esc(DOVE)} oggi: stanno nascendo?</h1>
${rigaStagione()}

<div id="attesa">Sto leggendo il pluviometro…</div>
<div id="guasto"></div>
<div id="verdetto"></div>

<h2>Le piogge degli ultimi 25 giorni</h2>
<div id="grafico"></div>
<p class="nota" id="ieri"></p>

<h2 id="h-conta">Però attenzione: la pioggia che conta è quella caduta da 13 a 20 giorni fa</h2>
<p class="breve" id="p-conta">Il fungo spunta 12-13 giorni dopo una bella pioggia: i funghi di oggi nascono da queste otto giornate.</p>
<div id="finestra"></div>
<div id="intensita"></div>

<h2>Com'è andata intorno? Apri le mappe</h2>
<div class="tasti" id="tasti">
  <a class="forte" id="t-conta" href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN}">13-20 gg fa</a>
  <a href="${SITO}/?r=${REGS}&amp;g=1&amp;${PIN}">Ieri</a>
  <a href="${SITO}/?r=${REGS}&amp;g=7&amp;${PIN}">Ultimi 7 gg</a>
  <a href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN}">Ultimi 20 gg</a>
  <a href="${SITO}/?r=${REGS}&amp;g=30&amp;${PIN}">Ultimi 30 gg</a>
  <a href="${SITO}/?r=${REG}&amp;${PIN}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'localita-${REG}-radar'})}catch(e){}">📡 Radar adesso</a>
</div>
<p class="breve">La pioggia degli ultimi 20 giorni ${r.prep} ${esc(NOME)}, stazione per stazione.</p>
<a href="${SITO}/?r=${REG}&amp;g=20" id="lnk-pioggia"
   onclick="try{gtag('event','apri_mappa',{da:'localita-${REG}-20gg'})}catch(e){}">
  <img class="img-mappa" src="${ANTEPRIME}/${REG}.jpg"
       alt="La mappa delle piogge ${r.prep} ${esc(NOME)}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"></a>

<h2 style="font-size:18px">I pluviometri più vicini</h2>
<table class="vic"><thead><tr><th>Località</th><th>Distanza</th><th>13-20 gg fa</th></tr></thead>
<tbody id="vicini">
${VICINI5.map(v => `<tr${v.io ? ' class="qui"' : ''} data-id="${esc(v.id)}"><td>${v.io
  ? `<b>${esc(v.n)}</b> <span class="com">(sei qui)</span>`
  : `<a class="loc" href="${SITO}/funghi/${REG}/${v.slug}/"><b>${esc(v.n)}</b></a>`
}<span class="com">${esc(v.sig)} · ${v.q} m</span></td>
<td>${v.io ? '—' : virgola(v.d) + ' km'}</td>
<td class="mm"><span class="v">…</span></td></tr>`).join('\n')}
</tbody></table>

<h2 style="font-size:18px">Dove è piovuto di più ${esc(GEN)}</h2>
<div id="migliori"></div>
<p class="nota" id="notavicini"></p>

<div id="meteo"></div>

${haBoschi(REG) ? `<h2>Che boschi ci sono intorno</h2>
<p class="breve">Faggete, castagneti, querceti e abetaie colorati per tipo, con il rilievo sotto.</p>
<a href="${SITO}/?r=${REG}&amp;${PIN}&amp;boschi=1" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'localita-${REG}-boschi'})}catch(e){}">
  <img class="img-mappa" src="${SITO}/tessere-boschi/anteprime/${REG}.jpg"
       alt="La mappa boschi ${r.prep} ${esc(NOME)}: faggete, castagneti, querceti e abetaie colorati per tipo"
       width="1600" height="1000" loading="lazy">
  <span class="vai-mappa">🌲 Guarda i boschi intorno ${esc(DOVE)}</span>
</a>
<p class="nota">La pioggia dice quando andare, il bosco dice dove. I boschi vengono da ${esc(fonteNota(REG))}.</p>
` : ''}
<div class="noioso">
<h2>Come funziona questa pagina</h2>
<p>I millimetri li misura il pluviometro di ${esc(AGENZIA)} ${esc(DOVE)}: ${esc(sigla)}, ${quota} metri,
con il ${bosco}% di bosco entro 3 km. Sono misure a terra, giorno per giorno, aggiornate ogni mattina.
La giornata di oggi non è contata perché il pluviometro la sta ancora misurando.</p>
<p>Perché da 13 a 20 giorni fa: dopo una pioggia il fungo impiega almeno dodici o tredici giorni
a spuntare, di più se fa freddo. La pioggia di ieri serve ai funghi fra due settimane.</p>
<p>Ti serve un altro periodo? Per ieri e gli ultimi 30 giorni c’è
<a href="${PIOGGE_URL}">dove ha piovuto ${esc(PIOGGE_DOVE)}</a>.${ZONA ? ` Questo pluviometro sta
${esc(ZONA.dove)}: <a href="${SITO}/funghi/zone/${slugDaNome(ZONA.n)}/">guarda tutta la zona</a>,
con i suoi ${ZONA.posti.length} pluviometri insieme.` : ''}</p>
${RITRATTO ? `<h2>L'archivio di questo pluviometro</h2>
<p><b>${periodo(RITRATTO)}</b>, in ${RITRATTO.giorni} giorni di misura, ${bagnate(RITRATTO)}
Il giorno più bagnato è stato il <b>${dataBella(RITRATTO.maxData)}</b>, con
<b>${virgola(RITRATTO.maxMm)} mm</b>.${RITRATTO.mese && RITRATTO.meseMm >= 1 ? ` Il mese più piovoso,
fra quelli che abbiamo per intero, è <b>${meseBello(RITRATTO.mese)}</b> con
${migliaia(RITRATTO.meseMm)} mm.` : ''}${POSTO_IN_CLASSIFICA ? ` Su ${QUANTI_CONFRONTABILI} pluviometri
da bosco ${esc(GEN)} con lo stesso periodo alle spalle, questo è il <b>${POSTO_IN_CLASSIFICA}º</b>
per acqua caduta.` : ''}</p>` : ''}
<p><b>Ricordati</b> che in molte regioni per raccogliere funghi serve il tesserino, e che nei parchi
valgono regole proprie.</p>
<p>Dati di ${esc(AGENZIA)} via il nostro archivio. Il bosco entro 3 km è calcolato su dati
OpenStreetMap, licenza ODbL. La provincia viene dai confini provinciali ISTAT.</p>
</div>
<p style="margin:22px 0 4px;"><a href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener" style="color:#e12b2b;font-weight:600;display:inline-flex;align-items:center;gap:7px;text-decoration:none;"
   onclick="try{gtag('event','click_youtube',{pulsante:'localita-fondo-${REG}'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a></p>

<h2 style="margin-top:30px">Quanto ha piovuto? Trova un'altra località</h2>
<nav class="altre" id="altri"><p class="nota">Sto leggendo l'elenco…</p></nav>
</main>

<footer>
  <a href="${SITO}/">Mappa delle piogge</a> ·
  <a href="${SITO}/${REG}/">Dove ha piovuto ${r.prep} ${esc(NOME)}</a> ·
  <a href="${SITO}/funghi/${REG}/">Piogge per funghi ${r.prep} ${esc(NOME)}</a> ·
  <a href="${SITO}/fonti.html">tutte le fonti e licenze</a><br>
  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.
</footer>

<script>
(function(){
  var REG = ${JSON.stringify(REG)}, ID = ${JSON.stringify(ID)}, NOME = ${JSON.stringify(NOME)};
  var REGS = ${JSON.stringify(REGS)}, POSTO = ${JSON.stringify(nomePosto)};
  var LAT = ${lat}, LON = ${lon};
  var SITO = ${JSON.stringify(SITO)}, MAPPA = SITO + '/';
  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var BASE = LOCALE ? '/data/'
    : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var GIORNI = 25;

  var MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  var GS=['dom','lun','mar','mer','gio','ven','sab'];
  function iso(d){ var p=function(n){return String(n).padStart(2,'0');};
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function menoDa(s, n){ var p=String(s).split('-');
    var d=new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()-n); return d; }
  function gg(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  /* «dal 4 all'11 settembre»: il mese una volta sola se e' lo stesso, e
     l'apostrofo davanti a 1, 8 e 11 (24/9/2026). */
  function dalAl(a,b){ var pa=a.split('-'), pb=b.split('-'), da=+pa[2], db=+pb[2];
    var al=(db===1||db===8||db===11) ? 'all\\u2019' : 'al ';
    return ((da===1||da===8||da===11) ? 'dall\\u2019' : 'dal ') + (pa[1]===pb[1] ? da : gg(a)) + ' ' + al + gg(b); }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function uno(n){ return Math.round(n*10)/10; }
  function num(n){ return uno(n).toFixed(1).replace('.', ','); }
  function km(a,b,c,d){ var R=6371, x=(c-a)*Math.PI/180, y=(d-b)*Math.PI/180;
    var s=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)*Math.sin(y/2);
    return R*2*Math.atan2(Math.sqrt(s), Math.sqrt(1-s)); }
  /* Un giro saltato si perdona, due no: si guarda «generato».
     ⚠️ Niente apici inversi da qui in giu': la pagina e' un template literal
     del generatore, e uno solo la spezzerebbe in due. */
  function fresco(j){
    if (!j || !j.generato || !j.serie || !j.anagrafe || !j.oggi) return false;
    var eta = Date.now() - new Date(j.generato).getTime();
    return eta >= 0 && eta < 36*3600*1000;
  }
  /* serie[0] e' IERI; n va dal piu' lontano al piu' vicino. */
  function somma(s, da, a){ var t=0; for (var n=da; n>=a; n--) t += (s[n-1]||0); return uno(t); }

  /* ⚠️ LA SCALA DEL VERDETTO E' SUA (24/9/2026): la pioggia degli ULTIMI 20
     GIORNI. Sotto 30 mm troppo poco, da 30 poco, da 60 bene, da 100 benissimo.
     Il riquadro dice com'e' andata la pioggia, non se ci sono i funghi. */
  var LIV=[{fino:30,t:'Troppo poca pioggia',c:'#c0392b'},
           {fino:60,t:'Poca pioggia',c:'#e6a100'},
           {fino:100,t:'Ha piovuto bene',c:'#5bb85d'},
           {fino:1e9,t:'Ha piovuto benissimo',c:'#2e9d44'}];

  fetch(BASE + 'funghi/' + REG + '-giorni.json')
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; })
    .then(function(j){
      if (j && fresco(j) && j.serie[ID]) { disegna(j); return; }
      guasto();
    })
    .catch(function(){ guasto(); });

  function guasto(){
    document.getElementById('attesa').style.display='none';
    var g=document.getElementById('guasto');
    g.style.display='block';
    g.innerHTML='⚠️ Non riesco a leggere l’archivio delle piogge in questo momento. Non dipende '
      + 'da te: riprova fra qualche minuto, oppure vai direttamente '
      + '<a href="'+MAPPA+'?r='+REGS+'">sulla mappa</a>.';
    document.getElementById('altri').innerHTML =
      '<p class="nota"><a href="'+SITO+'/funghi/'+REG+'/">Vedi tutti i posti da bosco</a></p>';
  }

  function link(dal, al){
    return MAPPA + '?r=' + REGS + '&da=' + dal + '&a=' + al
      + '&pl=' + LAT.toFixed(4) + ',' + LON.toFixed(4) + '&pn=' + encodeURIComponent(POSTO)
      + '&z=11&c=' + LAT.toFixed(4) + ',' + LON.toFixed(4);
  }

  function disegna(j){
    document.getElementById('attesa').style.display = 'none';
    var s = j.serie[ID];
    var mm = somma(s,20,13), m20 = somma(s,20,1);
    var daG = iso(menoDa(j.oggi,20)), aG = iso(menoDa(j.oggi,13)), ieri = iso(menoDa(j.oggi,1));

    /* IERI, per chi cerca «quanto ha piovuto ieri a». Si dice il giorno vero:
       il file puo' essere stato scritto prima di mezzanotte. */
    var ieriVero = iso(menoDa(iso(new Date()),1));
    document.getElementById('ieri').innerHTML = (ieri === ieriVero ? 'Ieri, ' : 'Il ')
      + gg(ieri) + ': ' + (s[0] == null ? 'il dato non è ancora arrivato.' : '<b>' + num(s[0]) + ' mm</b>.');

    /* ── il verdetto ── */
    var liv = LIV.filter(function(l){ return m20 < l.fino; })[0], k = LIV.indexOf(liv);
    var big = [];
    for (var n=20; n>=1; n--) if ((s[n-1]||0) >= 10) big.push(n);
    var dett = big.length
      ? big.slice(-4).map(function(n){ return '<b>' + num(s[n-1]) + ' mm</b> il ' + gg(iso(menoDa(j.oggi,n))); }).join(', ') + '.'
      : 'Nessuna giornata sopra i 10 mm.';
    var scala = '';
    for (var q=0; q<4; q++) scala += '<div' + (q<=k ? ' style="background:'+liv.c+'"' : '') + '></div>';
    document.getElementById('verdetto').innerHTML = '<div class="verdetto">'
      + '<div class="si"><span class="pallino" style="background:'+liv.c+'"></span>'+liv.t+'</div>'
      + '<div class="gr">'+Math.round(m20)+' mm<small>negli ultimi 20 giorni</small></div>'
      + '<div class="dett">'+dett+'</div>'
      + '<div class="scala">'+scala+'</div>'
      + '<div class="scala-t"><span>sotto 30</span><span>30-60</span><span>60-100</span><span>oltre 100</span></div>'
      + '<div class="capo-btns"><a class="capo-btn" href="'+link(daG, ieri)+'">Vedi sulla mappa</a></div></div>';

    /* ── le 25 barre, ieri a destra ── */
    var max = Math.max.apply(null, s.concat([1]));
    var barre = '', ascisse = '', ultimaEt = null;
    for (var i = GIORNI; i >= 1; i--) {
      var v = s[i-1] || 0, d = menoDa(j.oggi, i);
      var cl = (i>=13 && i<=20) ? ' dentro' : '';
      /* il numero sopra la barra solo se e' alta e lontana dall'ultima scritta:
         a 375 px due etichette vicine si sovrappongono */
      var etich = v >= max*0.2 && (ultimaEt === null || ultimaEt - i >= 2);
      if (etich) ultimaEt = i;
      barre += '<div class="b' + cl + '" data-n="' + i + '" title="' + gg(iso(d)) + ': ' + num(v) + ' mm">'
        + (etich ? '<b>' + num(v) + '</b>' : '')
        + '<i style="height:' + Math.max(2, Math.round(v/max*100)) + '%"></i></div>';
      ascisse += '<span>' + ((i===GIORNI || i===1 || i%5===0) ? (d.getDate()+'/'+(d.getMonth()+1)) : '') + '</span>';
    }
    document.getElementById('grafico').innerHTML =
      '<div class="gg">' + barre + '</div><div class="gg-x">' + ascisse + '</div>'
      + '<p class="gg-int" id="ggint"></p>'
      + '<p class="gg-leg"><i style="background:var(--blu)"></i>da 13 a 20 giorni fa &nbsp; '
      + '<i style="background:#b9cbe2"></i>gli altri giorni</p>';

    /* durata e punta del giorno toccato (serieI: solo i giorni da 5 mm in su) */
    var sI = (j.serieI && j.serieI[ID]) || null;
    function rigaInt(n) {
      var el = document.getElementById('ggint');
      if (!el || !sI) return;
      var v = s[n-1] || 0, o = sI[n-1];
      [].forEach.call(document.querySelectorAll('#grafico .b.scelto'), function (b) { b.classList.remove('scelto'); });
      var b = document.querySelector('#grafico .b[data-n="' + n + '"]');
      if (b) b.classList.add('scelto');
      var t = '<b>' + gg(iso(menoDa(j.oggi, n))) + '</b> · ' + num(v) + ' mm';
      if (o) t += ' in <b>' + o[0] + (o[0] === 1 ? ' ora' : ' ore') + '</b> · punta <b>' + num(o[1]) + ' mm</b> in un’ora';
      var dito = !(window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches);
      el.innerHTML = t + '<span class="gg-invito">' + (dito ? 'Tocca' : 'Clicca')
        + ' una barra per vedere durata e punta di un altro giorno.</span>';
    }
    if (sI) {
      var nMax = null;
      for (var k2 in sI) { var n2 = +k2 + 1; if (nMax === null || (s[n2-1] || 0) > (s[nMax-1] || 0)) nMax = n2; }
      if (nMax) rigaInt(nMax);
      document.getElementById('grafico').addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('.b[data-n]');
        if (b) rigaInt(+b.getAttribute('data-n'));
      });
    }

    /* ── la pioggia che conta: le 8 giornate, larghe ── */
    document.getElementById('h-conta').textContent = 'Però attenzione: la pioggia che conta è quella caduta ' + dalAl(daG, aG);
    document.getElementById('p-conta').innerHTML = 'Il fungo spunta 12-13 giorni dopo una bella pioggia: '
      + 'i funghi di oggi nascono da queste otto giornate, che qui hanno fatto <b>' + num(mm) + ' mm</b>.';
    var fmax = 1;
    for (var n3=20; n3>=13; n3--) fmax = Math.max(fmax, s[n3-1]||0);
    var fb = '', fx = '', righe = '';
    for (var n4=20; n4>=13; n4--) {
      var v4 = s[n4-1] || 0, d4 = menoDa(j.oggi, n4);
      fb += '<div class="c">' + (v4 > 0 ? '<b>' + num(v4) + '</b>' : '')
        + '<i style="height:' + Math.max(2, Math.round(v4/fmax*88)) + '%"></i></div>';
      fx += '<span>' + GS[d4.getDay()] + '<br>' + d4.getDate() + '/' + (d4.getMonth()+1) + '</span>';
      /* come e' caduta: lenta sotto 2 mm all'ora, battente sopra 6 (scala
         del 12/9). Si arrotonda PRIMA di giudicare, se no numero e parola
         si contraddicono sulla soglia. */
      var o4 = sI && sI[n4-1];
      if (o4 && v4 >= 5) {
        var r4 = uno(v4 / o4[0]);
        var tg = r4 < 2 ? ['lenta','t-lenta'] : r4 <= 6 ? ['media','t-media'] : ['battente','t-forte'];
        righe += '<div><span class="d">' + gg(iso(d4)) + '</span><span><b>' + num(v4) + ' mm</b> in '
          + o4[0] + (o4[0] === 1 ? ' ora' : ' ore') + ', punta ' + num(o4[1]) + ' mm in un’ora</span>'
          + '<span class="tag ' + tg[1] + '">' + tg[0] + '</span></div>';
      }
    }
    document.getElementById('finestra').innerHTML = '<div class="fin">' + fb + '</div><div class="fin-x">' + fx + '</div>';
    if (righe) document.getElementById('intensita').innerHTML =
      '<h2 style="font-size:18px">Com’è caduta</h2><p class="breve">La pioggia lenta entra nel terreno, quella battente corre via.</p>'
      + '<div class="int">' + righe + '</div>';
    document.getElementById('t-conta').href = link(daG, aG);
    document.getElementById('lnk-pioggia').href = link(daG, ieri);

    /* ── vicini e posti piu' bagnati ──
       L'anagrafe arriva dal file: [id, nome, sigla, quota, lat, lon, bosco%, slug] */
    var tutti = j.anagrafe.map(function(p){
      var ss = j.serie[p[0]];
      return ss ? { id:p[0], n:p[1], sig:p[2], q:p[3], slug:p[7], mm:somma(ss,20,13), d:km(LAT, LON, p[4], p[5]) } : null;
    }).filter(Boolean);
    function pag(x){ return SITO + '/funghi/' + REG + '/' + x.slug + '/'; }
    var perId = {};
    for (var iv = 0; iv < tutti.length; iv++) perId[tutti[iv].id] = tutti[iv];

    /* ⚠️ La tabella dei vicini e' GIA' NELL'HTML coi link: qui si riempiono
       solo le caselle dei millimetri. Rifarla con innerHTML toglierebbe i link
       dalla pagina che Google ha in mano dopo il rendering. */
    var trs = document.querySelectorAll('#vicini tr[data-id]'), mxv = 1;
    for (var it = 0; it < trs.length; it++) { var dv = perId[trs[it].getAttribute('data-id')]; if (dv) mxv = Math.max(mxv, dv.mm); }
    for (var it2 = 0; it2 < trs.length; it2++) {
      var dd = perId[trs[it2].getAttribute('data-id')];
      var cel = trs[it2].querySelector('.mm .v');
      if (!cel) continue;
      if (!dd || !(dd.mm > 0)) { cel.textContent = '—'; cel.className = 'v zero'; continue; }
      cel.textContent = num(dd.mm) + ' mm'; cel.className = 'v';
      var ba = document.createElement('span'); ba.className = 'barra';
      ba.style.width = Math.round(dd.mm / mxv * 100) + '%';
      cel.parentNode.insertBefore(ba, cel);
    }

    var ordinati = tutti.slice().sort(function(a,b){ return b.mm - a.mm; });
    var pos = ordinati.findIndex(function(x){ return x.id === ID; }) + 1;
    var primi = ordinati.slice(0, 6), mxp = Math.max(1, primi.length ? primi[0].mm : 1);
    document.getElementById('migliori').innerHTML = '<table class="vic"><thead><tr><th>Località</th><th>Distanza</th><th>13-20 gg fa</th></tr></thead><tbody>'
      + primi.map(function(x){
          var qui = x.id === ID;
          return '<tr' + (qui ? ' class="qui"' : '') + '><td>' + (qui ? '<b>' + esc(x.n) + '</b> <span class="com">(sei qui)</span>'
              : '<a class="loc" href="' + pag(x) + '"><b>' + esc(x.n) + '</b></a>')
            + '<span class="com">' + esc(x.sig) + ' · ' + x.q + ' m</span></td>'
            + '<td>' + (qui ? '—' : num(x.d) + ' km') + '</td>'
            + '<td class="mm"><span class="barra" style="width:' + Math.round(x.mm / mxp * 100) + '%"></span>'
            + '<span class="v">' + num(x.mm) + ' mm</span></td></tr>';
        }).join('') + '</tbody></table>';
    document.getElementById('notavicini').innerHTML =
      'Questo pluviometro è <b>' + pos + 'º su ' + tutti.length + '</b> fra i posti da bosco della regione. '
      + '<a href="' + SITO + '/funghi/' + REG + '/">Vedi i primi 15</a>.';

    /* ── temperatura e vento, se il pluviometro ce li ha ──
       ⚠️ Si mostra SOLO quello che c'e' davvero. */
    var sT = (j.serieT && j.serieT[ID]) || null, sW = (j.serieW && j.serieW[ID]) || null;
    function scalaT(lo, hi) {
      var passi = [1, 2, 2.5, 5, 10, 20, 25, 50, 100], dd2 = hi - lo, p = passi[passi.length - 1];
      for (var q2 = 0; q2 < passi.length; q2++) if (dd2 / passi[q2] <= 5) { p = passi[q2]; break; }
      var out = [], vv = Math.ceil(lo / p) * p;
      for (; vv <= hi + 1e-9; vv += p) out.push(Math.round(vv * 100) / 100);
      return out;
    }
    function grafico(serie, cls, colori, lo, hi, unita) {
      var passo = 100 / (GIORNI - 1);
      var y = function (v) { return 100 - (v - lo) / (hi - lo) * 100; };
      var linea = function (leggi) {
        var pezzi = [], cur = [];
        for (var q3 = GIORNI; q3 >= 1; q3--) {
          var x = (GIORNI - q3) * passo, v = leggi(serie[q3 - 1]);
          if (v == null) { if (cur.length > 1) pezzi.push(cur.join(' ')); cur = []; }
          else cur.push(x.toFixed(1) + ',' + y(v).toFixed(1));
        }
        if (cur.length > 1) pezzi.push(cur.join(' '));
        return pezzi;
      };
      var tacche = scalaT(lo, hi), svg = '', et = '';
      for (var g2 = 0; g2 < tacche.length; g2++) {
        var yy = y(tacche[g2]);
        svg += '<line class="griglia" x1="0" y1="' + yy.toFixed(1) + '" x2="100" y2="' + yy.toFixed(1) + '"/>';
        et += '<span style="top:' + yy.toFixed(1) + '%">' + ((tacche[g2] % 1 === 0) ? String(tacche[g2]) : num(tacche[g2])) + '</span>';
      }
      for (var k3 = 0; k3 < colori.length; k3++) {
        var pz = linea(colori[k3].leggi);
        for (var z = 0; z < pz.length; z++) svg += '<polyline class="' + colori[k3].cl + '" points="' + pz[z] + '"/>';
      }
      return '<div class="tt-box"><svg class="tt ' + cls + '" viewBox="0 0 100 100" preserveAspectRatio="none">'
        + svg + '</svg><div class="tt-y">' + et + '<span class="tt-u">' + unita + '</span></div></div>'
        + '<div class="gg-x tt-x">' + ascisse + '</div>';
    }
    if (sT || sW) {
      var che = (sT && sW) ? 'Temperatura e vento' : (sT ? 'Temperatura' : 'Vento');
      var H = '<h2>' + che + ' degli ultimi 25 giorni</h2>';
      if (sT) {
        var vals = [];
        for (var q4 = 0; q4 < GIORNI; q4++) if (sT[q4]) { vals.push(sT[q4][0]); vals.push(sT[q4][1]); }
        var lo = Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals) + 1);
        H += (sT[0] ? '<p class="breve">Ieri minima <b>' + num(sT[0][0]) + '°</b>, massima <b>' + num(sT[0][1]) + '°</b>.</p>' : '')
          + grafico(sT, 'tt-temp', [
              { cl: 'min', leggi: function (d) { return d ? d[0] : null; } },
              { cl: 'max', leggi: function (d) { return d ? d[1] : null; } }], lo, hi, '&deg;C')
          + '<p class="gg-leg"><i style="background:#d1603d"></i>massima &nbsp;'
          + '<i style="background:#3a6ea8"></i>minima</p>';
      }
      if (sW) {
        var vw = sW.filter(function (v) { return v != null; });
        var hiW = Math.ceil(Math.max.apply(null, vw.concat([1])) * 1.1);
        H += (sT ? '<h3 style="font-size:16px;margin:24px 0 0">Vento medio</h3>' : '')
          + grafico(sW, 'tt-vento', [{ cl: 'vento', leggi: function (d) { return d == null ? null : d; } }], 0, hiW, 'km/h')
          + '<p class="gg-leg">media del giorno, massimo del periodo ' + num(Math.max.apply(null, vw)) + ' km/h</p>';
      }
      document.getElementById('meteo').innerHTML = H;
    }

    /* ⚠️ L'elenco delle sorelle si disegna DAL FILE: un posto nuovo compare
       in tutte senza rigenerarne nessuna. Ordinato per nome. */
    document.getElementById('altri').innerHTML =
      '<p>' + tutti.slice().sort(function(a,b){ return a.n.localeCompare(b.n,'it'); })
        .map(function(x){
          return x.id === ID ? '<span class="io">' + esc(x.n) + '</span>'
            : '<a href="' + pag(x) + '">' + esc(x.n) + '</a>';
        }).join(' · ') + '</p>';
  }
}());
</script>
</body>
</html>
`;
}

if (require.main === module) {
  let scritte = 0;
  for (const k of LOCALITA) {
    const r = REGIONI.find(x => x.k === k);
    if (!r) { console.error(`⚠️ «${k}» non e' in genera-pagine-regione.js`); process.exit(1); }
    if (!POSTI[k]) { console.error(`⚠️ «${k}» non e' in funghi-posti.json`); process.exit(1); }
    if (!GENITIVO[k]) { console.error(`⚠️ manca il genitivo di «${k}»`); process.exit(1); }

    const sl = slugRegione(POSTI[k], m => console.log(`  ⚠️ ${m}`));
    for (const p of POSTI[k]) {
      const posto = [p[0], bello(p[1]), p[2], p[3], p[4], p[5], p[6]];
      const html = pagina(r, posto, sl[p[0]], sl);

      // ⚠️ SI CONTROLLA CHE LO SCRIPT DELLA PAGINA GIRI, prima di scriverla.
      // Il 2/9/2026 la Valle d'Aosta usciva con NOME = 'Valle d'Aosta': apostrofo
      // dritto dentro una stringa a virgolette singole, script morto, pagina
      // bianca. Qui il rischio e' molto piu' alto, perche' i nomi dei posti sono
      // centododici e non uno: «Sant'Olcese», «Cà de Massa», «Urbe - Vara Sup.».
      const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
      try { new Function(html.slice(i + 8, j)); }
      catch (e) {
        console.error(`⚠️ ${k}/${sl[p[0]]}: lo script della pagina non gira — ${e.message}`);
        process.exit(1);
      }

      const dir = path.join(RADICE, 'funghi', k, sl[p[0]]);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
      scritte++;
    }
    console.log(`  /funghi/${k}/  ${POSTI[k].length} posti`);
  }
  const voci = scriviSitemap(SITO, RADICE);
  console.log(`\n${scritte} pagine scritte, sitemap.xml con ${voci} indirizzi.`);
}

module.exports = { GENITIVO };
