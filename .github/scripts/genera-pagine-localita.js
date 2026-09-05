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
// ⚠️ `slug` si chiama qui `slugDaNome`: dentro pagina() c'e' gia' un parametro
// che si chiama slug ed e' una STRINGA. Importandola col suo nome la funzione
// veniva coperta e usciva «slug is not a function» solo a generazione avviata,
// non al controllo di sintassi.
const { LOCALITA, bello, slug: slugDaNome, slugRegione } = require('./lib-nomi.js');
const { perLink } = require('./lib-vicine.js');
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
/* le due linee della temperatura: stessa larghezza del grafico della pioggia,
   cosi' i giorni stanno incolonnati e si leggono insieme */
/* ⚠️ LA SCALA STA FUORI DALL'SVG. Il disegno e' stirato in larghezza
   (preserveAspectRatio="none"): un <text> dentro uscirebbe schiacciato,
   e per lo stesso motivo il tratto delle linee ha vector-effect. Le
   tacche sono <span> posizionati in percentuale sopra il disegno. */
.tt-box{position:relative;padding-right:42px;margin:14px 0 2px;}
.tt{width:100%;height:150px;display:block;overflow:visible;}
.tt .griglia{stroke:#e6eaf0;stroke-width:1;vector-effect:non-scaling-stroke;}
.tt polyline{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round;
  vector-effect:non-scaling-stroke;}
.tt .max{stroke:#d1603d;}
.tt .min{stroke:#3a6ea8;}
/* Il vento GIALLO come nel pannello della mappa (#ffd54f di histRenderLinee):
   stessa grandezza, stesso colore, cosi' chi passa dalla mappa alla pagina non
   deve reimparare la legenda. */
.tt .vento{stroke:#ffd54f;}
.tt-y{position:absolute;top:0;right:0;width:42px;height:150px;pointer-events:none;}
.tt-y span{position:absolute;right:0;transform:translateY(-50%);font-size:11px;
  color:#6b7a8d;line-height:1;padding-left:5px;}
.tt-y .tt-u{position:absolute;top:auto;bottom:-19px;right:0;transform:none;
  font-size:11px;color:#8a97a6;}
.tt-x{padding-right:42px;}
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

<div id="meteo"></div>

<h2>Come sta messo rispetto agli altri posti ${esc(GEN)}</h2>
<table class="vic"><thead><tr><th>Località</th><th>Distanza</th><th>13-20 gg fa</th></tr></thead>
<tbody id="vicini">
${VICINI5.map(v => `<tr${v.io ? ' class="qui"' : ''} data-id="${esc(v.id)}"><td>${v.io
  ? `<b>${esc(v.n)}</b> <span class="com">(sei qui)</span>`
  : `<a class="loc" href="${SITO}/funghi/${REG}/${v.slug}/"><b>${esc(v.n)}</b></a>`
}<span class="com">${esc(v.sig)} · ${v.q} MT</span></td>
<td>${v.io ? '—' : virgola(v.d) + ' km'}</td>
<td class="mm"><span class="v">…</span></td></tr>`).join('\n')}
</tbody></table>
<p class="nota" id="notavicini"></p>

<h2>Ecco cosa vedi sulla mappa</h2>
<a href="${SITO}/?r=${REG}&amp;g=20" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'localita-${REG}-20gg'})}catch(e){}">
  <img src="${ANTEPRIME}/${REG}.jpg"
       alt="La mappa delle piogge ${r.prep} ${esc(NOME)}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"
       style="width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);">
  <span class="vai-mappa">Apri mappa ${esc(NOME)} · ultimi 20 gg →</span>
</a>

<h2>Sta piovendo adesso?</h2>
<p>Questa pagina conta i millimetri dei giorni <b>già chiusi</b>: la giornata di oggi è esclusa,
perché il pluviometro la sta ancora misurando. Per la pioggia <b>in corso</b> c'è la diretta
radar, che mostra dove sta piovendo in questo momento, le ultime due ore e i quaranta minuti
seguenti.</p>
<a href="${SITO}/?r=${REG}&amp;${PIN}&amp;radar=ora" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'localita-${REG}-radar'})}catch(e){}">
  <span class="vai-mappa">Guarda il radar della pioggia ${esc(DOVE)} →</span>
</a>
<p class="nota">⚠️ Il radar <b>non è un pluviometro</b>: è una misura presa dal cielo, a 2 km di
risoluzione, e inquadra tutta la regione. Serve a vedere <i>dove</i> sta piovendo adesso, non a
contare quanta acqua è caduta. I millimetri di questa pagina restano quelli misurati a terra
da ${esc(CORTA)}.</p>

<h2 style="margin-bottom:12px">Perché proprio questo posto</h2>
<div class="metodo">
  <div><span class="n">1</span><b>C'è un pluviometro vero.</b> Non una stima su griglia: uno
  strumento di ${esc(AGENZIA)}, col suo nome e la sua quota.</div>
  <div><span class="n">2</span><b>Quota fra 200 e 1600 metri.</b> Qui siamo a ${quota}.</div>
  <div><span class="n">3</span><b>Almeno il 37% di bosco entro 3 km</b>, misurato sulle mappe di
  OpenStreetMap. Qui è il ${bosco}%.</div>
</div>

${RITRATTO ? `<h2 style="margin-top:30px">Quanto piove ${esc(DOVE)}, secondo il nostro archivio</h2>
<p>In cima alla pagina c'è la finestra corta, quella che serve per i funghi. Ma di questo pluviometro
teniamo tutti i giorni da quando lo leggiamo, e messi in fila raccontano un'altra cosa:
<b>${periodo(RITRATTO)}</b>, in ${RITRATTO.giorni} giorni di misura,
${bagnate(RITRATTO)}</p>
<p>Il giorno più bagnato di tutto l'archivio è stato il <b>${dataBella(RITRATTO.maxData)}</b>,
con <b>${virgola(RITRATTO.maxMm)} mm</b> in ventiquattro ore.${RITRATTO.mese && RITRATTO.meseMm >= 1 ? ` Il mese più piovoso,
fra quelli che abbiamo per intero, è <b>${meseBello(RITRATTO.mese)}</b> con
${migliaia(RITRATTO.meseMm)} mm.` : ''}${POSTO_IN_CLASSIFICA ? ` Su ${QUANTI_CONFRONTABILI} pluviometri
da bosco ${esc(GEN)} con lo stesso periodo alle spalle, questo è il <b>${POSTO_IN_CLASSIFICA}º</b>
per acqua caduta.` : ''}</p>
<p class="nota">Non è una media climatica: è quello che questo strumento ha misurato in quei
giorni, e basta. L'archivio parte dal ${dataBella(RITRATTO.dal)} e si allunga di un giorno al
giorno.</p>` : ''}

<div class="avviso">
  <b>Una cosa da tenere a mente.</b> Tanta pioggia non vuol dire tanti funghi: contano anche la
  temperatura, il vento e il tipo di bosco. <b>La temperatura e il vento ce li abbiamo:</b>
  clicca il pluviometro sulla mappa e vedi il suo storico, giorno per giorno, insieme alla
  pioggia.
</div>

${ZONA_DI[ID] ? `<p class="nota" style="margin-top:26px">Questo pluviometro sta
${esc(ZONA_DI[ID].dove)}: <a href="${SITO}/funghi/zone/${slugDaNome(ZONA_DI[ID].n)}/"
style="color:var(--blu)">guarda tutta la zona</a>, con i suoi
${ZONA_DI[ID].posti.length} pluviometri insieme.</p>` : ''}

<h2 style="margin-top:30px">Quanto ha piovuto? Trova un'altra località</h2>
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
  var REGS = ${JSON.stringify(REGS)}, POSTO = ${JSON.stringify(nomePosto)};
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
      + '<a href="'+MAPPA+'?r='+REGS+'">sulla mappa</a>.';
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
      /* ⚠️ pl/pn = il segnaposto. Senza, questi tre bottoni aprivano la
         mappa sul posto giusto ma SENZA la puntina, e chi arriva non sa quale
         dei pallini e' il suo (segnalato il 3/9/2026). Il bottone «Tutta la
         regione» la puntina non la vuole: li' si guarda l'insieme. */
      /* ⚠️ «Tutta la <regione>» apre UNA regione: le vicine servono a chi
         guarda il suo paese sul confine, non a chi ha chiesto l'insieme, e
         il bottone prometterebbe una cosa e ne farebbe un'altra. */
      return MAPPA + '?r=' + (centra ? REGS : REG) + '&da=' + dal + '&a=' + al
        + (centra ? '&pl=' + LAT.toFixed(4) + ',' + LON.toFixed(4)
                  + '&pn=' + encodeURIComponent(POSTO)
                  + '&z=11&c=' + LAT.toFixed(4) + ',' + LON.toFixed(4) : '');
    }

    document.getElementById('testa').innerHTML =
      '<div class="capo"><div class="et">Quanta acqua è caduta qui fra 13 e 20 giorni fa?</div>'
      + '<div class="gr">' + num(mm) + ' mm</div>'
      + '<div class="pic">dal ' + gg(daG) + ' al ' + gg(aG)
      + (forte ? ' · ultima pioggia forte ' + quando + ' (' + num(forte.mm) + ' mm)' : '') + '</div>'
      + '<div class="capo-btns">'
      + '<a class="capo-btn" href="' + link(daG, aG, true) + '">Apri mappa · 13-20 gg fa</a>'
      + '<a class="capo-btn" href="' + link(daG, a20, true) + '">Apri mappa · ultimi 20 gg</a>'
      /* ⚠️ QUI C'ERA UN TERZO BOTTONE, «Tutta la <regione>», tolto il 3/9/2026.
         Dal 3/9 il bottone sotto l'anteprima della mappa fa esattamente la
         stessa cosa (regione sola, 20 giorni, niente segnaposto) e i due erano
         gemelli a mezza pagina di distanza. Se un giorno servisse di nuovo, lo
         costruiva la funzione link qui sopra col terzo argomento a false. */
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

    /* ── temperatura e vento, se il pluviometro ce li ha ──────────────────
       ⚠️ Si mostra SOLO quello che c'e' davvero: la temperatura ce l'ha il 78%
       dei posti, il vento il 20%. Una scheda vuota con scritto «non
       disponibile» occupa spazio per dire niente. */
    var sT = (j.serieT && j.serieT[ID]) || null, sW = (j.serieW && j.serieW[ID]) || null;

    /* Un grafico a linee con la scala a destra, come il pannello della mappa.
       ⚠️ Le SCRITTE NON STANNO DENTRO L'SVG: il disegno e' stirato in
       larghezza (preserveAspectRatio="none") e un testo dentro uscirebbe
       schiacciato. Le tacche sono <span> in percentuale sopra il disegno, e
       il tratto delle linee non si scala (vector-effect). */
    function scala(lo, hi) {
      /* tacche tonde: si sceglie il passo che ne fa 3-5 dentro l'intervallo */
      var passi = [1, 2, 2.5, 5, 10, 20, 25, 50, 100], d = hi - lo, p = passi[passi.length - 1];
      for (var q = 0; q < passi.length; q++) if (d / passi[q] <= 5) { p = passi[q]; break; }
      var out = [], v = Math.ceil(lo / p) * p;
      for (; v <= hi + 1e-9; v += p) out.push(Math.round(v * 100) / 100);
      return out;
    }
    function grafico(serie, cls, colori, lo, hi, unita) {
      var W = 100, HH = 100, passo = W / (GIORNI - 1);
      var y = function (v) { return HH - (v - lo) / (hi - lo) * HH; };
      var linea = function (leggi) {
        var pezzi = [], cur = [];
        for (var q = GIORNI; q >= 1; q--) {
          var x = (GIORNI - q) * passo, v = leggi(serie[q - 1]);
          if (v == null) { if (cur.length > 1) pezzi.push(cur.join(' ')); cur = []; }
          else cur.push(x.toFixed(1) + ',' + y(v).toFixed(1));
        }
        if (cur.length > 1) pezzi.push(cur.join(' '));
        return pezzi;
      };
      var tacche = scala(lo, hi), svg = '', et = '';
      for (var g2 = 0; g2 < tacche.length; g2++) {
        var yy = y(tacche[g2]);
        svg += '<line class="griglia" x1="0" y1="' + yy.toFixed(1) + '" x2="100" y2="' + yy.toFixed(1) + '"/>';
        /* niente virgola dove non serve: 35 e non 35,0. La virgola resta
           solo se il passo delle tacche e' mezzo grado o meno. */
        var eti = (tacche[g2] % 1 === 0) ? String(tacche[g2]) : num(tacche[g2]);
        et += '<span style="top:' + yy.toFixed(1) + '%">' + eti + '</span>';
      }
      for (var k2 = 0; k2 < colori.length; k2++) {
        var pezzi = linea(colori[k2].leggi);
        for (var z = 0; z < pezzi.length; z++)
          svg += '<polyline class="' + colori[k2].cl + '" points="' + pezzi[z] + '"/>';
      }
      return '<div class="tt-box"><svg class="tt ' + cls + '" viewBox="0 0 100 100" preserveAspectRatio="none">'
        + svg + '</svg><div class="tt-y">' + et + '<span class="tt-u">' + unita + '</span></div></div>'
        + '<div class="gg-x tt-x">' + ascisse + '</div>';
    }

    if (sT || sW) {
      /* Il titolo dice solo quello che c'e' sotto: sui pluviometri con la sola
         temperatura citare il vento prometteva un grafico che non arrivava. */
      var che = (sT && sW) ? 'Temperatura e vento' : (sT ? 'Temperatura' : 'Vento');
      var H = '<h2 style="margin-top:30px">' + che + ', stesso periodo</h2>';
      if (sT) {
        var vals = [];
        for (var q3 = 0; q3 < GIORNI; q3++) if (sT[q3]) { vals.push(sT[q3][0]); vals.push(sT[q3][1]); }
        var lo = Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals) + 1);
        H += grafico(sT, 'tt-temp', [
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
      H += '<p class="nota">' + (sT && sW ? 'Temperatura e vento sono misurati'
        : (sT ? 'La temperatura è misurata' : 'Il vento è misurato'))
        + ' dallo stesso pluviometro, non da un modello.</p>';
      document.getElementById('meteo').innerHTML = H;
    }

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

    /* ⚠️ La tabella dei vicini e' GIA' NELL'HTML, coi nomi, le distanze e i
       link: qui si riempiono solo le caselle dei millimetri, che cambiano ogni
       giorno. Rifacendola con innerHTML si cancellerebbero i link dalla pagina
       che Google ha in mano dopo il rendering, che e' proprio quello che si
       voleva evitare. Se una riga non ha dati nel file, resta il trattino. */
    var perId = {};
    for (var iv = 0; iv < righe.length; iv++) perId[righe[iv].id] = righe[iv];
    var corpo = document.getElementById('vicini');
    var trs = corpo ? corpo.querySelectorAll('tr[data-id]') : [];
    for (var it = 0; it < trs.length; it++) {
      var d = perId[trs[it].getAttribute('data-id')];
      var cel = trs[it].querySelector('.mm .v');
      if (!cel) continue;
      if (!d) { cel.textContent = '—'; cel.className = 'v zero'; continue; }
      cel.textContent = d.mm > 0 ? num(d.mm) : '—';
      cel.className = d.mm > 0 ? 'v' : 'v zero';
    }

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
