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
  /* ⚠️ LA FOTO DELLA MAPPA, NON PIU' LA CARTINA (2/11/2026, scheda 111 ter; regola sua: le cartine delle pagine hanno la
     stessa faccia della mappa). La foto NOSTRA che la mappa mette sotto la pioggia e il radar (window._fotoNostra in
     index.html): Blue Marble e ESA WorldCover fino allo zoom 10, e il «+» si ferma li' (suo, 2/11: oltre era la foto
     del 10 ingrandita, sfocata; niente Esri, il suo tetto di tessere al mese lo usano gia' meteo e boschi; prima, con la
     cartina, si arrivava al 12). Indirizzo, limiti e crediti li scrive il generatore leggendoli da
     index.html (D.foto); la luce sta nello stile della pagina. Sopra: radar, confine BIANCO e i nomi nostri, come la
     mappa col radar acceso. Tre tentativi per tessera (jsDelivr alla prima richiesta di un file a volte risponde 403);
     al terzo errore senza nessuna tessera arrivata la foto si spegne e torna la cartina OSM di prima, confine blu. */
  var F = D.foto, fotoSi = !!F;
  m.createPane('foto');    m.getPane('foto').style.zIndex = 205;    m.getPane('foto').style.pointerEvents = 'none';
  m.createPane('radar');   m.getPane('radar').style.zIndex = 450;   m.getPane('radar').style.pointerEvents = 'none';
  m.createPane('confine'); m.getPane('confine').style.zIndex = 460; m.getPane('confine').style.pointerEvents = 'none';
  m.createPane('nomi');    m.getPane('nomi').style.zIndex = 470;    m.getPane('nomi').style.pointerEvents = 'none';
  function cartina(){ L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:12, className:'fondo', attribution:'© OpenStreetMap' }).addTo(m); }
  // il bianco della regione scelta nella mappa sulla foto: peso 2,2 di regionStyle, opacita' .9 della regola foto-on
  var BIANCO = { color:'#fff', weight:2.2, fill:false, opacity:.9 }, BLU = { color:'#1b3f6e', weight:2.6, fill:false, opacity:.95 };
  if(fotoSi){
    // inline-block: i crediti vanno a capo prima di «Foto:», non dentro (come la mappa). ⚠️ Niente classe «fondo»: il
    // «plus-lighter» di leaflet.css che li' si toglie, sulla foto chiude il filo del fondo scuro fra due tessere
    m.setMaxZoom(10);
    var foto = L.tileLayer(F.u, { pane:'foto', minNativeZoom:4, maxNativeZoom:10, maxZoom:10, bounds:F.lim, crossOrigin:true,
      attribution:'<span style="display:inline-block;max-width:100%">' + F.cr + '</span>' });
    var arrivate = 0, rotte = 0;
    foto.on('tileload', function(){ arrivate++; });
    foto.on('tileerror', function(e){
      if(!fotoSi) return;
      if(++rotte >= 3 && !arrivate){ fotoSi = false;
        setTimeout(function(){ m.removeLayer(foto); cartina(); m.setMaxZoom(12); el('mappa').classList.add('osm'); lay.setStyle(BLU); nomi(); }, 0); return; }
      var im = e.tile; if(!im) return; im._riprova = (im._riprova || 0) + 1; if(im._riprova > 3) return;
      // solo se la tessera e' ancora in mappa: quelle tolte dallo zoom non si richiedono
      setTimeout(function(){ var s = im.src; if(!s || !foto._map || !im.parentNode) return; im.src = ''; im.src = s; }, [2000, 5000, 12000][im._riprova - 1]);
    });
    foto.addTo(m);
  } else { cartina(); el('mappa').classList.add('osm'); }
  var lay = L.geoJSON(D.confine, { pane:'confine', style:fotoSi ? BIANCO : BLU }).addTo(m);
  // si inquadra il pezzo PIU' GRANDE della regione: con le isole lontane (Pantelleria, Lampedusa) la Sicilia
  // diventava piccola in mezzo al mare. Le isole vicine restano in vista.
  var grande = null, area = -1;
  lay.eachLayer(function(l){
    var anelli = l.getLatLngs(); if(!Array.isArray(anelli[0][0])) anelli = [anelli];
    anelli.forEach(function(p){ var b = L.latLngBounds(p[0]), a = (b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());
      if(a > area){ area = a; grande = b; } });
  });
  /* ⚠️ IL RADAR SU TUTTA ITALIA E UN PEZZO D'EUROPA, per tutte le regioni (28/10/2026, suo: «la pagina adesso farei il
     radar con l'europa, per tutte le regioni indipendentemente»; come l'anteprima delle pagine meteo, dove sulla sola
     regione era quasi sempre una cartina vuota): si vede la pioggia che arriva, e il confine dice dov'e' la regione.
     L'inquadratura comprende sempre la regione intera (la Sicilia scende sotto i 37,2°). */
  m.fitBounds(L.latLngBounds([[37.2, 6.5], [50.2, 18.5]]).extend(grande || lay.getBounds()), { padding:[10,10] });
  // ⚠️ NON SI RIMPICCIOLISCE FINO AL MONDO (2/11/2026, scheda 110 bis, come le pagine meteo della 109): senza minimo la
  // cartina arrivava allo zoom 0, il planisfero. L'inquadratura e' gia' l'Italia (4,75 al telefono, 5 al PC), quindi
  // non il «mai sotto il 6» delle meteo, che la ingrandirebbe: si scende di un tocco del «−», l'Europa del radar, e basta.
  m.setMinZoom(m.getZoom() - 1);
  /* e da lontano niente rettangolo (2/11/2026, scheda 111 ter, come «DA LONTANO NIENTE RETTANGOLO» della mappa): la foto
     copre l'Europa fino al 34° parallelo, e a quel tocco del «−» il suo bordo sud entrava nella cartina (una striscia
     blu al posto dell'Africa, 66 px al telefono e 88 al PC). Lo zoom minimo non scende sotto quello in cui la foto
     riempie la cartina, e la cartina resta dentro la foto (maxBounds: all'apertura non sposta niente). ⚠️ Al minimo
     maxBounds sposta il centro verso nord (quasi 5° al telefono) e il «+» di Leaflet ingrandiva li', sulla Germania:
     sotto l'inquadratura il «+» torna al centro di partenza, come prima (110 bis), se la cartina non l'ha trascinata
     la persona (al PC si puo') */
  if(fotoSi){
    var Z0 = m.getZoom(), C0 = m.getCenter(), trascinata = false;
    m.setMinZoom(Math.max(m.getMinZoom(), m.getBoundsZoom(F.lim, true))); m.setMaxBounds(F.lim);
    m.on('dragstart', function(){ trascinata = true; });
    m.zoomIn = function(d, o){
      var z = this.getZoom();
      if(!trascinata && z < Z0 - 0.01) return this.setView(C0, Math.min(Z0, z + (d || this.options.zoomDelta)), o);
      return L.Map.prototype.zoomIn.call(this, d, o);
    };
  }

  /* ── I NOMI SOPRA LA FOTO (2/11/2026, scheda 111 ter): la foto non ha scritte. Come i «NOMI NOSTRI» della mappa
     (index.html): bianchi con l'ombra, sopra il punto, a 12 px (la mappa fino allo zoom 11), e una scritta che
     urterebbe una gia' messa si salta, con lo stesso respiro intorno. Prima le citta' della regione, poi i capoluoghi
     d'Italia e le grandi citta' estere (D.nomi, dal generatore). Con la cartina di ripiego niente: ha gia' i suoi. ── */
  // ⚠️ POSTI, non NOMI: NOMI piu' sotto sono i nomi del tempo («Sereno»), e la stessa var li' la sovrascriveva
  var POSTI = D.citta.concat(D.nomi || []), scritte = L.layerGroup().addTo(m), misura = null;
  function larghezza(t, px){
    if(!misura) misura = document.createElement('canvas').getContext('2d');
    misura.font = '600 ' + px + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    return misura.measureText(t).width;
  }
  function nomi(){
    scritte.clearLayers(); if(!fotoSi) return;
    var px = 12, sz = m.getSize(), occupato = [];
    POSTI.forEach(function(p){
      // la cartina e' piccola: un nome che uscirebbe dal bordo («Skop», «Patra») o finirebbe sotto i crediti si salta,
      // la mappa a schermo pieno no
      var pt = m.latLngToContainerPoint([p.lat, p.lon]), tw = larghezza(p.n, px);
      if(pt.x - tw / 2 < 3 || pt.x + tw / 2 > sz.x - 3 || pt.y - px - 8 < 0 || pt.y > sz.y - 14) return;
      var w = tw + 44, h = px + 20;
      var box = { x1:pt.x - w / 2, y1:pt.y - h - 5, x2:pt.x + w / 2, y2:pt.y - 5 };
      for(var k = 0; k < occupato.length; k++){ var o = occupato[k]; if(box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1) return; }
      occupato.push(box);
      L.marker([p.lat, p.lon], { pane:'nomi', interactive:false, keyboard:false, icon:L.divIcon({ className:'nome-paese', iconSize:[0, 0], iconAnchor:[0, 0],
        html:'<span style="font-size:' + px + 'px">' + escN(p.n) + '</span>' }) }).addTo(scritte);
    });
  }
  m.on('moveend', nomi); nomi();

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

  /* ── LA RIGA VIVA: SE E COME STA PIOVENDO ADESSO (30/10/2026, suo: «il commento in alto dovrebbe dire qualcosa che dice
     se e come sta piovendo»). La scrive il radar stesso: le stesse tessere LibreWXR del riquadro, ma con lo SCHEMA 0, dove
     ogni pixel e' grigio e vale dBZ + 32 (provato il 30/10/2026 contro lo schema 2 del riquadro: 42 = 10 dBZ, il minimo, e
     lo schema 2 cambia colore ogni 5 dBZ). Da dBZ a mm/h con Marshall-Palmer (Z = 200·R^1,6), soglie delle previsioni
     della pagina: sotto 0,3 mm/h niente (10-14 dBZ: rumore, o pioviggine che spesso non arriva a terra), debole fino a 2,
     moderata fino a 6, forte, molto forte da 24 (temporali). Si guarda: nel punto di ogni citta' (3×3 pixel, ~5 km),
     su tutta la regione (quanta parte ne bagna), e se in regione non piove la pioggia piu' vicina a una citta' e da che
     parte; poi i fotogrammi dei prossimi 40 minuti, per le citta' ancora asciutte. Zoom 6 (~2 km a pixel, come il
     radar). Si rifa' ogni 5 minuti, anche se il riquadro sta mostrando le ultime 2 ore. ── */
  var Z6 = 6, MONDO = 256 * Math.pow(2, Z6);
  function inPx(lat, lon){ var s = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * MONDO, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * MONDO }; }
  function daPx(x, y){ var n = Math.PI * (1 - 2 * y / MONDO); return { lat: Math.atan((Math.exp(n) - Math.exp(-n)) / 2) * 180 / Math.PI, lon: x / MONDO * 360 - 180 }; }
  function mmOra(v){ return v < 42 ? 0 : Math.pow(Math.pow(10, (v - 32) / 10) / 200, 1 / 1.6); }   // v = grigio dello schema 0
  function classe(r){ return r < 0.3 ? 0 : r < 2 ? 1 : r < 6 ? 2 : r < 24 ? 3 : 4; }
  var CLASSI = ['', 'debole', 'moderata', 'forte', 'molto forte'];
  function km(a, b){ var r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371; }
  function verso(a, b){ var x = (b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), y = b.lat - a.lat;
    return ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'][Math.round(((Math.atan2(x, y) * 180 / Math.PI + 360) % 360) / 45) % 8]; }
  function elenco(l){ return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]; }
  // «a Fermo», «ad Ancona»: la preposizione davanti al primo nome (che puo' essere gia' dentro un <b>)
  function aD(t){ return /^(<b>)?[Aa]/.test(t) ? 'ad ' + t : 'a ' + t; }
  function immagine(u){ return new Promise(function(ok, ko){ var i = new Image(); i.crossOrigin = 'anonymous'; i.onload = function(){ ok(i); }; i.onerror = ko; i.src = u; }); }
  // il mosaico delle tessere che coprono la finestra [x0..x1]×[y0..y1] (pixel del mondo a zoom 6), in una tela sola
  function mosaico(host, fpath, x0, y0, x1, y1){
    var tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor(x1 / 256), ty1 = Math.floor(y1 / 256), lista = [];
    for(var tx = tx0; tx <= tx1; tx++) for(var ty = ty0; ty <= ty1; ty++) lista.push([tx, ty]);
    return Promise.all(lista.map(function(t){ return immagine(host + fpath + '/256/' + Z6 + '/' + t[0] + '/' + t[1] + '/0/0_0.png'); })).then(function(imm){
      var c = document.createElement('canvas'); c.width = (tx1 - tx0 + 1) * 256; c.height = (ty1 - ty0 + 1) * 256;
      var g = c.getContext('2d'); imm.forEach(function(im, k){ g.drawImage(im, (lista[k][0] - tx0) * 256, (lista[k][1] - ty0) * 256); });
      return { ox: tx0 * 256, oy: ty0 * 256, w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    });
  }
  function vDi(M, x, y){ x = Math.floor(x - M.ox); y = Math.floor(y - M.oy); if(x < 0 || y < 0 || x >= M.w || y >= M.h) return 0; var k = (y * M.w + x) * 4; return M.d[k + 3] ? M.d[k] : 0; }
  // la pioggia nel punto di una citta': il pixel piu' forte nei 3×3 intorno
  function nellaCitta(M, c){ var p = inPx(c.lat, c.lon), v = 0; for(var dx = -1; dx <= 1; dx++) for(var dy = -1; dy <= 1; dy++) v = Math.max(v, vDi(M, p.x + dx, p.y + dy)); return mmOra(v); }
  // la regione disegnata sulla tela del mosaico: un pixel e' della regione se la maschera li' e' piena
  function maschera(M){
    var c = document.createElement('canvas'); c.width = M.w; c.height = M.h; var g = c.getContext('2d'); g.beginPath();
    (D.confine.geometry.coordinates || []).forEach(function(pol){ pol.forEach(function(an){ an.forEach(function(q, i){ var p = inPx(q[1], q[0]);
      if(i) g.lineTo(p.x - M.ox, p.y - M.oy); else g.moveTo(p.x - M.ox, p.y - M.oy); }); g.closePath(); }); });
    g.fill('evenodd'); return g.getImageData(0, 0, M.w, M.h).data;
  }
  var bordi = lay.getBounds(), RAGGIO = 1.5;   // la finestra: la regione e 1,5° intorno (~150 km), per la pioggia piu' vicina
  function rigaViva(){
    var box = el('ad-t'); if(!box) return;
    fetch(RADAR).then(function(r){ return r.ok ? r.json() : Promise.reject(); }).then(function(j){
      var f = (j.radar && j.radar.past || []).slice(-1)[0]; if(!f) throw 0;
      var a = inPx(bordi.getNorth() + RAGGIO, bordi.getWest() - RAGGIO), b = inPx(bordi.getSouth() - RAGGIO, bordi.getEast() + RAGGIO);
      var dopo = (j.radar.nowcast || []);
      return Promise.all([mosaico(j.host, f.path, a.x, a.y, b.x, b.y)].concat(dopo.map(function(n){
        // i prossimi 40 minuti: basta il pezzo con le citta'
        var xs = D.citta.map(function(c){ return inPx(c.lat, c.lon); });
        return mosaico(j.host, n.path, Math.min.apply(null, xs.map(function(p){ return p.x; })) - 2, Math.min.apply(null, xs.map(function(p){ return p.y; })) - 2,
          Math.max.apply(null, xs.map(function(p){ return p.x; })) + 2, Math.max.apply(null, xs.map(function(p){ return p.y; })) + 2).then(function(M){ M.t = n.time; return M; }, function(){ return null; });
      }))).then(function(tutti){ scriviRiga(f.time, tutti[0], tutti.slice(1).filter(Boolean), a, b); });
    }).catch(function(){ box.textContent = 'Il radar non risponde in questo momento: riprova fra qualche minuto.'; el('ad-q').textContent = 'Adesso'; });
  }
  // a e b: gli angoli della finestra (regione e 150 km intorno) in pixel del mondo; il mosaico e' a tessere intere, piu' largo
  function scriviRiga(quando, M, dopo, a, b){
    // per classe: quanti pixel della regione e il loro baricentro (per dire «vicino a» quale citta')
    var mk = maschera(M), tot = 0, bagnati = 0, per = [null, {}, {}, {}, {}], vicina = null;
    for(var c0 = 1; c0 <= 4; c0++) per[c0] = { n: 0, lat: 0, lon: 0 };
    var xa = Math.max(0, Math.floor(a.x - M.ox)), xb = Math.min(M.w - 1, Math.ceil(b.x - M.ox)), ya = Math.max(0, Math.floor(a.y - M.oy)), yb = Math.min(M.h - 1, Math.ceil(b.y - M.oy));
    for(var y = ya; y <= yb; y++) for(var x = xa; x <= xb; x++){
      var k = (y * M.w + x) * 4, cl = M.d[k + 3] ? classe(mmOra(M.d[k])) : 0, dentro = mk[k + 3] > 0;
      if(dentro) tot++;
      if(!cl) continue;
      var p = daPx(x + M.ox, y + M.oy);
      if(dentro){ bagnati++; per[cl].n++; per[cl].lat += p.lat; per[cl].lon += p.lon; }
      else D.citta.forEach(function(c){ var d = km(c, p); if(!vicina || d < vicina.d) vicina = { d: d, c: c, p: p }; });
    }
    // la pioggia piu' forte che conta: almeno 4 pixel (~15 km²) di quella classe, un pixel solo puo' essere un'eco spuria
    var forte = 0; for(var c1 = 4; c1 >= 1 && !forte; c1--) if(per[c1].n >= 4 || (c1 === 1 && per[1].n)) forte = c1;
    if(vicina && vicina.d > 150) vicina = null;   // oltre la finestra la risposta e' «nel raggio di 150 km non piove»
    var citta = D.citta.map(function(c){ return { n: c.n, c: c, k: classe(nellaCitta(M, c)) }; });
    var piove = citta.filter(function(x){ return x.k; }), asciutte = citta.filter(function(x){ return !x.k; });
    /* Le frasi in stile bollettino (30/10/2026, suo: «metti delle frasi più eleganti», la brutta era «Non piove in Veneto,
       e nemmeno nei 150 km intorno»): «Pioggia moderata su Bari, debole su Taranto. Nelle altre sei città è asciutto. Le
       precipitazioni interessano l'11% circa della Puglia.» · «Le città sono all'asciutto, ma piove debolmente nella zona di
       Salerno.» · «Tempo asciutto in Toscana. La pioggia più vicina è a est di Arezzo, a circa 75 km.» · «Tempo asciutto
       in Veneto e in tutte le zone vicine.» · «Entro le 12:00 la pioggia potrebbe raggiungere anche Gubbio.» */
    var NUM = ['', 'una', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'];
    function quante(n){ return NUM[n] || String(n); }
    var COME = ['', 'piove debolmente', 'piove', 'piove forte', 'piove a dirotto'];
    var t = [];
    if(piove.length){
      // per forza della pioggia, dalla piu' forte: «Pioggia moderata su Lucca e Pistoia, debole su Massa.»
      var pezzi = [];
      for(var cl = 4; cl >= 1; cl--){ var qui = piove.filter(function(x){ return x.k === cl; }).map(function(x){ return '<b>' + escN(x.n) + '</b>'; });
        if(qui.length) pezzi.push((pezzi.length ? '' : 'Pioggia ') + CLASSI[cl] + ' su ' + elenco(qui)); }
      t.push(pezzi.join(', ') + '.');
      t.push(!asciutte.length ? 'Piove in tutte le città.' : asciutte.length <= 4 ? 'È asciutto ' + aD(elenco(asciutte.map(function(x){ return escN(x.n); }))) + '.'
        : 'Nelle altre ' + quante(asciutte.length) + ' città è asciutto.');
    } else if(forte){
      var cen = { lat: per[forte].lat / per[forte].n, lon: per[forte].lon / per[forte].n };
      var dove = D.citta.slice().sort(function(u, v){ return km(u, cen) - km(v, cen); })[0];
      t.push('Le città sono all\'asciutto, ma ' + COME[forte] + ' nella zona di <b>' + escN(dove.n) + '</b>.');
    } else {
      t.push('<b>Tempo asciutto ' + escN(D.dove) + '</b>' + (vicina ? '. La pioggia più vicina è a ' + verso(vicina.c, vicina.p) + ' di ' + escN(vicina.c.n)
        + ', a circa ' + Math.max(5, Math.round(vicina.d / 5) * 5) + ' km.' : ' e in tutte le zone vicine.'));
    }
    // «l'11%», «l'8%», «il 15%»; solo se una frase qui sopra ha detto che piove (qualche pixel isolato non conta)
    if(bagnati && tot && (piove.length || forte)){ var q = Math.round(bagnati / tot * 100);
      t.push('Le precipitazioni interessano ' + (bagnati / tot < 0.01 ? "meno dell'1%" : (/^(8|11$|1$)/.test(String(q)) ? "l'" : 'il ') + q + '% circa') + ' ' + escN(D.gen) + '.'); }
    // i prossimi 40 minuti: le citta' ancora asciutte dove arriva, e quando (il primo fotogramma che la vede)
    var arriva = [], ultimo = null;
    asciutte.forEach(function(x){ for(var i = 0; i < dopo.length; i++) if(classe(nellaCitta(dopo[i], x.c))){ arriva.push(x.n); ultimo = Math.max(ultimo || 0, dopo[i].t); break; } });
    // oltre quattro: «Lucca, Pisa, Massa, Prato e altre due città» / «… e un'altra città» (era «e altre una città», 1/11/2026)
    var oltre = arriva.length - 4;
    if(arriva.length) t.push('Entro le ' + ora(ultimo) + ' la pioggia potrebbe raggiungere ' + (piove.length ? 'anche ' : '')
      + (oltre > 0 ? arriva.slice(0, 4).map(escN).join(', ') + (oltre === 1 ? ' e un\'altra città' : ' e altre ' + quante(oltre) + ' città') : elenco(arriva.map(escN))) + '.');
    el('ad-q').textContent = 'Adesso · radar delle ' + ora(quando);
    el('ad-t').innerHTML = t.join(' ');
    window._rigaViva = el('ad-t').textContent;   // per le prove
  }
  rigaViva();
  setInterval(rigaViva, 300000);

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
  /* ⚠️ «AGGIORNATE ALLE» A POCHI MINUTI, E LE CARTE CHE SI RINFRESCANO DA SOLE (31/10/2026, scheda 103), come la mappa
     (vedi «AGGIORNATE A POCHI MINUTI FA» e «SI AGGIORNA DA SOLA» in index.html). Prima l'ora era quella in cui MET aveva
     calcolato la previsione (`agg`, spesso un'ora o due prima). Ora e' l'ora fino a cui MET garantisce che questa e' la
     previsione in vigore (`scade` di ogni citta', vale la prima), o l'ora di adesso se viene prima; senza `scade` (cache
     di prima) l'ora di MET, come prima. Si riscrive ogni mezzo minuto; ogni 10 minuti, SOLO a pagina in vista (tornando in
     vista, subito se ne sono passati 10), si richiedono le citta' con &r= (salta la cache del browser, non quella del
     server, che chiede a MET solo i punti scaduti) e si rimettono carte, barra e ora. La barra si ridisegna solo se e'
     cambiata (non riparte da capo per niente); una citta' che al rinfresco non risponde resta com'era, se e' ancora di
     oggi. A mezzanotte si richiede tutto, e il numero grande prende di nuovo l'ora che viene. */
  function oggiRoma(){ return new Date().toLocaleDateString('sv-SE', { timeZone:'Europe/Rome' }); }
  function fmtOra(t){ return new Date(t).toLocaleTimeString('it-IT', { timeZone:'Europe/Rome', hour:'2-digit', minute:'2-digit' }); }
  var CARTE = D.citta.map(function(c, i){ return document.querySelector('.cit[data-i="' + i + '"]'); });
  CARTE.forEach(function(card, i){ if(card) card.addEventListener('click', function(){ ga('adesso_citta', { regione:D.k, posto:D.citta[i].n }); }); });
  var agg = null, val = null, OGGI = [];   // OGGI[i] = il giorno di oggi della citta' i, per la barra che scorre
  var RINFRESCO = 10 * 60 * 1000, rinfrescata = 0, giornoVisto = '';
  function scriviQuando(){
    if(!agg && !val) return;
    // da dove viene e fino a quando vale; la pioggia di ADESSO e' quella del radar
    el('pv-quando').textContent = 'Previsioni del modello ECMWF via MET Norway, aggiornate alle ' + fmtOra(val ? Math.min(Date.now(), val) : agg)
      + '. La pioggia che cade adesso la mostra il radar qui sopra.';
  }
  function chiediCitta(primo){
    var oggi = oggiRoma();
    var oraNow = +new Date().toLocaleString('en-GB', { timeZone:'Europe/Rome', hour:'2-digit', hour12:false });
    var salta = primo ? '' : '&r=' + Math.floor(Date.now() / 60000);
    var quante = CARTE.filter(Boolean).length, fatti = 0, nAgg = null, nVal = null, prima = JSON.stringify(OGGI);
    giornoVisto = oggi; rinfrescata = Date.now();
    D.citta.forEach(function(c, i){
      var card = CARTE[i]; if(!card) return;
      fetch(API + '?lat=' + c.lat.toFixed(4) + '&lon=' + c.lon.toFixed(4) + (c.q != null ? '&q=' + Math.round(c.q) : '') + '&v=12' + salta)   // come API_V della mappa (bug 12, 19/10/2026)
        .then(function(r){ return r.ok ? r.json() : Promise.reject(); }).then(function(d){
          var ore = d.ore || [], h = null;
          for(var k = 0; k < ore.length; k++){ if(ore[k].g > oggi || (ore[k].g === oggi && ore[k].h >= oraNow)){ h = ore[k]; break; } }
          // ⚠️ i giorni per DATA, non per posizione (19/10/2026, quinto check, bug 11): dopo mezzanotte una previsione
          // presa prima (cache) comincia con IERI, e «Oggi» mostrava ieri e «Domani» oggi. Si tolgono i giorni passati.
          var gg = (d.giorni || []).filter(function(x){ return x.g >= oggi; });
          h = h || ore[0]; var g0 = gg[0], g1 = gg[1];
          if(!h || !g0 || !g1 || g0.g !== oggi) throw 0;   // senza il giorno di oggi la riga «Oggi / Domani» non si scrive
          OGGI[i] = g0;
          card.querySelector('.cit-ic').textContent = icona(h.s);
          // l'ora accanto ai gradi: il numero grande e' la PREVISIONE di quell'ora, non una misura
          card.querySelector('.cit-t').innerHTML = Math.round(h.t) + '°<small>alle ' + h.h + '</small>';
          card.querySelector('.cit-cond').innerHTML = cond(h.s, h.mm) + (h.mm >= 0.1 ? ' <span class="mmw">' + mm(h.mm) + ' mm</span>' : '');
          card.querySelector('.cit-gg').innerHTML = 'Oggi <b>' + g0.mn + '°</b> / <b>' + g0.mx + '°</b>' + pg(g0.mm)
            + '<br>Domani ' + icona(g1.s) + ' <b>' + g1.mn + '°</b> / <b>' + g1.mx + '°</b>' + pg(g1.mm);
          if(d.agg && (!nAgg || d.agg > nAgg)) nAgg = d.agg;
          if(d.scade && (!nVal || d.scade < nVal)) nVal = d.scade;
        }).catch(function(){
          if(!primo && OGGI[i] && OGGI[i].g === oggi) return;   // al rinfresco la carta di oggi resta com'era
          OGGI[i] = null;
          card.querySelector('.cit-ic').textContent = ''; card.querySelector('.cit-t').innerHTML = '&nbsp;';
          card.querySelector('.cit-gg').innerHTML = '&nbsp;<br>&nbsp;';
          card.querySelector('.cit-cond').textContent = 'Previsione non disponibile'; })
        .then(function(){ if(++fatti < quante) return;
          if(nAgg || nVal){ agg = nAgg; val = nVal; }   // nessuna risposta: resta l'ora di prima
          scriviQuando();
          if(primo || JSON.stringify(OGGI) !== prima) disegnaNastro();
          window._cittaPronte = true; window._cittaGiri = (window._cittaGiri || 0) + 1; });   // _cittaGiri: per le prove
    });
  }
  chiediCitta(true);
  setInterval(function(){ if(document.visibilityState !== 'visible') return; scriviQuando();
    if(Date.now() - rinfrescata >= RINFRESCO || oggiRoma() !== giornoVisto) chiediCitta(false); }, 30000);
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible' && Date.now() - rinfrescata >= RINFRESCO) chiediCitta(false); });
  window._cittaRinfresca = function(){ chiediCitta(false); };   // per le prove

  /* ── LA BARRA CHE SCORRE sotto il radar (30/10/2026, suo: «sì, tutti e due»): le citta' delle carte qui sotto, con
     icona, minima e massima di oggi, come la vista Italia della mappa e le pagine meteo (dove sta sopra la scheda ora
     per ora). Si scrive quando sono arrivate tutte le citta' (le stesse richieste delle carte, niente in piu'). ⚠️ E' LO
     STESSO CODICE di clientePagina in .github/scripts/genera-pagine-meteo-zona.js (naGira, taglia, le copie, la presa):
     se cambia li', si cambia anche qui. Scorre a 45 px/s, si trascina col dito o col mouse con lo slancio, un tocco
     sotto i 6 px apre la citta' sulla mappa come la sua carta; ferma col mouse sopra, fuori dallo schermo e con «riduci
     movimento». ── */
  var NA = { pos:0, w:0, t0:0, v:0, presa:null, sopra:false, giro:0, vista:true, largo:0 };
  var FERMO = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function escN(t){ return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function naGira(t){
    var na = el('nastro'), tr = na && na.querySelector('.t');
    if(!tr || na.hidden || !NA.vista){ NA.giro = 0; NA.t0 = 0; return; }
    var dt = NA.t0 ? Math.min(64, t - NA.t0) : 16; NA.t0 = t;
    if(!NA.presa){
      if(Math.abs(NA.v) > 0.05){ NA.pos += NA.v * dt; NA.v *= Math.pow(0.94, dt / 16); }   // lo slancio, in px al millisecondo
      else { NA.v = 0; if(!NA.sopra && !FERMO) NA.pos -= 0.045 * dt; } }
    if(NA.w > 0){ NA.pos %= NA.w; if(NA.pos > 0) NA.pos -= NA.w; }
    tr.style.transform = 'translate3d(' + NA.pos.toFixed(1) + 'px,0,0)';
    if(FERMO && !NA.presa && !NA.v){ NA.giro = 0; NA.t0 = 0; return; }
    NA.giro = requestAnimationFrame(naGira);
  }
  function naParti(){ if(!NA.giro && NA.vista){ NA.t0 = 0; NA.giro = requestAnimationFrame(naGira); } }
  // un nome che non ci sta (al telefono piu' di due righe, al computer piu' di meta' barra) lascia solo METEO e OGGI
  function taglia(){
    var na = el('nastro'), lab = na && na.querySelector('.lab'); if(!lab) return;
    lab.classList.remove('corto');
    var alto = lab.querySelector('b').offsetHeight + lab.querySelector('span').offsetHeight;
    if(alto > lab.clientHeight || lab.offsetWidth > na.clientWidth * 0.45) lab.classList.add('corto');
  }
  function disegnaNastro(){
    var na = el('nastro'); if(!na) return;
    var vv = D.citta.map(function(c, i){ var g = OGGI[i]; if(!g) return '';
      return '<button class="v" data-i="' + i + '"><b>' + escN(c.n) + '</b><span class="ic">' + icona(g.s) + '</span><span class="mn">' + g.mn + '°</span><span class="mx">' + g.mx + '°</span></button>'; }).join('');
    if(!vv){ na.hidden = true; return; }   // nessuna citta' arrivata: niente barra vuota
    taglia();
    var tr = na.querySelector('.t'), P = na.querySelector('.lab').offsetWidth, una, copie = 2;
    tr.innerHTML = vv;
    // il primo parte DOPO il blocco rosso, non sotto; il contenuto si ripete quanto serve e il giro e' di una copia
    tr.style.paddingLeft = P + 'px';
    una = tr.scrollWidth - P;
    while(una > 0 && P + una * copie < na.clientWidth + una && copie < 12) copie++;
    tr.innerHTML = new Array(copie + 1).join(vv);
    NA.w = una; NA.pos = 0; NA.v = 0; NA.largo = innerWidth; naParti();
  }
  (function(){
    var na = el('nastro'); if(!na) return;
    function apriDa(b){ var c = b && D.citta[+b.getAttribute('data-i')]; if(!c) return;
      ga('adesso_barra', { regione:D.k, posto:c.n });
      location.href = SITO + '/previsioni/?r=' + c.reg + '&pl=' + c.lat + ',' + c.lon + '&pn=' + encodeURIComponent(c.n); }
    na.addEventListener('pointerdown', function(ev){ if(ev.button > 0) return; NA.v = 0; NA.presa = { x:ev.clientX, pos:NA.pos, mosso:false, ux:ev.clientX, ut:ev.timeStamp }; naParti(); });
    na.addEventListener('pointermove', function(ev){ var p = NA.presa; if(!p) return;
      if(!p.mosso && Math.abs(ev.clientX - p.x) > 6){ p.mosso = true; try{ na.setPointerCapture(ev.pointerId); }catch(e){} }
      if(!p.mosso) return;
      NA.pos = p.pos + (ev.clientX - p.x);
      var dt = ev.timeStamp - p.ut; if(dt > 0){ NA.v = (ev.clientX - p.ux) / dt; p.ux = ev.clientX; p.ut = ev.timeStamp; } });
    na.addEventListener('pointerup', function(ev){ var p = NA.presa; NA.presa = null; if(!p) return;
      if(!p.mosso){ NA.v = 0; var b = document.elementFromPoint(ev.clientX, ev.clientY); apriDa(b && b.closest ? b.closest('#nastro .v') : null); return; }
      if(ev.timeStamp - p.ut > 90) NA.v = 0;   // fermata prima di lasciarla: niente slancio
      NA.v = Math.max(-3, Math.min(3, NA.v)); naParti(); });
    // col dito in su o in giu' il browser scorre la pagina e la presa si annulla
    na.addEventListener('pointercancel', function(){ NA.presa = null; });
    na.addEventListener('pointerenter', function(ev){ if(ev.pointerType === 'mouse') NA.sopra = true; });
    na.addEventListener('pointerleave', function(ev){ if(ev.pointerType === 'mouse') NA.sopra = false; });
    // da tastiera il clic arriva senza puntatore (detail 0); quelli del puntatore li ha gia' visti pointerup
    na.addEventListener('click', function(e){ if(e.detail === 0) apriDa(e.target.closest('.v')); });
    if('IntersectionObserver' in window) new IntersectionObserver(function(e){ NA.vista = e[e.length - 1].isIntersecting; if(NA.vista) naParti(); }).observe(na);
    // si rifa' solo se cambia la LARGHEZZA: al telefono la barra degli indirizzi che sparisce e' un resize
    var rt = 0; addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ if(innerWidth !== NA.largo){ taglia(); disegnaNastro(); } }, 200); });
    taglia();
  })();

  // ── la casella: gli 8.610 paesi del cartello blu, si scaricano solo quando servono ──
  var paesi = null, inp = el('pv-in'), lista = el('pv-lista'), trovati = [], su = 0;
  var qui = [D.k];
  function norma(s){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  // ⚠️ (19/10/2026, quinto check, bug 18) un elenco fallito si dimentica: prima la promessa respinta
  // restava in `paesi` e la casella moriva fino a ricaricare la pagina.
  function scarica(){
    if(!paesi) paesi = fetch('/data/elenco-paesi.txt').then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); }).then(function(t){
      var a = [];
      t.split('\n').forEach(function(r){ var c = r.split('|'); if(c.length < 6) return;
        a.push({ n:c[0], lat:+c[1], lon:+c[2], pr:c[3], reg:c[4], pop:+c[5], k:norma(c[0]) }); });
      return a; }).catch(function(e){ paesi = null; throw e; });
    return paesi;
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function linkPrev(p){ return SITO + '/previsioni/?r=' + p.reg + '&pl=' + p.lat + ',' + p.lon + '&pn=' + encodeURIComponent(p.n); }
  function cerca(tutti){
    var q = norma(inp.value);
    // sotto 2 lettere si ferma anche la domanda sulle frazioni ancora in volo, se no riapriva la lista vecchia
    if(q.length < 2){ ++giri; clearTimeout(attesaGeo); lista.className = 'pv-lista'; trovati = []; return; }
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
    lista.innerHTML = trovati.length ? trovati.map(function(p, i){ return '<li data-i="' + i + '"' + (i === su ? ' class="su"' : '') + '>' + esc(p.n) + '<small>' + esc(p.pr) + '</small></li>'; }).join('')
      : '<li class="vuoto">Nessun posto con questo nome</li>';
    lista.className = 'pv-lista aperta';
  }
  /* ⚠️ LE FRAZIONI (18/10/2026): l'elenco ha solo gli 8.610 comuni, e «Viozene» o «Prato Nevoso» davano
     «Nessun paese». Come la casella della mappa (locDaGeocoder in index.html), se l'elenco non trova niente
     si chiede al geocoder (/api/cerca), solo in Italia. ⚠️ La tabella delle regioni e' una COPIA di
     GEO_REGIONI di index.html (questa pagina non vede il codice della mappa): se cambia una, cambia l'altra.
     `giri` tiene solo l'ultima ricerca: una risposta lenta non scrive sopra una piu' nuova. */
  var giri = 0;
  var GEO_REGIONI = { 'Piemonte':'piemonte', "Valle d'Aosta":'valledaosta', 'Lombardia':'lombardia', 'Veneto':'veneto',
    'Friuli Venezia Giulia':'friuli', 'Liguria':'liguria', 'Emilia-Romagna':'emilia', 'Toscana':'toscana', 'Umbria':'umbria',
    'Marche':'marche', 'Lazio':'lazio', 'Abruzzo':'abruzzo', 'Molise':'molise', 'Campania':'campania', 'Puglia':'puglia',
    'Basilicata':'basilicata', 'Calabria':'calabria', 'Sicilia':'sicilia', 'Sardegna':'sardegna' };
  function frazioni(testo){
    // dal 25/10/2026 /api/cerca (GeoNames servito dal sito) al posto del geocoder di prima; in locale quella di wrangler
    return fetch((LOCALE && location.port !== '8788' ? 'http://127.0.0.1:8788' : '') + '/api/cerca?name=' + encodeURIComponent(testo) + '&count=10&language=it&countryCode=IT')
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
  function cercaOra(){
    scarica().then(cerca, function(){
      lista.innerHTML = '<li class="vuoto">Elenco dei paesi non raggiungibile, riprova tra poco</li>'; lista.className = 'pv-lista aperta'; });
  }
  inp.addEventListener('focus', function(){ scarica().catch(function(){}); });
  inp.addEventListener('input', cercaOra);
  inp.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); vai(trovati[su]); }
    else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); if(!trovati.length) return;
      su = (su + (e.key === 'ArrowDown' ? 1 : trovati.length - 1)) % trovati.length;
      [].forEach.call(lista.children, function(li, i){ li.classList.toggle('su', i === su); }); }
  });
  lista.addEventListener('mousedown', function(e){ var li = e.target.closest('li[data-i]'); if(li){ e.preventDefault(); vai(trovati[+li.dataset.i]); } });
  el('pv-vai').addEventListener('click', function(){ if(trovati.length) vai(trovati[su]); else { cercaOra(); inp.focus(); } });
  inp.addEventListener('blur', function(){ setTimeout(function(){ lista.className = 'pv-lista'; }, 150); });
})();
