#!/usr/bin/env node
/**
 * LE PAGINE «DOVE HA PIOVUTO» DI ZONA: zone/<zona>/index.html (13/9/2026).
 *
 * PERCHE' ESISTONO. Il sito ha DUE categorie di pagine, e vanno ragionate in
 * modo diverso (deciso con l'utente il 13/9/2026):
 *  - PIOGGE: valgono tutto l'anno, per chiunque voglia sapere quanto ha
 *    piovuto. Devono stare in alto su «dove ha piovuto ieri in Garfagnana»,
 *    «quanto ha piovuto in Lunigiana». Sono la mappa, le 23 regioni e queste.
 *  - FUNGHI: la finestra 13-20 giorni fa, «dove andare a funghi oggi», con la
 *    riga di stagione. Sono /funghi/ e tutto quello che ci sta sotto.
 * Fino a oggi una zona esisteva SOLO come pagina funghi, quindi per la pioggia
 * di ieri in Garfagnana non c'era niente da trovare.
 *
 * ⚠️ NON SONO LA COPIA DELLA PAGINA FUNGHI con un altro titolo. Stessa zona e
 * stessi pluviometri, ma altri numeri (ieri, 7 e 30 giorni, invece della
 * finestra dei funghi) e altro testo. Due pagine quasi uguali sullo stesso
 * posto sono il modo piu' sicuro di farne indicizzare nessuna: e' il motivo per
 * cui le localita' «piogge» NON si fanno (1.043 localita' funghi ancora
 * «rilevate, non indicizzate» al 4/9/2026).
 *
 * I NUMERI li prepara genera-riepiloghi.js in data/riepiloghi/zone/<zona>.json,
 * una richiesta per pagina. L'ultimo giorno e' quello COMPLETO: se ieri non e'
 * ancora arrivato da tutte le reti, la scheda dice la data vera.
 *
 * ⚠️ IL FOGLIO DI STILE SI PRENDE DALLA PAGINA REGIONE di casa, come le zone
 * funghi lo prendono dalla pagina funghi: stessa famiglia, stesso aspetto, e un
 * solo posto dove cambiarlo. Quindi si lancia DOPO genera-pagine-regione.js.
 *
 * Uso: node .github/scripts/genera-pagine-zona-piogge.js
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione, elenco, diZona } = require('./lib-nomi.js');
const { perLink } = require('./lib-vicine.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));

const SITO = 'https://avventurepluvio-test.netlify.app';
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const REG_DI = {}, SLUG_DI = {}, ANAG = {};
for (const [k, v] of Object.entries(POSTI)) {
  const sl = slugRegione(v);
  for (const p of v) { REG_DI[p[0]] = k; SLUG_DI[p[0]] = sl[p[0]]; ANAG[p[0]] = p; }
}

function scrivi(dest, testo) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, testo.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
}

function pagina(z) {
  const zslug = slug(z.n);
  const ids = z.posti.filter(id => REG_DI[id]);
  const regioni = [...new Set(ids.map(id => REG_DI[id]))];
  const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regioni[0]);
  const nomeReg = casa.nomeTitolo || casa.nome;
  const agenzie = [...new Set(regioni.map(k => {
    const r = REGIONI.find(x => x.k === k);
    return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null;
  }).filter(Boolean))];
  const REGS = perLink(casa.k, z.lat, z.lon);
  const PIN = 'pl=' + z.lat + ',' + z.lon + '&amp;pn=' + encodeURIComponent(z.n) + '&amp;pz=1';
  const di = diZona(z.dove);

  // Tetto 62 caratteri come tutte le altre: si accorcia solo sui nomi lunghi.
  const TITOLO = [
    `Dove ha piovuto ${z.dove}: ieri e negli ultimi giorni`,
    `Dove ha piovuto ${z.dove}: ieri e ultimi giorni`,
    `Dove ha piovuto ${z.dove}`,
  ].find(t => t.length <= 62) || `Pioggia ${z.dove}`;
  const DESCR = [
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni, pluviometro per pluviometro: ${ids.length} pluviometri di ${elenco(agenzie)}. Aggiornato ogni giorno.`,
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni, pluviometro per pluviometro. Aggiornato ogni giorno.`,
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni.`,
  ].find(t => t.length <= 158);

  const modello = path.join(RADICE, casa.k, 'index.html');
  if (!fs.existsSync(modello)) {
    console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-regione.js');
    process.exit(1);
  }
  const m = fs.readFileSync(modello, 'utf8');
  const STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));

  // Le righe della tabella, cotte coi loro link: i nomi e i link li legge
  // Google, i millimetri e l'ordine li mette il javascript.
  const righe = ids.map(id => ANAG[id]).sort((a, b) => bello(a[1]).localeCompare(bello(b[1]), 'it'))
    .map(p => `<tr data-id="${esc(p[0])}"><td><a href="${SITO}/funghi/${REG_DI[p[0]]}/${SLUG_DI[p[0]]}/">${esc(bello(p[1]))}</a>` +
      `<span class="com">${esc(p[2])} · ${p[3]} m</span></td>` +
      `<td class="mm v1">–</td><td class="mm v7">–</td><td class="mm v30">–</td></tr>`).join('\n');

  const altre = ZONE.filter(x => x.reg === casa.k && x.n !== z.n)
    .sort((a, b) => a.n.localeCompare(b.n, 'it'))
    .map(x => `<a href="${SITO}/zone/${slug(x.n)}/">${esc(x.n)}</a>`).join(' · ');

  const scheda = (id, titolo, cta, largo) => `
  <div class="card${largo ? ' largo' : ''}" id="card${id}">
    <h2 id="tit${id}">${titolo}</h2>
    <div class="numerone" id="rip${id}-media"><span class="attesa">calcolo in corso…</span></div>
    <div id="rip${id}-top"></div>
    <p class="nota" id="rip${id}-date"></p>
    <a class="cta" id="cta${id}" style="margin:14px 0 2px;margin-top:auto;" href="${SITO}/?r=${REGS}&amp;g=${id}&amp;${PIN}"
       onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-${id}gg'})}catch(e){}">${cta}</a>
  </div>`;

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/zone/${zslug}/">
<meta property="og:title" content="${esc('Dove ha piovuto ' + z.dove + ': ieri e ultimi giorni')}">
<meta property="og:description" content="${esc('La pioggia misurata dai pluviometri ' + di + ': ieri, ultimi 7 e 30 giorni.')}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/zone/${zslug}/">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], [nomeReg, `${SITO}/${casa.k}/`], [z.n, null]])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<style>${STILE}
.bric{font-size:14px;color:#666;margin-bottom:6px;}
.bric a{color:var(--blu);}
.tab{width:100%;border-collapse:collapse;font-size:15px;margin:8px 0 6px;}
.tab th{text-align:right;font-size:13px;color:#555;font-weight:600;padding:6px 5px;border-bottom:2px solid var(--bordo);white-space:nowrap;}
.tab th:first-child{text-align:left;}
.tab td{padding:8px 5px;border-bottom:1px solid var(--bordo);vertical-align:top;}
.tab td.mm{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
.tab a{color:var(--blu);text-decoration:none;font-weight:600;}
.tab .com{display:block;font-size:12.5px;color:#777;}
.altre-zone{font-size:15px;line-height:1.9;color:#555;}
.altre-zone a{color:var(--blu);}
@media(max-width:420px){.tab{font-size:14px;}.tab td,.tab th{padding-left:3px;padding-right:3px;}}
</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'zona-piogge-${zslug}'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › <a href="${SITO}/${casa.k}/">${esc(nomeReg)}</a> › ${esc(z.n)}</p>
<h1>Dove ha piovuto ${esc(z.dove)}</h1>
<p class="sotto">Ieri e negli ultimi 30 giorni, dai <b>${ids.length} pluviometri</b> ${esc(di)}, di ${esc(elenco(agenzie))}. Millimetri misurati a terra, non stime.</p>

<div class="griglia">${scheda(1, 'Ieri', 'Apri la mappa di ieri →', false)}${scheda(7, 'Ultimi 7 giorni', 'Apri la mappa a 7 giorni →', false)}${scheda(30, 'Ultimi 30 giorni', 'Apri la mappa a 30 giorni →', true)}
</div>

<h2>I pluviometri ${esc(di)}</h2>
<p class="nota" style="margin-top:0">Dal più bagnato negli ultimi 7 giorni. Il trattino vuol dire che quel pluviometro in quei giorni non ha pubblicato, non che non è piovuto.</p>
<table class="tab">
<thead><tr><th>Pluviometro</th><th id="th1">Ieri</th><th>7 giorni</th><th>30 giorni</th></tr></thead>
<tbody id="righe">
${righe}
</tbody>
</table>

<h2>Sta piovendo adesso?</h2>
<p>Questa pagina conta i millimetri dei giorni <b>già chiusi</b>: la giornata di oggi è
esclusa, perché i pluviometri la stanno ancora misurando. Per la pioggia <b>in corso</b> c'è
la diretta radar: dove sta piovendo in questo momento, le ultime due ore e i quaranta
minuti seguenti.</p>
<a class="cta" href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;radar=ora"
   onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-radar'})}catch(e){}">Guarda il radar della pioggia ${esc(z.dove)} →</a>

<h2>Dati pluviometrici: da dove arrivano</h2>
<p>Sono i pluviometri di <b>${esc(elenco(agenzie))}</b> che stanno ${esc(z.dove)}: strumenti a terra, con il loro nome e la loro quota. Il nome di ogni pluviometro porta alla sua scheda, con la pioggia giorno per giorno.</p>

<h2>Funghi ${esc(z.dove)}</h2>
<p>Per i funghi conta un altro periodo, la pioggia caduta da 13 a 20 giorni fa: <a href="${SITO}/funghi/zone/${zslug}/">dove andare a funghi ${esc(z.dove)}</a>.</p>

<h2>Dove ha piovuto nelle altre zone</h2>
<p class="altre-zone">${altre ? altre + ' · ' : ''}<a href="${SITO}/${casa.k}/"><b>tutta la regione</b></a></p>
</main>

<footer>
  Dati: ${esc(elenco(agenzie))} ·
  <a href="${SITO}/fonti.html">tutte le fonti e licenze</a> ·
  <a href="${SITO}/guida/">guida alla mappa</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a>
</footer>

<script>
(function(){
  var BASE = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname) ? '/data/' : '${RAW}';
  var ZONA = ${JSON.stringify(zslug)}, REGS = ${JSON.stringify(REGS)}, SITO = ${JSON.stringify(SITO)};
  var PIN = ${JSON.stringify(PIN.replace(/&amp;/g, '&'))};
  var MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  var GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function giornoFa(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
  function breve(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  // «l’8» e «l’11»: davanti a una vocale l'articolo si elide.
  function ilGiorno(s){ var g=+String(s).split('-')[2]; return (g===8||g===11?'l’':'il ')+breve(s); }
  function mm(v){ return v==null ? '–' : (Math.round(v*10)/10).toFixed(1).replace('.', ',') + ' mm'; }
  /* «Ieri» solo se e' davvero ieri: il riepilogo puo' essere di altroieri
     (ieri non ancora completo) o essere stato scritto prima di mezzanotte. */
  function nomeGiorno(s){
    if (s === iso(giornoFa(1))) return 'Ieri';
    var p = String(s).split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
    return GIORNI[d.getDay()] + ' ' + breve(s);
  }
  function guasto(){
    ['1','7','30'].forEach(function(k){
      document.getElementById('rip'+k+'-media').innerHTML = '<span class="attesa">dati non disponibili al momento</span>';
    });
  }
  function disegna(k, d){
    var el = document.getElementById('rip'+k+'-media');
    if (!d) { document.getElementById('card'+k).style.display = 'none'; return; }
    el.innerHTML = mm(d.media) + ' <small>di media nella zona</small>';
    var top = document.getElementById('rip'+k+'-top');
    if (!d.top || !d.top.length || d.top[0].mm < 1) {
      top.innerHTML = '<p class="nota">' + (k === '1' ? 'Giornata quasi asciutta' : 'Periodo quasi asciutto') + ' in tutta la zona.</p>';
    } else {
      var ol = document.createElement('ol'); ol.className = 'top-staz';
      d.top.forEach(function(s){ var li = document.createElement('li'); li.textContent = s.n + ' — ' + mm(s.mm); ol.appendChild(li); });
      top.innerHTML = '<p style="margin:8px 0 2px"><b>Dove ha piovuto di più:</b></p>';
      top.appendChild(ol);
    }
    var nota = document.getElementById('rip'+k+'-date');
    if (k === '1') {
      var t = nomeGiorno(d.ultimo);
      document.getElementById('tit1').textContent = t;
      document.getElementById('th1').textContent = t === 'Ieri' ? 'Ieri' : breve(d.ultimo);
      nota.textContent = t === 'Ieri'
        ? 'Giornata di ieri, ' + breve(d.ultimo) + ', su ' + d.stazioni + ' pluviometri.'
        : 'I dati di ieri non sono ancora arrivati da tutti i pluviometri: questa è l’ultima giornata intera, ' + ilGiorno(d.ultimo) + '.';
    } else {
      // «dall’8», «all’11»: davanti a otto e undici la preposizione si apostrofa
      var apo = function (s) { return /^(8|11) /.test(s); };
      nota.textContent = (apo(breve(d.primo)) ? 'Dall’' : 'Dal ') + breve(d.primo) + (apo(breve(d.ultimo)) ? ' all’' : ' al ') + breve(d.ultimo) + ', su ' + d.giorni + ' giornate di dati. La giornata odierna è esclusa.';
    }
    var cta = document.getElementById('cta'+k);
    if (cta && d.primo && d.ultimo) cta.href = SITO + '/?r=' + REGS + '&da=' + d.primo + '&a=' + d.ultimo + '&' + PIN;
  }
  fetch(BASE + 'riepiloghi/zone/' + ZONA + '.json')
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; })
    .then(function(j){
      if (!j || !j.periodi) return guasto();
      disegna('1', j.periodi['1']); disegna('7', j.periodi['7']); disegna('30', j.periodi['30']);
      var corpo = document.getElementById('righe');
      var tr = [].slice.call(corpo.querySelectorAll('tr'));
      tr.forEach(function(r){
        var v = (j.posti || {})[r.getAttribute('data-id')] || [null, null, null];
        r.valore = v[1];
        r.querySelector('.v1').textContent = mm(v[0]);
        r.querySelector('.v7').textContent = mm(v[1]);
        r.querySelector('.v30').textContent = mm(v[2]);
      });
      /* Si SPOSTANO i nodi, non si rifa la tabella: i link devono restare
         quelli cotti nell HTML, che sono quelli che Google legge. */
      tr.sort(function(a, b){
        if (a.valore == null) return 1;
        if (b.valore == null) return -1;
        return b.valore - a.valore;
      }).forEach(function(r){ corpo.appendChild(r); });
    });
})();
</script>
</body>
</html>
`;
}

if (require.main === module) {
  let n = 0;
  for (const z of ZONE) {
    if (!z.posti.some(id => REG_DI[id])) continue;
    scrivi(path.join(RADICE, 'zone', slug(z.n), 'index.html'), pagina(z));
    n++;
  }
  const tot = scriviSitemap(SITO, RADICE);
  console.log(`${n} pagine «dove ha piovuto» di zona scritte, sitemap.xml con ${tot} indirizzi.`);
}
