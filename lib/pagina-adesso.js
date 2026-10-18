/* Pagine «Dove sta piovendo adesso» (/<regione>/adesso/), 18/10/2026.
   Le pagine sono gusci statici scritti da .github/scripts/genera-pagine-adesso.js: testo, citta' e
   link sono gia' nell'HTML (Google li legge), qui arrivano solo le cose vive:
   - il RADAR: stessa fonte e stessa coda d'indirizzo del tasto «Diretta radar» della mappa (LibreWXR / OPERA);
   - le PREVISIONI delle citta': la stessa funzione del sito (/api/previsioni, MET Norway), un posto per carta;
   - la CASELLA «Cerca una località»: l'elenco paesi del cartello blu, apre le previsioni della mappa sul paese.
   I dati della pagina stanno nel blocco <script id="adesso-dati" type="application/json">. */
(function(){
  var D = JSON.parse(document.getElementById('adesso-dati').textContent);
  var SITO = D.sito;
  // in locale (python -m http.server) la funzione non c'e': si chiede a quella vera, che risponde anche a localhost
  var LOCALE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (LOCALE ? 'https://precipitazioni.avventuremicologiche.it' : '') + '/api/previsioni';
  function ga(n, p){ try{ gtag('event', n, p || {}); }catch(e){} }
  function el(id){ return document.getElementById(id); }

  // ── la cartina e il confine ──
  var mobile = matchMedia('(pointer:coarse)').matches;
  // al telefono il dito scorre la PAGINA, non la cartina (Leaflet altrimenti si mangia il dito): si zooma coi tasti
  var m = L.map('mappa', { scrollWheelZoom:false, dragging:!mobile, tap:false, zoomSnap:0.25 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:12, className:'fondo', attribution:'© OpenStreetMap' }).addTo(m);
  m.createPane('radar');   m.getPane('radar').style.zIndex = 450;   m.getPane('radar').style.pointerEvents = 'none';
  m.createPane('confine'); m.getPane('confine').style.zIndex = 460; m.getPane('confine').style.pointerEvents = 'none';
  var lay = L.geoJSON(D.confine, { pane:'confine', style:{ color:'#1b3f6e', weight:2.6, fill:false, opacity:.95 } }).addTo(m);
  // si inquadra il pezzo PIU' GRANDE della regione: con le isole lontane (Pantelleria, Lampedusa) la Sicilia
  // diventava piccola in mezzo al mare. Le isole vicine restano in vista.
  var grande = null, area = -1;
  lay.eachLayer(function(l){
    var anelli = l.getLatLngs(); if(!Array.isArray(anelli[0][0])) anelli = [anelli];
    anelli.forEach(function(p){ var b = L.latLngBounds(p[0]), a = (b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());
      if(a > area){ area = a; grande = b; } });
  });
  m.fitBounds(grande || lay.getBounds(), { padding:[20,20] });

  // ── il radar ──
  var RADAR = 'https://api.librewxr.net/public/weather-maps.json', CODA = '/256/{z}/{x}/{y}/2/1_1.png';
  var strati = [], timer = null, scelta = 'ora';
  function ora(t){ return new Date(t*1000).toLocaleTimeString('it-IT', { timeZone:'Europe/Rome', hour:'2-digit', minute:'2-digit' }); }
  function stato(t, err){ var s = el('stato'); s.textContent = t; s.className = 'rb-stato' + (err ? ' err' : ''); }
  function pulisci(){ if(timer){ clearInterval(timer); timer = null; } strati.forEach(function(l){ m.removeLayer(l); }); strati = []; }
  function accendi(i){
    strati.forEach(function(l, j){ l.setOpacity(j === i ? 0.95 : 0); });
    el('quando').textContent = (scelta === 'prev' ? 'previsto per le ' : 'radar delle ') + ora(strati[i]._quando);
  }
  function carica(id){
    scelta = id;
    [].forEach.call(document.querySelectorAll('.rb .tasti a'), function(a){ a.classList.toggle('forte', a.dataset.id === id); });
    fetch(RADAR).then(function(r){ return r.ok ? r.json() : Promise.reject(); }).then(function(j){
      var p = (j.radar && j.radar.past) || [], n = (j.radar && j.radar.nowcast) || [];
      var lista = id === 'ora' ? p.slice(-1) : (id === 'due' ? p : n);
      if(!lista.length) throw 0;
      pulisci();
      strati = lista.map(function(f){
        var l = L.tileLayer(j.host + f.path + CODA, { opacity:0, pane:'radar', maxNativeZoom:6, maxZoom:12,
          attribution:'radar <a href="https://librewxr.net/" target="_blank" rel="noopener">LibreWXR</a> / OPERA (CC BY)' });
        l._quando = f.time; l.addTo(m); return l; });
      var i = 0; accendi(i);
      if(strati.length > 1) timer = setInterval(function(){ i = (i + 1) % strati.length; accendi(i); }, 700);
      stato(id === 'prev' ? "Le macchie di adesso spostate dove stanno andando: vale solo per l'ora che viene." : 'Radar europeo OPERA, risoluzione 2 km.');
      window._radarPronto = true;
    }).catch(function(){ stato('⚠️ Radar non raggiungibile, riprova fra poco', true); });
  }
  [].forEach.call(document.querySelectorAll('.rb .tasti a'), function(a){
    a.addEventListener('click', function(){ carica(a.dataset.id); ga('adesso_radar', { regione:D.k, modo:a.dataset.id }); });
  });
  carica('ora');
  setInterval(function(){ if(scelta === 'ora') carica('ora'); }, 300000);   // un fotogramma nuovo ogni 5 minuti

  // ── le previsioni delle citta' ──
  // icone: le STESSE della sezione Previsioni della mappa (ICONE in index.html)
  var ICONE = [[/clearsky_day|fair_day/,'☀️'],[/clearsky_night|fair_night/,'🌙'],[/partlycloudy_day/,'⛅'],[/partlycloudy_night|^cloudy|fog/,'☁️'],
               [/thunder/,'⛈️'],[/heavyrain|heavysleet/,'🌧️'],[/rain|sleet|drizzle/,'🌦️'],[/snow/,'🌨️']];
  function icona(s){ for(var i = 0; i < ICONE.length; i++) if(ICONE[i][0].test(s || '')) return ICONE[i][1]; return '☁️'; }
  var NOMI = { clearsky:'Sereno', fair:'Poco nuvoloso', partlycloudy:'Parzialmente nuvoloso', cloudy:'Nuvoloso', fog:'Nebbia',
    lightsnow:'Neve debole', snow:'Neve', heavysnow:'Neve forte' };
  /* L'intensita' della pioggia la decidono i MILLIMETRI dell'ora, non il nome del simbolo: MET chiama «heavyrain»
     anche 1 mm/h, e «Pioggia forte · 1 mm» accanto al numero sembra un errore. Soglie: sotto 2 debole, sopra 6 forte. */
  function cond(s, mmOra){ var b = (s || '').replace(/_(day|night|polartwilight)$/, '');
    if(/thunder/.test(b)) return 'Temporale';
    if(/rain/.test(b) && !/sleet|snow/.test(b)){
      var base = /showers/.test(b) ? 'Rovesci' : 'Pioggia', v = mmOra || 0;
      return v < 2 ? base + (base === 'Rovesci' ? ' deboli' : ' debole') : v > 6 ? base + (base === 'Rovesci' ? ' forti' : ' forte') : base; }
    return NOMI[b] || (/sleet/.test(b) ? 'Pioggia e neve' : /snow/.test(b) ? 'Neve' : 'Nuvoloso'); }
  function mm(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  // i millimetri in blu e mai spezzati: se non ci stanno vanno a capo interi
  function pg(v){ return v >= 0.5 ? ' <span class="mmw">' + mm(v) + ' mm</span>' : ''; }
  var oggi = new Date().toLocaleDateString('sv-SE', { timeZone:'Europe/Rome' });
  var oraNow = +new Date().toLocaleString('en-GB', { timeZone:'Europe/Rome', hour:'2-digit', hour12:false });
  var fatti = 0, agg = null;
  D.citta.forEach(function(c, i){
    var card = document.querySelector('.cit[data-i="' + i + '"]'); if(!card) return;
    card.addEventListener('click', function(){ ga('adesso_citta', { regione:D.k, posto:c.n }); });
    fetch(API + '?lat=' + c.lat.toFixed(4) + '&lon=' + c.lon.toFixed(4) + (c.q != null ? '&q=' + Math.round(c.q) : '') + '&v=11')
      .then(function(r){ return r.ok ? r.json() : Promise.reject(); }).then(function(d){
        var ore = d.ore || [], h = null;
        for(var k = 0; k < ore.length; k++){ if(ore[k].g > oggi || (ore[k].g === oggi && ore[k].h >= oraNow)){ h = ore[k]; break; } }
        h = h || ore[0]; var g0 = d.giorni[0], g1 = d.giorni[1];
        if(!h || !g0 || !g1) throw 0;
        card.querySelector('.cit-ic').textContent = icona(h.s);
        // l'ora accanto ai gradi: il numero grande e' la PREVISIONE di quell'ora, non una misura
        card.querySelector('.cit-t').innerHTML = Math.round(h.t) + '°<small>alle ' + h.h + '</small>';
        card.querySelector('.cit-cond').innerHTML = cond(h.s, h.mm) + (h.mm >= 0.1 ? ' <span class="mmw">' + mm(h.mm) + ' mm</span>' : '');
        card.querySelector('.cit-gg').innerHTML = 'Oggi <b>' + g0.mn + '°</b> / <b>' + g0.mx + '°</b>' + pg(g0.mm)
          + '<br>Domani ' + icona(g1.s) + ' <b>' + g1.mn + '°</b> / <b>' + g1.mx + '°</b>' + pg(g1.mm);
        if(d.agg && (!agg || d.agg > agg)) agg = d.agg;
      }).catch(function(){ card.querySelector('.cit-cond').textContent = 'Previsione non disponibile'; })
      .then(function(){ if(++fatti === D.citta.length){
        // da dove viene e quando e' stata calcolata; la pioggia di ADESSO e' quella del radar
        var ag = agg ? new Date(agg).toLocaleTimeString('it-IT', { timeZone:'Europe/Rome', hour:'2-digit', minute:'2-digit' }) : null;
        el('pv-quando').textContent = 'Previsioni del modello ECMWF via MET Norway' + (ag ? ', aggiornate alle ' + ag : '')
          + '. La pioggia che cade adesso la mostra il radar qui sopra.';
        window._cittaPronte = true; } });
  });

  // ── la casella: gli 8.610 paesi del cartello blu, si scaricano solo quando servono ──
  var paesi = null, inp = el('pv-in'), lista = el('pv-lista'), trovati = [], su = 0;
  var qui = [D.k];
  function norma(s){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function scarica(){
    if(!paesi) paesi = fetch('/data/elenco-paesi.txt').then(function(r){ return r.text(); }).then(function(t){
      var a = [];
      t.split('\n').forEach(function(r){ var c = r.split('|'); if(c.length < 6) return;
        a.push({ n:c[0], lat:+c[1], lon:+c[2], pr:c[3], reg:c[4], pop:+c[5], k:norma(c[0]) }); });
      return a; });
    return paesi;
  }
  function linkPrev(p){ return SITO + '/?r=' + p.reg + '&m=prev&pl=' + p.lat + ',' + p.lon + '&pn=' + encodeURIComponent(p.n); }
  function cerca(tutti){
    var q = norma(inp.value);
    if(q.length < 2){ lista.className = 'pv-lista'; trovati = []; return; }
    var a = [], b = [];
    tutti.forEach(function(p){ if(p.k.indexOf(q) === 0) a.push(p); else if(p.k.indexOf(' ' + q) > -1) b.push(p); });
    // prima i paesi della regione della pagina, poi gli altri; dentro, dal piu' popoloso
    var ordine = function(x, y){ return (qui.indexOf(x.reg) < 0) - (qui.indexOf(y.reg) < 0) || y.pop - x.pop; };
    trovati = a.sort(ordine).concat(b.sort(ordine)).slice(0, 7); su = 0;
    var giro = ++giri; clearTimeout(attesaGeo);
    // i comuni si vedono SUBITO; le frazioni si chiedono comunque se c'e' posto, come fa la mappa
    // («solda» trovava Soldano e mai Solda): un comune piu' lungo non deve fare da tappo alla frazione
    if(trovati.length >= 7 || q.length < 3){ mostra(); return; }
    if(trovati.length) mostra();
    else { lista.innerHTML = '<li class="vuoto">Cerco anche tra le frazioni…</li>'; lista.className = 'pv-lista aperta'; }
    var testo = inp.value.trim();
    attesaGeo = setTimeout(function(){   // una domanda sola quando si smette di scrivere, non una per lettera
      frazioni(testo).then(function(f){
        if(giro !== giri || su > 0) return;   // ha scritto altro, o sta gia' scegliendo con le frecce
        var visti = {}; trovati.forEach(function(p){ visti[norma(p.n) + '|' + p.reg] = 1; });
        trovati = trovati.concat(f.filter(function(p){ return !visti[norma(p.n) + '|' + p.reg]; })).slice(0, 7);
        mostra();
      }).catch(function(){ if(giro === giri) mostra(); });
    }, 350);
  }
  var attesaGeo = null;
  function mostra(){
    lista.innerHTML = trovati.length ? trovati.map(function(p, i){ return '<li data-i="' + i + '"' + (i === su ? ' class="su"' : '') + '>' + p.n + '<small>' + p.pr + '</small></li>'; }).join('')
      : '<li class="vuoto">Nessun posto con questo nome</li>';
    lista.className = 'pv-lista aperta';
  }
  /* ⚠️ LE FRAZIONI (18/10/2026): l'elenco ha solo gli 8.610 comuni, e «Viozene» o «Prato Nevoso» davano
     «Nessun paese». Come la casella della mappa (locDaGeocoder in index.html), se l'elenco non trova niente
     si chiede al geocoder di Open-Meteo, solo in Italia. ⚠️ La tabella delle regioni e' una COPIA di
     GEO_REGIONI di index.html (questa pagina non vede il codice della mappa): se cambia una, cambia l'altra.
     `giri` tiene solo l'ultima ricerca: una risposta lenta non scrive sopra una piu' nuova. */
  var giri = 0;
  var GEO_REGIONI = { 'Piemonte':'piemonte', "Valle d'Aosta":'valledaosta', 'Lombardia':'lombardia', 'Veneto':'veneto',
    'Friuli Venezia Giulia':'friuli', 'Liguria':'liguria', 'Emilia-Romagna':'emilia', 'Toscana':'toscana', 'Umbria':'umbria',
    'Marche':'marche', 'Lazio':'lazio', 'Abruzzo':'abruzzo', 'Molise':'molise', 'Campania':'campania', 'Puglia':'puglia',
    'Basilicata':'basilicata', 'Calabria':'calabria', 'Sicilia':'sicilia', 'Sardegna':'sardegna' };
  function frazioni(testo){
    return fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(testo) + '&count=10&language=it&countryCode=IT')
      .then(function(r){ return r.json(); })
      .then(function(j){
        var visti = {};
        return (j.results || []).map(function(x){
          var a1 = x.admin1 || '', a2 = x.admin2 || '';
          var k = a1.indexOf('Trentino') === 0 ? (a2.indexOf('Bolzano') >= 0 ? 'altoadige' : 'trentino') : GEO_REGIONI[a1];
          if(!k) return null;
          var sig = (a2 || a1).replace(/^Provincia (autonoma )?(di |dell'|della |del )?/i, '').replace(/^Citt[aà] metropolitana di /i, '');
          var chiave = x.name + '|' + sig; if(visti[chiave]) return null; visti[chiave] = 1;
          return { n:x.name, lat:Math.round(x.latitude * 1e5) / 1e5, lon:Math.round(x.longitude * 1e5) / 1e5,
                   pr:'frazione · ' + sig.slice(0, 16), reg:k, pop:x.population || 0 };
        }).filter(Boolean)
          .sort(function(x, y){ return (qui.indexOf(x.reg) < 0) - (qui.indexOf(y.reg) < 0) || y.pop - x.pop; })
          .slice(0, 7);
      });
  }
  function vai(p){ if(!p) return; ga('adesso_cerca', { regione:D.k, posto:p.n }); location.href = linkPrev(p); }
  inp.addEventListener('focus', scarica);
  inp.addEventListener('input', function(){ scarica().then(cerca); });
  inp.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); vai(trovati[su]); }
    else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); if(!trovati.length) return;
      su = (su + (e.key === 'ArrowDown' ? 1 : trovati.length - 1)) % trovati.length;
      [].forEach.call(lista.children, function(li, i){ li.classList.toggle('su', i === su); }); }
  });
  lista.addEventListener('mousedown', function(e){ var li = e.target.closest('li[data-i]'); if(li){ e.preventDefault(); vai(trovati[+li.dataset.i]); } });
  el('pv-vai').addEventListener('click', function(){ if(trovati.length) vai(trovati[su]); else { scarica().then(cerca); inp.focus(); } });
  inp.addEventListener('blur', function(){ setTimeout(function(){ lista.className = 'pv-lista'; }, 150); });
})();
