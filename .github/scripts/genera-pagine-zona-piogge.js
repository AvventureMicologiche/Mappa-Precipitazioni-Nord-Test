#!/usr/bin/env node
/**
 * LE PAGINE «DOVE HA PIOVUTO» DI ZONA: zone/<zona>/index.html (13/9/2026).
 *
 * PERCHE' ESISTONO. Il sito ha DUE categorie di pagine, e vanno ragionate in
 * modo diverso (deciso con l'utente il 13/9/2026):
 *  - PIOGGE: valgono tutto l'anno, per chiunque voglia sapere quanto ha
 *    piovuto. Devono stare in alto su «dove ha piovuto ieri in Garfagnana»,
 *    «quanto ha piovuto in Lunigiana». Sono la mappa, le 23 regioni e queste.
 *  - FUNGHI: la finestra 13-20 giorni fa, «dove andare a funghi oggi», con la
 *    riga di stagione. Sono /funghi/ e tutto quello che ci sta sotto.
 * Fino a oggi una zona esisteva SOLO come pagina funghi, quindi per la pioggia
 * di ieri in Garfagnana non c'era niente da trovare.
 *
 * ⚠️ NON SONO LA COPIA DELLA PAGINA FUNGHI con un altro titolo. Stessa zona e
 * stessi pluviometri, ma altri numeri (ieri, 7 e 30 giorni, invece della
 * finestra dei funghi) e altro testo. Due pagine quasi uguali sullo stesso
 * posto sono il modo piu' sicuro di farne indicizzare nessuna: e' il motivo per
 * cui le localita' «piogge» NON si fanno (1.043 localita' funghi ancora
 * «rilevate, non indicizzate» al 4/9/2026).
 *
 * I NUMERI li prepara genera-riepiloghi.js in data/riepiloghi/zone/<zona>.json,
 * una richiesta per pagina. L'ultimo giorno e' quello COMPLETO: se ieri non e'
 * ancora arrivato da tutte le reti, la scheda dice la data vera.
 *
 * ⚠️ IL FOGLIO DI STILE SI PRENDE DALLA PAGINA REGIONE di casa, come le zone
 * funghi lo prendono dalla pagina funghi: stessa famiglia, stesso aspetto, e un
 * solo posto dove cambiarlo. Quindi si lancia DOPO genera-pagine-regione.js.
 *
 * Uso: node .github/scripts/genera-pagine-zona-piogge.js
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione, elenco, diZona, postiDellaZona, diEnte } = require('./lib-nomi.js');
const { perLink } = require('./lib-vicine.js');
const { scriviSitemap } = require('./genera-sitemap.js');
// il bottone YouTube in fondo, col quiz accanto SOLO nelle regioni che ce l'hanno (18/10/2026):
// la pagina regione gemella ce l'aveva dall'11/10, queste no
const { coppiaQuiz } = require('./lib-pagina-funghi.js');
// ⚠️ ANCHE METEO, COME LE PAGINE REGIONE (20/10/2026, campione sulla Garfagnana): cerca nell'intestazione con le sei
// porte, la riga Previsioni · Radar · Boschi · Satellite sotto «Apri la mappa di ieri», «Che tempo farà» coi PAESI
// della zona (non le citta' della regione) e il grafico coi 7 giorni previsti. Il codice nel browser e' lo stesso
// della regione (lib-meteo-regione.js, con le opzioni di zona): una regola sola, un posto solo.
const { METEO_CSS, meteoHtml, meteoClient } = require('./lib-meteo-regione.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));

const SITO = 'https://avventurepluvio-test.pages.dev';
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
// ⚠️ L'ANTEPRIMA DELLA MAPPA, dal ramo `anteprime` (22/9/2026, sua richiesta:
// «ce l'abbiamo, usiamolo»). Era l'unica famiglia di pagine senza: regione,
// zone funghi e paesi ce l'hanno tutte, queste no.
// Non si genera niente di nuovo: e' la STESSA immagine della regione di casa,
// che anteprime.yml riscrive ogni giorno. Quindi zero lavoro in piu' e zero
// crediti Netlify — le immagini non stanno nel sito ma su un ramo a se', e le
// serve raw.githubusercontent.
// ⚠️ IL BOTTONE E' `.cta`, NON `.vai-mappa`. La zona funghi usa `.vai-mappa`
// perche' quella classe sta nel foglio della famiglia funghi; queste pagine
// prendono lo stile dalla PAGINA REGIONE, dove `.vai-mappa` non esiste e
// sarebbe rimasta testo nudo. `.cta` in quel foglio c'e' gia' ed e' la stessa
// che usano i tre riquadri qui sopra: un bottone solo, niente CSS nuovo.
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime';
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Per REGIONE: gli id non sono unici fra regioni (18/10/2026), la regione di ogni
// pluviometro la decide postiDellaZona per vicinanza al centro della zona (lib-nomi.js).
const SLUG_REG = {}, ANAG_REG = {};
for (const [k, v] of Object.entries(POSTI)) {
  SLUG_REG[k] = slugRegione(v); ANAG_REG[k] = {};
  for (const p of v) ANAG_REG[k][p[0]] = p;
}

function scrivi(dest, testo) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, testo.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
}

/* ── I PAESI DELLA ZONA, per «Che tempo farà» (20/10/2026) ──
   Le zone non hanno un confine: hanno un centro e i loro pluviometri. Quindi i candidati sono
   (1) il comune piu' vicino a ogni pluviometro, (2) i comuni dentro l'inviluppo dei pluviometri: questi sono «certi»
   e vengono prima; (3) per riempire, i comuni della regione della zona entro 1,6 volte la distanza mediana dei
   pluviometri dal centro (minimo 12 km: le zone con 2-3 pluviometri restavano con 2 paesi).
   Si ordinano per log(abitanti) x vicinanza al centro, i paesi di un'altra regione pesano 0,6: cosi' i paesi
   principali ci sono e una citta' grande ai margini non passa davanti (Brescia in Val Trompia, La Spezia in
   Lunigiana). Al massimo DODICI: e' il tetto dell'API (50 sottorichieste di Cloudflare).
   ⚠️ REGOLA SUA: «meglio un paese in piu', anche fuori zona, che uno in meno». Per questo la pagina scrive
   «I paesi della X e dei dintorni». Limite noto: in Lunigiana centro e pluviometri stanno a sud, Pontremoli e
   Fivizzano restano fuori (la casella li trova). Ognuno porta la SUA regione (r). Finiscono in
   data/paesi-zone.json, che legge /api/previsioni?zona=<slug>. Niente quota: MET usa il suo terreno. */
const COMUNI = fs.readFileSync(path.join(RADICE, 'data', 'elenco-paesi.txt'), 'utf8').split('\n')
  .map(r => r.split('|')).filter(p => p.length >= 6 && (p[6] || '').trim() !== 'z')
  .map(p => ({ n: p[0], lat: +p[1], lon: +p[2], reg: p[4], pop: +p[5] || 0 }));
const MAX_PAESI = 12;
const km = (a, b, c, d) => 111.2 * Math.hypot(c - a, (d - b) * Math.cos(a * Math.PI / 180));
function inviluppo(pt) {   // catena monotona di Andrew, punti [x, y]
  const p = pt.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const giu = [], su = [];
  for (const q of p) { while (giu.length >= 2 && x(giu[giu.length - 2], giu[giu.length - 1], q) <= 0) giu.pop(); giu.push(q); }
  for (const q of p.reverse()) { while (su.length >= 2 && x(su[su.length - 2], su[su.length - 1], q) <= 0) su.pop(); su.push(q); }
  return giu.slice(0, -1).concat(su.slice(0, -1));
}
function dentro(q, poli) {
  let d = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i], b = poli[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
function paesiDellaZona(z) {
  const { ids, regDi } = postiDellaZona(POSTI, z), k = Math.cos(z.lat * Math.PI / 180);
  const st = ids.map(id => ANAG_REG[regDi[id]][id]).map(p => ({ lat: +p[4], lon: +p[5] }));
  const dist = st.map(p => km(z.lat, z.lon, p.lat, p.lon)).sort((a, b) => a - b);
  const s = Math.max(6, dist[Math.floor(dist.length / 2)] || 0);   // la scala della zona, in km
  const cand = new Map(), metti = (c, certo) => { const ch = c.n + '|' + c.reg, v = cand.get(ch);
    cand.set(ch, { ...c, d: km(z.lat, z.lon, c.lat, c.lon), certo: certo || (v && v.certo) }); };
  for (const p of st) { let best = null, d0 = Infinity; for (const c of COMUNI) { const d = km(p.lat, p.lon, c.lat, c.lon); if (d < d0) { d0 = d; best = c; } } if (best) metti(best, true); }
  const poli = st.length >= 3 ? inviluppo(st.map(p => [p.lon * k, p.lat])) : [];
  for (const c of COMUNI) {
    if (poli.length >= 3 && dentro([c.lon * k, c.lat], poli)) metti(c, true);
    else if (c.reg === z.reg && km(z.lat, z.lon, c.lat, c.lon) <= Math.max(12, 1.6 * s)) metti(c);
  }
  // ⚠️ PRIMA I CERTI (comune di un pluviometro o dentro l'area dei pluviometri), poi il cerchio: con la sola vicinanza
  // al centro la Garfagnana perdeva l'alta valle (Piazza al Serchio, Minucciano) per Bagni di Lucca. 20/10/2026.
  const peso = c => Math.log10(c.pop + 10) * Math.exp(-((c.d / (2 * s)) ** 2)) * (c.reg === z.reg ? 1 : 0.6);
  return [...cand.values()].sort((a, b) => (b.certo ? 1 : 0) - (a.certo ? 1 : 0) || peso(b) - peso(a)).slice(0, MAX_PAESI)
    .map(c => ({ n: c.n, lat: c.lat, lon: c.lon, r: c.reg }));
}

function pagina(z) {
  const zslug = slug(z.n);
  const { ids, regDi: REG_DI } = postiDellaZona(POSTI, z);   // senza doppioni
  const SLUG_DI = id => SLUG_REG[REG_DI[id]][id], ANAG = id => ANAG_REG[REG_DI[id]][id];
  const regioni = [...new Set(ids.map(id => REG_DI[id]))];
  const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regioni[0]);
  const nomeReg = casa.nomeTitolo || casa.nome;
  const agenzie = [...new Set(regioni.map(k => {
    const r = REGIONI.find(x => x.k === k);
    return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null;
  }).filter(Boolean))];
  const REGS = perLink(casa.k, z.lat, z.lon);
  const PIN = 'pl=' + z.lat + ',' + z.lon + '&amp;pn=' + encodeURIComponent(z.n) + '&amp;pz=1';
  const di = diZona(z.dove);

  // Tetto 62 caratteri come tutte le altre: si accorcia solo sui nomi lunghi.
  const TITOLO = [
    `Dove ha piovuto ${z.dove}: ieri e negli ultimi giorni`,
    `Dove ha piovuto ${z.dove}: ieri e ultimi giorni`,
    `Dove ha piovuto ${z.dove}`,
  ].find(t => t.length <= 62) || `Pioggia ${z.dove}`;
  const DESCR = [
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni, pluviometro per pluviometro: ${ids.length} pluviometri ${diEnte(elenco(agenzie))}. Aggiornato ogni giorno.`,
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni, pluviometro per pluviometro. Aggiornato ogni giorno.`,
    `Quanta pioggia è caduta ${z.dove} ieri e negli ultimi 7 e 30 giorni.`,
  ].find(t => t.length <= 158);

  const modello = path.join(RADICE, casa.k, 'index.html');
  if (!fs.existsSync(modello)) {
    console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-regione.js');
    process.exit(1);
  }
  const m = fs.readFileSync(modello, 'utf8');
  // ⚠️ SENZA IL BLOCCO DEL METEO (19/10/2026, trovato col bug 16): dal 19/10 la pagina regione ha in coda le regole
  // della casella di ricerca (lib-meteo-regione.js, METEO_CSS), fatte per la SUA testata con la lente; copiate qui,
  // sul telefono spostavano «Iscriviti» da destra a meta' testata (x 295 → 202 a 390 px). Si taglia dal suo inizio.
  let STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));
  const iMeteo = STILE.indexOf('/* ── IL METEO NELLE PAGINE REGIONE');
  if (iMeteo >= 0) STILE = STILE.slice(0, iMeteo);

  // Le righe della tabella, cotte coi loro link: i nomi e i link li legge
  // Google, i millimetri e l'ordine li mette il javascript.
  const righe = ids.map(id => ANAG(id)).sort((a, b) => bello(a[1]).localeCompare(bello(b[1]), 'it'))
    .map(p => `<tr data-id="${esc(p[0])}"><td><a href="${SITO}/funghi/${REG_DI[p[0]]}/${SLUG_DI(p[0])}/">${esc(bello(p[1]))}</a>` +
      `<span class="com">${esc(p[2])} · ${p[3]} m</span></td>` +
      `<td class="mm v1">–</td><td class="mm v7">–</td><td class="mm v30">–</td></tr>`).join('\n');

  const altre = ZONE.filter(x => x.reg === casa.k && x.n !== z.n)
    .sort((a, b) => a.n.localeCompare(b.n, 'it'))
    .map(x => `<a href="${SITO}/zone/${slug(x.n)}/">${esc(x.n)}</a>`).join(' · ');

  // ⚠️ 25/9/2026: LO SCHEMA «PRIMA I DATI», come le pagine funghi del 24/9 e
  // la pagina regione: in cima IERI (la domanda del titolo), poi le barre dei
  // 30 giorni, i periodi, i pluviometri, le mappe; le spiegazioni in fondo.
  const card = (k, titolo) => `
  <div class="card">
    <h3>${titolo}</h3>
    <div class="numerone" id="rip${k}-media"><span class="attesa">…</span></div>
    <div id="rip${k}-top"></div>
    <p class="nota" id="rip${k}-date"></p>
    <a class="vai" id="cta${k}" href="${SITO}/?r=${REGS}&amp;g=${k}&amp;${PIN}"
       onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-${k}gg'})}catch(e){}">Apri la mappa →</a>
  </div>`;
  const tasto = (id, g, testo, forte) => `<a${forte ? ' class="forte"' : ''} id="${id}" href="${SITO}/?r=${REGS}&amp;g=${g}&amp;${PIN}"
     onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-${g}gg'})}catch(e){}">${testo}</a>`;

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/zone/${zslug}/">
<meta property="og:title" content="${esc('Dove ha piovuto ' + z.dove + ': ieri e ultimi giorni')}">
<meta property="og:description" content="${esc('La pioggia misurata dai pluviometri ' + di + ': ieri, ultimi 7 e 30 giorni.')}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/zone/${zslug}/">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], [nomeReg, `${SITO}/${casa.k}/`], [z.n, null]])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<style>${STILE}
.bric{font-size:14px;color:#666;margin-bottom:6px;}
.bric a{color:var(--blu);}
.tab{width:100%;border-collapse:collapse;font-size:15px;margin:8px 0 6px;}
.tab th{text-align:right;font-size:13px;color:#555;font-weight:600;padding:6px 5px;border-bottom:2px solid var(--bordo);white-space:nowrap;}
.tab th:first-child{text-align:left;}
.tab td{padding:8px 5px;border-bottom:1px solid var(--bordo);vertical-align:top;}
.tab td.mm{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
.tab a{color:var(--blu);text-decoration:none;font-weight:600;}
.tab .com{display:block;font-size:12.5px;color:#777;}
.altre-zone{font-size:15px;line-height:1.9;color:#555;}
.altre-zone a{color:var(--blu);}
@media(max-width:420px){.tab{font-size:14px;}.tab td,.tab th{padding-left:3px;padding-right:3px;}}
${METEO_CSS}
/* i paesi hanno nomi lunghi («Castelnuovo di Garfagnana»): a capo invece dei puntini, colonna un filo piu' larga */
#meteo .mk-cr{grid-template-columns:1.45fr 1fr 1fr 1fr;}
#meteo .mk-cr b{white-space:normal;overflow:visible;line-height:1.2;font-size:14.5px;}
</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'zona-piogge-${zslug}'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › <a href="${SITO}/${casa.k}/">${esc(nomeReg)}</a> › ${esc(z.n)}</p>
<h1>Dove ha piovuto ${esc(z.dove)}</h1>
<p class="sotto"><b>Pluviometria ${esc(di)}</b>: i dati dei ${ids.length} pluviometri ${esc(diEnte(elenco(agenzie)))}, ieri e nell'ultimo mese.</p>

<div id="attesa">Sto leggendo i pluviometri…</div>
<div id="verdetto"></div>
${meteoHtml(casa, `Che tempo farà ${esc(z.dove)}`, 'Sto leggendo le previsioni dei paesi…')}

<h2 id="h-grafico">La pioggia degli ultimi 30 giorni</h2>
<div id="grafico"></div>

<h2>Ultimi 7 e 30 giorni</h2>
<div class="griglia">${card(7, 'Ultimi 7 giorni')}${card(30, 'Ultimo mese')}
</div>

<h2>I pluviometri ${esc(di)}</h2>
<p class="nota" style="margin-top:0">Dal più bagnato negli ultimi 7 giorni. Ogni nome porta alla sua pagina, con la pioggia giorno per giorno.</p>
<table class="tab">
<thead><tr><th>Pluviometro</th><th id="th1">Ieri</th><th>7 giorni</th><th>30 giorni</th></tr></thead>
<tbody id="righe">
${righe}
</tbody>
</table>

<h2>Mappa pluviometrica ${esc(di)}: guardala in dettaglio</h2>
<div class="tasti">
  ${tasto('t1', 1, 'Ieri', true)}
  ${tasto('t7', 7, 'Ultimi 7 gg')}
  ${tasto('t15', 15, 'Ultimi 15 gg')}
  ${tasto('t20', 20, 'Ultimi 20 gg')}
  ${tasto('t30', 30, 'Ultimi 30 gg')}
  <a href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-radar'})}catch(e){}">📡 Radar adesso</a>
  <a class="t-prev" href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;m=prev"
     onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-previsioni'})}catch(e){}">☀️ Previsioni</a>
</div>
<p class="breve">La pioggia degli ultimi 20 giorni ${casa.prep} ${esc(nomeReg)}; il link apre la mappa già inquadrata ${esc(z.dove)}.</p>
<a href="${SITO}/?r=${REGS}&amp;g=20&amp;${PIN}&amp;z=10&amp;c=${z.lat},${z.lon}" id="lnk-img" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-anteprima'})}catch(e){}">
  <img class="img-mappa" src="${ANTEPRIME}/${casa.k}.jpg" alt="La mappa delle piogge ${casa.prep} ${esc(nomeReg)}"
       width="1600" height="1000" loading="lazy"></a>

<h2>Funghi ${esc(z.dove)}</h2>
<p style="margin-bottom:6px">Sei un appassionato di funghi? Guarda le nostre analisi in dettaglio:</p>
<ul style="margin:0 0 12px 22px;line-height:1.9">
  <li><a href="${SITO}/funghi/zone/${zslug}/">Funghi ${esc(z.dove)} oggi, stanno nascendo?</a></li>
  <li><a href="${SITO}/funghi/${casa.k}/">Funghi ${casa.prep} ${esc(nomeReg)} oggi</a></li>
</ul>

<h2>Dove ha piovuto nelle altre zone</h2>
<p class="altre-zone">${altre ? altre + ' · ' : ''}<a href="${SITO}/${casa.k}/"><b>tutta la regione</b></a></p>

<div class="noioso">
<h2>Come funziona questa pagina</h2>
<p>I millimetri li misurano i ${ids.length} pluviometri ${esc(diEnte(elenco(agenzie)))} che stanno ${esc(z.dove)}: strumenti a terra,
con il loro nome e la loro quota, non stime da modello. I numeri in cima sono la media dei pluviometri della zona, giorno
per giorno. La giornata di oggi non è contata perché i pluviometri la stanno ancora misurando. Nella tabella il trattino
vuol dire che quel pluviometro in quei giorni non ha pubblicato.</p>
<h2>Dove piove oggi ${esc(z.dove)}? La diretta radar</h2>
<p>Per la pioggia in corso c'è la <a href="${SITO}/?r=${casa.k}&amp;${PIN}&amp;radar=ora"
   onclick="try{gtag('event','apri_mappa',{da:'zona-piogge-${zslug}-radar-testo'})}catch(e){}">diretta radar</a>:
dove sta piovendo in questo momento, le ultime due ore e i quaranta minuti seguenti. Il radar misura dal cielo, a 2 km
di risoluzione; i millimetri di questa pagina sono quelli misurati a terra.</p>
${coppiaQuiz(casa.k, `<a href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener" class="yt-btn"
   onclick="try{gtag('event','click_youtube',{pulsante:'zona-piogge-${zslug}-fondo'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a>`, `zona-piogge-${zslug}-fondo`)}
</div>
</main>

<footer>
  Dati: ${esc(elenco(agenzie))} ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="${SITO}/guida/">guida alla mappa</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a>
</footer>

<script>
(function(){
  var BASE = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname) ? '/data/' : '${RAW}';
  var ZONA = ${JSON.stringify(zslug)}, REGS = ${JSON.stringify(REGS)}, SITO = ${JSON.stringify(SITO)};
  var PIN = ${JSON.stringify(PIN.replace(/&amp;/g, '&'))}, CASA = ${JSON.stringify(casa.k)};
  var MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  var MESI_L = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  var GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  var NG = 30;
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function giornoFa(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
  function daIso(s){ var p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
  function menoDa(s,n){ var d=daIso(s); d.setDate(d.getDate()-n); return d; }
  function breve(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  function lungo(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI_L[(+p[1])-1]; }
  function num(n){ return (Math.round(n*10)/10).toFixed(1).replace('.', ','); }
  // Sotto i 10 mm il decimale conta (0,4 non e' zero), sopra no.
  function mm(n){ return n===0 ? '0' : n<10 ? num(n) : String(Math.round(n)); }
  // La media grande: «meno di 0,1» se arrotondata fa zero ma qualcuno ha misurato pioggia (17/10/2026).
  function mediaMm(d){ return Math.round(d.media*10)===0 && d.top && d.top.length && d.top[0].mm > 0 ? '<small style="margin:0 .3em 0 0">meno di</small>0,1' : mm(d.media); }
  // lo zero vero si scrive «0 mm», come nella scheda grande (18/10/2026): prima «0,0 mm»
  function mmCella(v){ return v==null ? '–' : v===0 ? '0 mm' : num(v) + ' mm'; }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  // «Ieri» solo se e' davvero ieri: il riepilogo puo' essere di altroieri.
  function nomeGiorno(s){
    if (s === iso(giornoFa(1))) return 'Ieri';
    return GIORNI[daIso(s).getDay()] + ' ' + lungo(s);
  }
  function link(da, a){ return SITO + '/?r=' + REGS + '&da=' + da + '&a=' + a + '&s=p&' + PIN; }
  // «dal 18 al 24 settembre»: il mese una volta sola, l'apostrofo davanti a 1, 8, 11
  function dalAl(a, b){ var pa=a.split('-'), pb=b.split('-'), da=+pa[2], db=+pb[2];
    var ap=function(n){ return n===1||n===8||n===11; };
    return (ap(da)?'Dall’':'Dal ')+(pa[1]===pb[1]?da:lungo(a))+(ap(db)?' all’':' al ')+lungo(b); }

  function tasti(ultimo){
    [['t1',1],['t7',7],['t15',15],['t20',20],['t30',30],['cta7',7],['cta30',30]].forEach(function(x){
      var el = document.getElementById(x[0]); if (el) el.href = link(iso(menoDa(ultimo, x[1]-1)), ultimo);
    });
    var img = document.getElementById('lnk-img');
    if (img) img.href = link(iso(menoDa(ultimo, 19)), ultimo) + '&z=10&c=' + PIN.split('pl=')[1].split('&')[0];
  }
  tasti(iso(giornoFa(1)));

  function scriviIeri(d){
    var box = document.getElementById('verdetto');
    if (!d) { box.innerHTML = ''; return; }
    var t = nomeGiorno(d.ultimo), top = (d.top||[]).filter(function(s){ return s.mm >= 1; }), dett;
    if (top.length) {
      dett = 'Dove ha piovuto di più: ' + top.map(function(s){ return '<b>' + esc(s.n) + '</b> ' + (s.mm === 0 ? '0' : num(s.mm)) + ' mm'; }).join(', ') + '.';
    } else if (d.top && d.top.length && d.top[0].mm > 0) {
      dett = 'Giornata quasi asciutta: il massimo è stato ' + num(d.top[0].mm) + ' mm ' + (/^[aA]/.test(d.top[0].n) ? 'ad ' : 'a ') + esc(d.top[0].n) + (/\\.$/.test(d.top[0].n) ? '' : '.');   /* «T.P.» non prende un altro punto; doppia barra: sta dentro il modello (18/10/2026) */
    } else {
      dett = 'Giornata asciutta: nessun pluviometro della zona ha misurato pioggia.';
    }
    box.innerHTML = '<div class="verdetto">'
      + '<div class="si">' + (t === 'Ieri' ? 'Ieri, ' + lungo(d.ultimo) : t) + '</div>'
      + '<div class="gr">' + mediaMm(d) + ' mm<small>di media</small></div>'
      + '<div class="top">' + dett + '</div>'
      + '<div class="dett">' + (d.stazioni === 1 ? 'Un pluviometro solo della zona.' : 'Media di ' + d.stazioni + ' pluviometri della zona.') + '</div>'
      + (t === 'Ieri' ? '' : '<div class="dett">I dati di ieri non sono ancora arrivati da tutti i pluviometri: questa è l’ultima giornata intera.</div>')
      // 11/10/2026: lo stesso bottone a due righe delle pagine regione (.ieri-btn,
      // che arriva con lo stile copiato dalla pagina regione)
      + '<div class="capo-btns"><a class="ieri-btn" href="' + link(d.ultimo, d.ultimo) + '"'
      + ' onclick="try{gtag(\\'event\\',\\'apri_mappa\\',{da:\\'zona-piogge-' + ZONA + '-ieri-box\\'})}catch(e){}">'
      + '<b>' + (t === 'Ieri' ? 'Apri la mappa di ieri' : 'Mappa di quel giorno') + '</b><i>→</i>'   // «Apri la mappa di quel giorno» andava a capo gia' a 390 px (C15, 19/10/2026)
      + '<small>la pioggia in tutte le località</small></a></div>'
      // 20/10/2026, come le pagine regione (lib-numeri-regione.js): le altre funzioni della mappa, gia' puntate sulla zona
      + '<div class="mk-porte">'
      + [['☀️', 'Previsioni', '&m=prev', 'porta-previsioni'], ['📡', 'Radar', '&radar=ora', 'porta-radar'],
         ['🌲', 'Boschi', '&boschi=1', 'porta-boschi'], ['🛰', 'Satellite', '&boschi=1&sat=1', 'porta-satellite']].map(function(t){
          return '<a href="' + SITO + '/?r=' + CASA + t[2] + '&' + PIN + '" onclick="try{gtag(\\'event\\',\\'apri_mappa\\',{da:\\'zona-piogge-' + ZONA + '-' + t[3] + '\\'})}catch(e){}"><span>' + t[0] + '</span>' + t[1] + '</a>';
        }).join('') + '</div></div>';
  }

  function scriviBarre(s, ultimo){
    var el = document.getElementById('grafico');
    if (!s || !s.length) { el.innerHTML = '<p class="nota">Il grafico giorno per giorno arriva col prossimo aggiornamento.</p>'; return; }
    var n = Math.min(NG, s.length), max = 1, barre = '', ax = '';
    for (var q = 0; q < n; q++) max = Math.max(max, s[q] || 0);
    // Le etichette si danno dalla barra piu' alta in giu', saltando le vicine
    // di una gia' etichettata: cosi' la piu' alta il suo numero ce l'ha sempre.
    var cand = [], lab = {};
    for (var c = 1; c <= n; c++) if (s[c-1] != null && s[c-1] >= 1 && s[c-1] >= max*0.2) cand.push(c);
    cand.sort(function(a, b){ return s[b-1] - s[a-1]; })
      .forEach(function(c){ if (!lab[c-1] && !lab[c+1]) lab[c] = 1; });
    for (var i = n; i >= 1; i--) {
      var v = s[i-1], d = menoDa(ultimo, i-1), cl = i <= 7 ? ' dentro' : '';
      barre += '<div class="b' + cl + '" title="' + lungo(iso(d)) + ': ' + (v == null ? 'nessun dato' : num(v) + ' mm') + '">' + (lab[i] ? '<b>' + mm(v) + '</b>' : '')
        + '<i style="height:' + (v == null ? 0 : Math.max(2, Math.round(v/max*86))) + '%"></i></div>';
      ax += '<span>' + ((i === n || i === 1 || i % 5 === 0) ? (d.getDate() + '/' + (d.getMonth()+1)) : '') + '</span>';
    }
    el.innerHTML = '<div class="gg">' + barre + '</div><div class="gg-x">' + ax + '</div>'
      + '<p class="gg-leg"><i style="background:var(--blu)"></i>ultimi 7 giorni &nbsp; '
      + '<i style="background:#b9cbe2"></i>i giorni prima &nbsp;·&nbsp; media dei pluviometri della zona, in mm</p>';
  }

  function scriviPeriodo(k, d){
    var el = document.getElementById('rip' + k + '-media');
    if (!d) { el.innerHTML = '<span class="attesa">dati non disponibili al momento</span>'; return; }
    el.innerHTML = mediaMm(d) + ' mm <small>di media</small>';
    var cont = document.getElementById('rip' + k + '-top');
    if (!d.top || !d.top.length || d.top[0].mm < 1) {
      cont.innerHTML = '<p class="nota">Periodo quasi asciutto in tutta la zona.</p>';
    } else {
      var ol = document.createElement('ol'); ol.className = 'top-staz';
      d.top.forEach(function(s){ var li = document.createElement('li'); li.textContent = s.n + ' — ' + (s.mm === 0 ? '0' : num(s.mm)) + ' mm';   /* lo zero vero e' «0», come in tabella (18/10/2026) */ ol.appendChild(li); });
      cont.innerHTML = ''; cont.appendChild(ol);
    }
    document.getElementById('rip' + k + '-date').textContent = dalAl(d.primo, d.ultimo)
      + (d.giorni < +k ? ', ' + d.giorni + (d.giorni === 1 ? ' giornata di dati' : ' giornate di dati') : '') + '.';
  }

  function guasto(){
    document.getElementById('attesa').textContent = 'Non riesco a leggere l’archivio delle piogge in questo momento: riprova fra qualche minuto.';
  }
  fetch(BASE + 'riepiloghi/zone/' + ZONA + '.json')
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; })
    .then(function(j){
      if (!j || !j.periodi || !j.periodi['7']) return guasto();
      document.getElementById('attesa').style.display = 'none';
      var ultimo = (j.periodi['1'] || j.periodi['7']).ultimo;
      tasti(ultimo);
      scriviIeri(j.periodi['1']);
      scriviBarre(j.serie, j.ultimoGiorno || ultimo);   // 17/10/2026: la data di serie[0] scritta dal riepilogo
      scriviPeriodo('7', j.periodi['7']); scriviPeriodo('30', j.periodi['30']);
      var t = nomeGiorno(ultimo);
      document.getElementById('th1').textContent = t === 'Ieri' ? 'Ieri' : breve(ultimo);
      var corpo = document.getElementById('righe');
      var tr = [].slice.call(corpo.querySelectorAll('tr'));
      tr.forEach(function(r){
        var v = (j.posti || {})[r.getAttribute('data-id')] || [null, null, null];
        r.valore = v[1];
        r.querySelector('.v1').textContent = mmCella(v[0]);
        r.querySelector('.v7').textContent = mmCella(v[1]);
        r.querySelector('.v30').textContent = mmCella(v[2]);
      });
      /* Si SPOSTANO i nodi, non si rifa la tabella: i link devono restare
         quelli cotti nell HTML, che sono quelli che Google legge. */
      tr.sort(function(a, b){
        if (a.valore == null) return 1;
        if (b.valore == null) return -1;
        return b.valore - a.valore;
      }).forEach(function(r){ corpo.appendChild(r); });
    });
})();
</script>
<script>
(${meteoClient.toString()})(${JSON.stringify(casa.k)}, ${JSON.stringify(nomeReg)}, ${JSON.stringify(SITO)}, ${fs.existsSync(path.join(RADICE, casa.k, 'adesso')) ? 'true' : 'false'}, ${JSON.stringify({
  ga: 'zona-piogge-' + zslug, area: 'zona=' + zslug, riepilogo: 'riepiloghi/zone/' + zslug + '.json', media: 'media della zona',
  guasto: 'Le previsioni dei paesi', tutte: 'Mostra tutti i paesi (#)', tocca: 'Tocca un paese per vederlo ora per ora sulla mappa',
  sopra: 'I paesi ' + di + ' e dei dintorni' })});
</script>
</body>
</html>
`;
}

if (require.main === module) {
  // SOLO=garfagnana: una pagina sola, per i campioni (niente sitemap). L'elenco dei paesi si scrive sempre intero.
  const SOLO = process.env.SOLO;
  const paesi = {};
  for (const z of ZONE) if (postiDellaZona(POSTI, z).ids.length) paesi[slug(z.n)] = paesiDellaZona(z);
  fs.writeFileSync(path.join(RADICE, 'data', 'paesi-zone.json'), JSON.stringify(paesi, null, 1) + '\n', 'utf8');
  let n = 0;
  for (const z of ZONE) {
    if (!postiDellaZona(POSTI, z).ids.length) continue;
    if (SOLO && slug(z.n) !== SOLO) continue;
    scrivi(path.join(RADICE, 'zone', slug(z.n), 'index.html'), pagina(z));
    n++;
  }
  if (SOLO) { console.log(`${n} pagina scritta (SOLO=${SOLO}), sitemap non toccata.`); process.exit(0); }
  const tot = scriviSitemap(SITO, RADICE);
  console.log(`${n} pagine «dove ha piovuto» di zona scritte, sitemap.xml con ${tot} indirizzi.`);
}
