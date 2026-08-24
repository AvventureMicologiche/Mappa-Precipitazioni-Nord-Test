#!/usr/bin/env node
/**
 * Genera le pagine statiche per regione (/lombardia/, /piemonte/, ...).
 *
 * PERCHE' ESISTONO. Il sito, per Google, e' UNA pagina sola: un URL, un titolo,
 * e ogni volta che si aggiunge una nazione cambia il nome a quella stessa
 * pagina. Chi cerca «dove ha piovuto in Trentino» non trova mai una pagina che
 * parli di quello. L'analisi GA4 del 14/8/2026 dice che Google porta solo il
 * 9,5% delle sessioni ma con la permanenza piu' alta di tutti (2m41s): il
 * canale migliore e' anche il piu' chiuso. Queste pagine lo aprono.
 *
 * COME SONO FATTE. Sono GUSCI STATICI: il testo non cambia mai, i numeri li
 * scarica il browser del visitatore dai file data/ su raw.githubusercontent,
 * la stessa strada che usa la mappa. Quindi NON vanno mai rigenerate quando
 * arrivano dati nuovi, e i collector continuano a non far partire nessun
 * deploy (data/ e' nella regola ignore di netlify.toml). Si rigenerano solo
 * se cambia il MODELLO qui sotto: `node .github/scripts/genera-pagine-regione.js`.
 *
 * ⚠️ STAZIONI: il numero scritto e' quello che la mappa MOSTRA, non quello dei
 * file. Piemonte e Toscana hanno liste curate (170 su 273, 165 su 379), la
 * Lombardia esclude 3 sensori con coordinate corrotte e l'Emilia le 8 gemelle
 * liguri. Scrivere il conteggio grezzo sarebbe una bugia verificabile.
 *
 * ⚠️ GEMELLE (24/8/2026): quando una regione legge PIU' cartelle, le stazioni
 * si uniscono per POSIZIONE, non per cartella+id. Il Friuli e' il caso che l'ha
 * imposto: la pagina leggeva la sola OSMER (41 pluviometri) mentre dichiarava
 * «oltre 130», perche' dal 21/8 la mappa unisce OSMER e la rete regionale
 * completa via MeteoHub. Ma MeteoHub ripubblica le stesse stazioni OSMER con un
 * altro id (`46.51697_12.86492` invece di `osmer_BIC`): unendo per cartella+id,
 * 37 pluviometri su 141 sarebbero stati contati DUE volte, con la stessa
 * pioggia due volte in classifica. La regola e' quella gia' usata in mappa da
 * `loadOSMERFriuliRegion` — vince la PRIMA cartella dell'elenco (la fonte di
 * casa), le altre perdono le stazioni entro ~1 km. Friuli: 41 + 141 − 37 = 145.
 * Sulla Svizzera (svizzera+ticino) non scarta niente: le 9 sovrapposte erano
 * gia' state sanate l'11/8 passando le SMN ticinesi a MeteoSwiss OGD.
 *
 * ⚠️ L'ABRUZZO NON HA UNA PAGINA, ed e' voluto: e' l'unica regione a stime
 * Open-Meteo live, non ha cartella dati, e i due riepiloghi non potrebbero
 * calcolare niente. Una pagina che promette numeri e non li ha lavora contro.
 *
 * ⚠️ I bottoni portano ANCHE le date: il meccanismo ?r= della mappa e' quello
 * dei link condivisi e senza da/a viene ignorato in silenzio (?r=lombardia da
 * solo apre la mappa generica). Con le date la mappa apre con la regione gia'
 * scelta, l'analisi in corso e il preset del periodo acceso.
 */

const fs = require('fs');
const path = require('path');

// ⚠️ UNICA RIGA DIVERSA DA PRODUZIONE (24/8/2026): il dominio. Tutto il resto,
// RAW compreso, deve restare IDENTICO — i dati si leggono da prod anche qui,
// perche' in questo repo Alto Adige, Toscana, Liguria e le dieci reti MeteoHub
// non girano e i loro file sono fermi a luglio. Un `diff` fra i due generatori
// deve dare solo queste righe: se ne compaiono altre, i due sono divergenti.
const SITO = 'https://avventurepluvio-test.netlify.app';
const GA_ID = 'G-9R7MXXS0V4';
const VIDEO_FAQ = 'https://youtu.be/fvsBZJ_Ylf4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';

// Le anteprime della mappa stanno su un RAMO A SE', `anteprime`, coi file alla
// radice: le rifa' genera-anteprime.js ogni tre giorni riscrivendo il ramo da
// capo, cosi' gli 8 MB di immagini non si accumulano nella storia di main.
// raw.githubusercontent serve qualunque ramo, quindi rinfrescarle NON fa
// scattare un deploy Netlify.
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime';

// chiave = quella delle caselle della mappa (?r=<chiave>) e della cartella pagina.
// dirs   = cartelle dati da sommare. prep = preposizione del titolo.
// staz   = come si dice il numero di stazioni CHE LA MAPPA MOSTRA.
const REGIONI = [
  { k:'lombardia',   nome:'Lombardia',              prep:'in',   dirs:['lombardia'],            agenzia:'ARPA Lombardia',        url:'https://www.dati.lombardia.it/', staz:'oltre 250',        geo:"dalla Valchiavenna all'Oltrepò" },
  { k:'piemonte',    nome:'Piemonte',               prep:'in',   dirs:['piemonte'],             agenzia:'ARPA Piemonte',         url:'', staz:'oltre 250',        geo:'dalle Alpi Marittime al Lago Maggiore' },
  { k:'valledaosta', nome:"Valle d'Aosta",          prep:'in',   dirs:['valledaosta-cf'],       agenzia:'Centro Funzionale della Valle d’Aosta', agenziaCorta:'Centro Funzionale VdA', url:'', staz:'oltre 60',  geo:'dal fondovalle della Dora ai ghiacciai del Monte Rosa' },
  { k:'liguria',     nome:'Liguria',                prep:'in',   dirs:['liguria'],              agenzia:'ARPA Liguria (OMIRL)',  url:'', staz:'quasi 200',        geo:'dalle Alpi Liguri alla Lunigiana' },
  { k:'emilia',      nome:'Emilia-Romagna',         prep:'in',   dirs:['emilia'],               agenzia:'ARPAE Emilia-Romagna',  url:'', staz:'oltre 300',        geo:'dal crinale appenninico al delta del Po' },
  { k:'veneto',      nome:'Veneto',                 prep:'in',   dirs:['veneto'],               agenzia:'ARPA Veneto',           url:'', staz:'oltre 180',        geo:'dalle Dolomiti bellunesi alla laguna' },
  { k:'friuli',      nome:'Friuli Venezia Giulia',  prep:'in',   dirs:['friuli-osmer','meteohub-friuli'], agenzia:'ARPA FVG (OSMER e rete regionale)', agenziaCorta:'ARPA FVG', nomeTitolo:'Friuli', url:'', staz:'oltre 130',geo:'dalle Alpi Carniche al Carso' },
  { k:'trentino',    nome:'Trentino',               prep:'in',   dirs:['trentino'],             agenzia:'Meteotrentino',         url:'', staz:'oltre 100',        geo:'dalle Dolomiti di Brenta alla Valsugana' },
  { k:'altoadige',   nome:'Alto Adige',             prep:'in',   dirs:['altoadige'],            agenzia:'Provincia autonoma di Bolzano', agenziaCorta:'Provincia di Bolzano', url:'', staz:'oltre 50', geo:'dalla Val Venosta alle Dolomiti' },
  { k:'toscana',     nome:'Toscana',                prep:'in',   dirs:['toscana'],              agenzia:'SIR Toscana',           url:'', staz:'oltre 350',        geo:'dalla Lunigiana al Monte Amiata' },
  { k:'umbria',      nome:'Umbria',                 prep:'in',   dirs:['meteohub-umbria'],      agenzia:'MeteoHub',              url:'', staz:'oltre 70',         geo:"dall'Appennino umbro-marchigiano al Trasimeno" },
  { k:'marche',      nome:'Marche',                 prep:'nelle',dirs:['meteohub-marche'],      agenzia:'MeteoHub',              url:'', staz:'oltre 110',        geo:'dai Monti Sibillini alla costa adriatica' },
  { k:'lazio',       nome:'Lazio',                  prep:'nel',  dirs:['meteohub-lazio'],       agenzia:'MeteoHub',              url:'', staz:'oltre 200',        geo:'dai Monti della Laga al litorale pontino' },
  { k:'molise',      nome:'Molise',                 prep:'in',   dirs:['meteohub-molise'],      agenzia:'MeteoHub',              url:'', staz:'circa 25',  geo:'dal Matese al basso Molise' },
  { k:'campania',    nome:'Campania',               prep:'in',   dirs:['meteohub-campania'],    agenzia:'MeteoHub',              url:'', staz:'oltre 150',        geo:'dal Cilento al Matese' },
  { k:'puglia',      nome:'Puglia',                 prep:'in',   dirs:['meteohub-puglia'],      agenzia:'MeteoHub',              url:'', staz:'oltre 120',        geo:'dal Gargano al Salento' },
  { k:'basilicata',  nome:'Basilicata',             prep:'in',   dirs:['meteohub-basilicata'],  agenzia:'MeteoHub',              url:'', staz:'circa 50',         geo:'dal Pollino alle Murge lucane' },
  { k:'calabria',    nome:'Calabria',               prep:'in',   dirs:['meteohub-calabria'],    agenzia:'MeteoHub',              url:'', staz:'circa 140',        geo:"dal Pollino all'Aspromonte" },
  { k:'sicilia',     nome:'Sicilia',                prep:'in',   dirs:['meteohub-sicilia'],     agenzia:'MeteoHub',              url:'', staz:'oltre 400',        geo:"dall'Etna alle Madonie" },
  { k:'sardegna',    nome:'Sardegna',               prep:'in',   dirs:['meteohub-sardegna'],    agenzia:'MeteoHub',              url:'', staz:'oltre 90',         geo:'dalla Gallura al Sulcis' },
  { k:'svizzera',    nome:'Svizzera',               prep:'in',   dirs:['svizzera','ticino'],    agenzia:'MeteoSvizzera e OASI Ticino', agenziaCorta:'MeteoSvizzera', url:'', staz:'oltre 300',  geo:'dal Ticino ai Grigioni, dal Vallese al Giura' },
  { k:'austria',     nome:'Austria',                prep:'in',   dirs:['austria'],              agenzia:'GeoSphere Austria',     url:'', staz:'quasi 270',        geo:'dai ghiacciai del Tirolo alle colline del Burgenland' },
  { k:'slovenia',    nome:'Slovenia',               prep:'in',   dirs:['slovenia'],             agenzia:'ARSO Slovenia',         url:'', staz:'oltre 110',        geo:'dalle Alpi Giulie al Carso', nota:'ARSO pubblica con circa 36 ore di ritardo: nei riepiloghi qui sotto gli ultimi uno o due giorni possono mancare, ed è normale.' },
];

function pagina(r){
  // ⚠️ TITOLO E DESCRIZIONE rifatti il 23/8/2026 sui dati di Search Console, e
  // qui dentro devono restare uguali a quelli pubblicati: la pagina Liguria era
  // vista 70 volte per «mappa pluviometri liguria» e cliccata zero, e la parola
  // «pluviometri» nel titolo non c'era. Fuori anche il suffisso «| Mappa
  // Pluviometrica», che mangiava spazio ripetendo la stessa parola, e i titoli
  // sono passati da 78-93 caratteri (tagliati da Google) a 51-59.
  // «misurata» nella descrizione fa un lavoro preciso: dice che non siamo una
  // previsione. Limiti da rispettare: titolo <= 62, descrizione <= 158.
  const nomeCorto = r.nomeTitolo || r.nome;
  const titolo = `Dove ha piovuto ${r.prep} ${r.nome}`;
  const titoloTag = `Dove ha piovuto ${r.prep} ${nomeCorto}: la mappa dei pluviometri`;
  const agMeta = r.agenziaCorta || r.agenzia;
  const code = ['Le zone più bagnate, aggiornate ogni giorno.', 'Zone più bagnate, aggiornate ogni giorno.',
                'Zone più bagnate, ogni giorno.', 'Aggiornate ogni giorno.'];
  const prep2 = /^(Provincia|Centro)/.test(agMeta) ? (agMeta.startsWith('Provincia') ? 'della' : 'del') : 'di';
  let descr = '';
  for (const coda of code) {
    descr = `Quanta pioggia è caduta ${r.prep} ${nomeCorto} negli ultimi 7 e 20 giorni, misurata da ${r.staz} pluviometri ${prep2} ${agMeta}. ${coda}`;
    if (descr.length <= 158) break;
  }
  const fonteFooter = r.url
    ? `<a href="${r.url}" target="_blank" rel="noopener">${r.agenzia}</a>`
    : r.agenzia;
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titoloTag}</title>
<meta name="description" content="${descr}">
<link rel="canonical" href="${SITO}/${r.k}/">
<meta property="og:title" content="${titolo} — piogge per funghi">
<meta property="og:description" content="Riepilogo degli ultimi 7 e 20 giorni con le zone più bagnate, da ${r.staz} pluviometri di ${r.agenzia}.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/${r.k}/">
<meta property="og:type" content="website">
<!-- Google tag (gtag.js) — stessa proprietà del sito.
     ⚠️ Il config sta dietro al controllo sull'HOSTNAME, come in index.html dal
     22/7/2026: senza, le stesse pagine pubblicate sul sito di TEST manderebbero
     eventi alla proprietà vera, e sono proprio i numeri per regione che si
     stanno usando per giudicare titoli e descrizioni. Senza quel config gtag.js
     non invia nulla e le chiamate gtag('event',…) sparse nella pagina restano
     innocue. La regex copre dominio nudo e www. -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<style>
:root{--blu:#1b3f6e;--blu-scuro:#123252;--grigio:#f0f4fb;--bordo:#d0d8e8;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#222;background:#fff;font-size:17px;line-height:1.6;}
header{background:var(--blu);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
header a{color:#fff;text-decoration:none;}
header .logo{font-weight:600;font-size:15px;display:flex;align-items:center;gap:7px;}
header .yt{margin-left:auto;background:#e12b2b;font-size:13px;font-weight:600;padding:6px 11px;border-radius:7px;white-space:nowrap;}
main{max-width:760px;margin:0 auto;padding:22px 16px 4px;}
h1{color:var(--blu-scuro);font-size:30px;line-height:1.25;margin-bottom:8px;}
.sotto{color:#555;font-size:17px;margin-bottom:22px;}
h2{color:var(--blu-scuro);font-size:22px;margin:34px 0 10px;}
p{margin-bottom:12px;}
.cta{display:block;text-align:center;background:var(--blu);color:#fff;font-size:19px;font-weight:600;padding:15px 18px;border-radius:9px;text-decoration:none;margin:22px 0;}
.cta:hover{background:#2a5490;}
.griglia{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:18px 0;}
.card{background:var(--grigio);border:1px solid var(--bordo);border-radius:9px;padding:16px;display:flex;flex-direction:column;}
.card h2{margin:0 0 6px;font-size:20px;}
.numerone{font-size:32px;font-weight:700;color:var(--blu-scuro);}
.numerone small{font-size:15px;font-weight:400;color:#555;}
.attesa{color:#777;font-style:italic;}
.nota{font-size:14px;color:#666;margin-top:8px;}
.top-staz{margin:6px 0 0;}
.top-staz li{margin:4px 0 4px 20px;}
footer{border-top:1px solid var(--bordo);margin-top:8px;padding:14px 16px 24px;font-size:14px;color:#555;text-align:center;}
footer a{color:var(--blu);}
@media(max-width:480px){h1{font-size:25px;}body{font-size:16px;}}
</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<h1>${titolo}</h1>
<p class="sotto">Ieri e negli ultimi 20 giorni, da <b>${r.staz} pluviometri di ${r.agenzia}</b>, ${r.geo}.</p>${r.nota ? `\n<p class="nota" style="margin:-16px 0 20px;">${r.nota}</p>` : ''}

<div class="griglia">
  <div class="card">
    <h2>Ultimi 7 giorni</h2>
    <div class="numerone" id="rip7-media"><span class="attesa">calcolo in corso…</span></div>
    <div id="rip7-top"></div>
    <p class="nota" id="rip7-date"></p>
    <!-- ⚠️ L'indirizzo scritto qui deve GIA' portare alla regione (23/8/2026):
         lo script in fondo alla pagina lo riscrive con le date esatte, ma solo
         dopo che i dati sono arrivati, e chi cliccava prima finiva sulla mappa
         vuota da scegliere. Il parametro g sono i giorni: la mappa li fa date.
         ⚠️ Se un giorno queste pagine si rigenerano, la correzione deve stare
         QUI: la stessa, fatta a mano sulle 23 pagine, e' durata mezza giornata
         ed e' stata cancellata dal primo giro del generatore. -->
    <a class="cta" id="cta7" style="margin:14px 0 2px;margin-top:auto;" href="${SITO}/?r=${r.k}&amp;g=7"
       onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-7gg'})}catch(e){}">Apri la mappa a 7 giorni →</a>
  </div>
  <div class="card">
    <h2>Ultimi 20 giorni</h2>
    <div class="numerone" id="rip15-media"><span class="attesa">calcolo in corso…</span></div>
    <div id="rip15-top"></div>
    <p class="nota" id="rip15-date"></p>
    <a class="cta" id="cta15" style="margin:14px 0 2px;margin-top:auto;" href="${SITO}/?r=${r.k}&amp;g=20"
       onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-20gg'})}catch(e){}">Apri la mappa a 20 giorni →</a>
  </div>
</div>

<h2>Ecco cosa vedi sulla mappa</h2>
<a href="${SITO}/?r=${r.k}" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-anteprima'})}catch(e){}">
  <img src="${ANTEPRIME}/${r.k}.jpg" alt="La mappa delle piogge ${r.prep} ${r.nome}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"
       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">
  <span style="display:block;text-align:center;background:var(--blu);color:#fff;font-size:19px;font-weight:600;padding:15px 18px;border-radius:9px;margin:12px 0 4px;">Apri la mappa ${r.prep} ${r.nome} →</span>
</a>
<p class="nota" style="text-align:center;margin-bottom:26px;">Più il colore è acceso, più acqua è caduta. Ogni pallino è un pluviometro: cliccalo e vedi il suo storico.</p>

<h2>Come si legge</h2>
<p>Il colore mostra i millimetri <b>cumulati</b> nel periodo che scegli.</p>
<p>Cliccando una stazione trovi quota, grafico della pioggia degli ultimi 30 giorni e, dove ci sono i sensori, temperatura minima e massima, vento e umidità.</p>

<h2>Da dove arrivano i dati</h2>
<p>Sono <b>${r.staz} pluviometri di ${r.agenzia}</b>, strumenti a terra, non stime da modello.</p>

<p style="margin-bottom:6px;"><a href="${CANALE}" target="_blank" rel="noopener" style="color:#e12b2b;font-weight:600;display:inline-flex;align-items:center;gap:7px;"
   onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a></p>
<p><a href="${VIDEO_FAQ}" target="_blank" rel="noopener" style="color:#e12b2b;font-weight:600;display:inline-flex;align-items:center;gap:7px;"
   onclick="try{gtag('event','click_youtube',{pulsante:'faq-pagina-${r.k}'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Video FAQ: come si usa la mappa (2 minuti)</a></p>
</main>

<footer>
  Dati: ${fonteFooter} ·
  <a href="${SITO}/fonti.html">tutte le fonti e licenze</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a><br>
  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.
</footer>

<script>
(function(){
  var DIRS=${JSON.stringify(r.dirs)};
  var BASE='${RAW}';
  var MESI=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function breve(d){ return d.getDate()+' '+MESI[d.getMonth()]; }
  function giornoFa(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
  // Una regione puo' leggere piu' cartelle (la Svizzera somma MeteoSvizzera e
  // OASI Ticino): si scaricano tutte e si uniscono, con la chiave stazione
  // prefissata dalla cartella per non far collidere id di reti diverse.
  function prendi(d){
    return Promise.all(DIRS.map(function(dir){
      return fetch(BASE+dir+'/'+iso(d)+'.json')
        .then(function(res){ return res.ok?res.json():null; })
        .catch(function(){ return null; })
        .then(function(j){ return j&&j.stations ? {dir:dir,stations:j.stations} : null; });
    })).then(function(parti){
      parti=parti.filter(Boolean);
      return parti.length ? parti : null;
    });
  }
  document.getElementById('cta7').href='${SITO}/?r=${r.k}&da='+iso(giornoFa(7))+'&a='+iso(giornoFa(1));
  document.getElementById('cta15').href='${SITO}/?r=${r.k}&da='+iso(giornoFa(20))+'&a='+iso(giornoFa(1));
  // GEMELLE. Se le cartelle sono piu' d'una, le reti si sovrappongono: la
  // stessa stazione fisica compare in tutt'e due con id diversi (il Friuli ha
  // 37 pluviometri OSMER ripubblicati da MeteoHub come «lat_lon»), e unendo per
  // cartella+id la sua pioggia verrebbe contata due volte. Si scartano quindi
  // le stazioni delle cartelle successive che cadono entro ~1 km da una della
  // PRIMA cartella, che e' la fonte di casa. Tolleranza larga apposta: le due
  // fonti arrotondano le coordinate in modo diverso e due pluviometri veri non
  // stanno mai cosi' vicini. Stessa regola della mappa (loadOSMERFriuliRegion).
  function scartaGemelle(files){
    var fuori={};
    if(DIRS.length<2) return fuori;
    var pos={};
    files.forEach(function(parti){ if(!parti) return; parti.forEach(function(p){
      if(p.dir!==DIRS[0]) return;
      p.stations.forEach(function(s){ pos[s.id]=[s.lat,s.lon]; });
    });});
    var casa=Object.keys(pos).map(function(k){ return pos[k]; });
    files.forEach(function(parti){ if(!parti) return; parti.forEach(function(p){
      if(p.dir===DIRS[0]) return;
      p.stations.forEach(function(s){
        var id=p.dir+':'+s.id;
        if(id in fuori) return;
        fuori[id]=casa.some(function(q){
          return Math.abs(q[0]-s.lat)<0.009 && Math.abs(q[1]-s.lon)<0.013;
        });
      });
    });});
    return fuori;
  }
  var giorni=[]; for(var i=1;i<=20;i++) giorni.push(giornoFa(i));
  Promise.all(giorni.map(prendi)).then(function(files){
    var gemelle=scartaGemelle(files);
    function riepilogo(quanti, prefisso){
      var somma={}, nomi={}, prov={}, presenti=0, ultimo=null, primo=null;
      for(var k=0;k<quanti;k++){
        var parti=files[k];
        if(!parti) continue;
        presenti++;
        if(!ultimo) ultimo=giorni[k];
        primo=giorni[k];
        parti.forEach(function(p){
          p.stations.forEach(function(s){
            if(s.mm==null) return;
            var id=p.dir+':'+s.id;
            if(gemelle[id]) return;
            somma[id]=(somma[id]||0)+s.mm;
            nomi[id]=s.n;
            if(s.p) prov[id]=s.p;
          });
        });
      }
      // La provincia si scrive solo se DICE qualcosa. Il campo e' disomogeneo
      // fra reti: le dieci reti MeteoHub ci mettono la sigla della REGIONE
      // (tutte le siciliane «SIC»), Friuli «FVG», VdA «AO», Trentino «TN» —
      // ripetere lo stesso valore su ogni riga e' rumore. Il Piemonte scrive
      // «PROVINCIA DI ALESSANDRIA» in maiuscolo, la Liguria il comune.
      // Regola: se in tutta la regione c'e' un valore solo si omette; se no
      // si ripulisce e si mostra.
      var distinti={}; Object.keys(prov).forEach(function(id){ distinti[prov[id]]=1; });
      var mostraProv=Object.keys(distinti).length>1;
      function etichetta(id){
        if(!mostraProv||!prov[id]) return nomi[id];
        var p=String(prov[id]).replace(/^PROVINCIA DI\\s+/i,'');
        if(p===p.toUpperCase()&&p.length>4) p=p.charAt(0)+p.slice(1).toLowerCase();
        return nomi[id]+' ('+p+')';
      }
      var el=document.getElementById(prefisso+'-media');
      if(!presenti){ el.innerHTML='<span class="attesa">dati non disponibili al momento</span>'; return; }
      var valori=Object.keys(somma).map(function(id){return somma[id];});
      var media=valori.reduce(function(a,b){return a+b;},0)/valori.length;
      el.innerHTML=media.toFixed(0)+' mm <small>di media regionale</small>';
      var top=Object.keys(somma).sort(function(a,b){return somma[b]-somma[a];}).slice(0,5);
      var cont=document.getElementById(prefisso+'-top');
      if(!top.length||somma[top[0]]<1){
        cont.innerHTML='<p class="nota">Periodo quasi asciutto su tutta la regione.</p>';
      }else{
        var ol=document.createElement('ol'); ol.className='top-staz';
        top.forEach(function(id){
          var li=document.createElement('li');
          li.textContent=etichetta(id)+' — '+somma[id].toFixed(1)+' mm';
          ol.appendChild(li);
        });
        cont.innerHTML='<p style="margin:8px 0 2px"><b>Dove ha piovuto di più:</b></p>';
        cont.appendChild(ol);
      }
      document.getElementById(prefisso+'-date').textContent='Dal '+breve(primo)+' al '+breve(ultimo)+', su '+presenti+' giornate di dati. La giornata odierna è esclusa.';
    }
    riepilogo(7,'rip7');
    riepilogo(20,'rip15');
  });
})();
</script>
</body>
</html>
`;
}

// ⚠️ La sitemap NON si inventa da zero: esisteva dall'8/8/2026 con due voci
// curate a mano, e `lastmod` va aggiornato quando cambia la PAGINA, non quando
// arrivano dati nuovi (era scritto nel commento del file originale, e vale
// ancora). Home e fonti.html tengono quindi le loro date e i loro changefreq;
// le pagine regione nascono oggi e il loro HTML non cambia mai — i numeri li
// mette il browser a ogni visita — quindi «weekly» e non «daily».
const SITEMAP_FISSE = [
  { loc: SITO + '/',           lastmod: '2026-08-14', freq: 'daily',   pri: '1.0' },
  { loc: SITO + '/fonti.html', lastmod: '2026-08-07', freq: 'monthly', pri: '0.5' },
];

function sitemap(nascita){
  const voce = v => `  <url>\n    <loc>${v.loc}</loc>\n    <lastmod>${v.lastmod}</lastmod>\n` +
                    `    <changefreq>${v.freq}</changefreq>\n    <priority>${v.pri}</priority>\n  </url>`;
  const righe = SITEMAP_FISSE.concat(
    REGIONI.map(r => ({ loc: `${SITO}/${r.k}/`, lastmod: nascita, freq: 'weekly', pri: '0.8' }))
  ).map(voce);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- Generata da .github/scripts/genera-pagine-regione.js — non modificare a mano.\n` +
    `     lastmod = quando cambia la PAGINA, non quando arrivano dati nuovi: le\n` +
    `     pagine regione sono gusci statici, i numeri li scarica il browser. -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${righe.join('\n')}\n</urlset>\n`;
}

// ⚠️ Il repo ha fine riga MISTE e vanno rispettate, se no il diff esplode:
// gli HTML (index.html, fonti.html) sono a CRLF, sitemap.xml e robots.txt a
// LF. Scrivendo la sitemap a CRLF il diff passava da 20 righe a 144.
function scrivi(dest, testo, crlf){
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const norm = testo.replace(/\r\n/g, '\n');
  fs.writeFileSync(dest, crlf ? norm.replace(/\n/g, '\r\n') : norm, 'utf8');
}

const radice = path.resolve(__dirname, '..', '..');
REGIONI.forEach(r => {
  scrivi(path.join(radice, r.k, 'index.html'), pagina(r), true);
  console.log(`  /${r.k}/  ${r.nome} — ${r.staz} staz., ${r.dirs.join('+')}`);
});
// Data di nascita delle pagine, fissa: rigenerare il modello non deve far
// credere a Google che siano cambiate tutte.
scrivi(path.join(radice, 'sitemap.xml'), sitemap('2026-08-14'), false);
console.log(`\n${REGIONI.length} pagine + sitemap.xml scritte.`);
