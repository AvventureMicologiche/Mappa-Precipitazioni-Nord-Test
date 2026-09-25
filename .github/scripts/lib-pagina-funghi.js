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
.gg .b b{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:10.5px;
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
.fin-x{display:flex;gap:6px;font-size:12px;color:#6b7a8d;}
.fin-x span{flex:1;text-align:center;line-height:1.25;}
.img-mappa{width:100%;height:auto;border:1px solid var(--bordo);border-radius:9px;display:block;background:var(--grigio);margin-top:10px;}
.tasti{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;}
.tasti a{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:14.5px;color:var(--blu-scuro);
  padding:11px 6px;border:1px solid #b9c7da;border-radius:9px;background:linear-gradient(180deg,#fff,#eef3fa);}
.tasti a.forte{background:var(--blu);color:#fff;border-color:var(--blu);}
@media(max-width:640px){.verdetto .gr{font-size:38px;} .tasti{grid-template-columns:repeat(2,1fr);}}
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
  /* «dal 4 all'11 settembre»: il mese una volta sola, l'apostrofo davanti a 1, 8, 11 */
  function dalAl(a, b){ var pa = a.split("-"), pb = b.split("-"), da = +pa[2], db = +pb[2];
    var al = (db === 1 || db === 8 || db === 11) ? "all’" : "al ";
    return ((da === 1 || da === 8 || da === 11) ? "dall’" : "dal ") + (pa[1] === pb[1] ? da : gg(a)) + " " + al + gg(b); }
  function esc(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
  function uno(n){ return Math.round(n*10)/10; }
  function num(n){ return uno(n).toFixed(1).replace(".", ","); }
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
    var m20 = somma(s, 20, 1);
    var liv = LIV.filter(function(l){ return m20 < l.fino; })[0], k = LIV.indexOf(liv);
    var big = [];
    for (var n = 20; n >= 1; n--) if ((s[n-1]||0) >= 10) big.push(n);
    var dett = big.length
      ? big.slice(-4).map(function(n){ return "<b>" + num(s[n-1]) + " mm</b> il " + gg(iso(menoDa(oggi,n))); }).join(", ") + "."
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
    var max = Math.max.apply(null, s.concat([1])), barre = "", ax = "", ult = null;
    for (var i = GIORNI; i >= 1; i--) {
      var v = s[i-1] || 0, d = menoDa(oggi, i), cl = (i >= 13 && i <= 20) ? " dentro" : "";
      var et = v >= max*0.2 && (ult === null || ult - i >= 2);
      if (et) ult = i;
      barre += "<div class=\"b" + cl + "\" title=\"" + gg(iso(d)) + ": " + num(v) + " mm\">" + (et ? "<b>" + num(v) + "</b>" : "")
        + "<i style=\"height:" + Math.max(2, Math.round(v/max*100)) + "%\"></i></div>";
      ax += "<span>" + ((i === GIORNI || i === 1 || i % 5 === 0) ? (d.getDate() + "/" + (d.getMonth()+1)) : "") + "</span>";
    }
    document.getElementById("grafico").innerHTML = "<div class=\"gg\">" + barre + "</div><div class=\"gg-x\">" + ax + "</div>"
      + "<p class=\"gg-leg\"><i style=\"background:var(--blu)\"></i>da 13 a 20 giorni fa &nbsp; "
      + "<i style=\"background:#b9cbe2\"></i>gli altri giorni</p>";
    return ax;
  }

  /* la pioggia che conta: titolo con le date e le otto barre larghe */
  function scriviFinestra(s, oggi, _sI, quale){
    var daG = iso(menoDa(oggi,20)), aG = iso(menoDa(oggi,13));
    document.getElementById("h-conta").textContent = "Però attenzione: la pioggia che conta è quella caduta " + dalAl(daG, aG);
    document.getElementById("p-conta").innerHTML = "Il fungo spunta 12-13 giorni dopo una bella pioggia: "
      + "i funghi di oggi nascono da queste otto giornate, che qui hanno fatto " + quale + " <b>" + num(somma(s,20,13)) + " mm</b>.";
    var fmax = 1;
    for (var n = 20; n >= 13; n--) fmax = Math.max(fmax, s[n-1]||0);
    var fb = "", fx = "";
    for (var n2 = 20; n2 >= 13; n2--) {
      var v = s[n2-1] || 0, d = menoDa(oggi, n2);
      fb += "<div class=\"c\">" + (v > 0 ? "<b>" + num(v) + "</b>" : "") + "<i style=\"height:" + Math.max(2, Math.round(v/fmax*88)) + "%\"></i></div>";
      fx += "<span>" + GS[d.getDay()] + "<br>" + d.getDate() + "/" + (d.getMonth()+1) + "</span>";
    }
    document.getElementById("finestra").innerHTML = "<div class=\"fin\">" + fb + "</div><div class=\"fin-x\">" + fx + "</div>";
  }

  /* minima e massima degli ultimi 25 giorni, a linee */
  function scriviTemperatura(sT, ax, nota){
    var vals = [];
    for (var q = 0; q < GIORNI; q++) if (sT[q]) { vals.push(sT[q][0]); vals.push(sT[q][1]); }
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
        if (!d) { if (cur.length > 1) pz.push(cur.join(" ")); cur = []; continue; }
        cur.push(((GIORNI - i) / (GIORNI - 1) * 100).toFixed(1) + "," + y(d[c]).toFixed(1)); }
      if (cur.length > 1) pz.push(cur.join(" "));
      return pz; }
    ["min","max"].forEach(function(cl, c){ linea(c).forEach(function(pts){ svg += "<polyline class=\"" + cl + "\" points=\"" + pts + "\"/>"; }); });
    var ieri = sT[0];
    document.getElementById("meteo").innerHTML = "<h2>Temperatura degli ultimi 25 giorni</h2>"
      + (ieri ? "<p class=\"breve\">Ieri minima <b>" + num(ieri[0]) + "°</b>, massima <b>" + num(ieri[1]) + "°</b>" + (nota ? ", " + nota : "") + ".</p>" : "")
      + "<div class=\"tt-box\"><svg class=\"tt\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\">" + svg + "</svg>"
      + "<div class=\"tt-y\">" + et + "</div></div><div class=\"gg-x tt-x\">" + ax + "</div>"
      + "<p class=\"gg-leg\"><i style=\"background:#d1603d\"></i>massima &nbsp; <i style=\"background:#3a6ea8\"></i>minima</p>";
  }
}

const JS_COMUNE = comune.toString()
  .replace(/^function comune\(\)\s*\{/, '')
  .replace(/\}\s*$/, '');

module.exports = { STILE_NUOVO, JS_COMUNE };
