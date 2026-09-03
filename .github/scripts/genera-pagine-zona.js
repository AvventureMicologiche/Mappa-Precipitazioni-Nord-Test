#!/usr/bin/env node
/**
 * Genera le pagine di ZONA: /funghi/zone/<zona>/.
 *
 * PERCHE' ESISTONO. Le pagine regione rispondono a «piogge per funghi in
 * Toscana», quelle per localita' a «piogge per funghi al Passo del Turchino».
 * Ma un fungaiolo dice **«vado in Garfagnana»**, «vado in Val Trebbia», «vado
 * in Valtellina»: nomina la ZONA, che non e' ne' una regione ne' un paese.
 *
 * ⚠️ 3BMETEO LE PAGINE DI ZONA NON LE HA. Verificato il 3/9/2026:
 * `/meteo-funghi/garfagnana` e `/meteo-funghi/valtellina` rispondono 200 ma
 * servono la STESSA pagina generica (52.162 byte tutt'e due, titolo «Meteo
 * Funghi», nessun nome di zona) — e' un finto 404. Quelle che in Google
 * sembrano pagine di zona sono COMUNI col nome della valle dentro (Castiglione
 * di Garfagnana, Ponte in Valtellina). Qui non si copia nessuno.
 *
 * ══ COME SI DEFINISCE UNA ZONA, che e' tutto il problema ══════════════════
 *
 * ⚠️ NOMINATIM NON REGGE, e non va riprovato. Chieste tutte e 587 le zone che
 * il sito ha gia' in ricerca: **27 hanno un ingombro**. Per le valli informali,
 * cioe' proprio quelle che interessano, OpenStreetMap non ha nessun
 * oggetto-area: «Val Trebbia» restituisce una STRADA STATALE, «Val d'Aveto»
 * una BACHECA INFORMATIVA, «Sila» un ALBERGO. La Valtellina si', la Garfagnana
 * solo come «Unione Comuni Garfagnana».
 *
 * ⚠️ E IL RAGGIO FISSO E' PEGGIO, perche' e' arbitrario e non si vede che lo
 * e': misurato, la Garfagnana passa da 1 a 35 pluviometri fra 8 e 20 km di
 * raggio. Il numero non e' un dettaglio della regola, E' la regola.
 *
 * LA REGOLA, che non ha numeri da inventare: **ogni pluviometro da bosco va
 * alla zona piu' vicina e a nessun'altra**, con un tetto di 30 km per non
 * assegnare un posto a una zona lontana. 933 posti su 948 assegnati.
 * Niente doppioni: col raggio, Val d'Aveto e Appennino ligure si contendevano
 * gli stessi 27 pluviometri.
 * Prova che la regola tiene da sola: **nessuna zona risulta piu' larga di
 * 47 km**, perche' una valle vicina si riprende sempre i posti di confine.
 * L'assegnazione e' gia' cotta in `funghi-zone.json`: qui non si ricalcola.
 *
 * ⚠️ UNA ZONA STA ANCHE A CAVALLO DI PIU REGIONI (la Garfagnana e'
 * emilia+liguria+toscana): la pagina scarica un file dei giorni per ognuna,
 * da una a quattro. E' l'unica delle tre famiglie che fa piu' di una richiesta,
 * e il motivo e' geografico, non tecnico.
 *
 * ⚠️ VA LANCIATO DOPO `genera-pagine-funghi.js`: il foglio di stile lo legge
 * dalla pagina funghi della regione, per non tenerne due copie che divergono.
 */

const fs = require('fs');
const path = require('path');
const { REGIONI } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione } = require('./lib-nomi.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));

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

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// «ARPA Liguria, ARPAE Emilia-Romagna e SIR Toscana»: l'ultimo con la «e», gli
// altri con la virgola. ⚠️ Prima erano uniti tutti con « e » e con tre enti
// usciva «ARPA Liguria e ARPAE Emilia-Romagna e SIR Toscana», due «e» di fila.
function elenco(v) {
  return v.length < 2 ? (v[0] || '') : v.slice(0, -1).join(', ') + ' e ' + v[v.length - 1];
}

// Il genitivo della zona, ricavato dalla preposizione che gia' abbiamo:
// «in Garfagnana» -> «della Garfagnana», «nel Mugello» -> «del Mugello»,
// «sui Monti Lattari» -> «dei Monti Lattari», «sulle Alpi Apuane» -> «delle».
// ⚠️ Anche questo NON si deduce dal genere del nome, si deduce dall'articolo
// che il nome si porta gia' dietro: e' il motivo per cui la preposizione sta
// nell'anagrafe invece di essere ricalcolata ogni volta.
function diZona(dove) {
  const m = dove.match(/^(sull'|negli |nelle |sulle |sui |nel |sul |in )(.*)$/);
  if (!m) return 'della ' + dove;
  const pre = m[1], n = m[2];
  if (pre === 'negli ') return 'degli ' + n;
  if (pre === 'nelle ' || pre === 'sulle ') return 'delle ' + n;
  if (pre === 'sui ') return 'dei ' + n;
  if (pre === 'nel ' || pre === 'sul ') return 'del ' + n;
  if (pre === "sull'") return "dell'" + n;
  return /^[AEIOUÀÈÉÌÒÙ]/.test(n) ? "dell'" + n : 'della ' + n;
}

// id del posto -> regione, e id -> slug della sua pagina localita'
const REG_DI = {};
const SLUG_DI = {};
for (const [k, v] of Object.entries(POSTI)) {
  const sl = slugRegione(v);
  for (const p of v) { REG_DI[p[0]] = k; SLUG_DI[p[0]] = sl[p[0]]; }
}

function pagina(z) {
  const zslug = slug(z.n);
  const regioni = [...new Set(z.posti.map(id => REG_DI[id]))].filter(Boolean);
  const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regioni[0]);
  const nomeReg = casa.nomeTitolo || casa.nome;
  const agenzie = [...new Set(regioni.map(k => {
    const r = REGIONI.find(x => x.k === k);
    return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null;
  }).filter(Boolean))];

  const TITOLO = ('Piogge per funghi ' + z.dove).slice(0, 62);
  const DESCR = 'Quanta pioggia è caduta ' + z.dove + ', misurata da ' + z.posti.length +
    ' pluviometri nelle zone da bosco. La finestra da 13 a 20 giorni fa, quella che conta per i funghi.';

  const modello = path.join(RADICE, 'funghi', casa.k, 'index.html');
  if (!fs.existsSync(modello)) {
    console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-funghi.js');
    process.exit(1);
  }
  const m = fs.readFileSync(modello, 'utf8');
  const STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));

  // L'anagrafe dei soli posti della zona, cotta dentro: sono da 3 a 21 righe,
  // cioe' meno di un chilobyte. Il file dei giorni porta i numeri.
  const anag = z.posti.map(id => {
    const p = POSTI[REG_DI[id]].find(x => x[0] === id);
    return [id, bello(p[1]), p[2], p[3], p[4], p[5], SLUG_DI[id], REG_DI[id]];
  });

  return '<!DOCTYPE html>\n<html lang="it">\n<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + esc(TITOLO) + '</title>\n' +
'<meta name="description" content="' + esc(DESCR) + '">\n' +
'<link rel="canonical" href="' + SITO + '/funghi/zone/' + zslug + '/">\n' +
'<meta property="og:title" content="Piogge per funghi ' + esc(z.dove) + '">\n' +
'<meta property="og:description" content="La pioggia vera, misurata dai pluviometri nelle zone da bosco.">\n' +
'<meta property="og:image" content="' + SITO + '/preview.jpg">\n' +
'<meta property="og:url" content="' + SITO + '/funghi/zone/' + zslug + '/">\n' +
'<meta property="og:type" content="website">\n' +
'<script async src="https://www.googletagmanager.com/gtag/js?id=' + GA_ID + '"></script>\n' +
'<script>\n' +
'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}\n' +
'gtag("js",new Date());\n' +
'if(/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname))gtag("config","' + GA_ID + '");\n' +
'</script>\n' +
'<style>\n' + STILE + '\n' +
'.tre{display:flex;gap:10px;margin:18px 0 6px;flex-wrap:wrap;}\n' +
'.tre > div{flex:1;min-width:150px;background:var(--grigio);border:1px solid var(--bordo);border-radius:9px;padding:12px 14px;}\n' +
'.tre .et{font-size:13px;color:#5a6b80;}\n' +
'.tre .n{font-size:26px;font-weight:700;color:var(--blu-scuro);line-height:1.2;}\n' +
'nav.altre{border-top:1px solid var(--bordo);margin-top:30px;padding-top:14px;font-size:15px;color:#555;}\n' +
'nav.altre b{display:block;color:var(--blu-scuro);font-size:16px;margin:14px 0 2px;}\n' +
'nav.altre p{line-height:1.9;}\n' +
'nav.altre a{color:var(--blu);}\n' +
'</style>\n</head>\n<body>\n\n' +
'<header>\n' +
'  <a href="' + SITO + '/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>\n' +
'  <a class="yt" href="' + CANALE + '?sub_confirmation=1" target="_blank" rel="noopener"\n' +
'     onclick="try{gtag(\'event\',\'click_youtube\',{pulsante:\'zona-' + casa.k + '\'})}catch(e){}">▶ Canale YouTube</a>\n' +
'</header>\n\n<main>\n' +
'<p class="nota" style="margin-bottom:6px"><a href="' + SITO + '/funghi/' + casa.k + '/" style="color:var(--blu)">‹ Piogge per funghi ' + casa.prep + ' ' + esc(nomeReg) + '</a></p>\n\n' +
'<h1>Piogge per funghi ' + esc(z.dove) + '</h1>\n' +
'<p class="sotto">' + esc(nomeReg) + ' · <b>' + z.posti.length + ' pluviometri di ' + esc(elenco(agenzie)) +
   '</b>, nelle zone da bosco ' + esc(diZona(z.dove)) + '. Pioggia misurata, aggiornata ogni giorno.</p>\n\n' +
'<div class="patto">\n' +
'  <p><b>Cosa NON trovi qui:</b> una previsione di quanti funghi ci saranno. Attendibile non la\n' +
'  fa nessuno, e noi non ce la inventiamo.</p>\n' +
'  <p><b>Cosa trovi:</b> quanta acqua è caduta ' + esc(z.dove) + ', pluviometro per pluviometro, con la\n' +
'  data. Il bosco poi lo conosci tu meglio di qualunque sito.</p>\n' +
'</div>\n\n' +
'<div id="attesa">Sto leggendo i pluviometri…</div>\n' +
'<div id="guasto"></div>\n' +
'<div id="testa"></div>\n' +
'<div class="spiega" id="finestra" style="margin-top:14px"></div>\n\n' +
'<div class="tre" id="tre"></div>\n' +
'<p class="nota" id="notamedia"></p>\n\n' +
'<h2>I pluviometri della zona, dal più bagnato</h2>\n' +
'<div id="tabella"></div>\n' +
'<p class="nota" id="notaforte"></p>\n\n' +
'<h2>Ecco cosa vedi sulla mappa</h2>\n' +
'<a href="' + SITO + '/?r=' + casa.k + '" style="display:block;text-decoration:none;">\n' +
'  <img src="' + ANTEPRIME + '/' + casa.k + '.jpg"\n' +
'       alt="La mappa delle piogge ' + casa.prep + ' ' + esc(nomeReg) + '"\n' +
'       width="1600" height="1000" loading="lazy"\n' +
'       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">\n' +
'  <span class="vai-mappa">Apri la mappa su questa zona →</span>\n' +
'</a>\n\n' +
'<h2 style="margin-bottom:12px">Come scegliamo i pluviometri di una zona</h2>\n' +
'<div class="metodo">\n' +
'  <div><span class="n">1</span><b>Ognuno va alla zona più vicina, e a una sola.</b> Non un cerchio\n' +
'  di tot chilometri: quello sarebbe un numero deciso a tavolino, e cambiandolo cambierebbe la\n' +
'  zona. Così invece nessun pluviometro finisce in due zone insieme.</div>\n' +
'  <div><span class="n">2</span><b>Solo posti da bosco.</b> Pluviometro vero, quota fra 200 e 1600\n' +
'  metri, almeno il 37% di bosco entro 3 km sulle mappe di OpenStreetMap.</div>\n' +
'  <div><span class="n">3</span><b>Almeno tre.</b> Sotto i tre pluviometri una zona non ha una\n' +
'  pagina: un numero solo non racconta una valle.</div>\n' +
'</div>\n\n' +
'<div class="avviso">\n' +
'  <b>Una cosa da tenere a mente.</b> Tanta pioggia non vuol dire tanti funghi: contano anche la\n' +
'  temperatura, il vento e il tipo di bosco. <b>La temperatura e il vento ce li abbiamo:</b>\n' +
'  clicca un pluviometro sulla mappa e vedi il suo storico, giorno per giorno, insieme alla pioggia.\n' +
'</div>\n\n' +
'<h2 style="margin-top:30px">Le altre zone ' + esc(casa.prep === 'in' ? 'della ' + nomeReg : casa.prep + ' ' + nomeReg) + '</h2>\n' +
'<nav class="altre"><p>' +
  ZONE.filter(x => x.reg === z.reg && x.n !== z.n)
      .sort((a, b) => a.n.localeCompare(b.n, 'it'))
      .map(x => '<a href="' + SITO + '/funghi/zone/' + slug(x.n) + '/">' + esc(x.n) + '</a>').join(' · ') +
  (ZONE.filter(x => x.reg === z.reg && x.n !== z.n).length ? '' : "<span class=\"nota\">È l'unica zona di questa regione.</span>") +
'</p></nav>\n\n' +
'<p class="nota" style="margin-top:22px">Dati di ' + esc(elenco(agenzie)) + ' via il nostro archivio. Il\n' +
'bosco è calcolato su dati OpenStreetMap, licenza ODbL.</p>\n' +
'</main>\n\n' +
'<footer>\n' +
'  <a href="' + SITO + '/">Mappa delle piogge</a> ·\n' +
'  <a href="' + SITO + '/' + casa.k + '/">Dove ha piovuto ' + casa.prep + ' ' + esc(nomeReg) + '</a> ·\n' +
'  <a href="' + SITO + '/funghi/' + casa.k + '/">Piogge per funghi ' + casa.prep + ' ' + esc(nomeReg) + '</a> ·\n' +
'  <a href="' + SITO + '/fonti.html">tutte le fonti e licenze</a><br>\n' +
'  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.\n' +
'</footer>\n\n' +
'<script>\n(function(){\n' +
'  var SITO = ' + JSON.stringify(SITO) + ', MAPPA = SITO + "/";\n' +
'  var ZONA = ' + JSON.stringify(z.n) + ', DOVE = ' + JSON.stringify(z.dove) + ';\n' +
'  var CASA = ' + JSON.stringify(casa.k) + ', REGIONI = ' + JSON.stringify(regioni) + ';\n' +
'  var LAT = ' + z.lat + ', LON = ' + z.lon + ';\n' +
'  /* [ id, nome, sigla, quota, lat, lon, slug, regione ] */\n' +
'  var POSTI = ' + JSON.stringify(anag) + ';\n' +
'  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);\n' +
'  var BASE = LOCALE ? "/data/"\n' +
'    : "https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/";\n' +
'  var FORTE = 30, GIORNI = 25;\n\n' +
'  var MESI=["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];\n' +
'  function iso(d){ var p=function(n){return String(n).padStart(2,"0");};\n' +
'    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }\n' +
'  function menoDa(s,n){ var p=String(s).split("-");\n' +
'    var d=new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()-n); return d; }\n' +
'  function gg(s){ var p=String(s).split("-"); return (+p[2])+" "+MESI[(+p[1])-1]; }\n' +
'  function esc(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }\n' +
'  function uno(n){ return Math.round(n*10)/10; }\n' +
'  function num(n){ return uno(n).toFixed(1).replace(".", ","); }\n' +
'  function somma(s,da,a){ var t=0; for(var n=da;n>=a;n--) t += (s[n-1]||0); return uno(t); }\n\n' +
'  /* Stessa regola delle altre pagine: un giro saltato si perdona, due no. */\n' +
'  function fresco(j){\n' +
'    if(!j || !j.generato || !j.serie || !j.oggi) return false;\n' +
'    var eta = Date.now() - new Date(j.generato).getTime();\n' +
'    return eta >= 0 && eta < 36*3600*1000;\n' +
'  }\n\n' +
'  /* ⚠️ UNA ZONA STA ANCHE A CAVALLO DI PIU REGIONI, quindi qui i file sono\n' +
'     da uno a quattro. Si aspettano tutti e si uniscono le serie; se ne manca\n' +
'     anche uno solo si va sul guasto: una classifica a cui manca meta\n' +
'     valle vale meno di nessuna classifica. */\n' +
'  Promise.all(REGIONI.map(function(k){\n' +
'    return fetch(BASE + "funghi/" + k + "-giorni.json")\n' +
'      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });\n' +
'  })).then(function(js){\n' +
'    var buoni = js.filter(function(j){ return j && fresco(j); });\n' +
'    if(buoni.length !== REGIONI.length) return guasto();\n' +
'    var serie = {}, oggi = null;\n' +
'    buoni.forEach(function(j){ Object.keys(j.serie).forEach(function(id){ serie[id] = j.serie[id]; });\n' +
'                               if(!oggi || j.oggi < oggi) oggi = j.oggi; });\n' +
'    var righe = POSTI.filter(function(p){ return serie[p[0]]; });\n' +
'    if(righe.length < 2) return guasto();\n' +
'    disegna(serie, oggi, righe);\n' +
'  }).catch(function(){ guasto(); });\n\n' +
'  function guasto(){\n' +
'    document.getElementById("attesa").style.display="none";\n' +
'    var g=document.getElementById("guasto");\n' +
'    g.style.display="block";\n' +
'    g.innerHTML="⚠️ Non riesco a leggere l’archivio delle piogge in questo momento. Non dipende "\n' +
'      + "da te: riprova fra qualche minuto, oppure vai direttamente "\n' +
'      + "<a href=\\"" + MAPPA + "?r=" + CASA + "\\">sulla mappa</a>.";\n' +
'  }\n\n' +
'  function disegna(serie, oggi, righe){\n' +
'    var daG = iso(menoDa(oggi,20)), aG = iso(menoDa(oggi,13)), a20 = iso(menoDa(oggi,1));\n' +
'    var dati = righe.map(function(p){\n' +
'      var s = serie[p[0]];\n' +
'      var forte = null;\n' +
'      for(var n=1;n<=GIORNI;n++) if(s[n-1] >= FORTE){ forte = {g:n, mm:s[n-1]}; break; }\n' +
'      return { id:p[0], n:p[1], sig:p[2], q:p[3], lat:p[4], lon:p[5], slug:p[6], reg:p[7],\n' +
'               mm:somma(s,20,13), mm7:somma(s,7,1), mm25:somma(s,GIORNI,1), forte:forte };\n' +
'    }).sort(function(a,b){ return b.mm - a.mm; });\n\n' +
'    var med = function(c){ var t=0; dati.forEach(function(x){ t+=x[c]; }); return uno(t/dati.length); };\n' +
'    var primo = dati[0];\n\n' +
'    function link(x, dal, al){\n' +
'      return MAPPA + "?r=" + (x ? x.reg : CASA) + "&da=" + dal + "&a=" + al\n' +
'        + "&z=10&c=" + (x ? x.lat.toFixed(4)+","+x.lon.toFixed(4) : LAT.toFixed(4)+","+LON.toFixed(4));\n' +
'    }\n\n' +
'    document.getElementById("testa").innerHTML =\n' +
'      "<div class=\\"capo\\"><div class=\\"et\\">Dove ha piovuto di più " + esc(DOVE) + " fra 13 e 20 giorni fa?</div>"\n' +
'      + "<div class=\\"gr\\">" + esc(primo.n) + "</div>"\n' +
'      + "<div class=\\"pic\\">" + num(primo.mm) + " mm, dal " + gg(daG) + " al " + gg(aG) + "</div>"\n' +
'      + "<div class=\\"capo-btns\\">"\n' +
'      + "<a class=\\"capo-btn\\" href=\\"" + link(primo, daG, aG) + "\\">Apri mappa · 13-20 gg fa</a>"\n' +
'      + "<a class=\\"capo-btn\\" href=\\"" + link(null, daG, a20) + "\\">Apri mappa · ultimi 20 gg</a>"\n' +
'      + "<a class=\\"capo-btn\\" href=\\"" + SITO + "/funghi/zone/\\" style=\\"display:none\\">.</a>"\n' +
'      + "</div></div>";\n\n' +
'    document.getElementById("finestra").innerHTML =\n' +
'      "Qui la pioggia è caduta fra il <b>" + gg(daG) + "</b> e il <b>" + gg(aG) + "</b>, cioè da "\n' +
'      + "<b>13 a 20 giorni fa</b>. Dopo l’acqua il fungo non spunta subito: per svilupparsi gli "\n' +
'      + "servono <b>almeno 12-13 giorni</b>, a seconda della temperatura. È questa la pioggia "\n' +
'      + "che fa nascere i funghi <b>adesso</b>.";\n\n' +
'    document.getElementById("tre").innerHTML =\n' +
'      "<div><div class=\\"et\\">Media 13-20 giorni fa</div><div class=\\"n\\">" + num(med("mm")) + " mm</div></div>"\n' +
'      + "<div><div class=\\"et\\">Media ultimi 7 giorni</div><div class=\\"n\\">" + num(med("mm7")) + " mm</div></div>"\n' +
'      + "<div><div class=\\"et\\">Media ultimi 25 giorni</div><div class=\\"n\\">" + num(med("mm25")) + " mm</div></div>";\n\n' +
'    document.getElementById("notamedia").innerHTML =\n' +
'      "Medie sui <b>" + dati.length + " pluviometri</b> da bosco della zona. Il più bagnato nella "\n' +
'      + "finestra dei funghi è <b>" + esc(primo.n) + "</b> con " + num(primo.mm) + " mm, il più asciutto "\n' +
'      + "<b>" + esc(dati[dati.length-1].n) + "</b> con " + num(dati[dati.length-1].mm) + ".";\n\n' +
'    document.getElementById("tabella").innerHTML =\n' +
'      "<table class=\\"vic\\"><thead><tr><th>Località</th><th>13-20 gg fa</th>"\n' +
'      + "<th>Ultimi 7</th><th class=\\"tagl\\">Ultimi 25</th></tr></thead><tbody>"\n' +
'      + dati.map(function(r){\n' +
'          return "<tr><td><a class=\\"loc\\" href=\\"" + SITO + "/funghi/" + r.reg + "/" + r.slug + "/\\"><b>"\n' +
'            + esc(r.n) + "</b></a><span class=\\"com\\">" + esc(r.sig) + " · " + r.q + " MT</span></td>"\n' +
'            + "<td class=\\"mm\\"><span class=\\"v" + (r.mm>0?"":" zero") + "\\">" + (r.mm>0?num(r.mm):"—") + "</span></td>"\n' +
'            + "<td class=\\"mm\\"><span class=\\"v" + (r.mm7>0?"":" zero") + "\\">" + (r.mm7>0?num(r.mm7):"—") + "</span></td>"\n' +
'            + "<td class=\\"mm tagl\\"><span class=\\"v\\">" + num(r.mm25) + "</span></td></tr>";\n' +
'        }).join("")\n' +
'      + "</tbody></table>";\n\n' +
'    var conForte = dati.filter(function(r){ return r.forte; }).length;\n' +
'    document.getElementById("notaforte").innerHTML =\n' +
'      "«Pioggia forte» vuol dire almeno " + FORTE + " mm in un giorno solo: è quella che bagna "\n' +
'      + "davvero il terreno. Negli ultimi " + GIORNI + " giorni ne hanno avuta "\n' +
'      + (conForte === dati.length ? "<b>tutti</b> i pluviometri della zona"\n' +
'         : conForte === 0 ? "<b>nessun</b> pluviometro della zona"\n' +
'         : "<b>" + conForte + " pluviometri su " + dati.length + "</b>") + ". "\n' +
'      + "Ogni nome della tabella porta alla sua pagina, con la pioggia giorno per giorno.";\n\n' +
'    document.getElementById("attesa").style.display = "none";\n' +
'  }\n' +
'}());\n</script>\n</body>\n</html>\n';
}

if (require.main === module) {
  let scritte = 0;
  for (const z of ZONE) {
    const html = pagina(z);
    // ⚠️ SI CONTROLLA CHE LO SCRIPT DELLA PAGINA GIRI, prima di scriverla:
    // qui i nomi sono 114 e ci sono «Val d'Aveto», «Alta Val d'Enza».
    const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
    try { new Function(html.slice(i + 8, j)); }
    catch (e) {
      console.error(`⚠️ ${z.n}: lo script della pagina non gira — ${e.message}`);
      process.exit(1);
    }
    const dir = path.join(RADICE, 'funghi', 'zone', slug(z.n));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    scritte++;
  }
  const voci = scriviSitemap(SITO, RADICE);
  console.log(`${scritte} pagine di zona scritte, sitemap.xml con ${voci} indirizzi.`);
}

module.exports = { ZONE };
