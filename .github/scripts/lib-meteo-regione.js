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
.mk-cr span{display:flex;align-items:center;gap:3px;font-weight:600;flex-wrap:wrap;}
.mk-cr span i{font-style:normal;font-size:19px;}
.mk-cr span em{font-style:normal;font-size:12px;color:#1f6fd1;font-weight:700;width:100%;padding-left:24px;margin-top:-3px;}
.mk-cr-t{background:#eef4fb;font-size:13px;color:#4a6180;padding:6px 12px;}
.mk-cr-t span{font-weight:700;}
.mk-dopo{display:none;}
.mk-aperte .mk-dopo{display:grid;}
.mk-tutte{display:block;width:100%;margin:10px 0 0;padding:10px;border:1px solid #c5d4e6;border-radius:10px;background:#fff;color:#1b3f6e;font:700 15px system-ui,sans-serif;cursor:pointer;}
.mk-citta-n{font-size:13.5px;color:#5f738c;margin:10px 0 0;}
.mk-citta-n a{color:#1b3f6e;font-weight:700;}
@media(max-width:400px){.mk-cr{font-size:14px;padding:8px 9px;}.mk-cr span i{font-size:17px;}}
.gg .b.mk-fut i{background:repeating-linear-gradient(135deg,#7fb2ec 0 5px,#a9cdf5 5px 10px);border-radius:3px 3px 0 0;}
.gg .b.mk-fut b{color:#2f6db5;}
.gg .b.mk-oggi{border-left:2px dashed #e0a800;margin-left:3px;padding-left:1px;}
.gg-x span.mk-fx{color:#2f6db5;font-weight:600;}
.gg-leg .mk-leg-fut{background:repeating-linear-gradient(135deg,#7fb2ec 0 4px,#a9cdf5 4px 8px) !important;}
`;

// il blocco «Che tempo farà», scritto nella pagina (niente salti al caricamento); le citta' le riempie il codice
function meteoHtml(r) {
  const estera = ESTERE.includes(r.k);
  return `<section class="mk-meteo" id="meteo">
<h2>Che tempo farà ${r.prep} ${r.nome}</h2>
${estera ? '' : `<div class="mk-tuo"><input type="search" autocomplete="off" aria-label="Cerca un paese o una frazione" placeholder="Il tuo paese, anche una frazione"><div class="mk-drop"></div></div>
`}<div class="mk-citta"><p class="mk-attesa">Sto leggendo le previsioni delle città…</p></div>
</section>`;
}

/* ⚠️ GIRA NEL BROWSER: la pagina la copia con toString() e la chiama coi suoi valori, come numeriRegione.
   Niente require, niente sintassi che i telefoni vecchi non capiscono. */
function meteoClient(K, NOME, SITO, ADESSO) {
  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== '8788' ? 'http://127.0.0.1:8788/api/previsioni' : '/api/previsioni';
  var BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/data/' : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
  var GS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function el(t, cl, html) { var e = document.createElement(t); if (cl) e.className = cl; if (html != null) e.innerHTML = html; return e; }
  function daIso(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function mm(n) { return n === 0 ? '0' : n < 10 ? num(n) : String(Math.round(n)); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function ga(da) { try { gtag('event', 'apri_mappa', { da: 'pagina-' + K + '-' + da }); } catch (e) {} }
  // le icone della mappa (index.html, ICONE)
  var ICONE = [[/clearsky_day|fair_day/, '☀️'], [/clearsky_night|fair_night/, '🌙'], [/partlycloudy_day/, '⛅'], [/partlycloudy_night|^cloudy|fog/, '☁️'],
               [/thunder/, '⛈️'], [/heavyrain|heavysleet/, '🌧️'], [/rain|sleet|drizzle/, '🌦️'], [/snow/, '🌨️']];
  function icona(s) { for (var i = 0; i < ICONE.length; i++) if (ICONE[i][0].test(s || '')) return ICONE[i][1]; return '☁️'; }
  function nomeG(s, d) { var x = daIso(s); return d === 0 ? 'oggi' : d === 1 ? 'domani' : GS[x.getDay()] + ' ' + x.getDate(); }
  function nomeReg(k) { return { valledaosta: "Valle d'Aosta", altoadige: 'Alto Adige', emilia: 'Emilia-Romagna', friuli: 'Friuli' }[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }
  function pl(x) { return '&pl=' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4) + '&pn=' + encodeURIComponent(x.n) + (x.z ? '&pz=1' : ''); }
  function vai(url, da) { ga(da); setTimeout(function () { location.href = url; }, 120); }

  /* ── l'elenco dei comuni e le frazioni ── */
  var ELENCO = null;
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function carica() {
    if (ELENCO) return Promise.resolve(ELENCO);
    return fetch('/data/elenco-paesi.txt').then(function (r) { return r.text(); }).then(function (t) {
      ELENCO = [];
      t.split('\n').forEach(function (r) { var p = r.split('|'); if (p.length < 6) return;
        ELENCO.push({ n: p[0], lat: +p[1], lon: +p[2], sg: p[3], reg: p[4], pop: +p[5] || 0, z: (p[6] || '').trim() === 'z', q: norm(p[0]) }); });
      return ELENCO;
    });
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
    inp.addEventListener('focus', function () { carica(); });
    inp.addEventListener('input', function () { carica().then(function () { mostra(inp.value); }); });
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
  var blocco = document.getElementById('meteo');
  var tuo = blocco && blocco.querySelector('.mk-tuo input');
  if (tuo) casella(tuo, blocco.querySelector('.mk-tuo .mk-drop'), function (x) { tuo.blur(); vai(SITO + '/?r=' + x.reg + '&m=prev' + pl(x), 'cerca-meteo'); });
  function disegnaCitta(j) {
    var box = blocco && blocco.querySelector('.mk-citta'); if (!box) return;
    var cc = (j && j.capoluoghi || []).filter(function (c) { return c.giorni && c.giorni.length >= 3; });
    if (!cc.length) { box.innerHTML = '<p class="mk-attesa">Le previsioni delle città non rispondono in questo momento: <a href="' + SITO + '/?r=' + K + '&m=prev">aprile sulla mappa</a>.</p>'; return; }
    // prima il capoluogo di regione, poi per abitanti (dall'elenco dei comuni): Prato e Pisa prima di Manciano
    var ab = {}; (ELENCO || []).forEach(function (x) { if (x.reg === K && !x.z) ab[x.q] = x.pop; });
    cc.sort(function (a, b) { return (b.c || 0) - (a.c || 0) || (ab[norm(b.n)] || 0) - (ab[norm(a.n)] || 0) || a.n.localeCompare(b.n, 'it'); });
    var g0 = cc[0].giorni;
    var testa = '<div class="mk-cr mk-cr-t"><span></span>' + [0, 1, 2].map(function (d) { return '<span>' + nomeG(g0[d].g, d) + '</span>'; }).join('') + '</div>';
    var righe = cc.map(function (c, i) {
      return '<a class="mk-cr' + (i >= 6 ? ' mk-dopo' : '') + '" href="' + SITO + '/?r=' + K + '&m=prev' + pl(c) + '" data-da="citta"><b>' + esc(c.n) + '</b>'
        + [0, 1, 2].map(function (d) { var g = c.giorni[d]; return '<span><i>' + icona(g.s) + '</i>' + g.mx + '°'
          + ((g.mm || 0) >= 0.5 ? '<em>' + mm(g.mm) + ' mm</em>' : '') + '</span>'; }).join('') + '</a>';
    }).join('');
    box.innerHTML = '<div class="mk-tab">' + testa + righe + '</div>'
      + (cc.length > 6 ? '<button class="mk-tutte">Mostra tutte le ' + cc.length + ' città</button>' : '')
      + '<p class="mk-citta-n">Tocca una città per vederla ora per ora sulla mappa'
      + (ADESSO ? ' · <a href="' + SITO + '/' + K + '/adesso/" data-adesso="1">dove sta piovendo adesso, col radar →</a>' : '') + '</p>';
    var bt = box.querySelector('.mk-tutte');
    if (bt) bt.addEventListener('click', function () { box.classList.add('mk-aperte'); bt.remove(); });
  }
  if (blocco) blocco.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-da]'); if (a) ga(a.getAttribute('data-da'));
    if (e.target.closest('a[data-adesso]')) { try { gtag('event', 'apri_adesso', { da: 'pagina-' + K + '-meteo' }); } catch (x) {} }
  });

  /* ═══ 4. IL GRAFICO: 30 giorni misurati + 7 previsti (media delle citta') ═══ */
  function previsti(j) {
    var cc = (j && j.capoluoghi || []).filter(function (c) { return c.giorni && c.giorni.length; }), out = [];
    for (var d = 0; d < 7 && cc.length; d++) {
      var t = 0, n = 0; cc.forEach(function (c) { var g = c.giorni[d]; if (g) { t += g.mm || 0; n++; } });
      if (!n) break; out.push({ g: cc[0].giorni[d].g, mm: t / n });
    }
    return out;
  }
  function grafico(j, F) {
    var box = document.getElementById('grafico'); if (!box || !j || !j.serie || !F.length) return;
    var s = j.serie, n = Math.min(30, s.length), max = 1, i, q;
    for (q = 0; q < n; q++) max = Math.max(max, s[q] || 0);
    F.forEach(function (g) { max = Math.max(max, g.mm); });
    var ultimo = j.serieDa || (j.periodi['1'] || j.periodi['7']).ultimo;
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
      + '<i class="mk-leg-fut"></i>previsti &nbsp;·&nbsp; media della regione, in mm</p>';
    var h = document.getElementById('h-grafico'); if (h) h.textContent = 'La pioggia: gli ultimi 30 giorni e i prossimi 7';
  }

  var citta = fetch(API + '?capoluoghi=' + K).then(function (r) { return r.json(); }).catch(function () { return null; });
  var riepilogo = fetch(BASE + 'riepiloghi/' + K + '.json').then(function (r) { return r.json(); }).catch(function () { return null; });
  citta.then(function (j) { return carica().catch(function () {}).then(function () { disegnaCitta(j); }); });
  // il grafico e' gia' cotto nell'HTML, ma la pagina lo RIDISEGNA quando arriva il suo riepilogo:
  // per qualche secondo si ricontrolla e si rimettono i giorni previsti se sono spariti
  Promise.all([citta, riepilogo]).then(function (x) {
    var F = previsti(x[0]), t0 = Date.now();
    (function aspetta() {
      if (document.querySelector('#grafico .gg') && !document.querySelector('#grafico .mk-fut')) grafico(x[1], F);
      if (Date.now() - t0 < 20000) setTimeout(aspetta, 200);
    })();
  });
}

module.exports = { METEO_CSS, meteoHtml, meteoClient, ESTERE };
