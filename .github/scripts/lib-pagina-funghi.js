/**
 * I pezzi comuni delle pagine funghi di ZONA e di REGIONE nello schema del
 * 24/9/2026 (deciso da lui guardando Santo Stefano d'Aveto): prima i dati,
 * cioe' il verdetto «ha piovuto abbastanza?», le 25 barre, la pioggia che
 * conta con le sue otto giornate, la temperatura; poi in fondo le spiegazioni.
 *
 * Le pagine di paese (genera-pagine-localita.js) hanno la stessa grafica ma il
 * loro codice scritto per esteso, perche' hanno anche durata e punta per
 * giorno, che su una media di zona non esistono.
 *
 * ⚠️ JS_COMUNE e' il SORGENTE della funzione `comune` qui sotto, preso con
 * toString(): cosi' il codice che finisce nelle pagine e' codice vero, che
 * node controlla, e non una stringa dove un apice sbagliato si scopre solo in
 * pagina. Deve restare JavaScript semplice (niente apici inversi: finisce
 * dentro un template literal del generatore).
 */

const STILE_NUOVO = `
.gg{display:flex;align-items:flex-end;gap:3px;height:150px;margin:14px 0 4px;}
.gg .b{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative;}
.gg .b i{display:block;background:#b9cbe2;border-radius:3px 3px 0 0;min-height:2px;}
.gg .b.dentro i{background:var(--blu);}
.gg .b b{align-self:center;margin-bottom:2px;line-height:1.1;font-size:10.5px;
  font-weight:700;color:var(--blu-scuro);white-space:nowrap;}
.gg-x{display:flex;gap:3px;font-size:10.5px;color:#6b7a8d;}
.gg-x span{flex:1;text-align:center;}
.gg-leg{font-size:13.5px;color:#555;margin-top:8px;}
.gg-leg i{display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:-1px;margin-right:4px;}
.tt-box{position:relative;padding-right:42px;margin:14px 0 2px;}
.tt{width:100%;height:150px;display:block;overflow:visible;}
.tt .griglia{stroke:#e6eaf0;stroke-width:1;vector-effect:non-scaling-stroke;}
.tt polyline{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;}
.tt .max{stroke:#d1603d;}
.tt .min{stroke:#3a6ea8;}
.tt-y{position:absolute;top:0;right:0;width:42px;height:150px;pointer-events:none;}
.tt-y span{position:absolute;right:0;transform:translateY(-50%);font-size:11px;color:#6b7a8d;line-height:1;padding-left:5px;}
.tt-x{padding-right:42px;}
.vic td:last-child,.vic th:last-child{text-align:right;}
.vic .qui{background:#eef4fd;}
.verdetto{background:#0f2d4d;color:#fff;border-radius:12px;padding:18px 18px 16px;margin:14px 0 8px;}
.verdetto .si{font-size:27px;font-weight:800;line-height:1.2;}
.verdetto .pallino{display:inline-block;width:15px;height:15px;border-radius:50%;margin-right:9px;vertical-align:2px;}
.verdetto .gr{font-size:44px;font-weight:800;line-height:1.1;margin-top:10px;}
.verdetto .gr small{font-size:18px;font-weight:600;opacity:.85;margin-left:6px;}
.verdetto .dett{font-size:16px;opacity:.9;margin-top:6px;}
.scala{display:flex;gap:4px;margin-top:14px;}
.scala div{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.18);}
.scala-t{display:flex;font-size:11.5px;opacity:.75;margin-top:4px;}
.scala-t span{flex:1;text-align:center;}
.breve{font-size:16px;color:#333;margin:6px 0 4px;}
.fin{display:flex;gap:6px;align-items:flex-end;height:170px;margin:16px 0 4px;}
.fin .c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;text-align:center;}
.fin .c i{display:block;background:var(--blu);border-radius:4px 4px 0 0;min-height:3px;}
.fin .c b{font-size:13px;color:var(--blu-scuro);margin-bottom:3px;}
/* C13 (19/10/2026): otto giornate senza pioggia, il grafico vuoto lo dice */
.fin{position:relative}.fin-nulla{position:absolute;left:0;right:0;top:38%;text-align:center;color:#5a6b80;font-size:14px;font-weight:600}
.fin-x{display:flex;gap:6px;font-size:12px;color:#6b7a8d;}
.fin-x span{flex:1;text-align:center;line-height:1.25;}
.gg .b.nodato i,.fin .c.nodato i{background:none;border:1px dashed #9fb3cc;border-bottom:0;height:14%;}
.fin .c.nodato b{color:#8a97a6;font-weight:400;}
.img-mappa{width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);margin-top:10px;}
.tasti{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;}
.tasti a{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:14.5px;color:var(--blu-scuro);
  padding:11px 6px;border:1px solid #b9c7da;border-radius:9px;background:linear-gradient(180deg,#fff,#eef3fa);}
.tasti a.forte{background:var(--blu);color:#fff;border-color:var(--blu);}
.tasti a.t-prev{grid-column:1 / -1;}
@media(max-width:640px){.verdetto .gr{font-size:38px;} .tasti{grid-template-columns:repeat(2,1fr);}}
.banda-prev{display:flex;align-items:center;gap:12px;margin:10px 0 4px;padding:13px 16px;border-radius:12px;background:linear-gradient(135deg,#1f6fd1,#3f8fe8);color:#fff;text-decoration:none;box-shadow:0 2px 8px rgba(31,111,209,.25);}
.banda-prev .ic{font-size:30px;line-height:1;flex:none;}
.banda-prev b{display:block;font-size:17px;line-height:1.2;}
.banda-prev span{display:block;font-size:13px;opacity:.92;margin-top:2px;}
.banda-prev .fr{margin-left:auto;font-size:22px;flex:none;}
.banda-prev:hover{background:linear-gradient(135deg,#1b5fb3,#3580d6);}
.noioso{margin-top:34px;padding-top:6px;border-top:1px solid var(--bordo);color:#555;font-size:15px;}
.noioso h2{font-size:17px;color:#445;margin:20px 0 6px;}
.noioso p{margin-bottom:8px;}
.noioso a{color:var(--blu);}
`;

/* eslint-disable no-unused-vars */
function comune() {
  var GIORNI = 25;
  var MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
  var GS = ["dom","lun","mar","mer","gio","ven","sab"];
  function iso(d){ var p = function(n){ return String(n).padStart(2,"0"); };
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate()); }
  function menoDa(s, n){ var p = String(s).split("-");
    var d = new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()-n); return d; }
  function gg(s){ var p = String(s).split("-"); return (+p[2]) + " " + MESI[(+p[1])-1]; }
  /* «il 9 ottobre», ma «l’8», «l’11», «l’1» (17/10/2026: si leggeva «il 8 ottobre») */
  function ilGg(s){ var d = +String(s).split("-")[2]; return (d === 1 || d === 8 || d === 11 ? "l’" : "il ") + gg(s); }
  /* «dal 4 all'11 settembre»: il mese una volta sola, l'apostrofo davanti a 1, 8, 11 */
  function dalAl(a, b){ var pa = a.split("-"), pb = b.split("-"), da = +pa[2], db = +pb[2];
    var al = (db === 1 || db === 8 || db === 11) ? "all’" : "al ";
    return ((da === 1 || da === 8 || da === 11) ? "dall’" : "dal ") + (pa[1] === pb[1] ? da : gg(a)) + " " + al + gg(b); }
  function esc(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
  /* + 1e-9 (19/10/2026, B8): 8,05 fatto per due strade usciva 8,0500 e 8,0499999 e diventava 8,1 nella
     lista della regione e 8,0 nella pagina della zona. Il margine sposta solo i casi a meta' esatta. */
  function uno(n){ return Math.round(n*10+1e-9)/10; }
  function num(n){ return uno(n).toFixed(1).replace(".", ","); }
  /* «0» se non e' piovuto, «meno di 0,1» per le tracce, la regola delle pagine piogge (19/10/2026, quarto check) */
  function mmT(n){ return !(n > 0) ? "0" : uno(n) === 0 ? "meno di 0,1" : num(n); }
  /* serie[0] e' IERI; n va dal piu' lontano al piu' vicino */
  function somma(s, da, a){ var t = 0; for (var n = da; n >= a; n--) t += (s[n-1]||0); return uno(t); }

  /* ⚠️ LA SCALA DEL VERDETTO E' SUA (24/9/2026): pioggia degli ULTIMI 20
     GIORNI. Sotto 30 mm troppo poco, da 30 poco, da 60 bene, da 100 benissimo.
     Dice com'e' andata la pioggia, non se ci sono i funghi. */
  var LIV = [{fino:30,t:"Troppo poca pioggia",c:"#c0392b"},
             {fino:60,t:"Poca pioggia",c:"#e6a100"},
             {fino:100,t:"Ha piovuto bene",c:"#5bb85d"},
             {fino:1e9,t:"Ha piovuto benissimo",c:"#2e9d44"}];

  function scriviVerdetto(s, oggi, href, sotto){
    /* 17/10/2026: un giorno senza nessun dato e' null, non zero. Sotto il 60% di
       giorni con dato (la soglia della mappa) niente verdetto: lo si dice. */
    var g20 = 0; for (var n0 = 20; n0 >= 1; n0--) if (s[n0-1] != null) g20++;
    if (g20 < 12) {
      document.getElementById("verdetto").innerHTML = "<div class=\"verdetto\">"
        + "<div class=\"si\"><span class=\"pallino\" style=\"background:#8a97a6\"></span>Dati incompleti</div>"
        + "<div class=\"dett\">Negli ultimi 20 giorni i pluviometri hanno mandato dati solo <b>" + g20 + (g20 === 1 ? " giorno" : " giorni")
        + "</b>: il totale sarebbe più basso del vero.</div>"
        + "<div class=\"capo-btns\"><a class=\"capo-btn\" href=\"" + href + "\">Vedi sulla mappa</a></div></div>";
      return;
    }
    var m20 = somma(s, 20, 1);
    /* la fascia si sceglie sul numero COME SI LEGGE (19/10/2026, quarto check B8): 29,48 usciva
       «Troppo poca pioggia» con scritto 30 mm accanto alla scala «sotto 30». */
    var liv = LIV.filter(function(l){ return Math.round(m20) < l.fino; })[0], k = LIV.indexOf(liv);
    var big = [];
    for (var n = 20; n >= 1; n--) if ((s[n-1]||0) >= 10) big.push(n);
    var dett = big.length
      ? big.slice(-4).map(function(n){ return "<b>" + num(s[n-1]) + " mm</b> " + ilGg(iso(menoDa(oggi,n))); }).join(", ") + "."
      : "Nessuna giornata sopra i 10 mm.";
    var sc = "";
    for (var q = 0; q < 4; q++) sc += "<div" + (q <= k ? " style=\"background:" + liv.c + "\"" : "") + "></div>";
    document.getElementById("verdetto").innerHTML = "<div class=\"verdetto\">"
      + "<div class=\"si\"><span class=\"pallino\" style=\"background:" + liv.c + "\"></span>" + liv.t + "</div>"
      + "<div class=\"gr\">" + Math.round(m20) + " mm<small>" + sotto + "</small></div>"
      + "<div class=\"dett\">" + dett + "</div>"
      + "<div class=\"scala\">" + sc + "</div>"
      + "<div class=\"scala-t\"><span>sotto 30</span><span>30-60</span><span>60-100</span><span>oltre 100</span></div>"
      + "<div class=\"capo-btns\"><a class=\"capo-btn\" href=\"" + href + "\">Vedi sulla mappa</a></div></div>";
  }

  /* le 25 barre, ieri a destra; restituisce le ascisse per i grafici sotto */
  function scriviBarre(s, oggi){
    var max = Math.max.apply(null, s.concat([1])), barre = "", ax = "";
    /* 17/10/2026: i numeri si danno dalla barra PIU' ALTA in giu', saltando le
       vicine di una gia' numerata (come le pagine delle piogge). Prima andavano
       in ordine di data: a Pieve Santo Stefano il 7/10 (5,9) prendeva il numero
       e l'8/10 (23,9), accanto, restava senza, e il 5,9 sembrava suo. Il numero
       sta sopra la SUA barra (CSS .gg .b b), per questo la piu' alta arriva all'86%. */
    var cand = [], lab = {};
    for (var c = 1; c <= GIORNI; c++) if ((s[c-1] || 0) >= 1 && (s[c-1] || 0) >= max*0.2) cand.push(c);
    cand.sort(function (a, b) { return s[b-1] - s[a-1]; })
      .forEach(function (c) { if (!lab[c-1] && !lab[c+1]) lab[c] = 1; });
    for (var i = GIORNI; i >= 1; i--) {
      var v = s[i-1] || 0, d = menoDa(oggi, i), cl = (i >= 13 && i <= 20) ? " dentro" : "";
      if (s[i-1] == null) {   /* nessun dato: barra vuota tratteggiata, non uno zero (17/10/2026) */
        barre += "<div class=\"b nodato\" title=\"" + gg(iso(d)) + ": nessun dato\"><i></i></div>";
        ax += "<span>" + ((i === GIORNI || i === 1 || i % 5 === 0) ? (d.getDate() + "/" + (d.getMonth()+1)) : "") + "</span>";
        continue;
      }
      barre += "<div class=\"b" + cl + "\" title=\"" + gg(iso(d)) + ": " + num(v) + " mm\">" + (lab[i] ? "<b>" + num(v) + "</b>" : "")
        + "<i style=\"height:" + Math.max(2, Math.round(v/max*86)) + "%\"></i></div>";
      ax += "<span>" + ((i === GIORNI || i === 1 || i % 5 === 0) ? (d.getDate() + "/" + (d.getMonth()+1)) : "") + "</span>";
    }
    document.getElementById("grafico").innerHTML = "<div class=\"gg\">" + barre + "</div><div class=\"gg-x\">" + ax + "</div>"
      + "<p class=\"gg-leg\"><i style=\"background:var(--blu)\"></i>da 13 a 20 giorni fa &nbsp; "
      + "<i style=\"background:#b9cbe2\"></i>gli altri giorni"
      + (s.slice(0, GIORNI).some(function(x){ return x == null; }) ? " &nbsp; <i style=\"background:none;border:1px dashed #9fb3cc;box-sizing:border-box\"></i>nessun dato" : "") + "</p>";
    return ax;
  }

  /* la pioggia che conta: titolo con le date e le otto barre larghe */
  function scriviFinestra(s, oggi, _sI, quale){
    var daG = iso(menoDa(oggi,20)), aG = iso(menoDa(oggi,13));
    document.getElementById("h-conta").textContent = "Però attenzione: la pioggia che conta è quella caduta " + dalAl(daG, aG);
    document.getElementById("p-conta").innerHTML = "Il fungo spunta 12-13 giorni dopo una bella pioggia: "
      + "i funghi di oggi nascono da queste otto giornate, che qui hanno fatto " + quale + " <b>" + mmT(somma(s,20,13)) + " mm</b>"
      + (function(){ var m = 0; for (var q = 20; q >= 13; q--) if (s[q-1] == null) m++; return m ? " (ma di " + m + (m === 1 ? " giorno" : " giorni") + " il dato manca)" : ""; })() + ".";
    var fmax = 1;
    for (var n = 20; n >= 13; n--) fmax = Math.max(fmax, s[n-1]||0);
    var fb = "", fx = "";
    for (var n2 = 20; n2 >= 13; n2--) {
      var v = s[n2-1] || 0, d = menoDa(oggi, n2);
      if (s[n2-1] == null) fb += "<div class=\"c nodato\" title=\"nessun dato\"><b>–</b><i></i></div>";
      else fb += "<div class=\"c\">" + (uno(v) > 0 ? "<b>" + num(v) + "</b>" : "") + "<i style=\"height:" + Math.max(2, Math.round(v/fmax*88)) + "%\"></i></div>";
      fx += "<span>" + GS[d.getDay()] + "<br>" + d.getDate() + "/" + (d.getMonth()+1) + "</span>";
    }
    /* C13 (19/10/2026): se nei giorni con dato non e' piovuto niente, il grafico vuoto sembrava rotto */
    var asciutto = somma(s,20,13) === 0;   /* il totale delle otto giornate, lo stesso numero scritto sopra */
    if (asciutto) fb += "<p class=\"fin-nulla\">Nessuna pioggia in questi otto giorni</p>";
    document.getElementById("finestra").innerHTML = "<div class=\"fin\">" + fb + "</div><div class=\"fin-x\">" + fx + "</div>";
  }

  /* minima e massima degli ultimi 25 giorni, a linee */
  function scriviTemperatura(sT, ax, nota){
    var vals = [];
    for (var q = 0; q < GIORNI; q++) if (sT[q]) { if (sT[q][0] != null) vals.push(sT[q][0]); if (sT[q][1] != null) vals.push(sT[q][1]); }
    if (!vals.length) return;
    var lo = Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals) + 1);
    var passi = [1, 2, 2.5, 5, 10], p = 10;
    for (var k = 0; k < passi.length; k++) if ((hi - lo) / passi[k] <= 5) { p = passi[k]; break; }
    var y = function(v){ return 100 - (v - lo) / (hi - lo) * 100; };
    var svg = "", et = "";
    for (var t = Math.ceil(lo / p) * p; t <= hi; t += p) {
      svg += "<line class=\"griglia\" x1=\"0\" y1=\"" + y(t).toFixed(1) + "\" x2=\"100\" y2=\"" + y(t).toFixed(1) + "\"/>";
      et += "<span style=\"top:" + y(t).toFixed(1) + "%\">" + t + "°</span>";
    }
    function linea(c){ var pz = [], cur = [];
      for (var i = GIORNI; i >= 1; i--) { var d = sT[i-1];
        if (!d || d[c] == null) { if (cur.length > 1) pz.push(cur.join(" ")); cur = []; continue; }
        cur.push(((GIORNI - i) / (GIORNI - 1) * 100).toFixed(1) + "," + y(d[c]).toFixed(1)); }
      if (cur.length > 1) pz.push(cur.join(" "));
      return pz; }
    ["min","max"].forEach(function(cl, c){ linea(c).forEach(function(pts){ svg += "<polyline class=\"" + cl + "\" points=\"" + pts + "\"/>"; }); });
    var ieri = sT[0];
    document.getElementById("meteo").innerHTML = "<h2>Temperatura degli ultimi 25 giorni</h2>"
      + (ieri ? "<p class=\"breve\">Ieri minima <b>" + (ieri[0] == null ? "—" : num(ieri[0]) + "°") + "</b>, massima <b>" + (ieri[1] == null ? "—" : num(ieri[1]) + "°") + "</b>" + (nota ? ", " + nota : "") + ".</p>" : "")
      + "<div class=\"tt-box\"><svg class=\"tt\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\">" + svg + "</svg>"
      + "<div class=\"tt-y\">" + et + "</div></div><div class=\"gg-x tt-x\">" + ax + "</div>"
      + "<p class=\"gg-leg\"><i style=\"background:#d1603d\"></i>massima &nbsp; <i style=\"background:#3a6ea8\"></i>minima</p>";
  }
}

const JS_COMUNE = comune.toString()
  .replace(/^function comune\(\)\s*\{/, '')
  .replace(/\}\s*$/, '');

/* ⚠️ LA DATA DEI DATI, PER CHI LEGGE E PER GOOGLE (26/9/2026). Le pagine di
   paese e di zona si rigenerano ogni tre mesi, ma i numeri li scarica il
   browser ogni volta: la pagina E' fresca, solo che non lo diceva. Qui si
   scrive sotto il verdetto «Dati aggiornati al 26 settembre alle 7:40» e si
   aggiunge un blocco WebPage con `dateModified` = quando e' stato scritto il
   file dei dati (`generato`). Google legge anche i dati strutturati aggiunti
   dal javascript. E' una data VERA, quella dei numeri mostrati: mai la data
   di oggi a prescindere. Serve alle ricerche con «oggi», che sono le nostre.
   Stile in linea: le pagine di paese prendono il foglio dalla pagina della
   regione, e cosi' non serve rigenerare anche quella. */
function aggiornato() {
  function scriviAggiornato(generato) {
    var d = new Date(generato);
    if (isNaN(d.getTime())) return;
    var MM = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
    var g = d.getDate();
    var pre = (g === 8 || g === 11) ? "all’" : "al ";
    var ora = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    var v = document.querySelector("#verdetto .verdetto");
    if (v) {
      var p = document.createElement("div");
      p.style.cssText = "font-size:13px;opacity:.75;margin-top:10px;";
      p.textContent = "Dati aggiornati " + pre + (g === 1 ? "1°" : g) + " " + MM[d.getMonth()] + " alle " + ora;
      v.appendChild(p);
    }
    var can = document.querySelector("link[rel=canonical]");
    var ld = { "@context": "https://schema.org", "@type": "WebPage", "name": document.title,
               "url": can ? can.href : location.href, "inLanguage": "it", "dateModified": d.toISOString() };
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }
}
const JS_AGGIORNATO = aggiornato.toString()
  .replace(/^function aggiornato\(\)\s*\{/, '')
  .replace(/\}\s*$/, '');

/* ── I BOTTONI IN RILIEVO, comuni a tutte le pagine (11/10/2026) ──────────────
   Nati sulle pagine regione (sua scelta V2 fra tre: «le scritte cosi' piccole
   fanno schifo, i bottoni non sembrano bottoni»), poi estesi a funghi, zone e
   paesi su sua richiesta. UN SOLO BLOCCO per tutti: prima lo stesso bottone
   era scritto in quattro generatori.
   ⚠️ VA IN FONDO AL FOGLIO DI STILE di ogni pagina, dopo tutto il resto: le
   schede dei paesi e le zone copiano lo stile delle pagine funghi e poi
   ridefiniscono .tasti e .banda-prev, e l'ultima regola vince.
   ⚠️ La chiave «BOTTONI IN RILIEVO» nel commento la usa chi lo inserisce nelle
   pagine gia' fatte senza rigenerarle (per non toccare i numeri d'archivio):
   se c'e' gia', non lo rimette. */
/* Il bottone rosso «Vieni a trovarci su YouTube» in fondo alle pagine (11/10/2026,
   sua richiesta: «solo bottone rosso 3D», niente schede col video). Il logo
   nel bottone si rovescia: rettangolo bianco, triangolo rosso. Sta anche da
   solo (YT_BTN) per le pagine della mappa forestale, che RILIEVO non lo hanno. */
const YT_BTN = `/* BOTTONE YOUTUBE (lib-pagina-funghi.js) */
.yt-btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(180deg,#e0262e,#b8141b);color:#fff !important;
  font-weight:800;font-size:16.5px;text-decoration:none !important;padding:13px 20px 14px;border-radius:12px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 4px 0 #7d0d12,0 9px 18px rgba(160,20,27,.32);transition:transform .08s,box-shadow .08s;}
.yt-btn svg{width:26px;height:18px;flex:none;}
.yt-btn svg rect{fill:#fff;}
.yt-btn svg polygon{fill:#e12b2b;}
.yt-btn:hover{background:linear-gradient(180deg,#e8323a,#c01820);}
.yt-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #7d0d12,0 4px 8px rgba(160,20,27,.3);}
`;
const RILIEVO = `/* BOTTONI IN RILIEVO (lib-pagina-funghi.js) */
.capo-btns{gap:12px;margin-top:15px;}
.capo-btn{background:#fff;border:none;color:#10263f;font-size:16px;font-weight:700;padding:12px 18px 13px;border-radius:12px;
  box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 2px 0 #c9d6e6,0 5px 0 #7f97b6,0 10px 18px rgba(0,0,0,.35);transition:transform .08s,box-shadow .08s;}
.capo-btn:hover{background:#f3f7fc;}
.capo-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #7f97b6,0 5px 10px rgba(0,0,0,.3);}
.banda-prev{padding:15px 16px 16px;border-radius:14px;box-shadow:0 6px 0 #164f97,0 12px 22px rgba(20,60,120,.38);transition:transform .08s,box-shadow .08s;}
.banda-prev b{font-size:19px;}
.banda-prev span{font-size:15px;}
.banda-prev .fr{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;}
.banda-prev:active{transform:translateY(4px);box-shadow:0 2px 0 #164f97,0 5px 10px rgba(20,60,120,.3);}
.tasti{gap:12px;margin-top:12px;}
.tasti a{background:#fff;border:1px solid #d3deeb;border-radius:12px;padding:13px 6px 14px;font-size:16px;
  box-shadow:0 4px 0 #9fb3cc,0 8px 14px rgba(15,45,77,.16);transition:transform .08s,box-shadow .08s;}
.tasti a:hover{background:#f3f7fc;}
.tasti a.forte{background:var(--blu);color:#fff;border-color:var(--blu);box-shadow:0 4px 0 #0c2440,0 8px 14px rgba(15,45,77,.25);}
.tasti a.forte:hover{background:#24508a;}
.tasti a:active{transform:translateY(3px);box-shadow:0 1px 0 #9fb3cc,0 3px 6px rgba(15,45,77,.16);}
.tasti a.forte:active{box-shadow:0 1px 0 #0c2440,0 3px 6px rgba(15,45,77,.25);}
.card .vai{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:auto;background:var(--blu);color:#fff;font-size:16px;font-weight:700;
  padding:11px 14px 12px;border-radius:12px;text-decoration:none;box-shadow:0 4px 0 #0c2440,0 8px 14px rgba(15,45,77,.22);transition:transform .08s,box-shadow .08s;}
.card .nota{margin-bottom:14px;}
.card .vai:hover{background:#24508a;}
.card .vai:active{transform:translateY(3px);box-shadow:0 1px 0 #0c2440,0 3px 6px rgba(15,45,77,.22);}
.verdetto .top{font-size:17.5px;line-height:1.55;}
.verdetto .dett{font-size:15px;opacity:.85;}
@media(max-width:480px){.banda-prev b{font-size:17.5px;}.banda-prev span{font-size:14px;}.tasti a{font-size:15px;}.capo-btn{font-size:15.5px;}
  .verdetto .top{font-size:16px;}.verdetto .dett{font-size:14px;}}
` + YT_BTN;

/* ── IL QUIZ ESAME TARTUFI ACCANTO A YOUTUBE (12/10/2026, sua scelta) ─────────
   Solo nelle regioni che il quiz ha: bottone giallo ACCANTO a «Vieni a trovarci
   su YouTube», simmetrico (celle uguali, 53 px: lui, «devi ricordarti sempre le
   simmetrie»). Sta qui perche' lo usano le pagine regione, funghi, zone e paesi:
   una regione nuova nel quiz = una riga in QUIZ_REGIONI, e al primo giro le
   pagine che si rigenerano lo prendono da sole. Le pagine funghi che NON si
   rigenerano l'hanno avuto con uno script d'inserimento (banco, 12/10). */
const QUIZ = 'https://avventuremicologiche.it/esame-tartufi/';
const QUIZ_REGIONI = { toscana: 'Toscana', lazio: 'Lazio', marche: 'Marche', campania: 'Campania' };
const QUIZ_CSS = `
/* QUIZ ACCANTO A YOUTUBE: due celle uguali, una sotto l'altra sul telefono */
.coppia-btn{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0 4px;}
.coppia-btn a{justify-content:center;box-sizing:border-box;min-height:53px;width:100%;}
.coppia-btn svg{width:26px;flex:none;}
.quiz-btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(180deg,#F9C93E,#EDA40C);color:#3d1f04 !important;
  font-weight:800;font-size:16.5px;text-decoration:none !important;padding:13px 20px 14px;border-radius:12px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 4px 0 #a06a08,0 9px 18px rgba(150,95,10,.32);transition:transform .08s,box-shadow .08s;}
.quiz-btn:hover{background:linear-gradient(180deg,#FBD150,#F0AC1A);}
.quiz-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #a06a08,0 4px 8px rgba(150,95,10,.3);}
@media(max-width:560px){.coppia-btn{grid-template-columns:1fr;}}
`;
const COPPA_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#7A3A08" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm-1 4v1a2 2 0 0 0 2 2V7zm12 0v3a2 2 0 0 0 2-2V7z"/></svg>';
// Il bottone YouTube (ytA = il suo <a>) da solo, o in coppia col quiz della regione k.
// `pulsante` e' il valore dell'evento GA click_quiz, come quello di click_youtube.
const coppiaQuiz = (k, ytA, pulsante) => QUIZ_REGIONI[k]
  ? `<div class="coppia-btn">${ytA}
<a href="${QUIZ}${k}/" target="_blank" rel="noopener" class="quiz-btn"
   onclick="try{gtag('event','click_quiz',{pulsante:'${pulsante}'})}catch(e){}">${COPPA_SVG}Quiz esame tartufi ${QUIZ_REGIONI[k]}</a></div>`
  : `<p style="margin:22px 0 4px;">${ytA}</p>`;

/* Lo stile di una pagina gia' fatta, da usare come base per un'altra (17/10/2026).
   ⚠️ Paesi, zone, indice funghi e mappa forestale copiano il <style> di una pagina
   funghi, che dall'11-12/10 contiene gia' RILIEVO (con YT_BTN in coda) e QUIZ_CSS;
   poi li aggiungevano di nuovo, e rigenerando il blocco usciva DOPPIO (visto il 17/10
   sulle 911 pagine di paese). Qui si tolgono: chi li vuole li aggiunge da se'. */
function stileDelModello(html) {
  const s = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  return s.split(RILIEVO).join('').split(YT_BTN).join('').split(QUIZ_CSS).join('');
}

module.exports = { STILE_NUOVO, JS_COMUNE, JS_AGGIORNATO, RILIEVO, YT_BTN, QUIZ_REGIONI, QUIZ_CSS, coppiaQuiz, stileDelModello };
