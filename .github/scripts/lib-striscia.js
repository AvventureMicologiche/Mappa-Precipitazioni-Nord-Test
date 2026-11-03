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
div.mk-str{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:16px 0 2px;}
/* ⚠️ L'ETICHETTA SOTTO LA CARTINA, NON SOPRA (28/10/2026, come le anteprime delle pagine meteo, dove sopra copriva la
   Sicilia e le citta' della costa; suo: «prendi le idee nuove che abbiamo messo in queste pagine e applicale»). Il
   riquadro e' una colonna: la cartina (i.mk-img, dove ritaglia() mette l'immagine) e sotto la striscia gialla. */
div.mk-str a{position:relative;display:flex;flex-direction:column;height:auto;border-radius:11px;overflow:hidden;background:#1d3d63;
  box-shadow:0 0 0 1px rgba(255,255,255,.28);text-decoration:none;}
div.mk-str a i.mk-img{position:relative;display:block;height:122px;background:#1d3d63 no-repeat;}
div.mk-str a span{position:static;display:block;flex:1;border-radius:0;box-shadow:none;background:rgba(9,28,52,.86);color:#fff;font:700 13.5px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  padding:7px 9px 8px;}
div.mk-str a span b{display:block;font-weight:800;white-space:nowrap;}
div.mk-str a span small{display:block;font-weight:500;font-size:12px;opacity:.88;margin-top:1px;white-space:nowrap;}
div.mk-str a.mk-uno{grid-column:1 / -1;}
div.mk-str i.mk-pin{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#e12b2b;border:2px solid #fff;
  box-shadow:0 1px 4px rgba(0,0,0,.45);}
@media(min-width:700px){div.mk-str a i.mk-img{height:150px;}}
/* al telefono il riquadro e' largo ~146 px a 360: scritte un filo piu' piccole, e a capo piuttosto che fuori */
@media(max-width:420px){div.mk-str a span{padding:6px 7px 7px;font-size:12.5px;}
  div.mk-str a span b,div.mk-str a span small{white-space:normal;} div.mk-str a span small{font-size:11px;}}
@media(max-width:370px){div.mk-str a span{font-size:12px;padding:6px;} div.mk-str a span small{font-size:10.5px;}}
/* ⚠️ PAGINE PIOGGE: LA CARTINA GRANDE E LA SCRITTA PICCOLA SOPRA (1/11/2026, suo: «da quando le scritte sono cosi'
   grandi e la cartina non si vede?»,
   poi sulla Sila Grande «rigenera tutto con questo formato»). Il riquadro e' tutto cartina, 300 px al telefono e 440 al
   PC (prima 140 / 185 di cartina con sotto la fascia gialla grande), sulle pagine regione si vede la regione INTERA
   (ritaglia) e la scritta e' UNA riga gialla piccola in basso a sinistra, sopra la cartina. Le pagine funghi (due
   riquadri, pioggia e boschi) restano come il 28/10: etichetta sotto. */
div.mk-str.mk-ieri a{display:block;height:300px;}
div.mk-str.mk-ieri a i.mk-img{position:absolute;left:0;top:0;right:0;bottom:0;height:auto;}
@media(min-width:700px){div.mk-str.mk-ieri a{height:440px;} div.mk-str.mk-ieri a i.mk-img{height:auto;}}
div.mk-str.mk-ieri a span{position:absolute;left:8px;bottom:8px;right:auto;flex:none;padding:4px 10px;border-radius:999px;}
div.mk-str.mk-ieri a span b{font-size:13px;font-weight:800;white-space:nowrap;} div.mk-str.mk-ieri a span small{display:none;}
div.mk-str.mk-ieri a span em{font-style:normal;font-weight:600;}
@media(max-width:420px){div.mk-str.mk-ieri a span{left:6px;bottom:6px;padding:4px 9px;}
  div.mk-str.mk-ieri a span b{font-size:12px;white-space:nowrap;} div.mk-str.mk-ieri a span em{display:none;}}
/* al PC la pillola un po' piu' grande: accanto al bottone largo di ieri sembrava la cosa meno importante */
@media(min-width:700px){div.mk-str.mk-ieri a span{left:10px;bottom:10px;padding:5px 12px;} div.mk-str.mk-ieri a span b{font-size:15px;}}
/* il bottone sotto la cartina, stesso giallo della pillola (1/11/2026) */
#verdetto a.mk-oppure,a.mk-oppure{display:block;margin:9px 0 2px;padding:11px 10px;border-radius:11px;text-align:center;text-decoration:none;
  background:linear-gradient(180deg,#f9c93e,#eda40c);color:#3d1f04;font:800 15px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  box-shadow:0 3px 0 rgba(160,106,8,.85);}
#verdetto a.mk-oppure:hover,a.mk-oppure:hover{filter:brightness(1.05);}
/* la striscia colorata (20/10/2026, suo: «il bottone magari rosso o giallo?»): giallo del quiz, rosso di YouTube.
   Sotto la cartina il giallo e' pieno, come le anteprime delle pagine meteo (all'85% serviva quando stava sopra) */
div.mk-str.mk-giallo a span{background:linear-gradient(180deg,#f9c93e,#eda40c);color:#3d1f04;border-top:1px solid rgba(160,106,8,.35);box-shadow:none;}
div.mk-str.mk-rosso a span{background:linear-gradient(180deg,#ec3b33,#c9221b);color:#fff;border-top:1px solid #8f1410;box-shadow:none;}
div.mk-str.mk-giallo a span small,div.mk-str.mk-rosso a span small{opacity:.92;}
/* sopra la cartina (pagine piogge) il giallo ha un'ombra, se no si perde nei colori della pioggia */
div.mk-str.mk-ieri.mk-giallo a span{background:linear-gradient(180deg,rgba(249,201,62,.94),rgba(237,164,12,.94));border-top:0;
  box-shadow:0 2px 0 rgba(160,106,8,.85),0 4px 10px rgba(0,0,0,.3);}
/* ⚠️ PAGINE FUNGHI: I DUE RIQUADRI GRANDI (1/11/2026, suo: «sì ingrandiscili anche qui», proposta B fra due). Come le
   pagine piogge: tutto cartina, la scritta e' una pillola gialla in basso a sinistra che dice il periodo («Pioggia 20
   giorni», «Boschi, tipo per tipo»). Al telefono uno SOTTO l'altro, larghi quanto la scheda e alti 240 px (affiancati
   erano larghi 160 px e la regione si vedeva a meta'); al PC affiancati, alti 320 (erano 122 / 150 con la fascia sotto).
   Classe mk-grandi, cosi' i riquadri dell'indice /funghi/ (mk-italia, stile loro) non cambiano. */
div.mk-str.mk-grandi a{display:block;height:240px;}
div.mk-str.mk-grandi a i.mk-img{position:absolute;left:0;top:0;right:0;bottom:0;height:auto;}
div.mk-str.mk-grandi a span{position:absolute;left:6px;bottom:6px;right:auto;flex:none;padding:4px 9px;border-radius:999px;}
div.mk-str.mk-grandi a span b{font-size:12.5px;white-space:nowrap;} div.mk-str.mk-grandi a span small{display:none;}
@media(max-width:699px){div.mk-str.mk-grandi{grid-template-columns:1fr;}}
@media(min-width:700px){div.mk-str.mk-grandi a{height:320px;} div.mk-str.mk-grandi a span{left:10px;bottom:10px;padding:5px 12px;}
  div.mk-str.mk-grandi a span b{font-size:15px;}}
div.mk-str.mk-grandi.mk-giallo a span{background:linear-gradient(180deg,rgba(249,201,62,.94),rgba(237,164,12,.94));border-top:0;
  box-shadow:0 2px 0 rgba(160,106,8,.85),0 4px 10px rgba(0,0,0,.3);}
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
  function ritaglia(a0, g) {
    // la cartina sta nella parte di sopra del riquadro (i.mk-img, 28/10/2026: l'etichetta e' sotto)
    var a = a0.querySelector('i.mk-img') || a0;
    // ⚠️ la pagina disegna la scheda mentre e' ancora nascosta (riquadri larghi 0): si riprova finche' ha una misura
    var j = g.j, tw = a.clientWidth, th = a.clientHeight;
    if (!tw || !th) { a._prove = (a._prove || 0) + 1; if (a._prove < 50) setTimeout(function () { ritaglia(a0, g); }, 200); return; }
    var k, cx, cy, p;
    if (OPZ.tipo === 'regione' && j.reg) {
      var nw = proj(j.reg.n, j.reg.w, j.z), se = proj(j.reg.s, j.reg.e, j.z);
      k = tw / Math.max(1, se[0] - nw[0]);
      // (1/11/2026) i riquadri sono alti: la regione ci sta INTERA, anche in altezza (la Calabria era a meta')
      k = 0.94 * Math.min(k, th / Math.max(1, se[1] - nw[1]));
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
    var f = OPZ.reg + (tipo === 'ieri' ? '-ieri' : tipo === '7g' ? '-7g' : '-mappa');
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
      d.className = 'mk-str mk-ieri' + COL;   // 2/11/2026: via « mk-grande», classe senza CSS (check 9)
      d.innerHTML = '<a href="' + vecchio.getAttribute('href') + '" data-t="ieri" class="mk-uno"><i class="mk-img"></i><span>' + (OPZ.modo === 'sopra'
        ? '<b>💧 Guarda la pioggia di ieri</b><small>località per località →</small>'
        : '<b>' + (tit ? tit.textContent : 'Apri la mappa di ieri') + ' →</b><small>' + (sot ? sot.textContent : '') + '</small>') + '</span></a>';
      btns.setAttribute('data-str', '1');
      if (OPZ.modo === 'sopra') btns.parentNode.insertBefore(d, btns); else btns.parentNode.replaceChild(d, btns);
      var a1 = d.querySelector('a');
      a1.addEventListener('click', function () { ga(a1.getAttribute('data-t')); });
      /* ⚠️ L'IMMAGINE DEVE ESSERE DEL GIORNO DEL BOTTONE (21/10/2026, ottavo check, bug 2): se lo scatto di ieri fallisce
         (o GitHub salta il giro) sul ramo resta quella dell'altroieri, che usciva sotto «Ieri» senza nessun avviso.
         Se la data del JSON non e' quella del link (da=) l'immagine non si mette: il riquadro resta blu con la scritta,
         come quando manca. */
      var daL = (vecchio.getAttribute('href').match(/[?&]da=(\d{4}-\d\d-\d\d)/) || [])[1];
      /* ⚠️ LA CARTINA DEGLI ULTIMI 7 GIORNI (1/11/2026, suo: «la scritta va bene la pioggia di ieri e la mappa ultimi 7
         giorni»). La scheda resta su ieri (e' la risposta alla ricerca), la cartina e' quella dei 7 giorni (<reg>-7g, che
         genera-anteprime.js scatta per tutte le regioni): nei giorni asciutti quella di ieri era solo cartina e pallini
         bianchi. Il riquadro porta alla mappa dei 7 giorni (il link #cta7 della pagina) e lo dice. Se lo scatto dei 7
         giorni manca o non finisce a ieri, resta la cartina di ieri come prima. */
      /* ⚠️ E SOTTO, IL BOTTONE GIALLO «OPPURE GUARDA LA PIOGGIA DI IERI» (1/11/2026, suo: «il tasto dentro la mappa 7 gg va
         bene e poi tasto giallo orizzontale sotto la mappa»). La pillola sulla cartina dice quanti giorni si guardano, il
         bottone porta alla mappa di ieri (il link del vecchio «Apri la mappa di ieri»). Si mettono SUBITO, senza aspettare
         il JSON, cosi' la pagina non salta di 50 px quando arriva; se la cartina dei 7 giorni manca si torna a com'era
         (pillola di ieri, niente bottone: direbbe la stessa cosa due volte). */
      var c7 = OPZ.modo === 'sopra' ? null : document.getElementById('cta7'), sp = a1.querySelector('span'), ieriHtml = sp.innerHTML, opp = null;
      if (c7) {
        a1.setAttribute('href', c7.getAttribute('href')); a1.setAttribute('data-t', '7giorni');
        sp.innerHTML = '<b>💧 Pioggia degli ultimi 7 giorni<em> · apri la mappa</em> →</b>';
        opp = document.createElement('a'); opp.className = 'mk-oppure'; opp.href = vecchio.getAttribute('href');
        opp.textContent = 'Oppure guarda la pioggia di ieri →';
        opp.addEventListener('click', function () { ga('ieri'); });
        d.parentNode.insertBefore(opp, d.nextSibling);
      }
      carica('7g', PIOGGIA).then(function (g7) {
        if (g7 && c7 && (!daL || !g7.j.a || g7.j.a === daL)) { a1._g = g7; ritaglia(a1, g7); return; }
        if (opp) { opp.parentNode.removeChild(opp); a1.setAttribute('href', vecchio.getAttribute('href')); a1.setAttribute('data-t', 'ieri'); sp.innerHTML = ieriHtml; }
        carica('ieri', PIOGGIA).then(function (g) { if (g && (!daL || !g.j.da || g.j.da === daL)) { a1._g = g; ritaglia(a1, g); } });
      });
      return;
    }
    // (21/10/2026, ottavo check, bug 9) solo il bottone NORMALE diventa la striscia: «Vedi i vicini sulla mappa» (pluviometro
    // sospeso, millimetri sbagliati) resta com'e', se no sopra la pagina che lo dice invitava a «guardare la pioggia»
    if (vecchio.textContent.replace(/\s+/g, ' ').trim() !== 'Vedi sulla mappa') return;
    d.className = 'mk-str mk-grandi' + COL;   // i due riquadri grandi (1/11/2026)
    var b = document.querySelector('main a[href*="boschi=1"]:not([href*="sat=1"])');
    // le scritte (20/10/2026, suo: «scriviamo qualcosa in più che incentivi il click»): una riga corta che invita
    // e una piccola sotto; tre alternative messe a confronto in localhost, questa e' la 1
    d.innerHTML = '<a href="' + vecchio.getAttribute('href') + '" data-t="pioggia"' + (b ? '' : ' class="mk-uno"') + '><i class="mk-img"></i><span><b>💧 Pioggia 20 giorni →</b></span></a>'
      + (b ? '<a href="' + b.getAttribute('href') + '" data-t="boschi"><i class="mk-img"></i><span><b>🌲 Boschi, tipo per tipo →</b></span></a>' : '');
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
