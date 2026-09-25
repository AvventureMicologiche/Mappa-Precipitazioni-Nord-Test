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
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione, elenco, diZona } = require('./lib-nomi.js');
const { rigaStagione } = require('./lib-stagione.js');
const { perLink } = require('./lib-vicine.js');
const { scriviSitemap } = require('./genera-sitemap.js');
const { haBoschi, cartaBreve, cartaDi, fonteNota } = require('./lib-boschi.js');
// Il ritratto dell'archivio, cotto dentro la pagina: il perche' sta in cima
// a lib-clima.js. Qui e' di zona, cioe' la media dei suoi pluviometri.
const { clima, buono, dataBella, meseBello, migliaia, virgola } = require('./lib-clima.js');
// 24/9/2026: grafica e codice di pagina comuni con le pagine di regione
const { STILE_NUOVO, JS_COMUNE } = require('./lib-pagina-funghi.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));

const SITO = 'https://avventurepluvio-test.netlify.app';
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// elenco() e diZona() stanno in lib-nomi.js dal 13/9/2026: le usa anche
// genera-pagine-zona-piogge.js.

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

  // IL SEGNAPOSTO NEL LINK (3/9/2026). pl = coordinate del centro della zona,
  // pn = nome, pz=1 = e' un AREA e non un paese, quindi la mappa la inquadra
  // piu' larga (una tacca di zoom in meno). Senza, chi cliccava da una pagina
  // di zona si trovava la regione intera senza sapere dove guardare.
  const PIN = 'pl=' + z.lat + ',' + z.lon + '&amp;pn=' + encodeURIComponent(z.n) + '&amp;pz=1';
  // NON la sola regione di casa: una valle sul crinale ha meta' dei suoi
  // pluviometri dall'altra parte (la Garfagnana ne ha di Emilia e Liguria).
  // Stesso criterio della ricerca per localita' del sito, vedi lib-vicine.
  const REGS = perLink(casa.k, z.lat, z.lon);
  const agenzie = [...new Set(regioni.map(k => {
    const r = REGIONI.find(x => x.k === k);
    return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null;
  }).filter(Boolean))];

  // ⚠️ 13/9/2026: «DOVE ANDARE A FUNGHI OGGI». Le zone escono gia' in prima
  // pagina su «funghi in garfagnana oggi» (114 viste in 28 giorni, ottavo
  // posto) col titolo «Piogge per funghi in Garfagnana», che la domanda vera
  // non l'aveva. ⚠️ «Oggi» si' e tutto l'anno: fuori stagione ci tutela la riga
  // di stagione sotto il titolo (lib-stagione.js). Tetto 62 caratteri.
  // ⚠️ 24/9/2026: «stanno nascendo?» in coda, come sulle pagine di paese.
  // Davanti resta «Funghi <zona> oggi», la forma delle ricerche vere.
  const TITOLO = [
    'Funghi ' + z.dove + ' oggi: stanno nascendo?',
    'Funghi ' + z.dove + ' oggi',
  ].find(t => t.length <= 62) || ('Funghi ' + z.dove).slice(0, 62);
  const DESCR = [
    'Stanno nascendo funghi ' + z.dove + '? Le piogge degli ultimi 25 giorni, giorno per giorno, da ' + z.posti.length + ' pluviometri da bosco. Aggiornato ogni mattina.',
    'Stanno nascendo funghi ' + z.dove + '? Le piogge degli ultimi 25 giorni da ' + z.posti.length + ' pluviometri da bosco.',
  ].find(t => t.length <= 158) || ('Funghi ' + z.dove + ' oggi: le piogge degli ultimi 25 giorni.');

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

  // ⚠️ IL RITRATTO DI UNA ZONA E' LA MEDIA DEI SUOI PLUVIOMETRI, e si fa solo
  // su quelli che hanno lo STESSO periodo alle spalle: uno entrato in archivio
  // a meta' abbasserebbe la media per un motivo che con la pioggia non c'entra.
  // Una zona sta anche a cavallo di piu' regioni, quindi l'archivio si chiede
  // regione per regione.
  const climi = {};
  for (const k of regioni) {
    const r = REGIONI.find(x => x.k === k);
    if (r) climi[k] = clima(r.dirs);
  }
  const perZona = z.posti
    .map(id => ({ id, n: bello((POSTI[REG_DI[id]].find(x => x[0] === id) || [])[1] || ''),
                  c: (climi[REG_DI[id]] || {})[id] }))
    .filter(x => buono(x.c));
  let RITRATTO = null;
  if (perZona.length >= 3) {
    // ⚠️ Il gruppo e' il PIU' NUMEROSO a pari periodo, non il piu' lungo: una
    // zona a cavallo di due regioni ha due archivi che partono in giorni
    // diversi (la Garfagnana: 90 giorni in Emilia, 55 in Toscana) e prendendo
    // i piu' lunghi restavano due pluviometri, cioe' nessun ritratto.
    let pari = [];
    for (const x of perZona) {
      const g = perZona.filter(y => y.c.giorni >= x.c.giorni * 0.9 && y.c.giorni <= x.c.giorni * 1.1);
      if (g.length > pari.length) pari = g;
    }
    if (pari.length >= 3) {
      const ord = pari.slice().sort((a, b) => b.c.mm - a.c.mm);
      const forte = pari.slice().sort((a, b) => b.c.maxMm - a.c.maxMm)[0];
      RITRATTO = {
        quanti: pari.length,
        giorni: Math.min(...pari.map(x => x.c.giorni)),
        dal: pari.map(x => x.c.dal).sort()[0],
        al: pari.map(x => x.c.al).sort().slice(-1)[0],
        media: Math.round(pari.reduce((s, x) => s + x.c.mm, 0) / pari.length),
        alto: ord[0], basso: ord[ord.length - 1], forte,
      };
    }
  }
  const meseIso = s => { const [a, m] = s.split('-'); return meseBello(a + '-' + m); };

  // La tabella dei pluviometri, cotta con i suoi link. Fino al 4/9/2026
  // nasceva a pagina aperta: nell'HTML servito la zona non linkava NESSUNA
  // delle sue localita', e le 114 zone erano un vicolo cieco per chi indicizza.
  // I millimetri e l'ordine restano al javascript: quelli cambiano ogni giorno.
  const righeTab = anag.slice().sort((a, b) => a[1].localeCompare(b[1], 'it'))
    .map(a => '<tr data-id="' + esc(a[0]) + '"><td><a class="loc" href="' + SITO + '/funghi/' +
      a[7] + '/' + a[6] + '/"><b>' + esc(a[1]) + '</b></a><span class="com">' + esc(a[2]) +
      ' · ' + a[3] + ' m</span></td>' +
      '<td class="mm"><span class="v">…</span></td>' +
      '<td class="mm"><span class="v">…</span></td>' +
      '<td class="mm tagl"><span class="v">…</span></td></tr>').join('\n');

  // ⚠️ 24/9/2026: STESSO SCHEMA DELLE PAGINE DI PAESE (deciso da lui): prima
  // i dati (ha piovuto abbastanza? le barre, la pioggia che conta, le mappe,
  // i pluviometri), in fondo le spiegazioni. Qui i numeri sono la MEDIA dei
  // pluviometri della zona, giorno per giorno.
  const PIN_A = PIN + '&amp;z=10&amp;c=' + z.lat + ',' + z.lon;
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/funghi/zone/${zslug}/">
<meta property="og:title" content="Funghi ${esc(z.dove)} oggi: stanno nascendo?">
<meta property="og:description" content="Le piogge degli ultimi 25 giorni, misurate dai pluviometri nelle zone da bosco.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/funghi/zone/${zslug}/">
<meta property="og:type" content="website">
${briciolaJson([
  ['Piogge per funghi', SITO + '/funghi/'],
  [nomeReg, SITO + '/funghi/' + casa.k + '/'],
  [z.n, null],
])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag("js",new Date());
if(/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname))gtag("config","${GA_ID}");
</script>
<style>
${STILE}
${STILE_NUOVO}
nav.altre{border-top:1px solid var(--bordo);margin-top:30px;padding-top:14px;font-size:15px;color:#555;}
nav.altre b{display:block;color:var(--blu-scuro);font-size:16px;margin:14px 0 2px;}
nav.altre p{line-height:1.9;}
nav.altre a{color:var(--blu);}
</style>
</head>
<body>

<header>
  <a href="${SITO}/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>
  <a class="yt" href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'zona-${casa.k}'})}catch(e){}">▶ <span class="yt-l">Canale </span>YouTube</a>
</header>

<main>
<p class="nota" style="margin-bottom:6px"><a href="${SITO}/funghi/" style="color:var(--blu)">‹ Piogge per funghi</a> <span style="color:#9aa7b8">›</span> <a href="${SITO}/funghi/${casa.k}/" style="color:var(--blu)">${esc(nomeReg)}</a></p>

<h1>Funghi ${esc(z.dove)} oggi: stanno nascendo?</h1>
${rigaStagione()}

<div id="attesa">Sto leggendo i pluviometri…</div>
<div id="guasto"></div>
<div id="verdetto"></div>

<h2>Le piogge degli ultimi 25 giorni</h2>
<div id="grafico"></div>
<p class="nota" id="ieri"></p>

<h2 id="h-conta">Però attenzione: la pioggia che conta è quella caduta da 13 a 20 giorni fa</h2>
<p class="breve" id="p-conta">Il fungo spunta 12-13 giorni dopo una bella pioggia: i funghi di oggi nascono da queste otto giornate.</p>
<div id="finestra"></div>

<h2>Com'è andata intorno? Apri le mappe</h2>
<div class="tasti">
  <a class="forte" id="t-conta" href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN_A}">13-20 gg fa</a>
  <a href="${SITO}/?r=${REGS}&amp;g=1&amp;${PIN_A}">Ieri</a>
  <a href="${SITO}/?r=${REGS}&amp;g=7&amp;${PIN_A}">Ultimi 7 gg</a>
  <a href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN_A}">Ultimi 20 gg</a>
  <a href="${SITO}/?r=${REGS}&amp;g=30&amp;${PIN_A}">Ultimi 30 gg</a>
  <a href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'zona-${zslug}-radar'})}catch(e){}">📡 Radar adesso</a>
</div>
<p class="breve">La pioggia degli ultimi 20 giorni ${casa.prep} ${esc(nomeReg)}, stazione per stazione.</p>
<a href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN_A}" id="lnk-pioggia"
   onclick="try{gtag('event','apri_mappa',{da:'zona-${zslug}-20gg'})}catch(e){}">
  <img class="img-mappa" src="${ANTEPRIME}/${casa.k}.jpg" alt="La mappa delle piogge ${casa.prep} ${esc(nomeReg)}"
       width="1600" height="1000" loading="lazy"></a>

<h2 style="font-size:18px">I pluviometri della zona, dal più bagnato</h2>
<table class="vic"><thead><tr><th>Località</th><th>13-20 gg fa</th><th>Ultimi 7</th><th class="tagl">Ultimi 25</th></tr></thead>
<tbody id="tabella">
${righeTab}
</tbody></table>
<p class="nota">Ogni nome porta alla sua pagina, con la pioggia giorno per giorno.</p>

<div id="meteo"></div>

${haBoschi(casa.k) ? `<h2>Che boschi ci sono nella zona</h2>
<p class="breve">Faggete, castagneti, querceti e abetaie colorati per tipo, con il rilievo sotto.</p>
<a href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;boschi=1" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'zona-${zslug}-boschi'})}catch(e){}">
  <img class="img-mappa" src="${SITO}/tessere-boschi/anteprime/${casa.k}.jpg"
       alt="La mappa boschi ${casa.prep} ${esc(nomeReg)}: faggete, castagneti, querceti e abetaie colorati per tipo"
       width="1600" height="1000" loading="lazy">
  <span class="vai-mappa">🌲 Guarda i boschi ${esc(z.dove)}</span>
</a>
<p class="nota">La pioggia dice quando andare, il bosco dice dove. I boschi vengono da ${esc(fonteNota(casa.k))}.</p>
` : ''}
<div class="noioso">
<h2>Come funziona questa pagina</h2>
<p>I millimetri li misurano i <b>${z.posti.length} pluviometri</b> di ${esc(elenco(agenzie))} nelle zone
da bosco ${esc(diZona(z.dove))}: quota fra 200 e 1600 metri e almeno il 37% di bosco entro 3 km.
I numeri in cima sono la media dei pluviometri, giorno per giorno. Ogni pluviometro va alla zona più
vicina, e a una sola. La giornata di oggi non è contata perché i pluviometri la stanno ancora misurando.</p>
<p>Perché da 13 a 20 giorni fa: dopo una pioggia il fungo impiega almeno dodici o tredici giorni
a spuntare, di più se fa freddo. La pioggia di ieri serve ai funghi fra due settimane.</p>
<p>Ti serve un altro periodo? Per ieri e gli ultimi 30 giorni c’è
<a href="${SITO}/zone/${zslug}/">dove ha piovuto ${esc(z.dove)}</a>.</p>
${RITRATTO ? `<h2>L'archivio della zona</h2>
<p>Da ${meseIso(RITRATTO.dal)} a ${meseIso(RITRATTO.al)}, in ${RITRATTO.giorni} giorni di misura, i ${RITRATTO.quanti} pluviometri
${esc(diZona(z.dove))}${RITRATTO.quanti < z.posti.length ? ' che leggiamo dallo stesso giorno' : ''} hanno contato
<b>${migliaia(RITRATTO.media)} mm</b> di pioggia a testa, in media. Il più bagnato è <b>${esc(RITRATTO.alto.n)}</b> con
${migliaia(RITRATTO.alto.c.mm)} mm, il più asciutto ${esc(RITRATTO.basso.n)} con ${migliaia(RITRATTO.basso.c.mm)}.
La giornata più piovosa è stata il <b>${dataBella(RITRATTO.forte.c.maxData)}</b> a ${esc(RITRATTO.forte.n)},
con <b>${virgola(RITRATTO.forte.c.maxMm)} mm</b>.</p>` : ''}
<p><b>Ricordati</b> che in molte regioni per raccogliere funghi serve il tesserino, e che nei parchi
valgono regole proprie.</p>
<p>Dati di ${esc(elenco(agenzie))} via il nostro archivio. Il bosco entro 3 km è calcolato su dati
OpenStreetMap, licenza ODbL.</p>
</div>
<p style="margin:22px 0 4px;"><a href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener" style="color:#e12b2b;font-weight:600;display:inline-flex;align-items:center;gap:7px;text-decoration:none;"
   onclick="try{gtag('event','click_youtube',{pulsante:'zona-fondo-${casa.k}'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a></p>

<h2 style="margin-top:30px">Le altre zone ${esc(casa.prep === 'in' ? 'della ' + nomeReg : casa.prep + ' ' + nomeReg)}</h2>
<nav class="altre"><p>${
  ZONE.filter(x => x.reg === z.reg && x.n !== z.n)
      .sort((a, b) => a.n.localeCompare(b.n, 'it'))
      .map(x => '<a href="' + SITO + '/funghi/zone/' + slug(x.n) + '/">' + esc(x.n) + '</a>').join(' · ')
  || '<span class="nota">È l’unica zona di questa regione.</span>'
}</p></nav>
</main>

<footer>
  <a href="${SITO}/">Mappa delle piogge</a> ·
  <a href="${SITO}/${casa.k}/">Dove ha piovuto ${casa.prep} ${esc(nomeReg)}</a> ·
  <a href="${SITO}/funghi/${casa.k}/">Piogge per funghi ${casa.prep} ${esc(nomeReg)}</a> ·
  <a href="${SITO}/fonti.html">tutte le fonti e licenze</a><br>
  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.
</footer>

<script>
(function(){
  var SITO = ${JSON.stringify(SITO)}, MAPPA = SITO + "/";
  var ZONA = ${JSON.stringify(z.n)}, DOVE = ${JSON.stringify(z.dove)};
  var REGIONI = ${JSON.stringify(regioni)}, REGS = ${JSON.stringify(REGS)};
  var LAT = ${z.lat}, LON = ${z.lon};
  /* [ id, nome, sigla, quota, lat, lon, slug, regione ] */
  var POSTI = ${JSON.stringify(anag)};
  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var BASE = LOCALE ? "/data/"
    : "https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/";
${JS_COMUNE}

  function fresco(j){
    if(!j || !j.generato || !j.serie || !j.oggi) return false;
    var eta = Date.now() - new Date(j.generato).getTime();
    return eta >= 0 && eta < 36*3600*1000;
  }
  /* ⚠️ UNA ZONA STA ANCHE A CAVALLO DI PIU REGIONI: i file sono da uno a
     quattro, si aspettano tutti e si uniscono. Se ne manca uno si va sul
     guasto: una media a cui manca meta valle vale meno di nessuna. */
  Promise.all(REGIONI.map(function(k){
    return fetch(BASE + "funghi/" + k + "-giorni.json")
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  })).then(function(js){
    var buoni = js.filter(function(j){ return j && fresco(j); });
    if (buoni.length !== REGIONI.length) return guasto();
    var serie = {}, serieT = {}, oggi = null;
    buoni.forEach(function(j){
      Object.keys(j.serie).forEach(function(id){ serie[id] = j.serie[id]; });
      Object.keys(j.serieT || {}).forEach(function(id){ serieT[id] = j.serieT[id]; });
      if (!oggi || j.oggi < oggi) oggi = j.oggi;
    });
    var righe = POSTI.filter(function(p){ return serie[p[0]]; });
    if (righe.length < 2) return guasto();
    disegna(serie, serieT, oggi, righe);
  }).catch(function(){ guasto(); });

  function guasto(){
    document.getElementById("attesa").style.display = "none";
    var g = document.getElementById("guasto");
    g.style.display = "block";
    g.innerHTML = "⚠️ Non riesco a leggere l’archivio delle piogge in questo momento. Non dipende "
      + "da te: riprova fra qualche minuto, oppure vai direttamente "
      + "<a href=\\"" + MAPPA + "?r=" + REGS + "\\">sulla mappa</a>.";
  }

  function link(dal, al){
    return MAPPA + "?r=" + REGS + "&da=" + dal + "&a=" + al
      + "&pl=" + LAT.toFixed(4) + "," + LON.toFixed(4) + "&pn=" + encodeURIComponent(ZONA) + "&pz=1"
      + "&z=10&c=" + LAT.toFixed(4) + "," + LON.toFixed(4);
  }

  function disegna(serie, serieT, oggi, righe){
    document.getElementById("attesa").style.display = "none";
    /* la serie della ZONA: media dei pluviometri, giorno per giorno. Un
       giorno senza dato non e uno zero: si media su chi c e. */
    var s = [];
    for (var i = 0; i < GIORNI; i++) {
      var t = 0, n = 0;
      righe.forEach(function(p){ var v = serie[p[0]][i]; if (v != null) { t += v; n++; } });
      s.push(n ? uno(t / n) : 0);
    }
    var sT = [];
    for (var i2 = 0; i2 < GIORNI; i2++) {
      var a = 0, b = 0, n2 = 0;
      righe.forEach(function(p){ var v = (serieT[p[0]] || [])[i2]; if (v) { a += v[0]; b += v[1]; n2++; } });
      sT.push(n2 ? [uno(a / n2), uno(b / n2)] : null);
    }
    var daG = iso(menoDa(oggi,20)), aG = iso(menoDa(oggi,13)), ieri = iso(menoDa(oggi,1));
    scriviVerdetto(s, oggi, link(daG, ieri), "in media, negli ultimi 20 giorni");
    var ax = scriviBarre(s, oggi);
    document.getElementById("ieri").innerHTML = "Ieri, " + gg(ieri) + ": in media <b>" + num(s[0]) + " mm</b> sui "
      + righe.length + " pluviometri della zona.";
    scriviFinestra(s, oggi, null, "in media");
    document.getElementById("t-conta").href = link(daG, aG);
    document.getElementById("lnk-pioggia").href = link(daG, ieri);
    if (sT.some(function(x){ return x; })) scriviTemperatura(sT, ax, "media dei pluviometri della zona");

    /* ⚠️ La tabella e GIA NELL HTML coi link: qui si riempiono le caselle e si
       RIORDINA dal piu bagnato spostando le righe, senza innerHTML. */
    var dati = {};
    righe.forEach(function(p){ var ss = serie[p[0]]; dati[p[0]] = { mm: somma(ss,20,13), mm7: somma(ss,7,1), mm25: somma(ss,GIORNI,1) }; });
    var corpo = document.getElementById("tabella");
    var trs = [].slice.call(corpo.querySelectorAll("tr[data-id]"));
    var mx = 1; Object.keys(dati).forEach(function(id){ mx = Math.max(mx, dati[id].mm); });
    trs.forEach(function(tr){
      var d = dati[tr.getAttribute("data-id")], cel = tr.querySelectorAll(".mm .v");
      if (cel.length < 3) return;
      if (!d) { for (var c = 0; c < 3; c++) { cel[c].textContent = "—"; cel[c].className = "v zero"; } return; }
      cel[0].textContent = d.mm > 0 ? num(d.mm) + " mm" : "—"; cel[0].className = d.mm > 0 ? "v" : "v zero";
      if (d.mm > 0) { var ba = document.createElement("span"); ba.className = "barra";
        ba.style.width = Math.round(d.mm / mx * 100) + "%"; cel[0].parentNode.insertBefore(ba, cel[0]); }
      cel[1].textContent = d.mm7 > 0 ? num(d.mm7) : "—"; cel[1].className = d.mm7 > 0 ? "v" : "v zero";
      cel[2].textContent = num(d.mm25); cel[2].className = "v";
    });
    trs.sort(function(x, y){
      var a2 = dati[x.getAttribute("data-id")], b2 = dati[y.getAttribute("data-id")];
      return (b2 ? b2.mm : -1) - (a2 ? a2.mm : -1);
    });
    trs.forEach(function(tr){ corpo.appendChild(tr); });
  }
}());
</script>
</body>
</html>
`;
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
