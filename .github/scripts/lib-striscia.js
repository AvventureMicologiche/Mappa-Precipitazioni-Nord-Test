/* ── LA MAPPA NELLA SCHEDA IN CIMA (20/10/2026, scheda 89, variante A approvata sul mockup) ──
   Suo dubbio: «una delle cose più attraenti che abbiamo sono le mappe e vengono mostrate dopo la metà della
   pagina». Nella scheda scura in cima, SOTTO la risposta (regola 19/10: sopra «Poca pioggia, 38 mm» niente),
   il bottone «Vedi sulla mappa» diventa due riquadri: 💧 Pioggia (20 giorni) e 🌲 Boschi, ognuno apre la sua
   mappa. Al telefono la scheda cresce di ~75 px.
   LE IMMAGINI SONO UNA PER REGIONE, ritagliate qui nel browser (sua scelta: «usa il ritaglio dell'anteprima di
   regione»): <reg>-mappa.webp + <reg>-mappa.json, scritti da genera-anteprime.js. Pioggia sul ramo `anteprime`
   (si rifà ogni giorno), boschi in tessere-boschi/anteprime/ (fissi). Il JSON dice zoom e pixel mondo
   dell'angolo in alto a sinistra: col punto della pagina (proiezione di Leaflet, EPSG:3857) si sa dove cade.
   - punto (pagine paese): centrato sul pluviometro, ~0,2 km per pixel CSS, col segnaposto;
   - zona: centrato sul centro della zona, ~0,3 km per pixel;
   - regione: la regione intera riempie la larghezza.
   Se un'immagine non arriva il riquadro resta blu scuro con la sua scritta: si clicca lo stesso.
   ⚠️ GIRA NEL BROWSER (copiata con toString): solo ES5. Si aggancia da sola al bottone della scheda quando la
   pagina lo disegna (MutationObserver su #verdetto), cosi' le tre famiglie non cambiano il loro codice. */

const STRISCIA_CSS = `
/* ── la mappa nella scheda in cima (lib-striscia.js, 20/10/2026) ── */
.mk-str{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:16px 0 2px;}
.mk-str a{position:relative;display:block;height:122px;border-radius:11px;overflow:hidden;background:#1d3d63 no-repeat;
  box-shadow:0 0 0 1px rgba(255,255,255,.28);text-decoration:none;}
.mk-str a span{position:absolute;left:7px;bottom:7px;background:rgba(9,28,52,.86);color:#fff;font:700 13.5px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  padding:6px 8px;border-radius:8px;}
.mk-str a span b{display:block;font-weight:800;white-space:nowrap;}
.mk-str a span small{display:block;font-weight:500;font-size:12px;opacity:.88;margin-top:1px;white-space:nowrap;}
.mk-str a.mk-uno{grid-column:1 / -1;}
.mk-str i.mk-pin{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#e12b2b;border:2px solid #fff;
  box-shadow:0 1px 4px rgba(0,0,0,.45);}
@media(min-width:700px){.mk-str a{height:150px;}}
/* al telefono il riquadro e' largo ~146 px a 360: scritte un filo piu' piccole, e a capo piuttosto che fuori */
@media(max-width:420px){.mk-str a span{left:6px;bottom:6px;right:6px;padding:5px 6px;font-size:12.5px;}
  .mk-str a span b,.mk-str a span small{white-space:normal;} .mk-str a span small{font-size:11px;}}
@media(max-width:370px){.mk-str a span{font-size:12px;padding:5px;} .mk-str a span small{font-size:10.5px;}}
/* pagine piogge: un riquadro solo, piu' alto; nel modo «bottone» la scritta e' quella grande del bottone di ieri */
.mk-str.mk-ieri a{height:140px;} @media(min-width:700px){.mk-str.mk-ieri a{height:185px;}}
.mk-str.mk-grande a span{left:10px;bottom:10px;right:auto;padding:9px 13px;border-radius:10px;}
.mk-str.mk-grande a span b{font-size:19px;} .mk-str.mk-grande a span small{font-size:14px;}
@media(max-width:420px){.mk-str.mk-grande a span b{font-size:17px;white-space:nowrap;} .mk-str.mk-grande a span small{font-size:13px;white-space:nowrap;}}
/* il bottone sulla mappa colorato (20/10/2026, suo: «il bottone magari rosso o giallo?»): giallo del quiz, rosso di YouTube */
.mk-str.mk-giallo a span{background:linear-gradient(180deg,rgba(249,201,62,.85),rgba(237,164,12,.85));color:#3d1f04;box-shadow:0 3px 0 rgba(160,106,8,.85),0 6px 14px rgba(0,0,0,.3);}   /* all'85% (suo: «giallo ma semitrasparente?»): la mappa si intravede, resta un bottone */
.mk-str.mk-rosso a span{background:linear-gradient(180deg,#ec3b33,#c9221b);color:#fff;box-shadow:0 3px 0 #8f1410,0 6px 14px rgba(0,0,0,.35);}
.mk-str.mk-giallo a span small,.mk-str.mk-rosso a span small{opacity:.92;}
`;

function strisciaMappa(OPZ) {
  // OPZ: reg, tipo ('punto' | 'zona' | 'regione'), lat, lon, ga (prefisso degli eventi), boschi (testo del riquadro)
  var LOCALE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var PIOGGIA = LOCALE ? '/_anteprime-prova/' : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime/';
  var BOSCHI = LOCALE ? '/tessere-boschi/anteprime/' : 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/tessere-boschi/anteprime/';
  var KMPX = { punto: 0.2, zona: 0.3 }[OPZ.tipo];
  var geo = {};   // tipo -> {j, url}

  function proj(lat, lon, z) {
    var s = 256 * Math.pow(2, z), sy = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sy) / (1 - sy)) / (4 * Math.PI)) * s];
  }
  function ritaglia(a, g) {
    // ⚠️ la pagina disegna la scheda mentre e' ancora nascosta (riquadri larghi 0): si riprova finche' ha una misura
    var j = g.j, tw = a.clientWidth, th = a.clientHeight;
    if (!tw || !th) { a._prove = (a._prove || 0) + 1; if (a._prove < 50) setTimeout(function () { ritaglia(a, g); }, 200); return; }
    var k, cx, cy, p;
    if (OPZ.tipo === 'regione' && j.reg) {
      var nw = proj(j.reg.n, j.reg.w, j.z), se = proj(j.reg.s, j.reg.e, j.z);
      k = tw / Math.max(1, se[0] - nw[0]);
      cx = (nw[0] + se[0]) / 2 - j.x0; cy = (nw[1] + se[1]) / 2 - j.y0;
    } else if (OPZ.lat == null) {   // regione senza confine nel JSON: il centro dell'immagine
      k = tw / j.w; cx = j.w / 2; cy = j.h / 2;
    } else {
      p = proj(OPZ.lat, OPZ.lon, j.z);
      var mpx = 40075016.686 * Math.cos(OPZ.lat * Math.PI / 180) / (256 * Math.pow(2, j.z));   // metri per pixel dell'immagine
      k = mpx / 1000 / (KMPX || 0.25);
      cx = p[0] - j.x0; cy = p[1] - j.y0;
    }
    k = Math.min(1.1, Math.max(k, tw / j.w, th / j.h));   // non oltre 1,1 (a 1,6 i pallini della Toscana sgranavano: meglio un'area piu' larga), e l'immagine copre sempre il riquadro
    var bw = j.w * k, bh = j.h * k;
    var x = Math.min(0, Math.max(tw - bw, tw / 2 - cx * k)), y = Math.min(0, Math.max(th - bh, th / 2 - cy * k));
    a.style.backgroundImage = 'url(' + g.url + ')';
    a.style.backgroundSize = bw.toFixed(1) + 'px ' + bh.toFixed(1) + 'px';
    a.style.backgroundPosition = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
    var pin = a.querySelector('i.mk-pin');
    if (OPZ.tipo === 'punto' && p) {
      if (!pin) { pin = document.createElement('i'); pin.className = 'mk-pin'; a.appendChild(pin); }
      pin.style.left = (cx * k + x).toFixed(1) + 'px'; pin.style.top = (cy * k + y).toFixed(1) + 'px';
    }
  }
  function carica(tipo, base) {
    if (geo[tipo]) return geo[tipo];
    var f = OPZ.reg + (tipo === 'ieri' ? '-ieri' : '-mappa');
    geo[tipo] = fetch(base + f + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { return { j: j, url: base + f + '.webp' + (j.generato ? '?v=' + encodeURIComponent(j.generato.slice(0, 13)) : '') }; })
      .catch(function () { return null; });
    return geo[tipo];
  }
  function ga(da) { try { gtag('event', 'apri_mappa', { da: OPZ.ga + '-striscia-' + da }); } catch (e) {} }
  function metti() {
    var btns = document.querySelector('#verdetto .capo-btns'); if (!btns || btns.getAttribute('data-str')) return;
    var vecchio = btns.querySelector('a'); if (!vecchio || btns.querySelectorAll('a').length !== 1) return;
    // il colore delle etichette: giallo all'85% per tutte (20/10/2026, sua scelta sul confronto con il blu scuro)
    var COL = ' mk-' + (OPZ.colore || 'giallo');
    var d = document.createElement('div'); d.className = 'mk-str' + COL;
    /* PAGINE PIOGGE (OPZ.ieri, 20/10/2026, suo: «in alto solo la mappa piogge»): un riquadro solo, la pioggia di IERI
       (<reg>-ieri.webp), largo quanto la scheda. modo 'sopra': la mappa sopra il bottone «Apri la mappa di ieri», che
       resta; modo 'bottone': il bottone stesso diventa la mappa, con la sua scritta sopra l'immagine. */
    if (OPZ.ieri) {
      var tit = vecchio.querySelector('b'), sot = vecchio.querySelector('small');
      d.className = 'mk-str mk-ieri' + (OPZ.modo === 'sopra' ? '' : ' mk-grande') + COL;
      d.innerHTML = '<a href="' + vecchio.getAttribute('href') + '" data-t="ieri" class="mk-uno"><span>' + (OPZ.modo === 'sopra'
        ? '<b>💧 Guarda la pioggia di ieri</b><small>località per località →</small>'
        : '<b>' + (tit ? tit.textContent : 'Apri la mappa di ieri') + ' →</b><small>' + (sot ? sot.textContent : '') + '</small>') + '</span></a>';
      btns.setAttribute('data-str', '1');
      if (OPZ.modo === 'sopra') btns.parentNode.insertBefore(d, btns); else btns.parentNode.replaceChild(d, btns);
      var a1 = d.querySelector('a');
      a1.addEventListener('click', function () { ga('ieri'); });
      carica('ieri', PIOGGIA).then(function (g) { if (g) { a1._g = g; ritaglia(a1, g); } });
      return;
    }
    var b = document.querySelector('main a[href*="boschi=1"]:not([href*="sat=1"])');
    // le scritte (20/10/2026, suo: «scriviamo qualcosa in più che incentivi il click»): una riga corta che invita
    // e una piccola sotto; tre alternative messe a confronto in localhost, questa e' la 1
    d.innerHTML = '<a href="' + vecchio.getAttribute('href') + '" data-t="pioggia"' + (b ? '' : ' class="mk-uno"') + '><span><b>💧 Guarda la pioggia</b><small>ultimi 20 giorni →</small></span></a>'
      + (b ? '<a href="' + b.getAttribute('href') + '" data-t="boschi"><span><b>🌲 Guarda i boschi</b><small>tipo per tipo →</small></span></a>' : '');
    btns.setAttribute('data-str', '1');
    btns.parentNode.replaceChild(d, btns);
    [].forEach.call(d.querySelectorAll('a'), function (a) {
      var t = a.getAttribute('data-t');
      a.addEventListener('click', function () { ga(t); });
      carica(t, t === 'boschi' ? BOSCHI : PIOGGIA).then(function (g) { if (g) { a._g = g; ritaglia(a, g); } });
    });
  }
  var v = document.getElementById('verdetto');
  if (v) { new MutationObserver(metti).observe(v, { childList: true, subtree: true }); metti(); }
  var tr;
  window.addEventListener('resize', function () { clearTimeout(tr); tr = setTimeout(function () {
    [].forEach.call(document.querySelectorAll('.mk-str a'), function (a) { if (a._g) ritaglia(a, a._g); }); }, 150); });
}

// lo script da mettere in fondo alla pagina, gia' chiamato coi suoi valori
const strisciaScript = opz => `<script>\n(${strisciaMappa.toString()})(${JSON.stringify(opz)});\n</script>`;

module.exports = { STRISCIA_CSS, strisciaMappa, strisciaScript };
