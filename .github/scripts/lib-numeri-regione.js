/**
 * I NUMERI DELLE PAGINE REGIONE, in un posto solo (11/10/2026).
 *
 * PERCHE' ESISTE. Fino a oggi i numeri di /toscana/ e delle altre 22 pagine li
 * scriveva SOLO il browser, dopo aver scaricato il riepilogo: la pagina che il
 * server consegnava diceva «Sto leggendo i pluviometri…» e tre riquadri con
 * «…». Google il javascript lo esegue tardi e non sempre, e titolo e
 * descrizione nei risultati restavano uguali tutto l'anno. Search Console, 12/9
 * → 10/10: «pluviometria toscana» 12.962 apparizioni in sesta posizione e 1,1%
 * di clic. Da qui la pagina «cotta»: ogni mattina il generatore scrive dentro
 * l'HTML i numeri di ieri, e il javascript resta per chi la apre piu' tardi.
 *
 * ⚠️ UNA FUNZIONE SOLA PER DUE MONDI. `numeriRegione` la chiama il generatore
 * in Node e la chiama il browser: il generatore la copia dentro la pagina con
 * `numeriRegione.toString()`. Due copie dello stesso disegno divergerebbero, ed
 * e' la trappola che questo progetto ha gia' pagato (le gemelle in tre copie).
 * Per questo e' scritta in ES5 e non tocca NIENTE fuori da se': niente DOM,
 * niente variabili esterne, niente `require`. Restituisce solo stringhe HTML.
 *
 * ⚠️ `oggi` lo passa chi chiama: il browser il suo giorno, il generatore il
 * giorno italiano in cui gira. Serve a dire «Ieri» solo quando e' davvero ieri.
 */

function numeriRegione(j, oggi, K, SITO) {
  var MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  var MESI_L = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  var GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  var NG = 30;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function daIso(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function menoDa(s, n) { var d = daIso(s); d.setDate(d.getDate() - n); return d; }
  function lungo(s) { var p = String(s).split('-'); return (+p[2]) + ' ' + MESI_L[(+p[1]) - 1]; }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  // Sotto i 10 mm il decimale conta (0,4 non e' zero), sopra no.
  function mm(n) { return n === 0 ? '0' : n < 10 ? num(n) : String(Math.round(n)); }
  // La media grande: «meno di 0,1» se arrotondata fa zero ma qualcuno ha misurato
  // pioggia (Garfagnana 16/10/2026: 0,03 mm, Renaio 0,4); «0» solo se e' asciutto vero.
  function mediaMm(d) { return Math.round(d.media * 10) === 0 && d.top && d.top.length && d.top[0].mm > 0 ? '<small style="margin:0 .3em 0 0">meno di</small>0,1' : mm(d.media); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function link(da, a) { return SITO + '/?r=' + K + '&da=' + da + '&a=' + a + '&s=p'; }
  // «dal 18 al 24 settembre»: il mese una volta sola, l'apostrofo davanti a 1, 8, 11
  function dalAl(a, b) {
    var pa = a.split('-'), pb = b.split('-'), da = +pa[2], db = +pb[2];
    var ap = function (n) { return n === 1 || n === 8 || n === 11; };
    return (ap(da) ? 'Dall’' : 'Dal ') + (pa[1] === pb[1] ? da : lungo(a)) + (ap(db) ? ' all’' : ' al ') + lungo(b);
  }
  var ieri = iso(menoDa(oggi, 1));
  // «Ieri» solo se e' davvero ieri: il riepilogo puo' essere di altroieri.
  function nomeGiorno(s) { return s === ieri ? 'Ieri' : GIORNI[daIso(s).getDay()] + ' ' + lungo(s); }

  var p = j.periodi, ultimo = (p['1'] || p['7']).ultimo, out = { ultimo: ultimo, ieri: ultimo === ieri };

  // Gli indirizzi dei tasti, con le date VERE
  out.tasti = {};
  [['t1',1],['t7',7],['t15',15],['t20',20],['t30',30],['cta7',7],['cta20',20],['cta30',30],['lnk-img',20]].forEach(function (x) {
    out.tasti[x[0]] = link(iso(menoDa(ultimo, x[1] - 1)), ultimo);
  });

  // ── IERI, in cima: la risposta alla domanda del titolo ──
  var d = p['1'];
  if (!d || !d.giorni) out.verdetto = '';
  else {
    var t = nomeGiorno(d.ultimo), top = (d.top || []).filter(function (s) { return s.mm >= 1; }).slice(0, 3), dett;
    if (top.length) dett = 'Dove ha piovuto di più: ' + top.map(function (s) { return '<b>' + esc(s.n) + '</b> ' + (s.mm === 0 ? '0' : num(s.mm)) + ' mm'; }).join(', ') + '.';
    else if (d.top && d.top.length && d.top[0].mm > 0) dett = 'Giornata quasi asciutta: il massimo è stato ' + num(d.top[0].mm) + ' mm a ' + esc(d.top[0].n) + (/\.$/.test(d.top[0].n) ? '' : '.');   // «T.P.» non prende un altro punto (18/10/2026)
    else dett = 'Giornata asciutta: nessun pluviometro ha misurato pioggia.';
    out.verdetto = '<div class="verdetto">'
      + '<div class="si">' + (t === 'Ieri' ? 'Ieri, ' + lungo(d.ultimo) : t) + '</div>'
      + '<div class="gr">' + mediaMm(d) + ' mm<small>di media</small></div>'
      + '<div class="top">' + dett + '</div>'
      + '<div class="dett">' + (d.stazioni === 1 ? 'Un pluviometro solo.' : 'Media di ' + d.stazioni + ' pluviometri.') + '</div>'
      + (t === 'Ieri' ? '' : '<div class="dett">I dati di ieri non sono ancora arrivati da tutte le reti: questa è l’ultima giornata intera.</div>')
      // 11/10/2026, sua scelta B fra quattro: bottone pieno a tutta larghezza,
      // titolo e sottotitolo su due righe volute (la frase lunga andava a capo
      // e non sembrava piu' un bottone). Forma dei banner della home.
      + '<div class="capo-btns"><a class="ieri-btn" href="' + esc(link(d.ultimo, d.ultimo)) + '"'
      + ' onclick="try{gtag(\'event\',\'apri_mappa\',{da:\'pagina-' + K + '-ieri-box\'})}catch(e){}">'
      + '<b>' + (t === 'Ieri' ? 'Apri la mappa di ieri' : 'Mappa di quel giorno') + '</b><i>→</i>'   // «Apri la mappa di quel giorno» andava a capo gia' a 390 px (C15, 19/10/2026)
      + '<small>la pioggia in tutte le località</small></a></div></div>';
  }

  // ── Le 30 barre, l'ultimo giorno a destra. Gli ultimi 7 in blu pieno ──
  var s = j.serie;
  if (!s || !s.length) out.grafico = '<p class="nota">Il grafico giorno per giorno arriva col prossimo aggiornamento.</p>';
  else {
    var n = Math.min(NG, s.length), max = 1, barre = '', ax = '', q, c, i;
    for (q = 0; q < n; q++) max = Math.max(max, s[q] || 0);
    // Le etichette si danno dalla barra piu' alta in giu', saltando le vicine
    // di una gia' etichettata: cosi' la piu' alta il suo numero ce l'ha sempre.
    var cand = [], lab = {};
    for (c = 1; c <= n; c++) if (s[c - 1] != null && s[c - 1] >= 1 && s[c - 1] >= max * 0.2) cand.push(c);
    cand.sort(function (a, b) { return s[b - 1] - s[a - 1]; })
      .forEach(function (c) { if (!lab[c - 1] && !lab[c + 1]) lab[c] = 1; });
    for (i = n; i >= 1; i--) {
      var v = s[i - 1], g = menoDa(j.serieDa || ultimo, i - 1), cl = i <= 7 ? ' dentro' : '';   // 17/10/2026: la data della serie la dice il riepilogo
      barre += '<div class="b' + cl + '" title="' + lungo(iso(g)) + ': ' + (v == null ? 'nessun dato' : num(v) + ' mm') + '">' + (lab[i] ? '<b>' + mm(v) + '</b>' : '')
        + '<i style="height:' + (v == null ? 0 : Math.max(2, Math.round(v / max * 86))) + '%"></i></div>';
      ax += '<span>' + ((i === n || i === 1 || i % 5 === 0) ? (g.getDate() + '/' + (g.getMonth() + 1)) : '') + '</span>';
    }
    out.grafico = '<div class="gg">' + barre + '</div><div class="gg-x">' + ax + '</div>'
      + '<p class="gg-leg"><i style="background:var(--blu)"></i>ultimi 7 giorni &nbsp; '
      + '<i style="background:#b9cbe2"></i>i giorni prima &nbsp;·&nbsp; media dei pluviometri della regione, in mm</p>';
  }

  // ── I tre periodi ──
  out.periodi = {};
  ['7','20','30'].forEach(function (k) {
    var d = p[k];
    // ⚠️ Un riepilogo scritto PRIMA del 13/9 il mese non ce l'ha: la scheda si
    // nasconde invece di dire «dati non disponibili», che sarebbe falso.
    if (!d && k === '30') { out.periodi[k] = { nascondi: true }; return; }
    if (!d || !d.giorni) { out.periodi[k] = { media: '<span class="attesa">dati non disponibili al momento</span>', top: '', date: '' }; return; }
    var top;
    if (!d.top || !d.top.length || d.top[0].mm < 1) top = '<p class="nota">Periodo quasi asciutto in tutta la regione.</p>';
    else top = '<ol class="top-staz">' + d.top.map(function (s) { return '<li>' + esc(s.n) + ' — ' + (s.mm === 0 ? '0' : num(s.mm)) + ' mm</li>'; }).join('') + '</ol>';   // lo zero vero e' «0» (18/10/2026)
    out.periodi[k] = {
      media: mediaMm(d) + ' mm <small>di media</small>',   // 17/10/2026: anche qui il decimale sotto i 10 mm (prima «1 mm» dove la zona diceva 0,8)
      top: top,
      // Le giornate si dicono solo se ne manca qualcuna: se no e' il titolo ripetuto.
      date: dalAl(d.primo, d.ultimo) + (d.giorni < +k ? ', ' + d.giorni + (d.giorni === 1 ? ' giornata di dati' : ' giornate di dati') : '') + '.',
    };
  });

  // ── Le zone: valore dei 7 giorni (per l'ordine) e testo della casella ──
  out.zone = {};
  (j.zone || []).forEach(function (z) {
    // «meno di 0,1» anche qui (18/10/2026): prima la lista diceva «ieri 0» in 20 zone dove la pagina
    // di zona, per lo stesso giorno, diceva «meno di 0,1 mm». Le spie p1/p7 le scrive il riepilogo.
    var zmm = function (v, piovuto) { return Math.round(v * 10) === 0 && piovuto ? '<small style="margin:0 .3em 0 0">meno di</small>0,1' : mm(v); };
    // «ieri» solo se il giorno della zona e' davvero ieri (18/10/2026): una zona a cavallo di due
    // regioni parte dal giorno completo piu' vecchio fra le due, e qui usciva «ieri 0,3» con il numero
    // dell'altroieri mentre la pagina di zona diceva «Giovedì 16 ottobre». Se no, la data corta.
    var giornoZ = !z.ultimo || z.ultimo === ieri ? 'ieri' : (+String(z.ultimo).split('-')[2]) + ' ' + MESI[(+String(z.ultimo).split('-')[1]) - 1];
    out.zone[z.s] = { val: z.m7, html: zmm(z.m7, z.p7) + ' mm' + (z.m1 != null ? '<small>' + giornoZ + ' ' + (Math.round(z.m1 * 10) === 0 && z.p1 ? 'meno di 0,1' : mm(z.m1)) + '</small>' : '') };
  });

  return out;
}

module.exports = { numeriRegione };
