/* ── LE PAGINE REGIONE PIOGGE DIVENTANO ANCHE METEO (19/10/2026, sua scelta sul campione) ──
   Obiettivi suoi per l'inverno: (1) un sito sempre piu' meteo; (2) chi arriva su una pagina deve poter
   scrivere il suo paese e andare sulla mappa, a tutte le funzioni (anche i boschi). Regola del campione:
   la RISPOSTA in cima («Ieri, 18 ottobre: 2,3 mm») non si tocca e niente le va sopra.
   Quattro pezzi:
   1. il cerca nell'intestazione: casella al computer, lente al telefono; scelto il posto, sei porte
      (Previsioni, Pioggia caduta, Radar, Temperature, Boschi, Satellite) verso la mappa;
   2. sotto «Apri la mappa di ieri» la riga Previsioni · Radar · Boschi · Satellite: sta in
      lib-numeri-regione.js (scheda di ieri), qui solo lo stile;
   3. dopo la scheda, «Che tempo farà»: casella per qualsiasi paese o frazione d'Italia, che apre SUBITO la
      mappa sulle previsioni di quel posto (scheda 7 giorni e ora per ora), e le citta' principali una per
      riga (oggi, domani, dopodomani), prima il capoluogo poi per abitanti;
   4. il grafico: gli ultimi 30 giorni misurati e i prossimi 7 previsti (media delle citta'), con la linea «oggi».
   ⚠️ BOCCIATE nel campione, non riproporle: le icone della «media della regione» (in media non vuol dire
   niente) e le previsioni del paese mostrate dentro la pagina (deve aprirsi la mappa).
   ⚠️ La casella cerca solo in ITALIA (elenco dei comuni + frazioni dal geocoder di Open-Meteo, come la
   casella della mappa e delle pagine «adesso»): nelle pagine estere non c'e', restano le citta'.
   Eventi GA4: tutti `apri_mappa` col campo `da` = pagina-<regione>-<pezzo>. */

const ESTERE = ['svizzera', 'austria', 'slovenia'];

const METEO_CSS = `
/* ── IL METEO NELLE PAGINE REGIONE (lib-meteo-regione.js, 19/10/2026) ── */
header{position:relative;flex-wrap:nowrap;}
.mk-cerca{position:relative;flex:1;max-width:340px;margin-left:14px;}
.mk-cerca input{width:100%;box-sizing:border-box;border:0;border-radius:9px;padding:8px 12px 8px 34px;font:500 15px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231b3f6e' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E") no-repeat 11px 50%;color:#10263f;}
.mk-cerca input::placeholder{color:#6b7d93;}
.mk-lente{display:none;}
.mk-drop{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(10,30,60,.3);
  z-index:50;overflow:hidden;display:none;color:#10263f;min-width:300px;}
.mk-drop.on{display:block;}
.mk-r{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;cursor:pointer;font-size:15px;border-bottom:1px solid #eef2f7;}
.mk-r:hover,.mk-r.sel{background:#eef4fb;}
.mk-r small{color:#6b7d93;white-space:nowrap;}
.mk-porte-t{padding:12px 14px 4px;font-weight:700;font-size:15px;}
.mk-porte-t small{display:block;font-weight:500;color:#6b7d93;font-size:13px;margin-top:2px;}
.mk-6{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px 12px;}
.mk-6 a{display:flex;align-items:center;gap:9px;padding:10px 10px;border:1px solid #d3deeb;border-radius:10px;text-decoration:none;color:#10263f;font-weight:700;font-size:14.5px;line-height:1.15;}
.mk-6 a:hover{background:#eef4fb;}
.mk-6 a span{font-size:20px;}
.mk-6 a small{display:block;font-weight:500;color:#6b7d93;font-size:12px;}
@media(max-width:600px){
  .mk-cerca{display:none;position:absolute;left:10px;right:10px;top:7px;margin:0;max-width:none;z-index:60;}
  header.mk-aperto .mk-cerca{display:block;}
  header.mk-aperto .logo,header.mk-aperto .yt,header.mk-aperto .mk-lente{visibility:hidden;}
  .mk-lente{display:flex;align-items:center;justify-content:center;margin-left:auto;width:36px;height:32px;border:0;border-radius:8px;background:rgba(255,255,255,.16);cursor:pointer;}
  header .yt{margin-left:8px;}
  .mk-drop{min-width:0;}
}
.mk-porte{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;}
.mk-porte a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 2px 8px;border-radius:11px;background:rgba(255,255,255,.12);
  color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;border:1px solid rgba(255,255,255,.22);}
.mk-porte a span{font-size:21px;line-height:1;}
.mk-porte a:hover{background:rgba(255,255,255,.2);}
.mk-meteo{background:#f3f7fc;border:1px solid #d6e2f0;border-radius:14px;padding:4px 16px 14px;margin:18px 0 6px;}
.mk-meteo h2{margin-top:14px;}
.mk-tuo{position:relative;margin:4px 0 12px;}
.mk-tuo input{width:100%;box-sizing:border-box;border:2px solid #1b3f6e;border-radius:12px;padding:13px 14px 13px 44px;font:600 16.5px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#10263f;
  background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%231b3f6e' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E") no-repeat 14px 50%;}
.mk-tuo input::placeholder{color:#5f738c;font-weight:500;}
.mk-tuo .mk-drop{min-width:0;}
.mk-attesa{color:#5f738c;font-size:14px;margin:8px 0;}
.mk-tab{background:#fff;border:1px solid #d6e2f0;border-radius:12px;overflow:hidden;}
.mk-cr{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;align-items:center;gap:4px;padding:8px 12px;border-bottom:1px solid #eef2f7;text-decoration:none;color:#10263f;font-size:15px;}
.mk-cr:hover{background:#f3f7fc;}
.mk-cr b{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mk-cr b small{display:block;font-weight:500;font-size:12px;color:#5f738c;}   /* «al pluviometro», pagine paese (20/10/2026) */
.mk-cr span{display:flex;align-items:center;gap:3px;font-weight:600;flex-wrap:wrap;}
.mk-cr span i{font-style:normal;font-size:19px;}
.mk-cr span em{font-style:normal;font-size:12px;color:#1f6fd1;font-weight:700;width:100%;padding-left:24px;margin-top:-3px;}
.mk-cr-t{background:#eef4fb;font-size:13px;color:#4a6180;padding:6px 12px;}
.mk-cr-t span{font-weight:700;}
.mk-dopo{display:none;}
.mk-aperte .mk-dopo{display:grid;}
.mk-tutte{display:block;width:100%;margin:10px 0 0;padding:10px;border:1px solid #c5d4e6;border-radius:10px;background:#fff;color:#1b3f6e;font:700 15px system-ui,sans-serif;cursor:pointer;}
.mk-citta-n{font-size:13.5px;color:#5f738c;margin:10px 0 0;}
.mk-sopra{font-size:14.5px;color:#4a6180;margin:2px 0 8px;font-weight:600;}
.mk-boschi{background:#eef6ef;border:1px solid #cfe3d2;border-radius:14px;padding:4px 16px 16px;margin:18px 0 6px;}
.mk-boschi h2{margin-top:14px;color:#1d4a2a;}
.mk-boschi-p{font-size:15px;color:#3d5a45;margin:2px 0 10px;}
@media(max-width:400px){.mk-boschi .mk-tuo input::placeholder{font-size:15px;}}   /* la frase sta intera anche a 360 px */
.mk-boschi .mk-tuo input{border-color:#2f6b3d;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%232f6b3d' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E");}
.mk-citta-n a{color:#1b3f6e;font-weight:700;}
/* il bottone del radar sotto la tabella (20/10/2026): bianco, e blu pieno col pallino che pulsa se oggi piove */
.mk-radar{display:flex;align-items:center;gap:11px;margin:12px 0 2px;padding:11px 14px;border-radius:12px;text-decoration:none;
  border:2px solid #1f6fd1;background:#fff;color:#123b6e;}
.mk-radar .mk-ic{font-size:24px;line-height:1;flex:none;}
.mk-radar b{display:block;font-size:16px;line-height:1.2;}
.mk-radar small{display:block;font-size:13.5px;font-weight:600;color:#1f6fd1;margin-top:2px;}
.mk-radar .mk-fr{margin-left:auto;font-size:21px;font-weight:700;flex:none;}
.mk-radar.piove{background:linear-gradient(135deg,#1f6fd1,#3f8fe8);color:#fff;box-shadow:0 3px 10px rgba(31,111,209,.3);}
.mk-radar.piove small{color:#fff;opacity:.92;}
.mk-radar .mk-pul{position:relative;width:12px;height:12px;flex:none;margin:0 2px 0 4px;}
.mk-radar .mk-pul:before,.mk-radar .mk-pul:after{content:'';position:absolute;inset:0;border-radius:50%;background:#fff;}
.mk-radar .mk-pul:after{animation:mkPul 1.6s ease-out infinite;}
@keyframes mkPul{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.8);opacity:0}}
@media(max-width:400px){.mk-cr{font-size:14px;padding:8px 9px;}.mk-cr span i{font-size:17px;}}
.gg .b.mk-fut i{background:repeating-linear-gradient(135deg,#7fb2ec 0 5px,#a9cdf5 5px 10px);border-radius:3px 3px 0 0;}
.gg .b.mk-fut b{color:#2f6db5;}
.gg .b.mk-oggi{border-left:2px dashed #e0a800;margin-left:3px;padding-left:1px;}
.gg-x span.mk-fx{color:#2f6db5;font-weight:600;}
.gg-leg .mk-leg-fut{background:repeating-linear-gradient(135deg,#7fb2ec 0 4px,#a9cdf5 4px 8px) !important;}
`;

// il blocco «Che tempo farà», scritto nella pagina (niente salti al caricamento); le citta' le riempie il codice
// (20/10/2026) le pagine di zona lo chiamano con titolo e attesa loro: «Che tempo farà in Garfagnana», «dei paesi»
function meteoHtml(r, titolo, attesa, id) {
  const estera = ESTERE.includes(r.k);
  return `<section class="mk-meteo" id="${id || 'meteo'}">
<h2>${titolo || `Che tempo farà ${r.prep} ${r.nome}`}</h2>
${estera ? '' : `<div class="mk-tuo"><input type="search" autocomplete="off" aria-label="Cerca un paese o una frazione" placeholder="Il tuo paese, anche una frazione"><div class="mk-drop"></div></div>
`}<div class="mk-citta"><p class="mk-attesa">${attesa || 'Sto leggendo le previsioni delle città…'}</p></div>
</section>`;
}

// «Trova i boschi» (20/10/2026, pagine funghi, sua idea: «non solo il tempo ma cercare i boschi»): una casella per
// qualsiasi paese o frazione d'Italia che apre SUBITO la mappa boschi su quel posto. La riempie meteoClient (OPZ.boschi).
function boschiHtml(titolo, id) {
  return `<section class="mk-boschi" id="${id || 'mk-boschi'}">
<h2>${titolo}</h2>
<p class="mk-boschi-p">Scrivi il paese: si apre la mappa dei boschi su quel posto, faggete, castagneti, querceti e abetaie colorati per tipo, col satellite a un tocco.</p>
<div class="mk-tuo"><input type="search" autocomplete="off" aria-label="Cerca i boschi di un paese o di una frazione" placeholder="Cerca una località, vedi i boschi"><div class="mk-drop"></div></div>
</section>`;
}

/* ⚠️ GIRA NEL BROWSER: la pagina la copia con toString() e la chiama coi suoi valori, come numeriRegione.
   Niente require, niente sintassi che i telefoni vecchi non capiscono.
   OPZ (20/10/2026, pagine di zona): senza, e' la pagina regione di sempre. Con: ga = prefisso degli eventi,
   area = la domanda all'API (zona=<slug>), riepilogo = il file del grafico, i testi «paesi» al posto di «citta'» e
   sopra = la riga sopra la tabella («I paesi della Garfagnana e dei dintorni»: un paese di confine non sembra un errore).
   Pagine funghi (20/10/2026): id = l'id del blocco «Che tempo farà» (li' #meteo e' gia' il grafico delle temperature),
   grafico: false = niente giorni previsti nel grafico (regola: niente previsioni di crescita), boschi = l'id del
   blocco «Trova i boschi» (boschiHtml).
   I paesi arrivano gia' in ordine (per abitanti) e ognuno porta la SUA regione (r): una zona sta su due regioni.
   Pagine paese (20/10/2026): area = 'paese=<reg>/<slug>', e il primo «paese» e' il punto del pluviometro (qui: 1),
   che nella tabella porta sotto il nome «al pluviometro».
   Pagine regione funghi (20/10/2026): area = 'zonedi=<reg>', una riga per zona (centro della zona, quota mediana dei
   suoi pluviometri, scritta sotto il nome col campo sotto), e ordine = l'id dell'elenco delle zone della pagina.
   Indice /funghi/ (20/10/2026): primi = quanti posti della classifica del giorno (italia.json) mettere in tabella,
   ognuno alla quota del suo pluviometro; il bottone del radar si apre sul primo posto dove oggi piove. */
function meteoClient(K, NOME, SITO, ADESSO, OPZ) {
  OPZ = OPZ || {};
  var GA = OPZ.ga || 'pagina-' + K, AREA = OPZ.area || 'capoluoghi=' + K, RIEP = OPZ.riepilogo || 'riepiloghi/' + K + '.json';
  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== '8788' ? 'http://127.0.0.1:8788/api/previsioni' : '/api/previsioni';
  var BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/data/' : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var GS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function el(t, cl, html) { var e = document.createElement(t); if (cl) e.className = cl; if (html != null) e.innerHTML = html; return e; }
  function daIso(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function mm(n) { return n === 0 ? '0' : n < 10 ? num(n) : String(Math.round(n)); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function ga(da) { try { gtag('event', 'apri_mappa', { da: GA + '-' + da }); } catch (e) {} }
  // le icone della mappa (index.html, ICONE)
  var ICONE = [[/clearsky_day|fair_day/, '☀️'], [/clearsky_night|fair_night/, '🌙'], [/partlycloudy_day/, '⛅'], [/partlycloudy_night|^cloudy|fog/, '☁️'],
               [/thunder/, '⛈️'], [/heavyrain|heavysleet/, '🌧️'], [/rain|sleet|drizzle/, '🌦️'], [/snow/, '🌨️']];
  function icona(s) { for (var i = 0; i < ICONE.length; i++) if (ICONE[i][0].test(s || '')) return ICONE[i][1]; return '☁️'; }
  /* ⚠️ I GIORNI PER DATA, NON PER POSIZIONE (19/10/2026, quinto check, bug 11). Dopo mezzanotte una previsione presa
     prima (cache) comincia con IERI: la tabella chiamava «oggi» ieri e il grafico metteva ieri due volte, fra i
     misurati e fra i previsti. I giorni passati si tolgono appena arriva la risposta (daOggi) e i nomi si danno
     confrontando la data. Stessa regola nella mappa (index.html) e in lib/pagina-adesso.js. */
  function isoRoma(ms) { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); }
  // ⚠️ DOMANI = OGGI + un giorno di CALENDARIO (20/10/2026, sesto check, bug 7): «adesso + 24 ore» sbagliava al cambio
  // d'ora (25/10/2026 fra 00 e 01 dava ancora il 25, 27/3/2027 fra 23 e 24 dava il 29). Mezzogiorno UTC: nessun fuso lo sposta.
  var OGGI = isoRoma(Date.now()), DOMANI = (function (p) { return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1, 12)).toISOString().slice(0, 10); })(OGGI.split('-'));
  function daOggi(j) { if (j && j.capoluoghi) j.capoluoghi.forEach(function (c) { if (c.giorni) c.giorni = c.giorni.filter(function (x) { return x.g >= OGGI; }); }); return j; }
  function nomeG(s, d) { var x = daIso(s); return s === OGGI ? 'oggi' : s === DOMANI ? 'domani' : GS[x.getDay()] + ' ' + x.getDate(); }
  function nomeReg(k) { return { valledaosta: "Valle d'Aosta", altoadige: 'Alto Adige', emilia: 'Emilia-Romagna', friuli: 'Friuli' }[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }
  function pl(x) { return '&pl=' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4) + '&pn=' + encodeURIComponent(x.n) + (x.z ? '&pz=1' : ''); }
  function vai(url, da) { ga(da); setTimeout(function () { location.href = url; }, 120); }

  /* ── l'elenco dei comuni e le frazioni ── */
  var ELENCO = null, IN_ARRIVO = null;
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* ⚠️ (20/10/2026, sesto check, bug 14) un 503 non e' un elenco: prima il testo dell'errore diventava ELENCO=[] e la
     casella restava muta per tutta la visita. Come lib/pagina-adesso.js: errore se !r.ok, UNA promessa in volo (due
     chiamate ravvicinate non scaricano due volte i 366 KB) e dimenticata sull'errore, cosi' si ritenta alla prossima. */
  function carica() {
    if (ELENCO) return Promise.resolve(ELENCO);
    if (!IN_ARRIVO) IN_ARRIVO = fetch('/data/elenco-paesi.txt').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
      var a = [];
      t.split('\n').forEach(function (r) { var p = r.split('|'); if (p.length < 6) return;
        a.push({ n: p[0], lat: +p[1], lon: +p[2], sg: p[3], reg: p[4], pop: +p[5] || 0, z: (p[6] || '').trim() === 'z', q: norm(p[0]) }); });
      ELENCO = a; IN_ARRIVO = null;
      return a;
    }).catch(function (e) { IN_ARRIVO = null; throw e; });
    return IN_ARRIVO;
  }
  function cerca(q) {
    q = norm(q); if (q.length < 2 || !ELENCO) return [];
    var a = [];
    ELENCO.forEach(function (x) { var i = x.q.indexOf(q); if (i < 0 || (i !== 0 && x.q.charAt(i - 1) !== ' ')) return; a.push({ x: x, p: i === 0 ? 0 : 1 }); });
    a.sort(function (u, v) { return u.p - v.p || (v.x.z - u.x.z) || v.x.pop - u.x.pop; });   // tutta Italia alla pari
    return a.slice(0, 6).map(function (u) { return u.x; });
  }
  // ⚠️ COPIA di GEO_REGIONI di index.html e di lib/pagina-adesso.js: se cambia una, cambiano tutte
  var GEO_REGIONI = { 'Piemonte': 'piemonte', "Valle d'Aosta": 'valledaosta', 'Lombardia': 'lombardia', 'Veneto': 'veneto',
    'Friuli Venezia Giulia': 'friuli', 'Liguria': 'liguria', 'Emilia-Romagna': 'emilia', 'Toscana': 'toscana', 'Umbria': 'umbria',
    'Marche': 'marche', 'Lazio': 'lazio', 'Abruzzo': 'abruzzo', 'Molise': 'molise', 'Campania': 'campania', 'Puglia': 'puglia',
    'Basilicata': 'basilicata', 'Calabria': 'calabria', 'Sicilia': 'sicilia', 'Sardegna': 'sardegna' };
  function frazioni(testo) {
    return fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(testo) + '&count=10&language=it&countryCode=IT')
      .then(function (r) { return r.json(); }).then(function (j) {
        var visti = {};
        return (j.results || []).map(function (x) {
          var a1 = x.admin1 || '', a2 = x.admin2 || '';
          var k = a1.indexOf('Trentino') === 0 ? (a2.indexOf('Bolzano') >= 0 ? 'altoadige' : 'trentino') : GEO_REGIONI[a1];
          if (!k) return null;
          var sig = (a2 || a1).replace(/^Provincia (autonoma )?(di |dell'|della |del )?/i, '').replace(/^Citt[aà] metropolitana di /i, '');
          var ch = x.name + '|' + sig; if (visti[ch]) return null; visti[ch] = 1;
          return { n: x.name, lat: x.latitude, lon: x.longitude, sg: '', reg: k, pop: x.population || 0, fraz: 'frazione · ' + sig.slice(0, 18), q: norm(x.name) };
        }).filter(Boolean).sort(function (u, v) { return v.pop - u.pop; });
      });
  }
  // una casella col suo menu: i comuni subito, le frazioni dopo una pausa di scrittura se c'e' posto
  function casella(inp, drop, scelto) {
    var righe = [], sel = -1, giro = 0, attesa = null;
    function disegna() {
      drop.innerHTML = righe.map(function (x, i) { return '<div class="mk-r" data-i="' + i + '"><span>' + esc(x.n) + '</span><small>' + (x.fraz ? x.fraz : (x.z ? 'zona · ' : (x.sg ? x.sg + ' · ' : '')) + nomeReg(x.reg)) + '</small></div>'; }).join('');
      drop.classList.add('on');
    }
    function mostra(q) {
      righe = cerca(q); sel = -1;
      var mio = ++giro; clearTimeout(attesa);
      if (righe.length < 6 && norm(q).length >= 3) attesa = setTimeout(function () {
        frazioni(q.trim()).then(function (f) {
          if (mio !== giro || sel >= 0) return;   // ha scritto altro, o sta scegliendo con le frecce
          var visti = {}; righe.forEach(function (x) { visti[x.q + '|' + x.reg] = 1; });
          righe = righe.concat(f.filter(function (x) { return !visti[x.q + '|' + x.reg]; })).slice(0, 7);
          if (righe.length) disegna(); else drop.innerHTML = '<div class="mk-porte-t">Nessun posto con questo nome<small>prova con il nome del comune</small></div>';
        }).catch(function () {});
      }, 350);
      if (!righe.length) { drop.innerHTML = norm(q).length >= 3 ? '<div class="mk-porte-t">Cerco anche tra le frazioni…</div>' : ''; drop.classList.toggle('on', norm(q).length >= 3); return; }
      disegna();
    }
    // senza elenco (errore) si cerca lo stesso: restano le frazioni del geocoder, e la prossima lettera ritenta l'elenco
    inp.addEventListener('focus', function () { carica().catch(function () {}); });
    inp.addEventListener('input', function () { carica().catch(function () {}).then(function () { mostra(inp.value); }); });
    inp.addEventListener('keydown', function (e) {
      var rs = drop.querySelectorAll('.mk-r');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!rs.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rs.length) % rs.length; for (var i = 0; i < rs.length; i++) rs[i].classList.toggle('sel', i === sel); }
      else if (e.key === 'Enter') { e.preventDefault(); if (righe.length) { inp.value = righe[sel >= 0 ? sel : 0].n; scelto(righe[sel >= 0 ? sel : 0]); } }
      else if (e.key === 'Escape') { drop.classList.remove('on'); inp.blur(); }
    });
    drop.addEventListener('click', function (e) { var r = e.target.closest('.mk-r'); if (r) { var x = righe[+r.getAttribute('data-i')]; inp.value = x.n; scelto(x); } });
    document.addEventListener('click', function (e) { if (!inp.parentNode.contains(e.target)) drop.classList.remove('on'); });
  }
  function seiPorte(x) {
    return [['☀️', 'Previsioni', '7 giorni, ora per ora', '/?r=' + x.reg + '&m=prev' + pl(x), 'previsioni'],
            ['💧', 'Pioggia caduta', 'ieri, 7 e 30 giorni', '/?r=' + x.reg + '&g=7' + pl(x), 'pioggia'],
            ['📡', 'Radar adesso', 'la pioggia in corso', '/?r=' + x.reg + '&radar=ora' + pl(x), 'radar'],
            ['🌡', 'Temperature', 'minime e massime', '/?r=' + x.reg + '&g=1&tq=1' + pl(x), 'temperature'],
            ['🌲', 'Boschi', "che bosco c'è, a che quota", '/?r=' + x.reg + '&boschi=1' + pl(x), 'boschi'],
            ['🛰', 'Satellite', "la foto dall'alto", '/?r=' + x.reg + '&boschi=1&sat=1' + pl(x), 'satellite']];
  }

  /* ═══ 1. IL CERCA NELL'INTESTAZIONE ═══ */
  var header = document.querySelector('header');
  if (header) {
    var hbox = el('div', 'mk-cerca'), hinp = el('input'), hdrop = el('div', 'mk-drop');
    hinp.type = 'search'; hinp.placeholder = 'Cerca un paese o una zona'; hinp.setAttribute('autocomplete', 'off'); hinp.setAttribute('aria-label', 'Cerca un paese o una zona');
    hbox.appendChild(hinp); hbox.appendChild(hdrop);
    var lente = el('button', 'mk-lente', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>');
    lente.setAttribute('aria-label', 'Cerca un paese');
    var yt = header.querySelector('.yt');
    header.insertBefore(hbox, yt); header.insertBefore(lente, yt);
    lente.addEventListener('click', function (e) { e.stopPropagation(); header.classList.add('mk-aperto'); hinp.focus(); });
    document.addEventListener('click', function (e) { if (!hbox.contains(e.target) && !hinp.value) header.classList.remove('mk-aperto'); });
    casella(hinp, hdrop, function (x) {
      hdrop.innerHTML = '<div class="mk-porte-t">' + esc(x.n) + '<small>Cosa vuoi vedere sulla mappa?</small></div><div class="mk-6">'
        + seiPorte(x).map(function (p) { return '<a href="' + SITO + p[3] + '" data-da="cerca-testa-' + p[4] + '"><span>' + p[0] + '</span><div>' + p[1] + '<small>' + p[2] + '</small></div></a>'; }).join('') + '</div>';
      hdrop.classList.add('on');
    });
    hdrop.addEventListener('click', function (e) { var a = e.target.closest('a[data-da]'); if (a) ga(a.getAttribute('data-da')); });
  }

  /* ═══ 3. «CHE TEMPO FARÀ»: la casella e le citta' ═══ */
  var blocco = document.getElementById(OPZ.id || 'meteo');
  var tuo = blocco && blocco.querySelector('.mk-tuo input');
  if (tuo) casella(tuo, blocco.querySelector('.mk-tuo .mk-drop'), function (x) { tuo.blur(); vai(SITO + '/?r=' + x.reg + '&m=prev' + pl(x), 'cerca-meteo'); });
  var bosco = OPZ.boschi && document.getElementById(OPZ.boschi), bin = bosco && bosco.querySelector('.mk-tuo input');
  if (bin) casella(bin, bosco.querySelector('.mk-tuo .mk-drop'), function (x) { bin.blur(); vai(SITO + '/?r=' + x.reg + '&boschi=1' + pl(x), 'cerca-boschi'); });
  function disegnaCitta(j) {
    var box = blocco && blocco.querySelector('.mk-citta'); if (!box) return;
    var cc = (j && j.capoluoghi || []).filter(function (c) { return c.giorni && c.giorni.length >= 3; });
    if (!cc.length) { box.innerHTML = '<p class="mk-attesa">' + (OPZ.guasto || 'Le previsioni delle città') + ' non rispondono in questo momento: <a href="' + SITO + '/?r=' + K + '&m=prev">aprile sulla mappa</a>.</p>'; return; }
    // prima il capoluogo di regione, poi per abitanti (dall'elenco dei comuni): Prato e Pisa prima di Manciano
    var ab = {}; (ELENCO || []).forEach(function (x) { if (x.reg === K && !x.z) ab[x.q] = x.pop; });
    if (!OPZ.area && !OPZ.primi) cc.sort(function (a, b) { return (b.c || 0) - (a.c || 0) || (ab[norm(b.n)] || 0) - (ab[norm(a.n)] || 0) || a.n.localeCompare(b.n, 'it'); });
    var g0 = cc[0].giorni;
    var testa = '<div class="mk-cr mk-cr-t"><span></span>' + [0, 1, 2].map(function (d) { return '<span>' + nomeG(g0[d].g, d) + '</span>'; }).join('') + '</div>';
    var righe = cc.map(function (c, i) {
      return '<a class="mk-cr' + (i >= 6 ? ' mk-dopo' : '') + '" href="' + SITO + '/?r=' + (c.r || K) + '&m=prev' + pl(c) + '" data-da="citta"><b>' + esc(c.n) + (c.qui ? '<small>al pluviometro</small>' : c.sotto ? '<small>' + esc(c.sotto) + '</small>' : '') + '</b>'
        + [0, 1, 2].map(function (d) { var g = c.giorni[d]; return '<span><i>' + icona(g.s) + '</i>' + g.mx + '°'
          + ((g.mm || 0) >= 0.5 ? '<em>' + mm(g.mm) + ' mm</em>' : '') + '</span>'; }).join('') + '</a>';
    }).join('');
    /* IL BOTTONE DEL RADAR (20/10/2026, suo: «il bottone dove sta piovendo adesso col radar è un po' nascosto»).
       Prima era una riga piccola in coda a «Tocca una città...»: ora e' un bottone sotto la tabella (sua scelta, sotto
       e non sopra). Si accende (blu pieno, pallino che pulsa) quando nella colonna «oggi» della tabella almeno un posto
       ha 1 mm o piu': si accende solo su un dato vero. Porta al radar sulla mappa centrato sul posto se la pagina ha gia'
       quel link (paesi, zone), se no alla pagina «adesso» della regione. */
    var bagnati = cc.filter(function (c) { var g = c.giorni[0]; return g && g.g === OGGI && (g.mm || 0) >= 1; }), piove = bagnati.length > 0;
    var rmap = document.querySelector('main a[href*="radar=ora"]');
    var rh = rmap ? rmap.getAttribute('href') : ADESSO ? SITO + '/' + K + '/adesso/' : '';
    var h2 = blocco.querySelector('h2'), dove = h2 ? h2.textContent.replace(/^Che tempo farà\s*/, '') : '';
    /* L'INDICE /funghi/ (OPZ.primi, 20/10/2026) non ha un link al radar ne' una pagina «adesso»: il radar si apre sul
       primo dei venti posti dove oggi piove (se no sul primo della classifica), e la scritta dice in quanti piove. */
    if (OPZ.primi && !rmap && cc[0]) { var cp = bagnati[0] || cc[0]; rh = SITO + '/?r=' + (cp.r || K) + '&radar=ora' + pl(cp); rmap = true;
      if (piove) dove = 'in ' + (bagnati.length === 1 ? 'uno' : bagnati.length) + ' dei ' + cc.length + ' posti'; }
    var radar = !rh ? '' : '<a class="mk-radar' + (piove ? ' piove' : '') + '" href="' + esc(rh) + '"'
      + (rmap ? ' data-da="radar-' + (piove ? 'pioggia' : 'asciutto') + '"' : ' data-adesso="1"') + '>'
      + (piove ? '<span class="mk-pul"></span><span><b>Oggi è prevista pioggia ' + esc(dove) + '</b><small>guardala arrivare col radar piogge</small></span>'
               : '<span class="mk-ic">📡</span><span><b>Dove sta piovendo adesso</b><small>guarda il radar piogge</small></span>')
      + '<span class="mk-fr">→</span></a>';
    box.innerHTML = (OPZ.sopra ? '<p class="mk-sopra">' + esc(OPZ.sopra) + '</p>' : '') + '<div class="mk-tab">' + testa + righe + '</div>'
      + (cc.length > 6 ? '<button class="mk-tutte">' + (OPZ.tutte || 'Mostra tutte le # città').replace('#', cc.length) + '</button>' : '')
      + '<p class="mk-citta-n">' + (OPZ.tocca || 'Tocca una città per vederla ora per ora sulla mappa') + '</p>' + radar;
    var bt = box.querySelector('.mk-tutte');
    if (bt) bt.addEventListener('click', function () { box.classList.add('mk-aperte'); bt.remove(); });
  }
  if (blocco) blocco.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-da]'); if (a) ga(a.getAttribute('data-da'));
    if (e.target.closest('a[data-adesso]')) { try { gtag('event', 'apri_adesso', { da: GA + '-meteo' }); } catch (x) {} }
  });

  /* ═══ 4. IL GRAFICO: 30 giorni misurati + 7 previsti (media delle citta') ═══ */
  // la media per DATA, non per posizione (20/10/2026, sesto check): una citta' con un giorno in meno in testa non
  // sposta piu' le altre, e la data non si prende piu' dalla prima citta'
  function previsti(j) {
    var somma = {}, quante = {}, date = [];
    (j && j.capoluoghi || []).forEach(function (c) {
      (c.giorni || []).forEach(function (g) {
        if (!g || !g.g || g.g < OGGI) return;
        if (somma[g.g] === undefined) { somma[g.g] = 0; quante[g.g] = 0; date.push(g.g); }
        somma[g.g] += g.mm || 0; quante[g.g]++;
      });
    });
    date.sort();
    return date.slice(0, 7).map(function (d) { return { g: d, mm: somma[d] / quante[d] }; });
  }
  function grafico(j, F) {
    var box = document.getElementById('grafico'); if (!box || !j || !j.serie || !F.length) return;
    var s = j.serie, n = Math.min(30, s.length), max = 1, i, q;
    for (q = 0; q < n; q++) max = Math.max(max, s[q] || 0);
    F.forEach(function (g) { max = Math.max(max, g.mm); });
    var ultimo = j.serieDa || j.ultimoGiorno || (j.periodi['1'] || j.periodi['7']).ultimo;   // ultimoGiorno: il riepilogo di zona
    var cand = [], lab = {};
    for (var c = 1; c <= n; c++) if (s[c - 1] != null && s[c - 1] >= 1 && s[c - 1] >= max * 0.2) cand.push(c);
    cand.sort(function (a, b) { return s[b - 1] - s[a - 1]; }).forEach(function (c) { if (!lab[c - 1] && !lab[c + 1]) lab[c] = 1; });
    var barre = '', ax = '';
    for (i = n; i >= 1; i--) {
      var v = s[i - 1], g = daIso(ultimo); g.setDate(g.getDate() - (i - 1));
      barre += '<div class="b' + (i <= 7 ? ' dentro' : '') + '" title="' + g.getDate() + ' ' + MESI[g.getMonth()] + ': ' + (v == null ? 'nessun dato' : num(v) + ' mm') + '">'
        + (lab[i] ? '<b>' + mm(v) + '</b>' : '') + '<i style="height:' + (v == null ? 0 : Math.max(2, Math.round(v / max * 86))) + '%"></i></div>';
      ax += '<span>' + ((i === n || i % 5 === 0) ? (g.getDate() + '/' + (g.getMonth() + 1)) : '') + '</span>';
    }
    F.forEach(function (f, d) {
      var x = daIso(f.g);
      barre += '<div class="b mk-fut' + (d === 0 ? ' mk-oggi' : '') + '" title="' + nomeG(f.g, d) + ', previsti: ' + num(f.mm) + ' mm">'
        + (f.mm >= 1 && f.mm >= max * 0.2 ? '<b>' + mm(f.mm) + '</b>' : '') + '<i style="height:' + Math.max(2, Math.round(f.mm / max * 86)) + '%"></i></div>';
      ax += '<span class="mk-fx">' + (d === 0 ? 'oggi' : d % 2 === 0 ? GS[x.getDay()] : '') + '</span>';
    });
    box.innerHTML = '<div class="gg">' + barre + '</div><div class="gg-x">' + ax + '</div>'
      + '<p class="gg-leg"><i style="background:var(--blu)"></i>ultimi 7 giorni &nbsp; <i style="background:#b9cbe2"></i>i giorni prima &nbsp; '
      + '<i class="mk-leg-fut"></i>previsti &nbsp;·&nbsp; ' + (OPZ.media || 'media della regione') + ', in mm</p>';
    var h = document.getElementById('h-grafico'); if (h) h.textContent = 'La pioggia: gli ultimi 30 giorni e i prossimi 7';
  }

  // senza il blocco «Che tempo farà» (mappa forestale: tipi di bosco e Italia, solo la ricerca) le previsioni non si chiedono
  /* OPZ.primi (20/10/2026, indice /funghi/): i posti della tabella sono quelli della CLASSIFICA DEL GIORNO
     (data/funghi/italia.json, cambia ogni mattina): prima si legge la classifica, poi si chiedono all'API i suoi primi
     OPZ.primi posti con ?posti=<reg>/<slug>/<sigla>,... nello stesso ordine. */
  var area = !OPZ.primi ? Promise.resolve(AREA) : fetch(BASE + 'funghi/italia.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (j) { return 'posti=' + (j.primi || []).slice(0, OPZ.primi).map(function (x) { return x[2] + '/' + x[3] + '/' + x[1]; }).join(','); });
  var citta = !blocco ? Promise.resolve(null)
    : area.then(function (a) { return fetch(API + '?' + a); }).then(function (r) { return r.json(); }).then(daOggi).catch(function () { return null; });   // da oggi in poi (bug 11)
  var riepilogo = OPZ.grafico === false ? null : fetch(BASE + RIEP).then(function (r) { return r.json(); }).catch(function () { return null; });
  // l'elenco dei comuni (366 KB) serve solo a ordinare le citta' per abitanti: nelle zone (OPZ.area) i paesi arrivano
  // gia' in ordine, quindi si disegna subito (20/10/2026, sesto check, bug 15)
  /* OPZ.ordine (20/10/2026, pagine regione funghi): l'id dell'elenco delle zone della pagina. La tabella prende il SUO
     ordine (dalla zona piu' bagnata 13-20 giorni fa), che la pagina fa quando arrivano i millimetri: si aspetta quello
     (la prima .zmm scritta), al massimo 10 secondi, poi si disegna comunque. Ogni zona porta il suo slug (s). */
  function inOrdine(j) {
    var t0 = Date.now();
    (function guarda() {
      var l = document.getElementById(OPZ.ordine), z = l && l.querySelector('.zmm');
      if (!(z && z.textContent) && Date.now() - t0 < 10000) { setTimeout(guarda, 200); return; }
      var ord = [].map.call(l ? l.querySelectorAll('a') : [], function (a) { return (a.getAttribute('href').match(/zone\/([^/]+)/) || [])[1]; });
      if (j && j.capoluoghi) j.capoluoghi.sort(function (a, b) { var i = ord.indexOf(a.s), k = ord.indexOf(b.s); return (i < 0 ? 999 : i) - (k < 0 ? 999 : k); });
      disegnaCitta(j);
    })();
  }
  citta.then(function (j) { if (OPZ.ordine) return inOrdine(j); if (OPZ.area || OPZ.primi) return disegnaCitta(j); return carica().catch(function () {}).then(function () { disegnaCitta(j); }); });
  // il grafico e' gia' cotto nell'HTML, ma la pagina lo RIDISEGNA quando arriva il suo riepilogo:
  // per qualche secondo si ricontrolla e si rimettono i giorni previsti se sono spariti
  if (OPZ.grafico !== false) Promise.all([citta, riepilogo]).then(function (x) {
    var F = previsti(x[0]), t0 = Date.now();
    (function aspetta() {
      if (document.querySelector('#grafico .gg') && !document.querySelector('#grafico .mk-fut')) grafico(x[1], F);
      if (Date.now() - t0 < 20000) setTimeout(aspetta, 200);
    })();
  });
}

module.exports = { METEO_CSS, meteoHtml, boschiHtml, meteoClient, ESTERE };
