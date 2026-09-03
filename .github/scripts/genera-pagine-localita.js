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
const { REGIONI } = require('./genera-pagine-regione.js');
const { LOCALITA, bello, slugRegione } = require('./lib-nomi.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));

// ⚠️ UNICA RIGA DIVERSA DA PRODUZIONE: il dominio. Tutto il resto,
// l'indirizzo dei dati compreso, deve restare IDENTICO — anche qui i numeri si
// leggono da prod, perche' in questo repo Alto Adige, Toscana, Liguria e le
// dieci reti MeteoHub non girano e i loro file sono fermi a luglio. Un diff
// fra i due generatori deve dare solo queste righe: se ne compaiono altre, i
// due sono divergenti.
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

// «al Passo del Turchino», «a Reppia», «all'Alpe di Vobbia»: la preposizione
// giusta si sceglie dall'articolo che il nome si porta dietro.
function aPosto(n) {
  if (/^(Passo|Colle|Monte|Bric|Rifugio|Lago|Piano|Ponte|Bosco|Forte|Poggio)\b/.test(n)) return 'al ' + n;
  if (/^(Alpe|Isola|Alta|Valle|Villa|Cima)\b/.test(n)) return "all'" + n;
  return 'a ' + n;
}

function pagina(r, posto, slug) {
  const [ID, nomePosto, sigla, quota, lat, lon, bosco] = posto;
  const REG = r.k;
  const NOME = r.nomeTitolo || r.nome;
  const AGENZIA = r.agenzia;
  const CORTA = r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '');
  const GEN = GENITIVO[REG];
  const DOVE = aPosto(nomePosto);

  // ⚠️ Limiti che Google taglia: titolo <= 62 caratteri, descrizione <= 158.
  // Il nome di un posto puo' essere lungo, quindi la coda del titolo si toglie
  // invece di lasciarlo mozzare a meta' parola.
  const pieno = `Piogge per funghi ${DOVE}: dove ha piovuto davvero`;
  const TITOLO = pieno.length <= 62 ? pieno : `Piogge per funghi ${DOVE}`;
  const DESCR = `Quanta pioggia è caduta ${DOVE} (${sigla}, ${quota} m), misurata dal ` +
    `pluviometro di ${CORTA}. La finestra da 13 a 20 giorni fa, quella che conta per i funghi.`;

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
<meta property="og:title" content="Piogge per funghi ${esc(DOVE)}">
<meta property="og:description" content="La pioggia vera, misurata dal pluviometro, giorno per giorno.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/funghi/${REG}/${slug}/">
<meta property="og:type" content="website">
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
.gg-leg i{display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:-1px;margin-right:4px;}
.tre{display:flex;gap:10px;margin:18px 0 6px;flex-wrap:wrap;}
.tre > div{flex:1;min-width:150px;background:var(--grigio);border:1px solid var(--bordo);
  border-radius:9px;padding:12px 14px;}
.tre .et{font-size:13px;color:#5a6b80;}
.tre .n{font-size:26px;font-weight:700;color:var(--blu-scuro);line-height:1.2;}
.vic td:last-child,.vic th:last-child{text-align:right;}
.vic .qui{background:#eef4fd;}
.vic .qui b{color:var(--blu-scuro);}
/* ⚠️ Il posto corrente dentro l'elenco NON puo' essere un <b>: dentro
   nav.altre il <b> e' l'intestazione di un gruppo (display:block) e il nome
   sarebbe andato a capo spezzando l'elenco in due. */
nav.altre .io{font-weight:700;color:var(--blu-scuro);}
</style>
</head>
<body>

<header>
  <a href="${SITO}/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>
  <a class="yt" href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'localita-${REG}'})}catch(e){}">▶ Canale YouTube</a>
</header>

<main>
<p class="nota" style="margin-bottom:6px"><a href="${SITO}/funghi/${REG}/" style="color:var(--blu)">‹ Piogge per funghi ${r.prep} ${esc(NOME)}</a></p>

<h1>Piogge per funghi ${esc(DOVE)}</h1>
<p class="sotto">${esc(sigla)} · ${quota} m slm · ${bosco}% di bosco entro 3 km. Pioggia misurata dal
pluviometro di ${esc(CORTA)}, aggiornata ogni giorno.</p>

<div class="patto">
  <p><b>Cosa NON trovi qui:</b> una previsione di quanti funghi ci saranno. Attendibile non la
  fa nessuno, e noi non ce la inventiamo.</p>
  <p><b>Cosa trovi:</b> quanta acqua è caduta qui, giorno per giorno, con la data. Il bosco poi
  lo conosci tu meglio di qualunque sito.</p>
</div>

<div id="attesa">Sto leggendo il pluviometro…</div>
<div id="guasto"></div>
<div id="testa"></div>
<div class="spiega" id="finestra" style="margin-top:14px"></div>

<h2>Giorno per giorno, ultimi 25 giorni</h2>
<div id="grafico"></div>
<div class="tre" id="tre"></div>
<p class="nota" id="notaforte"></p>

<h2>Come sta messo rispetto agli altri posti ${esc(GEN)}</h2>
<div id="vicini"></div>
<p class="nota" id="notavicini"></p>

<h2>Ecco cosa vedi sulla mappa</h2>
<a href="${SITO}/?r=${REG}" style="display:block;text-decoration:none;">
  <img src="${ANTEPRIME}/${REG}.jpg"
       alt="La mappa delle piogge ${r.prep} ${esc(NOME)}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"
       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">
  <span class="vai-mappa">Apri la mappa su questo pluviometro →</span>
</a>

<h2 style="margin-bottom:12px">Perché proprio questo posto</h2>
<div class="metodo">
  <div><span class="n">1</span><b>C'è un pluviometro vero.</b> Non una stima su griglia: uno
  strumento di ${esc(AGENZIA)}, col suo nome e la sua quota.</div>
  <div><span class="n">2</span><b>Quota fra 200 e 1600 metri.</b> Qui siamo a ${quota}.</div>
  <div><span class="n">3</span><b>Almeno il 37% di bosco entro 3 km</b>, misurato sulle mappe di
  OpenStreetMap. Qui è il ${bosco}%.</div>
</div>

<div class="avviso">
  <b>Una cosa da tenere a mente.</b> Tanta pioggia non vuol dire tanti funghi: contano anche la
  temperatura, il vento e il tipo di bosco. <b>La temperatura e il vento ce li abbiamo:</b>
  clicca il pluviometro sulla mappa e vedi il suo storico, giorno per giorno, insieme alla
  pioggia.
</div>

<h2 style="margin-top:30px">Gli altri posti da bosco ${esc(GEN)}</h2>
<nav class="altre" id="altri"><p class="nota">Sto leggendo l'elenco…</p></nav>

<p class="nota" style="margin-top:22px">Dati di ${esc(AGENZIA)} via il nostro archivio. Il
bosco è calcolato su dati OpenStreetMap, licenza ODbL. La provincia viene dai confini
provinciali ISTAT.</p>
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
  var LAT = ${lat}, LON = ${lon};
  var SITO = ${JSON.stringify(SITO)}, MAPPA = SITO + '/';
  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var BASE = LOCALE ? '/data/'
    : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var FORTE = 30, GIORNI = 25, VICINI = 5;

  var MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  function iso(d){ var p=function(n){return String(n).padStart(2,'0');};
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function menoDa(s, n){ var p=String(s).split('-');
    var d=new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()-n); return d; }
  function gg(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function uno(n){ return Math.round(n*10)/10; }
  /* ⚠️ Sempre un decimale: senza il toFixed, 22 usciva «22» in una colonna di
     «50,6» e «20,6» e la colonna dei millimetri si sfrangiava. */
  function num(n){ return uno(n).toFixed(1).replace('.', ','); }
  function km(a,b,c,d){ var R=6371, x=(c-a)*Math.PI/180, y=(d-b)*Math.PI/180;
    var s=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)*Math.sin(y/2);
    return R*2*Math.atan2(Math.sqrt(s), Math.sqrt(1-s)); }

  /* Stessa regola delle pagine regione e funghi: un giro saltato si perdona,
     due no. Si guarda il campo «generato», non l'ultimo giorno contenuto.
     ⚠️ Niente apici inversi da qui in giu': tutta la pagina e' un template
     literal del generatore, e uno solo la spezzerebbe in due. */
  function fresco(j){
    if (!j || !j.generato || !j.serie || !j.anagrafe || !j.oggi) return false;
    var eta = Date.now() - new Date(j.generato).getTime();
    return eta >= 0 && eta < 36*3600*1000;
  }
  /* La somma di una finestra: n va dal piu' lontano al piu' vicino, come nella
     pagina regione. serie[0] e' IERI. */
  function somma(s, da, a){ var t=0; for (var n=da; n>=a; n--) t += (s[n-1]||0); return uno(t); }

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
      + '<a href="'+MAPPA+'?r='+REG+'">sulla mappa</a>.';
    document.getElementById('altri').innerHTML =
      '<p class="nota"><a href="'+SITO+'/funghi/'+REG+'/">Vedi tutti i posti da bosco</a></p>';
  }

  function disegna(j){
    var s = j.serie[ID];
    var mm = somma(s,20,13), mm7 = somma(s,7,1), mm25 = somma(s,GIORNI,1);
    var daG = iso(menoDa(j.oggi,20)), aG = iso(menoDa(j.oggi,13)), a20 = iso(menoDa(j.oggi,1));

    var forte = null;
    for (var n=1; n<=GIORNI; n++) if (s[n-1] >= FORTE) { forte = {g:n, mm:s[n-1]}; break; }
    var quando = forte ? (forte.g===1 ? 'ieri' : forte.g+' giorni fa') : null;

    function link(dal, al, centra){
      return MAPPA + '?r=' + REG + '&da=' + dal + '&a=' + al
        + (centra ? '&z=11&c=' + LAT.toFixed(4) + ',' + LON.toFixed(4) : '');
    }

    document.getElementById('testa').innerHTML =
      '<div class="capo"><div class="et">Quanta acqua è caduta qui fra 13 e 20 giorni fa?</div>'
      + '<div class="gr">' + num(mm) + ' mm</div>'
      + '<div class="pic">dal ' + gg(daG) + ' al ' + gg(aG)
      + (forte ? ' · ultima pioggia forte ' + quando + ' (' + num(forte.mm) + ' mm)' : '') + '</div>'
      + '<div class="capo-btns">'
      + '<a class="capo-btn" href="' + link(daG, aG, true) + '">Apri mappa · 13-20 gg fa</a>'
      + '<a class="capo-btn" href="' + link(daG, a20, true) + '">Apri mappa · ultimi 20 gg</a>'
      + '<a class="capo-btn" href="' + link(daG, a20, false) + '">Tutta la ' + NOME + '</a>'
      + '</div></div>';

    /* ⚠️ Perche' 13-20 e non un altro numero: il fungo non spunta subito dopo
       la pioggia, gli servono almeno 12-13 giorni e quanti dipende dalla
       temperatura. Dirlo e' il punto della pagina: senza, la finestra sembra
       scelta a caso. */
    document.getElementById('finestra').innerHTML =
      'Qui la pioggia è caduta fra il <b>' + gg(daG) + '</b> e il <b>' + gg(aG) + '</b>, cioè da '
      + '<b>13 a 20 giorni fa</b>. Dopo l’acqua il fungo non spunta subito: per svilupparsi gli '
      + 'servono <b>almeno 12-13 giorni</b>, a seconda della temperatura. È questa la pioggia '
      + 'che fa nascere i funghi <b>adesso</b>.';

    /* ── il grafico: 25 barre, ieri a destra ── */
    var max = Math.max.apply(null, s.concat([1]));
    var barre = '', ascisse = '', ultimaEt = null;
    for (var i = GIORNI; i >= 1; i--) {
      var v = s[i-1] || 0;
      var cl = (i>=13 && i<=20) ? ' dentro' : '';
      var d = menoDa(j.oggi, i);
      /* Il numero sopra la barra si scrive solo se e' alta e se l'ultima
         scritta non e' troppo vicina: a 375 px due etichette su barre
         adiacenti si sovrappongono e si legge «55,87,2». */
      var etich = v >= max*0.28 && (ultimaEt === null || ultimaEt - i >= 3);
      if (etich) ultimaEt = i;
      barre += '<div class="b' + cl + '" title="' + gg(iso(d)) + ': ' + num(v) + ' mm">'
        + (etich ? '<b>' + num(v) + '</b>' : '')
        + '<i style="height:' + Math.max(2, Math.round(v/max*100)) + '%"></i></div>';
      /* Giorno e mese in forma corta: «13/8» non va a capo, «13 ago» si'. */
      ascisse += '<span>' + ((i===GIORNI || i===1 || i%5===0) ? (d.getDate()+'/'+(d.getMonth()+1)) : '') + '</span>';
    }
    document.getElementById('grafico').innerHTML =
      '<div class="gg">' + barre + '</div><div class="gg-x">' + ascisse + '</div>'
      + '<p class="gg-leg"><i style="background:var(--blu)"></i>la finestra dei funghi, '
      + 'da 13 a 20 giorni fa &nbsp; <i style="background:#b9cbe2"></i>gli altri giorni</p>';

    document.getElementById('tre').innerHTML =
      '<div><div class="et">13-20 giorni fa</div><div class="n">' + num(mm) + ' mm</div></div>'
      + '<div><div class="et">Ultimi 7 giorni</div><div class="n">' + num(mm7) + ' mm</div></div>'
      + '<div><div class="et">Ultimi 25 giorni</div><div class="n">' + num(mm25) + ' mm</div></div>';

    document.getElementById('notaforte').innerHTML = forte
      ? 'L’ultima pioggia forte è caduta <b>' + quando + '</b>: ' + num(forte.mm) + ' mm in un giorno solo, '
        + 'che è quella che bagna davvero il terreno.'
      : 'Negli ultimi ' + GIORNI + ' giorni qui non è caduta nessuna pioggia forte (almeno ' + FORTE + ' mm in un giorno).';

    /* ── posizione in classifica e posti vicini ──
       L'anagrafe arriva dal file: [id, nome, sigla, quota, lat, lon, bosco%, slug] */
    var tutti = j.anagrafe.map(function(p){
      var ss = j.serie[p[0]];
      return ss ? { id:p[0], n:p[1], sig:p[2], q:p[3], lat:p[4], lon:p[5], slug:p[7],
                    mm:somma(ss,20,13), d:km(LAT, LON, p[4], p[5]) } : null;
    }).filter(Boolean);
    var ordinati = tutti.slice().sort(function(a,b){ return b.mm - a.mm; });
    var pos = ordinati.findIndex(function(x){ return x.id === ID; }) + 1;

    function pag(x){ return SITO + '/funghi/' + REG + '/' + x.slug + '/'; }

    var vicini = tutti.filter(function(x){ return x.id !== ID; })
      .sort(function(a,b){ return a.d - b.d; }).slice(0, VICINI);
    var qui = tutti.find(function(x){ return x.id === ID; });
    var righe = vicini.concat([qui]).sort(function(a,b){ return a.d - b.d; });

    document.getElementById('vicini').innerHTML =
      '<table class="vic"><thead><tr><th>Località</th><th>Distanza</th><th>13-20 gg fa</th></tr></thead><tbody>'
      + righe.map(function(r){
          var io = r.id === ID;
          return '<tr' + (io ? ' class="qui"' : '') + '><td>'
            + (io ? '<b>' + esc(r.n) + '</b> <span class="com">(sei qui)</span>'
                  : '<a class="loc" href="' + pag(r) + '"><b>' + esc(r.n) + '</b></a>')
            + '<span class="com">' + esc(r.sig) + ' · ' + r.q + ' MT</span></td>'
            + '<td>' + (io ? '—' : num(r.d) + ' km') + '</td>'
            + '<td class="mm"><span class="v' + (r.mm>0?'':' zero') + '">' + (r.mm>0?num(r.mm):'—') + '</span></td></tr>';
        }).join('')
      + '</tbody></table>';

    document.getElementById('notavicini').innerHTML =
      'Nella finestra dei funghi questo pluviometro è <b>' + pos + 'º su ' + tutti.length + '</b> '
      + 'fra i posti da bosco della regione. '
      + '<a href="' + SITO + '/funghi/' + REG + '/">Vedi i primi 15</a>.';

    /* ⚠️ L'elenco delle sorelle si disegna DAL FILE, non e' cotto nella pagina:
       cosi' un posto nuovo compare in tutte e centododici senza rigenerarne
       nessuna. Ordinato per nome, che e' l'ordine in cui uno cerca. */
    document.getElementById('altri').innerHTML =
      '<p>' + tutti.slice().sort(function(a,b){ return a.n.localeCompare(b.n,'it'); })
        .map(function(x){
          return x.id === ID ? '<span class="io">' + esc(x.n) + '</span>'
            : '<a href="' + pag(x) + '">' + esc(x.n) + '</a>';
        }).join(' · ') + '</p>';

    document.getElementById('attesa').style.display = 'none';
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
      const html = pagina(r, posto, sl[p[0]]);

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
