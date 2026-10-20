#!/usr/bin/env node
/**
 * Scrive `funghi/index.html`: la RADICE della famiglia «Piogge per funghi».
 *
 * PERCHE' ESISTE. Fino all'8/9/2026 l'indirizzo `/funghi/` era un 404: 1.081
 * pagine pendevano da 19 pagine di regione e da nessun altro posto. Misurato
 * quel giorno sul grafo dei link interni: la mappa, che e' la pagina piu' forte
 * del sito (la puntano tutte le altre 1.105), non mandava UN SOLO link statico
 * alla famiglia — l'unico che c'e' lo costruisce il javascript dopo il clic su
 * un pallino, e Googlebot non lo vede mai. Questa pagina e' il posto dove quel
 * link puo' arrivare, e da cui si raggiunge tutto il resto.
 *
 * ⚠️ NON ELENCA LE 948 LOCALITA', e non e' una dimenticanza: sarebbero 1.081
 * link su una pagina sola. Elenca le 19 regioni e le 114 zone, e le localita'
 * le tiene la pagina della loro regione, che le ha gia' tutte. La strada resta
 * quella di sempre: indice -> regione -> paese.
 *
 * ⚠️ NON E' UN ELENCO E BASTA. Una pagina che ripete le stesse frasi delle
 * altre venti e aggiunge dei link non merita di essere indicizzata, e Google lo
 * dice chiaro con «scansionata, attualmente non indicizzata». Quello che qui
 * c'e' e da nessun'altra parte e' la CLASSIFICA NAZIONALE: i venti posti da
 * bosco piu' bagnati d'Italia nella finestra dei funghi, che nessuna pagina di
 * regione puo' avere perche' guarda una regione sola.
 *
 * ⚠️ I NUMERI NON SONO COTTI DENTRO: la pagina fa UNA richiesta a
 * `data/funghi/italia.json`, che scrive `genera-funghi.js` una volta al giorno.
 * Cuocerli vorrebbe dire un deploy al giorno, ~15 crediti l'uno, 450 al mese su
 * un piano da 1.000. E' la stessa scelta gia' fatta per le altre 1.081 pagine.
 *
 * ⚠️ VA LANCIATO DOPO `genera-pagine-funghi.js`: il foglio di stile lo legge da
 * una pagina di regione gia' scritta, come fa `genera-pagine-localita.js`. Una
 * regola scritta li' vale anche qui.
 *
 * ⚠️ FA PARTIRE UN DEPLOY: sta fuori da `data/` e da `.github/`, quindi non e'
 * nella regola ignore di netlify.toml.
 *
 * Uso: `node .github/scripts/genera-indice-funghi.js` (nessun parametro).
 */

const fs = require('fs');
const path = require('path');
const { REGIONI } = require('./genera-pagine-regione.js');
const { LOCALITA, slug } = require('./lib-nomi.js');
const { scriviSitemap } = require('./genera-sitemap.js');
const { rigaStagione } = require('./lib-stagione.js');
const { stileDelModello } = require('./lib-pagina-funghi.js');
// 20/10/2026, scheda 90: l'indice come le altre pagine funghi (ricerca in testata, «Che tempo farà» sui venti posti
// della classifica col bottone del radar, «Trova i boschi», e i due riquadri pioggia | boschi)
const { METEO_CSS, meteoHtml, boschiHtml, meteoClient } = require('./lib-meteo-regione.js');
const { STRISCIA_CSS } = require('./lib-striscia.js');

const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const RADICE = path.resolve(__dirname, '..', '..');
const SITO = 'https://avventurepluvio-test.pages.dev';

// Le regioni che una pagina funghi ce l'hanno davvero, nell'ordine in cui il
// resto del sito le elenca (nord -> sud, estero a parte): l'anagrafe sta in un
// posto solo, `genera-pagine-regione.js`, e da li' si prende anche l'ordine.
const CON_FUNGHI = REGIONI.filter(r => POSTI[r.k] && POSTI[r.k].length);
const N_POSTI = CON_FUNGHI.reduce((n, r) => n + (LOCALITA.includes(r.k) ? POSTI[r.k].length : 0), 0);

// Il foglio di stile viene dalla pagina funghi di una regione: una copia sola
// per tutte e 1.082 le pagine della famiglia.
const modello = path.join(RADICE, 'funghi', CON_FUNGHI[0].k, 'index.html');
if (!fs.existsSync(modello)) {
  console.error(`⚠️ manca ${modello}: lancia prima genera-pagine-funghi.js`);
  process.exit(1);
}
const m = fs.readFileSync(modello, 'utf8');
const STILE = stileDelModello(m);   // senza RILIEVO e QUIZ_CSS, che l'indice non ha

const nomeDi = r => r.nomeTitolo || r.nome;

// Le zone, raggruppate per regione: 114 nomi in fila sarebbero un muro, e chi
// cerca la sua valle la cerca dentro la sua regione.
const zonePerRegione = CON_FUNGHI
  .map(r => [r, ZONE.filter(z => z.reg === r.k).sort((a, b) => a.n.localeCompare(b.n, 'it'))])
  .filter(([, zz]) => zz.length);
const N_ZONE = zonePerRegione.reduce((n, [, zz]) => n + zz.length, 0);

const pagina = () => `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${/* ⚠️ TITOLO IN PAGINA E TITOLO DI RICERCA SONO DUE COSE DIVERSE, e qui sono
     diversi apposta. Quello che si legge in cima e' la frase dell'utente
     (9/9/2026); quello del tag `title`, cioe' la riga che compare nei risultati
     di Google, la ripete ma tiene davanti «Piogge per funghi», che e' la frase
     esatta con cui la gente cerca ed e' l'ancora di tutte e 1.081 le pagine.
     Perderla per far entrare la frase intera vorrebbe dire farsi male da soli.
     Limiti da rispettare: titolo <= 62 caratteri, descrizione <= 158.
     ⚠️ 13/9/2026: la domanda e' «dove andare a funghi oggi», e «Piogge per
     funghi» resta dentro il titolo. «Oggi» tutto l'anno: a gennaio ci tutela
     la riga di stagione sotto il titolo (lib-stagione.js). */''}
<title>Dove andare a funghi oggi: le piogge per funghi in Italia</title>
<meta name="description" content="Dove andare a funghi oggi: le piogge per funghi da 13 a 20 giorni fa, misurate a terra in ${N_POSTI} posti da bosco di ${CON_FUNGHI.length} regioni. Aggiornato ogni giorno.">
<link rel="canonical" href="${SITO}/funghi/">
<meta property="og:title" content="Dove andare a funghi oggi">
<meta property="og:description" content="Dove è caduta l'acqua nelle zone da bosco, misurata dai pluviometri. Non previsioni: pioggia vera.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/funghi/">
<meta property="og:type" content="website">
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
${STILE}
/* Solo di questa pagina: l'elenco delle regioni a schede, e le zone raccolte
   sotto il nome della loro regione. */
.regg{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:9px;margin-top:8px;}
.regg a{display:block;text-decoration:none;border:1px solid var(--bordo);border-radius:9px;
  padding:11px 13px;background:linear-gradient(180deg,#ffffff 0%,#f7fafd 100%);}
.regg a:hover{border-color:#9db4d2;background:#f2f7fd;}
.regg b{display:block;color:var(--blu-scuro);font-size:16.5px;}
.regg span{display:block;color:#6a7789;font-size:13px;margin-top:2px;}
.zgruppo{margin-top:14px;}
.zgruppo b{display:block;color:var(--blu-scuro);font-size:15.5px;margin-bottom:1px;}
.zgruppo p{line-height:1.9;font-size:15px;}
.zgruppo a{color:var(--blu);}
@media(max-width:640px){
  .regg{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:7px;}
  .regg a{padding:9px 10px;} .regg b{font-size:15px;}
}
${METEO_CSS}${STRISCIA_CSS}
#mk-meteo .mk-cr{grid-template-columns:1.45fr 1fr 1fr 1fr;}
#mk-meteo .mk-cr b{white-space:normal;overflow:visible;line-height:1.2;font-size:14.5px;}
#mk-meteo .mk-cr span em{white-space:nowrap;}
/* i due riquadri pioggia | boschi sotto «Ecco cosa vedi sulla mappa»: quasi quadrati, l'anteprima della regione copre */
.mk-str.mk-italia{gap:12px;margin:8px 0 6px;}
.mk-str.mk-italia a{height:auto;aspect-ratio:1/1.02;background-size:cover;background-position:50% 50%;}
</style>
</head>
<body>
<header>
  <a href="${SITO}/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· piogge</span></a>
  <a href="https://www.youtube.com/@avventuremicologiche" target="_blank" rel="noopener" class="yt">▶ <span class="yt-l">Canale </span>YouTube</a>
</header>
<main>

${/* ⚠️ LA FINESTRA DEVE ESSERE CHIARA NELLE PRIME TRE RIGHE, non dopo due
     riquadri. Fino al 9/9/2026 il titolo diceva «dove ha piovuto davvero» e i
     13-20 giorni comparivano solo al terzo blocco: chi arrivava da Google non
     capiva che stava guardando la pioggia di due settimane fa e non quella di
     ieri. Adesso il titolo pone la domanda e le tre righe sotto dicono subito
     la regola, la finestra e da dove vengono i numeri. */''}
<h1>Dove andare a funghi oggi</h1>
${rigaStagione()}
<p class="sotto">Dopo la pioggia il fungo non spunta subito: per svilupparsi gli servono almeno
dodici o tredici giorni. Per questo qui non guardiamo la pioggia di ieri ma quella <b>da 13 a 20
giorni fa</b>, misurata a terra dai pluviometri di ${N_POSTI} posti da bosco in ${CON_FUNGHI.length}
regioni. Dove ne è caduta di più è dove vale la pena andare a cercare.</p>

<div class="patto">
  <p><b>A cosa serve:</b> a pianificare le tue uscite. La pioggia vera, misurata a terra
  da pluviometri veri, posto per posto e con la data. Il posto esatto, poi, lo sai tu meglio di qualunque sito.</p>
  <p>Non è una previsione di quanti funghi ci saranno: attendibile non la fa
  nessuno, e noi non ce la inventiamo.</p>
  <p><b>Ricordati</b> che in molte regioni per raccogliere funghi serve il tesserino, e che nei parchi
  valgono regole proprie.</p>
</div>

<h2>I venti posti più bagnati d'Italia</h2>
<div class="spiega" id="finestra">Sto leggendo i pluviometri…</div>
<div id="tabella"></div>
<p class="nota" id="notaclass"></p>

${/* 20/10/2026: SUBITO SOTTO LA CLASSIFICA il tempo degli stessi venti posti, nello stesso ordine, ognuno alla quota
     del suo pluviometro (li sceglie meteoClient con OPZ.primi, l'API con ?posti=); niente giorni previsti nel grafico
     (impronta etica: niente previsioni di crescita). Poi «Trova i boschi», come nelle altre pagine funghi. */''}
${meteoHtml({ k: 'italia' }, 'Che tempo farà nei posti più bagnati', 'Sto leggendo le previsioni dei venti posti…', 'mk-meteo')}
${boschiHtml('🌲 Trova i boschi vicino a te')}

${/* ⚠️ L'ANTEPRIMA STA QUI, sotto la classifica e il meteo, e non in fondo: a leggere la pagina si deve capire
     subito che il sito ha una mappa.
     20/10/2026 (suo: «prova con la doppia anteprima come nelle altre pagine»): al posto di «preview.jpg» (ferma al
     3/8 e a 30 giorni) i due riquadri delle altre pagine funghi, pioggia e boschi, sulla REGIONE DEL PRIMO POSTO
     della classifica del giorno (sua scelta). Le immagini sono le anteprime che il sito ha gia': la pioggia dei 20
     giorni rifatta ogni mattina sul ramo «anteprime», i boschi fissi in tessere-boschi/anteprime/. Le mette lo script
     in fondo quando arriva la classifica; senza, i riquadri restano blu con la scritta e si cliccano lo stesso.
     ⚠️ Le scritte NON dicono il periodo (suo: «quella è un'immagine generica»). */''}
<h2 style="margin-top:30px">Ecco cosa vedi sulla mappa</h2>
<div class="mk-str mk-giallo mk-italia" id="riquadri">
  <a href="${SITO}/" data-t="pioggia" onclick="try{gtag('event','apri_mappa',{da:'indice-funghi-striscia-pioggia'})}catch(e){}"><span><b>💧 Mappa delle piogge</b><small>scegli il periodo →</small></span></a>
  <a href="${SITO}/?boschi=1" data-t="boschi" onclick="try{gtag('event','apri_mappa',{da:'indice-funghi-striscia-boschi'})}catch(e){}"><span><b>🌲 Mappa dei boschi</b><small>tipo per tipo →</small></span></a>
</div>
<p class="nota" style="text-align:center;margin-bottom:26px;">Qui sopra la regione del primo posto in classifica: a
sinistra la pioggia degli ultimi 20 giorni misurata dai pluviometri, più il colore è acceso più ne è venuta giù; a
destra i boschi, colorati tipo per tipo. Sulla mappa scegli il periodo e vai dove vuoi.</p>

<h2 style="margin-top:30px">Scegli la tua regione</h2>
<p class="nota">Ogni regione ha la sua classifica, tutti i suoi posti da bosco e le sue valli.</p>
<div class="regg">
${CON_FUNGHI.map(r => `  <a href="${SITO}/funghi/${r.k}/"><b>${nomeDi(r)}</b><span>${POSTI[r.k].length} posti</span></a>`).join('\n')}
</div>

<h2 style="margin-top:30px">Come scegliamo i posti</h2>
<div class="metodo">
  <div><span class="n">1</span><b>C'è un pluviometro vero.</b> Non una stima su griglia: uno
  strumento di un ente pubblico, col suo nome e la sua quota.</div>
  <div><span class="n">2</span><b>Quota fra 200 e 1600 metri.</b> Sotto è pianura, sopra il bosco
  finisce.</div>
  <div><span class="n">3</span><b>Almeno il 37% di bosco entro 3 km</b>, misurato sulle mappe di
  OpenStreetMap.</div>
</div>
<p class="nota">Restano fuori l'Abruzzo, che non ha una fonte pubblica aperta, e il Molise, dove
nessun pluviometro in fascia di quota arriva al 37% di bosco: una pagina vuota è peggio di
nessuna pagina.</p>

<h2 style="margin-top:30px">Le valli e le zone</h2>
<p class="nota">Una zona mette insieme i pluviometri di tutta la valle: comoda quando il posto
preciso non l'hai ancora scelto.</p>
${zonePerRegione.map(([r, zz]) => `<div class="zgruppo"><b>${nomeDi(r)}</b>
  <p>${zz.map(z => `<a href="${SITO}/funghi/zone/${slug(z.n)}/">${z.n}</a>`).join(' · ')}</p></div>`).join('\n')}

${/* ⚠️ LE DOMANDE VERE, e stanno SOLO QUI. Servono a due cose insieme: chi
     cerca su Google non scrive «piogge per funghi», scrive «quanti giorni dopo
     la pioggia nascono i funghi» o «dove andare a funghi», e queste sono le
     parole con cui le domande vanno fatte. E sono testo che questa pagina ha e
     nessun'altra: e' l'opposto del problema delle 948 schede di paese, che si
     somigliano al 91%.
     ⚠️ NON si copiano sulle 19 pagine di regione. Ripetute venti volte
     diventerebbero il doppione che stiamo cercando di togliere, e per Google
     un blocco identico su venti indirizzi non vale come su uno.
     ⚠️ Le risposte dicono quello che sappiamo e ammettono quello che non
     sappiamo. La terza in particolare: chi cerca «previsioni funghi» arriva
     qui e trova scritto che non ne facciamo, ed e' giusto cosi'. */''}
<h2 style="margin-top:30px">Le domande che ci fanno più spesso</h2>
<div class="metodo">
  <div><b>Quanti giorni dopo la pioggia nascono i funghi?</b> Dodici o tredici come minimo, e per
  questo la finestra di questa pagina va da 13 a 20 giorni fa. Prima di allora l'acqua è caduta ma
  il micelio ci sta ancora lavorando sotto terra.</div>
  <div><b>Dove andare a cercare i funghi dopo una pioggia?</b> Dove l'acqua è caduta davvero, che
  non è sempre dove sembra: due valli a dieci chilometri di distanza possono aver preso 90 mm e 8.
  Qui i millimetri ci sono posto per posto, misurati da pluviometri veri.</div>
  <div><b>Esistono previsioni attendibili per i funghi?</b> No, e noi non ne facciamo. Oltre alla
  pioggia contano la temperatura, il vento, la quota e il tipo di bosco. Quello che possiamo dirti
  con certezza è dove è caduta l'acqua e quanta.</div>
  <div><b>Quanto ha piovuto nel mio paese?</b> Scegli la regione qui sopra e cerca il nome: ogni
  posto da bosco ha la sua pagina, con la pioggia giorno per giorno e i pluviometri vicini.</div>
</div>

<h2 style="margin-top:30px">Tutta la pioggia, non solo il bosco</h2>
<p>Queste pagine guardano solo i pluviometri in mezzo al bosco. Per l'acqua caduta ovunque,
pianura compresa, c'è <a href="${SITO}/">la mappa delle precipitazioni</a>: più di cinquemila
pluviometri in Italia, Svizzera, Austria, Francia e Slovenia, con lo storico di ogni stazione.</p>
${/* Il tasto grande sta ora SOPRA, sotto l'anteprima: qui sarebbe il secondo
     nella stessa pagina, e due volte lo stesso invito non ne vale due. */''}

<p class="nota" style="margin-top:22px">Dati degli enti pubblici via il nostro archivio, elencati
in <a href="${SITO}/fonti">fonti e licenze</a>. Il bosco è calcolato su dati OpenStreetMap,
licenza ODbL. La provincia viene dai confini provinciali ISTAT.</p>

${/* ⚠️ Qui NON si chiama navAltre: quella scrive due elenchi, regioni e
     funghi, e il secondo ripeterebbe pari pari le 19 schede qui sopra. Di suo
     serve solo il primo, cioe' il ponte verso le pagine «dove ha piovuto». */''}
<nav class="altre">
  <b>Dove ha piovuto, regione per regione</b>
  <p>${REGIONI.map(r => `<a href="${SITO}/${r.k}/">${nomeDi(r)}</a>`).join(' · ')}</p>
</nav>
</main>

<script>
(function(){
  /* In locale si legge dalla cartella del repo, sul sito dal raw di GitHub:
     stesso trucco delle altre pagine della famiglia, cosi' le prove si fanno
     con un server locale a zero deploy e zero crediti. */
  var LOCALE = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var BASE = LOCALE ? '/data/'
    : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var SITO = ${JSON.stringify(SITO)};
  var QUANTI = 20;
  // le anteprime dei riquadri: la pioggia sul ramo «anteprime» (si rifa' ogni mattina), i boschi fissi
  var ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime/';
  var BOSCHI = LOCALE ? '/tessere-boschi/anteprime/'
    : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/tessere-boschi/anteprime/';
  var MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  function gg(d){ var p=String(d).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function vir(n){ return String(n).replace('.', ','); }

  function guasto(t){
    document.getElementById('finestra').innerHTML = t;
    document.getElementById('tabella').innerHTML = '';
  }

  fetch(BASE + 'funghi/italia.json', {cache:'no-store'})
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(j){
      var righe = (j.primi || []).slice(0, QUANTI);
      if (!righe.length) return guasto('La classifica non è disponibile in questo momento: ' +
        'scegli la tua regione qui sotto.');

      /* ⚠️ LA FINESTRA SI DICHIARA COL FILE, non col calendario di oggi. Se il
         giro notturno salta, la pagina resta vera lo stesso: dice le date a cui
         i numeri si riferiscono, invece di prometterne altre. */
      /* ⚠️ QUI NON SI RIPETE LA REGOLA DEI DODICI GIORNI: sta gia' nelle tre
         righe in cima, ed e' la prima cosa che si legge. Scritta due volte a
         mezza pagina di distanza sembrava che la pagina si fosse dimenticata di
         averla gia' detta. Qui servono solo le DATE, che in cima non ci sono
         perche' cambiano ogni giorno e il titolo e' cotto nel guscio. */
      document.getElementById('finestra').innerHTML =
        'Gli otto giorni della finestra sono <b>' + dalAl(j.finestra[0], j.finestra[1])
        + '</b>. Sono millimetri misurati a terra dai pluviometri, non una previsione.';
      /* 17/10/2026: «dal 8 ottobre al 15 ottobre» → «dall’8 al 15 ottobre», come le altre pagine */
      function dalAl(a, b){ var pa = a.split('-'), pb = b.split('-'), da = +pa[2], db = +pb[2];
        return ((da === 1 || da === 8 || da === 11) ? 'dall’' : 'dal ') + (pa[1] === pb[1] ? da : gg(a))
          + ((db === 1 || db === 8 || db === 11) ? ' all’' : ' al ') + gg(b); }

      /* ⚠️ NIENTE COLONNA «REGIONE», e non e' per far posto. Al primo giro
         c'era, e diceva «Bagnone MS — Liguria»: Bagnone e' in provincia di
         Massa-Carrara, cioe' Toscana, e sta nella cartella «liguria» solo
         perche' quel pluviometro lo pubblica OMIRL. Quella colonna diceva DOVE
         STA LA PAGINA fingendo di dire dove sta il paese. La sigla della
         provincia invece e' giusta sempre, e basta a orientarsi. */
      var max = righe[0][4] || 1;
      var h = '<table><thead><tr><th></th><th>Posto</th>' +
              '<th>Pioggia</th></tr></thead><tbody>';
      righe.forEach(function(r, i){
        var pc = Math.max(3, Math.round(100 * r[4] / max));
        h += '<tr><td class="pos">' + (i+1) + '</td>' +
             '<td><a class="loc" href="' + SITO + '/funghi/' + r[2] + '/' + r[3] + '/">' +
             '<b>' + esc(r[0]) + '</b><span class="com">' + esc(r[1]) + '</span></a></td>' +
             '<td class="mm"><span class="barra" style="width:' + pc + '%"></span>' +
             '<span class="v">' + vir(r[4].toFixed(1)) + ' mm</span></td></tr>';
      });
      document.getElementById('tabella').innerHTML = h + '</tbody></table>';

      /* i due riquadri sulla regione del primo posto (20/10/2026): le sue anteprime, e i link che la aprono a 20 giorni
         (pioggia) e coi boschi accesi */
      var reg = righe[0][2], rq = document.getElementById('riquadri');
      if (rq && /^[a-z]+$/.test(reg)) {
        var ap = rq.querySelector('a[data-t="pioggia"]'), ab = rq.querySelector('a[data-t="boschi"]');
        ap.style.backgroundImage = 'url(' + ANTEPRIME + reg + '-mappa.webp)'; ap.href = SITO + '/?r=' + reg + '&g=20';
        ab.style.backgroundImage = 'url(' + BOSCHI + reg + '-mappa.webp)'; ab.href = SITO + '/?r=' + reg + '&boschi=1';
      }

      document.getElementById('notaclass').textContent =
        'Su ' + j.quanti + ' posti da bosco che in quegli otto giorni hanno preso acqua, in ' +
        j.regioni + ' regioni. Clicca un posto e vedi la sua pioggia giorno per giorno.';
    })
    .catch(function(){
      guasto('La classifica non è disponibile in questo momento: scegli la tua regione qui sotto.');
    });
}());
</script>
<script>
(${meteoClient.toString()})('italia', 'Italia', ${JSON.stringify(SITO)}, false, ${JSON.stringify({
  ga: 'indice-funghi', primi: 20, id: 'mk-meteo', grafico: false, boschi: 'mk-boschi',
  guasto: 'Le previsioni dei venti posti', tutte: 'Mostra tutti i # posti', tocca: 'Tocca un posto per vederlo ora per ora sulla mappa',
  sopra: 'Gli stessi venti posti della classifica, nello stesso ordine, alla quota del loro pluviometro' })});
</script>
</body>
</html>
`;

const dest = path.join(RADICE, 'funghi', 'index.html');
const testo = pagina();
const prima = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
if (prima === testo) {
  console.log('  funghi/index.html  (invariato)');
} else {
  fs.writeFileSync(dest, testo, 'utf8');
  console.log(`  funghi/index.html  ${CON_FUNGHI.length} regioni, ${N_ZONE} zone, ${N_POSTI} posti`);
}

scriviSitemap(SITO, RADICE);
