#!/usr/bin/env node
/**
 * Genera le pagine «Dove sta piovendo adesso» (/<regione>/adesso/), 18/10/2026.
 *
 * PERCHE' ESISTONO. Search Console, 90 giorni al 16/10/2026: le ricerche «dove sta
 * piovendo adesso in …» (121 modi diversi di chiederlo) hanno mostrato il sito 2.664
 * volte con 23 clic, 0,9%, intorno al decimo posto; piu' di meta' dal sud (Sicilia 717,
 * Campania 629, Puglia 320). Google mostrava le pagine regione, che rispondono a
 * un'altra domanda («Pluviometria …, ieri e 30 giorni»). Per «dove ha piovuto oggi in …»,
 * con la pagina giusta, eravamo quarti col 12,7%. Il mockup approvato da lui sta in
 * `D:\video youtube\claudio\mockup-pagina-adesso\`.
 *
 * COME SONO FATTE. Gusci statici come le pagine regione: titolo, testi, citta' e link
 * sono nell'HTML (Google li legge), le cose vive le porta `lib/pagina-adesso.js`:
 * radar LibreWXR (lo stesso del tasto «Diretta radar»), previsioni delle citta' dalla
 * funzione /api/previsioni (MET Norway), casella «Cerca una località» sull'elenco paesi.
 * Non si rigenerano coi dati: solo se cambia il modello qui sotto.
 *   node .github/scripts/genera-pagine-adesso.js
 *
 * ⚠️ REGIONI: le italiane dell'anagrafe di genera-pagine-regione.js (fuori le ESTERE)
 * PIU' L'ABRUZZO, che la pagina regione non ce l'ha (stime Open-Meteo) ma il radar e le
 * previsioni si': la sua pagina non ha il blocco «Dove ha piovuto ieri».
 * ⚠️ STILE: lo stesso delle pagine regione (STILE_BASE, STILE_NUOVO, STILE_IERI, RILIEVO), piu' il
 * pezzo di questa pagina. Se cambia lo stile delle pagine regione, si rigenera anche qui.
 * ⚠️ CONFINE: dentro la pagina, alleggerito (3 decimali + Douglas-Peucker ~150 m): il
 * file nazionale pesa 1,4 MB, la Sardegna da sola 160 KB a piena precisione.
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, GEN, navAltre, STILE_BASE, STILE_IERI, ESTERE, SITO, GA_ID, CANALE, scrivi } = require('./genera-pagine-regione.js');
const { STILE_NUOVO, RILIEVO } = require('./lib-pagina-funghi.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const RADICE = path.resolve(__dirname, '..', '..');
const VERSIONE_JS = 2;   // si alza quando cambia lib/pagina-adesso.js: il browser riprende il file nuovo

// le regioni: l'anagrafe italiana + l'Abruzzo dopo il Lazio (stesso ordine nord-sud delle altre liste)
const ABRUZZO = { k:'abruzzo', nome:'Abruzzo', prep:'in', senzaPagina:true };
const LISTA = [];
for (const r of REGIONI) {
  if (ESTERE.includes(r.k)) continue;
  LISTA.push(r);
  if (r.k === 'lazio') LISTA.push(ABRUZZO);
}
const GEN2 = Object.assign({ abruzzo:"dell'Abruzzo" }, GEN);

// il confine di ogni regione: file e pezzo del nome (lo stesso criterio di geojsonFilter in index.html)
const CONFINI = {
  trentino: ['italia-province-tn-bz-confine.geojson', 'prov_name', 'Trento'],
  altoadige: ['italia-province-tn-bz-confine.geojson', 'prov_name', 'Bolzano'],
};
const NOME_CONFINE = { valledaosta:"Valle d", friuli:'Friuli', emilia:'Emilia' };
function confineDi(r) {
  const [file, prop, val] = CONFINI[r.k] || ['italia-regioni-confine.geojson', 'reg_name', NOME_CONFINE[r.k] || r.nome];
  const g = JSON.parse(fs.readFileSync(path.join(RADICE, file), 'utf8'));
  const f = g.features.filter(x => String(x.properties[prop] || '').indexOf(val) > -1);
  if (f.length !== 1) throw new Error(`confine di ${r.k}: trovate ${f.length} forme per «${val}»`);
  return { type:'Feature', properties:{}, geometry:alleggerisci(f[0].geometry) };
}

// ── Douglas-Peucker. ⚠️ Su un anello CHIUSO primo e ultimo punto coincidono, la retta di
// riferimento degenera e sopravvivono due punti (trappola gia' pagata con la Slovenia):
// si spezza in due catene aperte al punto piu' lontano dal primo.
const TOLL = 0.0015;
function dp(pts) {
  if (pts.length < 3) return pts.slice();
  const tieni = new Uint8Array(pts.length); tieni[0] = tieni[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    let max = -1, im = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const ex = x1 + t * dx - x, ey = y1 + t * dy - y, d = ex * ex + ey * ey;
      if (d > max) { max = d; im = i; }
    }
    if (im > -1 && max > TOLL * TOLL) { tieni[im] = 1; pila.push([a, im], [im, b]); }
  }
  return pts.filter((_, i) => tieni[i]);
}
function anello(r) {
  const p = r.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])
    .filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
  if (p.length < 4) return null;
  let lontano = 0, dmax = -1;
  p.forEach((q, i) => { const d = (q[0] - p[0][0]) ** 2 + (q[1] - p[0][1]) ** 2; if (d > dmax) { dmax = d; lontano = i; } });
  const s = dp(p.slice(0, lontano + 1)).concat(dp(p.slice(lontano)).slice(1));
  return s.length >= 4 ? s : null;
}
function alleggerisci(g) {
  const poli = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out = poli.map(pl => pl.map(anello).filter(Boolean)).filter(pl => pl.length);
  return { type:'MultiPolygon', coordinates:out };
}

// le citta': i capoluoghi dell'area (lo stesso elenco della sezione Previsioni), dal piu' popoloso
const CAPOLUOGHI = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', 'capoluoghi.json'), 'utf8'));
const POP = {};
for (const riga of fs.readFileSync(path.join(RADICE, 'data', 'elenco-paesi.txt'), 'utf8').split('\n')) {
  const c = riga.split('|'); if (c.length >= 6) POP[c[0]] = Math.max(POP[c[0]] || 0, +c[5]);
}
function cittaDi(r) {
  return (CAPOLUOGHI[r.k] || []).map(c => ({ n:c.n, lat:c.lat, lon:c.lon, q:c.q == null ? null : c.q, reg:r.k }))
    .sort((a, b) => (POP[b.n] || 0) - (POP[a.n] || 0));
}

const attr = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const nomeCortoDi = r => r.nomeTitolo || r.nome;
const linkPrev = c => `${SITO}/?r=${c.reg}&amp;m=prev&amp;pl=${c.lat},${c.lon}&amp;pn=${encodeURIComponent(c.n)}`;

// lo stile di questa pagina (dal mockup approvato il 18/10)
const STILE_ADESSO = `
.rb{border:1px solid var(--bordo);border-radius:14px;overflow:hidden;background:#fff;margin:14px 0 8px;box-shadow:0 8px 20px rgba(15,45,77,.14);}
.rb-testa{display:flex;align-items:center;gap:10px;background:#0f2d4d;color:#fff;padding:10px 14px;font-size:15.5px;}
.rb-testa b{font-weight:800;letter-spacing:.3px;}
.rb-testa .quando{margin-left:auto;opacity:.9;font-size:14.5px;white-space:nowrap;}
.vivo{width:11px;height:11px;border-radius:50%;background:#ff3b30;flex:none;box-shadow:0 0 0 0 rgba(255,59,48,.7);animation:vivo 1.6s infinite;}
@keyframes vivo{0%{box-shadow:0 0 0 0 rgba(255,59,48,.7)}70%{box-shadow:0 0 0 9px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}
/* fondo = il mare di OpenStreetMap: al telefono fra due tessere resta un filo di fondo (la mappa cade a mezzo pixel) */
#mappa{height:470px;background:#aad3df;}
.rb .tasti{grid-template-columns:repeat(3,1fr);margin:0;padding:12px 12px 4px;}
.rb .tasti a{cursor:pointer;user-select:none;}
.rb-scala{padding:8px 14px 12px;}
.rb-barra{height:11px;border-radius:4px;background:linear-gradient(90deg,#00a3e0 0%,#005588 26%,#ffee00 45%,#ffaa00 63%,#ff4400 81%,#c10000 100%);}
.rb-num{display:flex;justify-content:space-between;font-size:12px;color:#6b7a8d;margin-top:3px;}
.rb-par{display:flex;justify-content:space-between;font-size:13px;color:#445;margin-top:1px;font-weight:600;}
.rb-stato{font-size:13.5px;color:#6b7a8d;padding:0 14px 12px;margin-top:-4px;}
.rb-stato.err{color:#b3261e;font-weight:600;}
.pila{display:grid;gap:18px;margin:22px 0 10px;}
.reg-lista{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;margin:10px 0 4px;padding:0;list-style:none;}
.reg-lista a{display:block;padding:7px 2px;border-bottom:1px solid var(--bordo);font-weight:600;color:var(--blu);text-decoration:none;font-size:16px;}
.reg-lista a:hover{text-decoration:underline;}
.leaflet-container{font:inherit;}
.leaflet-container .leaflet-control-attribution{font-size:11px;line-height:1.4;}
/* leaflet.css mette «plus-lighter» sulle tessere: col fondo non nero il filo fra due tessere diventa PIU' CHIARO */
#mappa .fondo img.leaflet-tile{mix-blend-mode:normal;}
.pv-cerca{position:relative;background:#fff;border:2px solid var(--blu);border-radius:14px;padding:14px 16px 12px;margin:12px 0 6px;box-shadow:0 6px 16px rgba(15,45,77,.14);}
.pv-cerca label{display:block;font-weight:800;font-size:18px;color:var(--blu-scuro);margin-bottom:8px;}
.pv-riga{display:flex;gap:10px;}
.pv-riga input{flex:1;min-width:0;font:inherit;font-size:17px;padding:11px 13px;border:1px solid #b9c7da;border-radius:10px;color:#10263f;}
.pv-riga input:focus{outline:2px solid #3f8fe8;outline-offset:0;border-color:#3f8fe8;}
.pv-riga button{font:inherit;font-size:16px;font-weight:700;color:#fff;background:var(--blu);border:none;border-radius:10px;padding:0 18px;cursor:pointer;box-shadow:0 3px 0 #0c2440;}
.pv-cerca .nota{margin:8px 0 0;font-size:13.5px;}
.pv-lista{position:absolute;left:16px;right:16px;top:100%;margin-top:-6px;z-index:900;list-style:none;padding:4px 0;background:#fff;border:1px solid #c9d6e6;border-radius:10px;box-shadow:0 12px 28px rgba(15,45,77,.25);display:none;}
.pv-lista.aperta{display:block;}
.pv-lista li{display:flex;align-items:baseline;gap:8px;padding:10px 14px;cursor:pointer;font-size:16.5px;}
.pv-lista li:hover,.pv-lista li.su{background:#eef4fd;}
.pv-lista li small{color:#6b7a8d;font-size:13.5px;margin-left:auto;white-space:nowrap;}
.pv-lista li.vuoto{color:#6b7a8d;cursor:default;}
.cit-tit{font-size:18px;color:var(--blu-scuro);margin:22px 0 2px;}
#pv-quando{margin:0 0 10px;}
/* le carte vanno a capo e l'ULTIMA RIGA SI CENTRA: in 12 regioni su 19 l'ultima riga non e' piena */
.citta{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;}
.cit{flex:0 0 calc((100% - 24px) / 3);display:flex;flex-direction:column;background:var(--grigio);border:1px solid var(--bordo);border-radius:14px;padding:12px 14px 13px;text-decoration:none;color:#334;transition:background .1s;}
.cit:hover{background:#e7eef9;}
.cit-testa{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;}
.cit-testa b{font-size:17px;color:var(--blu-scuro);line-height:1.25;}
.cit-ic{font-size:34px;line-height:1;margin-top:-2px;}
.cit-t{font-size:34px;font-weight:800;color:var(--blu-scuro);line-height:1.05;margin-top:-6px;}
.cit-t small{font-size:13.5px;font-weight:600;color:#6b7a8d;margin-left:6px;letter-spacing:0;}
.cit-cond{font-size:14px;color:#555;margin:2px 0 8px;}
.cit-gg{font-size:14px;line-height:1.55;padding-bottom:10px;}
.cit-gg b{color:var(--blu-scuro);}
.cit-gg .mmw,.cit-cond .mmw{color:#1f6fd1;font-weight:700;white-space:nowrap;margin-left:3px;}
.cit-vai{margin-top:auto;align-self:flex-start;font-size:14px;font-weight:700;color:var(--blu);background:#fff;border:1px solid #c9d6e6;border-radius:20px;padding:4px 13px;white-space:nowrap;}
@media(max-width:640px){.citta{gap:10px;} .cit{flex-basis:calc((100% - 10px) / 2);padding:11px 12px 12px;}
  .cit-t{font-size:30px;} .cit-ic{font-size:30px;} .cit-gg{font-size:13.5px;} .cit-vai{font-size:13.5px;padding:4px 11px;}
  #mappa{height:380px;} .reg-lista{grid-template-columns:repeat(2,1fr);}
  .rb-testa{font-size:14.5px;} .rb-testa .quando{font-size:13.5px;}}
`;

function titoloDi(r) {
  const n = nomeCortoDi(r);
  return [`Dove sta piovendo adesso ${r.prep} ${n}: radar pioggia in diretta`,
          `Dove sta piovendo adesso ${r.prep} ${n}: radar in diretta`,
          `Dove sta piovendo adesso ${r.prep} ${n}`].find(t => t.length <= 62);
}
function descrDi(r) {
  const n = nomeCortoDi(r);
  return [`Il radar della pioggia ${r.prep} ${n} in diretta: dove piove in questo momento, le ultime 2 ore e i prossimi 40 minuti, e le previsioni delle città.`,
          `Radar della pioggia ${r.prep} ${n} in diretta: dove piove adesso, le ultime 2 ore e i prossimi 40 minuti, con le previsioni delle città.`,
          `Radar della pioggia ${r.prep} ${n} in diretta: dove piove adesso e le previsioni delle città.`].find(t => t.length <= 158);
}

function pagina(r) {
  const citta = cittaDi(r), gen = GEN2[r.k];
  const dati = JSON.stringify({ k:r.k, sito:SITO, citta, confine:confineDi(r) }).replace(/</g, '\\u003c');
  const carte = citta.map((c, i) => `<a class="cit" data-i="${i}" href="${linkPrev(c)}"><div class="cit-testa"><b>${c.n}</b><span class="cit-ic"></span></div>`
    + `<div class="cit-t">&nbsp;</div><div class="cit-cond">&nbsp;</div><div class="cit-gg">&nbsp;<br>&nbsp;</div><span class="cit-vai">7 giorni →</span></a>`).join('\n');
  const altre = LISTA.filter(x => x.k !== r.k).map(x => `<li><a href="${SITO}/${x.k}/adesso/">${x.nome}</a></li>`).join('\n');
  const ieri = r.senzaPagina ? '' : `
<h2>Quanta pioggia è caduta</h2>
<p>Il radar dice dove piove adesso. Quanta acqua è caduta davvero lo misurano i pluviometri a terra, millimetro per millimetro: ieri, negli ultimi 7, 20 e 30 giorni.</p>
<a class="ieri-btn" href="${SITO}/${r.k}/">
  <b>Dove ha piovuto ieri ${r.prep} ${r.nome}</b><small>I millimetri di ${r.staz} pluviometri, zona per zona</small><i>→</i></a>
`;
  const radarPluvio = r.senzaPagina
    ? `<p>Il radar guarda la pioggia in quota: può vedere gocce che evaporano prima di toccare terra, o perderla dietro le montagne.</p>`
    : `<p>Il radar guarda la pioggia in quota: può vedere gocce che evaporano prima di toccare terra, o perderla dietro le montagne.
I pluviometri la misurano a terra. Per sapere quanta ne è caduta c'è la pagina <a href="${SITO}/${r.k}/">Dove ha piovuto ${r.prep} ${r.nome}</a>.</p>`;
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attr(titoloDi(r))}</title>
<meta name="description" content="${attr(descrDi(r))}">
<link rel="canonical" href="${SITO}/${r.k}/adesso/">
<meta property="og:title" content="${attr(`Dove sta piovendo adesso ${r.prep} ${r.nome}`)}">
<meta property="og:description" content="Il radar della pioggia in diretta e le previsioni delle città.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/${r.k}/adesso/">
<meta property="og:type" content="website">
<!-- Google tag: il config solo sul dominio vero, come le pagine regione -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<link rel="stylesheet" href="/lib/leaflet/1.9.4/leaflet.css">
<style>
${STILE_BASE}
${STILE_NUOVO}
${STILE_IERI}
${RILIEVO}${STILE_ADESSO}</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}-adesso'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<h1>Dove sta piovendo adesso ${r.prep} ${r.nome}</h1>
<p class="sotto"><b>Radar della pioggia in diretta</b>: le macchie colorate sono la pioggia che sta cadendo adesso. Si aggiorna da solo ogni 5 minuti.</p>

<div class="rb">
  <div class="rb-testa"><span class="vivo"></span><b>IN DIRETTA</b><span class="quando" id="quando">carico il radar…</span></div>
  <div id="mappa"></div>
  <div class="tasti">
    <a class="forte" data-id="ora">Adesso</a>
    <a data-id="due">▶ −2 ore</a>
    <a data-id="prev">+40 min</a>
  </div>
  <div class="rb-scala">
    <div class="rb-barra"></div>
    <div class="rb-num"><span>0,5</span><span>3</span><span>6</span><span>12</span><span>24</span><span>50 mm/h</span></div>
    <div class="rb-par"><span>pioviggine</span><span>pioggia forte</span></div>
  </div>
  <div class="rb-stato" id="stato">Radar europeo OPERA, risoluzione 2 km.</div>
</div>

<div class="pila">
  <a class="ieri-btn" href="${SITO}/?r=${r.k}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-adesso-mappa'})}catch(e){}">
    <b>Apri il radar sulla mappa completa</b><small>Ingrandisci, spostati, guarda le regioni vicine</small><i>→</i></a>
</div>

<h2>Previsioni meteo ${r.prep} ${r.nome}</h2>
<div class="pv-cerca">
  <label for="pv-in">☀️ Cerca una località</label>
  <div class="pv-riga"><input id="pv-in" type="search" placeholder="Paese o città" autocomplete="off" enterkeyhint="search"><button id="pv-vai" type="button">Cerca</button></div>
  <ul class="pv-lista" id="pv-lista"></ul>
  <p class="nota">Tutti i comuni d'Italia: si aprono le previsioni a 7 giorni, ora per ora.</p>
</div>

<h3 class="cit-tit">Previsioni nelle città ${gen}</h3>
<p class="nota" id="pv-quando">Previsioni del modello ECMWF via MET Norway. La pioggia che cade adesso la mostra il radar qui sopra.</p>
<div class="citta" id="citta">
${carte}
</div>
${ieri}
<h2>Dove sta piovendo adesso nelle altre regioni</h2>
<ul class="reg-lista">
${altre}
</ul>

<div class="noioso">
<h2>Come funziona il radar</h2>
<p>Il radar meteo manda un fascio di onde radio e misura quanto ne torna indietro dalle gocce: più il colore è acceso, più forte piove.
Le immagini sono quelle della rete radar europea OPERA, a 2 km di risoluzione, distribuite da LibreWXR. Un fotogramma nuovo arriva ogni 5 minuti
e la pagina lo carica da sola.</p>
<h2>Le ultime 2 ore e i prossimi 40 minuti</h2>
<p>«▶ −2 ore» fa scorrere i fotogrammi delle ultime due ore: si vede da dove arriva la pioggia e dove sta andando. «+40 min»
sposta le macchie di adesso nella direzione in cui si muovono, per i prossimi quaranta minuti. Non è una previsione del tempo, vale solo per l'ora che viene.</p>
<h2>Radar e pluviometri: perché a volte non coincidono</h2>
${radarPluvio}
<p><a href="${SITO}/guida/" onclick="try{gtag('event','click_guida',{pulsante:'pagina-${r.k}-adesso'})}catch(e){}">📖 Guida alla mappa: come si usa, tutte le funzioni</a></p>
<p style="margin:22px 0 4px;"><a href="${CANALE}" target="_blank" rel="noopener" class="yt-btn"
   onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}-adesso-fondo'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a></p>
</div>
</main>

<footer>
${navAltre('regione')}
  Radar: <a href="https://librewxr.net/" target="_blank" rel="noopener">LibreWXR</a> / EUMETNET OPERA (CC BY) ·
  Previsioni: MET Norway (CC BY 4.0) ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a><br>
  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.
</footer>

<script id="adesso-dati" type="application/json">${dati}</script>
<script src="/lib/leaflet/1.9.4/leaflet.js"></script>
<script src="/lib/pagina-adesso.js?v=${VERSIONE_JS}"></script>
</body>
</html>
`;
}

if (require.main === module) {
  const senza = LISTA.filter(r => !GEN2[r.k]).map(r => r.k);
  if (senza.length) { console.error('⚠️ manca il genitivo per: ' + senza.join(', ')); process.exit(1); }
  for (const r of LISTA) {
    const html = pagina(r);
    const nc = cittaDi(r).length;
    if (!nc) { console.error(`⚠️ ${r.k}: nessuna città in capoluoghi.json`); process.exit(1); }
    scrivi(path.join(RADICE, r.k, 'adesso', 'index.html'), html, true);
    console.log(`  /${r.k}/adesso/  ${nc} città · ${Math.round(Buffer.byteLength(html) / 1024)} KB · «${titoloDi(r)}» (${titoloDi(r).length})`);
  }
  console.log(`\n${LISTA.length} pagine scritte, sitemap.xml con ${scriviSitemap(SITO, RADICE)} indirizzi.`);
}

module.exports = { LISTA };
