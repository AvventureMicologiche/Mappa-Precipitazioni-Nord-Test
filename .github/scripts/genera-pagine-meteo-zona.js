#!/usr/bin/env node
/**
 * LE PAGINE «PREVISIONI METEO <ZONA>»: meteo/<zona>/index.html (24/10/2026, TEST su 11 zone).
 *
 * PERCHE' ESISTONO. Chi cerca «meteo Garfagnana» o «previsioni Val Brembana» trova 3B Meteo e ilMeteo, che di una
 * valle danno il capoluogo e basta. Noi i paesi della zona li chiediamo gia' uno per uno (/api/previsioni?zona=, la
 * stessa domanda del blocco «Che tempo farà» delle pagine di zona) e abbiamo i pluviometri veri: questa pagina mette
 * insieme le due cose per rispondere a una TERZA domanda, diversa da quelle delle altre due famiglie:
 *   piogge  «Dove ha piovuto in…»     /zone/<zona>/
 *   funghi  «Funghi in… oggi»          /funghi/zone/<zona>/
 *   meteo   «Previsioni meteo…»        /meteo/<zona>/          ← questa
 *
 * ⚠️ E' UN TEST, deciso dall'utente il 24/10/2026: le 10 zone piu' viste in GA4 negli ultimi 28 giorni piu' la Val
 * Brembana (il campione rifinito con lui, prove/meteo-zone/). Una sitemap loro (sitemap-meteo.xml) per misurarle in
 * Search Console dopo una decina di giorni. NON tutte le 114: l'elenco e' ZONE_METEO qui sotto.
 *
 * COSA C'E' DENTRO (tutto deciso guardando il campione, vedi prove/meteo-zone/LEGGIMI.md):
 *  - casella «Cerca il tuo paese, anche una frazione»: elenco dei comuni del sito + frazioni dal geocoder Open-Meteo;
 *    il posto scelto apre la SCHEDA QUI, sempre su OGGI con le ore, e da li' sei bottoni verso la mappa;
 *  - «Il punto di stamattina», scritto dai numeri (niente redattore);
 *  - i 7 giorni della valle, da toccare: mappa, titolo della mappa e colonna della tabella passano a quel giorno;
 *  - la mappa: OpenStreetMap + il RILIEVO del sito (TINITALY/INGV, ricetta della mappa boschi), etichette «variante F»
 *    (pillola bianca: icona del cielo SEMPRE, minima blu, massima arancio, 💧 solo se piove, nome), che non escono dalla
 *    mappa e non si sovrappongono;
 *  - paese per paese dal piu' basso al piu' alto, il grafico 30 giorni misurati + 7 previsti, ieri e 7 giorni.
 *
 * ⚠️ LE QUOTE DEI PAESI SI CUOCIONO QUI (lib-quota-paesi.js), il browser non chiede niente a Open-Meteo.
 * ⚠️ IL CODICE DEL BROWSER (clientePagina) E' SOLO ES5: la pagina lo copia con toString(), come meteoClient.
 * ⚠️ Le richieste vanno al SITO STESSO (/api/previsioni, /data/elenco-paesi.txt, /lib/leaflet); il riepilogo dei
 *    pluviometri come la pagina zona piogge (raw, o /data/ in locale).
 *
 * Dal 28/10/2026 scrive anche meteo/index.html, la pagina madre delle zone (paginaIndice), e le pagine di zona hanno il
 * percorso «Mappa pluviometrica › Previsioni meteo › <zona>».
 *
 * Uso: node .github/scripts/genera-pagine-meteo-zona.js        (SOLO=garfagnana: una pagina sola, sitemap non toccata)
 * Si lancia DOPO genera-pagine-regione.js: il foglio di stile si prende dalla pagina regione, come le zone piogge.
 */

const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { bello, slug, slugRegione, elenco, diZona, postiDellaZona, diEnte } = require('./lib-nomi.js');
const { perLink } = require('./lib-vicine.js');
const { retiDei, regioneDati } = require('./lib-posti.js');
const { quotePaesi, chiave } = require('./lib-quota-paesi.js');

const RADICE = path.join(__dirname, '..', '..');
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const SLUG_REG = {};
for (const [k, v] of Object.entries(POSTI)) SLUG_REG[k] = slugRegione(v);

const SITO = 'https://avventurepluvio-test.pages.dev';
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';
// il rilievo del sito, la stessa versione fissata che usa la mappa boschi (index.html)
const RILIEVO = 'https://cdn.jsdelivr.net/gh/AvventureMicologiche/Mappa-Precipitazioni-Tessere@e19f7b19852573d067391c5e46b62bf65473b2db/rilievo/';
const GA_ID = 'G-9R7MXXS0V4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';

// ⚠️ LE ZONE DEL TEST, IN DUE GRUPPI (24/10/2026, suo). A: le 10 zone piu' viste in GA4 (28 gg) + la Val Brembana del
// campione, sitemap-meteo.xml. B: le 20 successive per visite, aggiunte lo stesso giorno («mi sembrano belle, ancora un
// po' di zone»), con la LORO sitemap (sitemap-meteo-b.xml) per misurarle a parte in Search Console. Non aggiungerne
// altre senza aver letto i numeri dei due gruppi.
const ZONE_METEO = ['garfagnana', 'lunigiana', 'casentino', 'valsassina', 'valdarno', 'mugello', 'nebrodi',
  'val-bormida', 'colline-metallifere-grossetane', 'val-d-aveto', 'val-brembana'];
const ZONE_METEO_B = ['valle-po', 'valle-di-viu', 'colline-livornesi', 'val-trebbia', 'sila-greca', 'alpi-apuane',
  'val-trompia', 'cilento', 'colline-metallifere', 'val-di-taro', 'val-di-vara', 'valle-germanasca', 'monti-reatini',
  'val-loana', 'monti-lattari', 'val-di-non', 'media-valle-del-serchio', 'monti-sibillini', 'valtiberina', 'valdinievole'];
const ZONE_METEO_TUTTE = ZONE_METEO.concat(ZONE_METEO_B);

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function scrivi(dest, testo) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, testo.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
}
const agenziaDi = k => { const r = REGIONI.find(x => x.k === k); return r ? (r.agenziaCorta || r.agenzia.replace(/\s*\(.*\)$/, '')) : null; };

/* Il link «Previsioni meteo <Zona> →» dentro il blocco «Che tempo farà» delle pagine zona piogge e zona funghi
   (genera-pagine-zona-piogge.js e genera-pagine-zona.js lo chiedono qui, cosi' l'elenco resta uno solo). Serve a dire
   a Google quale delle tre pagine della zona e' quella delle previsioni. Vuoto per le zone fuori dal test. */
function linkMeteo(zslug, nome, ga) {
  if (!ZONE_METEO_TUTTE.includes(zslug)) return '';
  return `<p class="mk-meteo-zona" style="margin:12px 0 2px;font-size:16px;font-weight:700"><a href="${SITO}/meteo/${zslug}/"`
    + ` onclick="try{gtag('event','apri_meteo_zona',{da:'${ga}'})}catch(e){}">Previsioni meteo ${esc(nome)} →</a></p>`;
}

const CSS = `
.bric{font-size:14px;color:#666;margin-bottom:6px;}
.bric a{color:var(--blu);}
/* ── pagina «Previsioni meteo <zona>» (campione 24/10/2026, prove/meteo-zone/) ── */
.pz-cerca{position:relative;margin:14px 0 4px}
.pz-cerca input{width:100%;box-sizing:border-box;font-size:16px;padding:12px 14px 12px 40px;border:2px solid #1a5fa8;border-radius:12px;outline:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%231a5fa8' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5 21 21'/%3E%3C/svg%3E") no-repeat 13px center}
.pz-drop{display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid #c9d5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:1000;overflow:hidden}
.pz-drop.on{display:block}
.pz-drop .r{padding:10px 14px;cursor:pointer;border-bottom:1px solid #eef2f6;display:flex;justify-content:space-between;gap:10px}
.pz-drop .r:hover,.pz-drop .r.sel{background:#eef5fb}
.pz-drop .r small{color:#7a8796}
.pz-drop .t{padding:10px 14px;color:#5a6b7d;font-size:14px}
.pz-punto{background:#eef5fb;border-left:4px solid #1a5fa8;border-radius:8px;padding:12px 14px;margin:14px 0 6px;font-size:15.5px;line-height:1.5}
.pz-punto b{color:#0f3d6e}
.pz-punto .pz-quando{display:block;font-size:12px;color:#5a6b7d;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.pz-giorni{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:10px 0 4px}
.pz-g{background:#fff;border:1px solid #d8e2ec;border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer;font:inherit;color:inherit;transition:transform .1s}
.pz-g:hover{border-color:#1a5fa8}
.pz-g.sel{background:#1a5fa8;border-color:#1a5fa8;color:#fff}
.pz-g.sel .t .mn,.pz-g.sel .t .mx,.pz-g.sel .p,.pz-g.sel .n{color:#fff}
.pz-g .n{font-size:12px;font-weight:700;color:#333;text-transform:capitalize}
.pz-g .ic{font-size:26px;line-height:1.3}
.pz-g .t{font-size:13px}.pz-g .t .mn{color:#1a5fa8}.pz-g .t .mx{color:#c4501a;font-weight:700}
.pz-g .p{font-size:13px;font-weight:700;color:#1a5fa8;margin-top:4px;min-height:17px}
.pz-g .p.zero{opacity:.6;font-weight:400}
/* LA % DI PIOGGIA (25/10/2026): la GOCCIA come weather.com e Google (sua scelta), e i millimetri scritti «mm». Tre toni
   come la mappa del sito: sotto il 10% grigia, dal 60% rossa. Nei giorni e' la piu' alta fra i paesi della zona */
.pz-g .pc{font-size:12.5px;font-weight:700;color:#1a5fa8;margin-top:2px;min-height:16px}
.pz-g .pc.z,.pz-scheda .giorni .pc.z,table.pz-tab td .pc.z{color:#9aa3ad;font-weight:500}
.pz-g .pc.alta,.pz-scheda .giorni .pc.alta,table.pz-tab td .pc.alta,.pz-et .pp.alta{color:#c21f1f}
.pz-g.sel .pc,.pz-g.sel .pc.z,.pz-g.sel .pc.alta{color:#fff}
.pz-g .barra{height:4px;background:#e3edf7;border-radius:2px;margin:4px 6px 0;overflow:hidden}
.pz-g .barra i{display:block;height:100%;background:#1a5fa8}
.pz-g.sel .barra{background:rgba(255,255,255,.3)}.pz-g.sel .barra i{background:#fff}
.pz-tot{font-size:14px;color:#333;margin:6px 0 0}
.pz-mappa-testa{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.pz-mappa-testa .dove{font-weight:700;color:#0f3d6e}
#pz-mappa{height:460px;border-radius:12px;border:1px solid #c9d5e1;margin:8px 0 4px;z-index:1}
.pz-pt{position:relative}
/* ⚠️ L'ETICHETTA STA SUL PAESE (24/10/2026 sera, suo, dopo tre prove bocciate con puntino + etichetta spostata + lineetta:
   «niente di quello che mi hai proposto funziona, guarda come fanno gli altri»). Come la mappa di 3B Meteo: il
   riquadro e' CENTRATO sul punto del paese, niente puntino a parte, niente lineette; se due si toccherebbero non se ne
   sposta nessuna, si NASCONDE il paese meno importante, e ingrandendo la mappa ricompare. */
.pz-et{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;cursor:pointer;text-align:center;line-height:1.12;background:rgba(255,255,255,.95);border-radius:8px;padding:2px 7px 3px;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.pz-et .r1{display:block;font-size:12px;font-weight:800}
.pz-et .ic{font-size:16px;vertical-align:-3px;margin-right:2px}
.pz-et .mn{color:#1a5fa8}.pz-et .mx{color:#c4501a}
.pz-et .gc{color:#1a5fa8;margin-left:4px}.pz-et .gc.bagnato{background:#1a5fa8;color:#fff;border-radius:999px;padding:0 5px}
.pz-et .pp{color:#1a5fa8;margin-left:4px}
.pz-et .nm{display:block;font-size:11px;font-weight:700;color:#1f2d3a}
.pz-et.via{display:none}
@media (max-width:600px){.pz-et{padding:1px 5px 2px}.pz-et .r1{font-size:11px}.pz-et .ic{font-size:14px}.pz-et .nm{font-size:10px}}
.pz-zoom{color:#1a5fa8;font-weight:700}
.pz-scorri{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0}
table.pz-tab{border-collapse:collapse;min-width:640px;width:100%;font-size:13px}
table.pz-tab th,table.pz-tab td{padding:6px 4px;border-bottom:1px solid #e6ecf2;text-align:center;white-space:nowrap}
table.pz-tab th:first-child,table.pz-tab td:first-child{text-align:left;position:sticky;left:0;background:#fff;padding-right:10px}
table.pz-tab tbody tr{cursor:pointer}table.pz-tab tbody tr:hover td{background:#f4f8fc}
table.pz-tab td:first-child{color:#1a5fa8;font-weight:700;text-decoration:underline;text-decoration-color:#bcd2e8}
table.pz-tab .col-sel{background:#eef5fb}
table.pz-tab th.col-sel{color:#1a5fa8}
table.pz-tab td .q{display:block;font-size:11px;color:#7a8796;font-weight:400;text-decoration:none}
table.pz-tab td .ic{font-size:17px}
table.pz-tab td .mn{color:#1a5fa8}table.pz-tab td .mx{color:#c4501a;font-weight:700}
table.pz-tab td .mm{display:block;font-size:11.5px;color:#1a5fa8;font-weight:700;min-height:14px}
table.pz-tab td .pc{display:block;font-size:11.5px;color:#1a5fa8;font-weight:700}
.pz-scheda{display:none;border:2px solid #1a5fa8;border-radius:14px;padding:12px 14px;margin:14px 0;background:#fff;scroll-margin-top:12px}
.pz-scheda.on{display:block}
.pz-scheda .testa{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.pz-scheda h3{margin:0;font-size:19px;color:#0f3d6e}
.pz-scheda .sub{font-size:12.5px;color:#5a6b7d;margin-top:2px}
.pz-scheda .chiudi{border:0;background:#eef2f6;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;flex:none}
.pz-scheda .giorni{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(66px,1fr);gap:6px;overflow-x:auto;margin:10px 0 6px;padding-bottom:4px}
.pz-scheda .giorni button{border:1px solid #d8e2ec;background:#fff;border-radius:10px;padding:6px 4px;font:inherit;font-size:12.5px;cursor:pointer;text-align:center}
.pz-scheda .giorni button.sel{background:#1a5fa8;color:#fff;border-color:#1a5fa8}
.pz-scheda .giorni b{display:block;text-transform:capitalize}
.pz-scheda .giorni .pc{display:block;font-weight:700;color:#1a5fa8}.pz-scheda .giorni button.sel .pc{color:#fff}
.pz-ore{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(54px,1fr);gap:4px;overflow-x:auto;padding:6px 0 8px}
.pz-ora{text-align:center;border-radius:8px;padding:5px 2px;background:#f6f9fc;font-size:12px}
/* «pomeriggio» a 13 px vuole 72 px e al telefono la casella ne dava 55-71: tagliato in «pomeriggi» (25/10/2026) */
.pz-ore.fasce{grid-auto-columns:minmax(70px,1fr)}
.pz-ore.fasce .pz-ora{padding:8px 2px;font-size:13px}.pz-ore.fasce .pz-ora .ic{font-size:26px}.pz-ore.fasce .pz-ora .h b{display:block;color:#0f3d6e;font-size:12px;letter-spacing:-.2px}
.pz-ora .h{color:#5a6b7d}.pz-ora .ic{font-size:20px}.pz-ora .t{font-weight:700}
.pz-ora .mm{color:#1a5fa8;font-weight:700;min-height:15px}.pz-ora .v{color:#7a8796;font-size:11px}
/* la % di pioggia, ora per ora: gli stessi tre toni della mappa (sotto il 10% grigia, dal 60% rossa) */
.pz-ora .pc{font-size:11.5px;font-weight:700;color:#1a5fa8;min-height:15px}.pz-ora .pc.z{color:#9aa3ad;font-weight:500}.pz-ora .pc.alta{color:#c21f1f}
.pz-porte{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.pz-porte a{display:block;text-align:center;border:1px solid #c9d5e1;border-radius:10px;padding:8px 4px;text-decoration:none;color:#0f3d6e;font-size:12.5px;font-weight:700}
.pz-porte a span{display:block;font-size:20px}
.pz-graf{display:flex;align-items:flex-end;gap:2px;height:130px;margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #c9d5e1}
.pz-graf .b{flex:1;background:#1a5fa8;border-radius:2px 2px 0 0;min-height:2px;cursor:pointer}
.pz-graf .b:hover,.pz-graf .b.sel{background:#c4501a}
.pz-graf .b.prev{background:repeating-linear-gradient(45deg,#7fb0e0,#7fb0e0 3px,#b9d4ef 3px,#b9d4ef 6px)}
.pz-graf .b.prev.sel,.pz-graf .b.prev:hover{background:#c4501a}
.pz-graf-info{font-size:14px;min-height:20px;color:#0f3d6e;margin-top:6px}
.pz-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#4a5866;margin-top:4px}
.pz-leg i{display:inline-block;width:12px;height:10px;margin-right:5px;vertical-align:-1px;border-radius:2px}
.pz-radar{display:block;background:#1a5fa8;color:#fff!important;text-decoration:none;border-radius:12px;padding:14px 16px;margin:18px 0;font-weight:700}
.pz-radar small{display:block;font-weight:400;opacity:.9;margin-top:2px}
.pz-vai{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.pz-vai a{display:block;border:1px solid #c9d5e1;border-radius:10px;padding:12px;text-decoration:none;color:#0f3d6e;font-weight:700;background:#fff}
.pz-vai a small{display:block;font-weight:400;color:#5a6b7d;margin-top:3px}
@media (max-width:600px){.pz-giorni{gap:4px}.pz-g{padding:6px 2px}.pz-g .ic{font-size:22px}.pz-g .t,.pz-g .p{font-size:12px}.pz-vai{grid-template-columns:1fr}#pz-mappa{height:480px}
  /* al telefono la casella del giorno e' larga ~48 px: «5,8 mm» andava a capo (25/10/2026), e sotto adesso c'e' la % */
  .pz-g .p,.pz-g .pc{font-size:11.5px;letter-spacing:-.3px;white-space:nowrap}}
@media (max-width:380px){.pz-g .p,.pz-g .pc{font-size:11px}}
`;

/* ⚠️ GIRA NEL BROWSER: la pagina la copia con toString() e la chiama con la sua configurazione (C).
   SOLO ES5: niente frecce, let, const, backtick. E' il codice del campione (prove/meteo-zone/costruisci.js) con la
   sola variante F delle etichette, senza interruttore pioggia/temperature e con le richieste al sito stesso. */
function clientePagina(C) {
  var SITO = C.sito, REG = C.reg;
  var API = '/api/previsioni';
  var BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/data/' : C.raw;
  var RIP = BASE + 'riepiloghi/zone/' + C.slug + '.json';
  var QUOTE = C.quote, PLUV = C.pluv;
  var GS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'], GL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var ICONE = [[/clearsky_day|fair_day/, '☀️'], [/clearsky_night|fair_night/, '🌙'], [/partlycloudy_day/, '⛅'], [/partlycloudy_night|^cloudy|fog/, '☁️'],
               [/thunder/, '⛈️'], [/heavyrain|heavysleet/, '🌧️'], [/rain|sleet|drizzle/, '🌦️'], [/snow/, '🌨️']];
  function icona(s) { for (var i = 0; i < ICONE.length; i++) if (ICONE[i][0].test(s || '')) return ICONE[i][1]; return '☁️'; }
  function iso(ms) { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); }
  function piu(s, n) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n, 12)).toISOString().slice(0, 10); }
  var OGGI = iso(Date.now()), DOMANI = piu(OGGI, 1), IERI = piu(OGGI, -1);
  function d(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function nome(s, lungo) { var x = d(s); return s === OGGI ? 'oggi' : s === DOMANI ? 'domani' : s === IERI ? 'ieri' : (lungo ? GL : GS)[x.getDay()] + ' ' + x.getDate(); }
  function maiusc(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function mm(n) { return n === 0 ? '0' : n < 10 ? num(n) : String(Math.round(n)); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  // la % di pioggia: la goccia e i tre toni (vedi .pz-g .pc nello stile)
  function tonoPc(p) { return p == null ? '' : p < 10 ? ' z' : p >= 60 ? ' alta' : ''; }
  function pcTesto(p) { return p == null ? '' : '💧 ' + p + '%'; }
  function finoAl(p) { return (/^(8|11$|1$)/.test(String(p)) ? "fino all'" : 'fino al ') + p + '%'; }
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function $(id) { return document.getElementById(id); }
  function ga(azione) { try { gtag('event', 'meteo_zona', { zona: C.slug, azione: azione }); } catch (e) {} }
  var J = null, G = [], RIPJ = null, SEL = OGGI, mappa = null, strato = null, PAESI = [];

  /* ── i 7 giorni della valle ── */
  function giorniDi() {
    var per = {};
    PAESI.forEach(function (c) { c.giorni.forEach(function (g) { if (g.g < OGGI) return; (per[g.g] = per[g.g] || []).push({ c: c, g: g }); }); });
    return Object.keys(per).sort().slice(0, 7).map(function (k) {
      var l = per[k], conti = {}, top = null, mmS = 0, mmMax = 0, dove = '';
      l.forEach(function (x) { var i = icona(x.g.s); conti[i] = (conti[i] || 0) + 1; mmS += x.g.mm; if (x.g.mm > mmMax) { mmMax = x.g.mm; dove = x.c.n; } });
      Object.keys(conti).forEach(function (i) { if (!top || conti[i] > conti[top]) top = i; });
      var mn = Math.min.apply(null, l.map(function (x) { return x.g.mn; })), mx = Math.max.apply(null, l.map(function (x) { return x.g.mx; }));
      // la % del giorno nella zona = la piu' alta fra i paesi, e dove
      var pc = null, dpc = '';
      l.forEach(function (x) { if (x.g.pc != null && (pc == null || x.g.pc > pc)) { pc = x.g.pc; dpc = x.c.n; } });
      return { g: k, ic: top, mn: mn, mx: mx, dmn: l.filter(function (x) { return x.g.mn === mn; })[0].c.n, dmx: l.filter(function (x) { return x.g.mx === mx; })[0].c.n, mm: mmS / l.length, mmMax: mmMax, dove: dove, pc: pc, dpc: dpc };
    });
  }
  function disegnaGiorni() {
    var maxMm = Math.max(5, Math.max.apply(null, G.map(function (x) { return x.mm; })));
    var conPc = G.some(function (x) { return x.pc != null; });
    $('giorni').innerHTML = G.map(function (x) {
      return '<button class="pz-g' + (x.g === SEL ? ' sel' : '') + '" data-g="' + x.g + '"><div class="n">' + nome(x.g) + '</div><div class="ic">' + x.ic + '</div>'
        + '<div class="t"><span class="mn">' + x.mn + '°</span> / <span class="mx">' + x.mx + '°</span></div>'
        + '<div class="p' + (x.mm < 0.1 ? ' zero' : '') + '">' + (x.mm < 0.1 ? 'asciutto' : mm(x.mm) + ' mm') + '</div>'
        + (conPc ? '<div class="pc' + tonoPc(x.pc) + '"' + (x.pc != null ? ' title="probabilità di pioggia, la più alta fra i paesi: ' + esc(x.dpc) + '"' : '') + '>' + pcTesto(x.pc) + '</div>' : '')
        + '<div class="barra"><i style="width:' + Math.min(100, x.mm / maxMm * 100) + '%"></i></div></button>';
    }).join('');
  }
  function totale() {
    var tot = G.reduce(function (a, x) { return a + x.mm; }, 0), picco = G.slice().sort(function (a, b) { return b.mmMax - a.mmMax; })[0];
    $('tot').innerHTML = tot < 0.5 ? 'Nei prossimi 7 giorni <b>non è prevista pioggia</b> che conti ' + C.inValle + '.'
      : 'In tutta la settimana sono previsti in media <b>' + mm(tot) + ' mm</b>; il giorno più bagnato è <b>' + nome(picco.g, true) + '</b>, fino a ' + mm(picco.mmMax) + ' mm a ' + esc(picco.dove) + '.';
    return tot;
  }
  function sceglie(g) {
    SEL = g; disegnaGiorni(); disegnaMappa(); disegnaTab();
    var x = G.filter(function (y) { return y.g === g; })[0];
    $('mappa-giorno').textContent = 'La ' + C.valle + ' ' + (g === OGGI ? 'oggi' : g === DOMANI ? 'domani' : nome(g, true)) + (x ? ': ' + (x.mm < 0.1 ? 'asciutto' : mm(x.mm) + ' mm in media') : '');
  }

  /* ── la mappa della valle ── */
  function disegnaMappa() {
    if (!window.L || !J) return;
    if (!mappa) {
      // ⚠️ AL TELEFONO UN DITO FA SCORRERE LA PAGINA, NON LA MAPPA (24/10/2026, suo «la mappa si sposta se scrolli col
      // dito: fissala»): sugli schermi touch niente trascinamento a un dito; restano il pizzico a due dita (che sposta
      // anche), i bottoni + e − e i tocchi sui paesi. Si guarda il PUNTATORE, non la larghezza, come il tasto «La mia
      // posizione» della mappa: un computer con la finestra stretta resta col mouse.
      var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      mappa = L.map('pz-mappa', { scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.25, dragging: !touch });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '© OpenStreetMap' }).addTo(mappa);
      /* il RILIEVO del sito (tessere TINITALY 1.1, INGV, CC BY 4.0): stessa ricetta della mappa boschi, pane sotto le
         tessere e tessere in «multiply». Qui si puo': sotto non c'e' la pioggia colorata (la regola del 24/9) */
      mappa.createPane('rilievo'); mappa.getPane('rilievo').style.zIndex = 190; mappa.getPane('tilePane').style.mixBlendMode = 'multiply';
      L.tileLayer(C.rilievo + '{z}/{x}/{y}.png', { pane: 'rilievo', minZoom: 5, maxNativeZoom: 13, maxZoom: 15, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        attribution: 'rilievo: TINITALY 1.1, INGV (CC BY 4.0)' }).addTo(mappa);
      // le lineette in un pannello SOTTO le etichette: ogni marcatore ha il suo livello, e una lineetta lunga passava
      // sopra la pillola di un altro paese (24/10/2026, Garfagnana al telefono)
      mappa.createPane('linee'); mappa.getPane('linee').style.zIndex = 590;
      // il margine e' mezza etichetta per lato: le etichette stanno CENTRATE sul paese, e un paese sul bordo ne avrebbe meta' fuori (e sparirebbe)
      mappa.fitBounds(L.latLngBounds(PAESI.map(function (c) { return [c.lat, c.lon]; })), { padding: innerWidth <= 600 ? [58, 26] : [80, 34], maxZoom: 12 });
      mappa.on('zoomend', sistemaEtichette);
      // ⚠️ NIENTE PALLINI DEI PLUVIOMETRI su questa mappa (24/10/2026, suo «sì toglili»): la mappa dice solo «che tempo
      // farà nei paesi», e i puntini verdi della pioggia misurata confondevano. I pluviometri stanno nel blocco della
      // pioggia caduta (nomi cliccabili) e nella pagina piogge della zona.
    }
    if (strato) mappa.removeLayer(strato);
    strato = L.layerGroup().addTo(mappa);
    PAESI.forEach(function (c, n) {
      var g = c.giorni.filter(function (x) { return x.g === SEL; })[0]; if (!g) return;
      // icona del cielo e temperature SEMPRE (suo, 24/10), i millimetri solo se piove; sotto il nome.
      // ⚠️ DAL 25/10 LA GOCCIA E' LA %, NON I MILLIMETRI (sua scelta, come weather.com): «💧40%» dal 10% in su (sotto
      // e' rumore, e ogni pezzo in piu' allarga la pillola e nasconde un paese), poi «0,8 mm» col suo nome
      var r1 = '<span class="r1"><span class="ic">' + icona(g.s) + '</span><span class="mn">' + g.mn + '°</span> <span class="mx">' + g.mx + '°</span>'
        + (g.pc != null && g.pc >= 10 ? '<span class="pp' + tonoPc(g.pc) + '" title="probabilità di pioggia">💧' + g.pc + '%</span>' : '')
        + (g.mm >= 0.1 ? '<span class="gc' + (g.mm >= 1 ? ' bagnato' : '') + '" title="' + mm(g.mm) + ' mm di pioggia">' + mm(g.mm) + ' mm</span>' : '') + '</span>';
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="pz-pt"><span class="pz-et" data-n="' + n + '">' + r1 + '<span class="nm">' + esc(c.n) + '</span></span></div>', iconSize: [0, 0] }), zIndexOffset: 1000 - n })
        .addTo(strato).on('click', function () { apri(posto(c), 'mappa'); });
    });
    sistemaEtichette();
  }
  /* DIRADARE, NON SPOSTARE (24/10/2026 sera, vedi lo stile .pz-et). Le etichette si passano in ordine di importanza
     (l'ordine dell'elenco dei paesi della zona: prima i comuni dei pluviometri e i piu' grandi); ognuna resta centrata
     sul suo paese se non tocca quelle gia' tenute e sta dentro la mappa, se no si nasconde. Ingrandendo ricompaiono:
     si rifa' a ogni zoom. Sotto la mappa si dice quanti paesi sono nascosti. */
  function sistemaEtichette() {
    var bordo = $('pz-mappa').getBoundingClientRect(), messi = [], nascosti = 0;
    var E = [].slice.call(document.querySelectorAll('#pz-mappa .pz-et'));
    E.forEach(function (l) { l.classList.remove('via'); });
    E.sort(function (a, b) { return a.getAttribute('data-n') - b.getAttribute('data-n'); }).forEach(function (l) {
      var r = l.getBoundingClientRect();
      var fuori = r.left < bordo.left + 2 || r.right > bordo.right - 2 || r.top < bordo.top + 2 || r.bottom > bordo.bottom - 18;
      var tocca = messi.some(function (m) { return !(r.right + 3 < m.left || r.left - 3 > m.right || r.bottom + 3 < m.top || r.top - 3 > m.bottom); });
      if (fuori || tocca) { l.classList.add('via'); nascosti++; } else messi.push(r);
    });
    var nota = $('mappa-nota');
    if (nota) nota.innerHTML = 'Tocca un paese per vederlo ora per ora. 💧 è la probabilità di pioggia, scritta dal 10% in su.' + (nascosti ? ' <span class="pz-zoom">Ingrandisci la mappa (+) per vedere '
      + (nascosti === 1 ? "l'altro paese" : 'gli altri ' + nascosti + ' paesi') + '.</span>' : '');
  }

  /* ── la tabella paese per paese ── */
  function disegnaTab() {
    if (!J) return;
    var date = G.map(function (x) { return x.g; });
    var righe = PAESI.slice().sort(function (a, b) { return (QUOTE[a.n] || 0) - (QUOTE[b.n] || 0); });
    var conPc = G.some(function (x) { return x.pc != null; });
    $('tab').innerHTML = '<thead><tr><th>Paese</th>' + date.map(function (g) { return '<th class="' + (g === SEL ? 'col-sel' : '') + '">' + nome(g) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + righe.map(function (c) {
        var per = {}; c.giorni.forEach(function (g) { per[g.g] = g; });
        return '<tr data-n="' + esc(c.n) + '"><td>' + esc(c.n) + '<span class="q">~ ' + (QUOTE[c.n] != null ? QUOTE[c.n].toLocaleString('it-IT') : '–') + ' m</span></td>'
          + date.map(function (g) { var x = per[g], k = g === SEL ? ' class="col-sel"' : ''; if (!x) return '<td' + k + '>–</td>';
              return '<td' + k + '><span class="ic">' + icona(x.s) + '</span><br><span class="mn">' + x.mn + '°</span>/<span class="mx">' + x.mx + '°</span><span class="mm">' + (x.mm >= 0.1 ? mm(x.mm) + ' mm' : '') + '</span>'
                + (conPc ? '<span class="pc' + tonoPc(x.pc) + '">' + pcTesto(x.pc) + '</span>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  /* ── la scheda del posto: 7 giorni e ore ── */
  var SCHEDA = null, AVVIO = false;
  function posto(c) { return { n: c.n, lat: c.lat, lon: c.lon, quota: QUOTE[c.n], reg: c.r || REG }; }
  function FASCIA(h) { return h < 6 ? 'notte' : h < 12 ? 'mattina' : h < 18 ? 'pomeriggio' : 'sera'; }
  function porte(x) {
    var pl = '&pl=' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4) + '&pn=' + encodeURIComponent(x.n);
    return [['☀️', 'Vai alla mappa', '/?r=' + x.reg + '&m=prev' + pl, 'previsioni'], ['💧', 'Pioggia caduta', '/?r=' + x.reg + '&g=7' + pl, 'pioggia'], ['📡', 'Radar adesso', '/?r=' + x.reg + '&radar=ora' + pl, 'radar'],
            ['🌡', 'Temperature', '/?r=' + x.reg + '&g=1&tq=1' + pl, 'temperature'], ['🌲', 'Boschi', '/?r=' + x.reg + '&boschi=1' + pl, 'boschi'], ['🛰', 'Satellite', '/?r=' + x.reg + '&boschi=1&sat=1' + pl, 'satellite']]
      .map(function (p) { return '<a href="' + SITO + p[2] + '" onclick="try{gtag(\'event\',\'apri_mappa\',{da:\'meteo-' + C.slug + '-scheda-' + p[3] + '\'})}catch(e){}"><span>' + p[0] + '</span>' + p[1] + '</a>'; }).join('');
  }
  function disegnaScheda(g) {
    var s = SCHEDA, j = s.j;
    var giorni = (j.giorni || []).filter(function (x) { return x.g >= OGGI; }).slice(0, 7);
    if (!giorni.some(function (x) { return x.g === g; })) g = giorni[0] && giorni[0].g;
    var ora = +new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }) % 24;
    var ore = (j.ore || []).filter(function (o) { return o.g === g && (o.g !== OGGI || o.h >= ora || o.h6); });
    var q = s.x.quota != null ? s.x.quota : (j.q != null ? Math.round(j.q) : null);
    var conPc = ore.some(function (o) { return o.pc != null; });
    $('scheda').innerHTML = '<div class="testa"><div><h3>' + esc(s.x.n) + '</h3><div class="sub">' + (q != null ? '~ ' + q + ' m · ' : '') + 'previsioni ora per ora' + (conPc ? ' · 💧 probabilità di pioggia' : '') + (AVVIO ? ' · tocca un altro paese o cercalo per cambiarlo' : '') + '</div></div><button class="chiudi" aria-label="Chiudi">×</button></div>'
      + '<div class="giorni">' + giorni.map(function (x) { return '<button data-g="' + x.g + '" class="' + (x.g === g ? 'sel' : '') + '"><b>' + nome(x.g) + '</b>' + icona(x.s) + ' ' + x.mn + '°/' + x.mx + '°<br>' + (x.mm >= 0.1 ? mm(x.mm) + ' mm' : '–') + (x.pc != null ? '<span class="pc' + tonoPc(x.pc) + '">' + pcTesto(x.pc) + '</span>' : '') + '</button>'; }).join('') + '</div>'
      // fasce anche se la prima casella e' un'ora sola: MET da' le 00 locali come ora e poi le fasce di 6 (25/10/2026)
      + (ore.length ? '<div class="pz-ore' + (ore.some(function (o) { return o.h6; }) ? ' fasce' : '') + '">' + ore.map(function (o) {
          return '<div class="pz-ora"><div class="h">' + (o.h6 ? '<b>' + FASCIA(o.h) + '</b>' + o.h + '-' + ((o.h + 6) % 24) : String(o.h).padStart(2, '0') + ':00') + '</div><div class="ic">' + icona(o.s) + '</div><div class="t">' + Math.round(o.t) + '°</div>'
            + '<div class="mm">' + (o.mm >= 0.1 ? mm(o.mm) + ' mm' : '') + '</div>'
            // la % ora per ora (25/10/2026): la % del giorno da sola non basta per programmare un'uscita («ti da 100% per
            // la pioggia della sera ma devi programmare di giorno», suo). Nelle fasce di 6 ore e' la piu' alta (maxProb)
            + (conPc ? '<div class="pc' + tonoPc(o.pc) + '">' + pcTesto(o.pc) + '</div>' : '')
            + '<div class="v">' + (o.v != null ? Math.round(o.v * 3.6) + ' km/h' : '') + '</div></div>'; }).join('') + '</div>'
        : '<p class="nota">Ore non disponibili per questo giorno.</p>')
      + '<div class="pz-porte">' + porte(s.x) + '</div>';
  }
  // da === 'avvio': la scheda che si apre DA SOLA sul paese principale (24/10/2026, suo: «se non clicchi un paese il
  // report orario non si vede»): niente scorrimento della pagina e niente evento GA, non e' un gesto di chi legge
  function apri(x, da) {
    var sc = $('scheda'); sc.classList.add('on'); AVVIO = da === 'avvio';
    sc.innerHTML = '<p class="nota">Sto leggendo le previsioni di ' + esc(x.n) + '…</p>';
    if (!AVVIO) { sc.scrollIntoView({ behavior: 'smooth', block: 'start' }); ga('scheda-' + da); }
    fetch(API + '?lat=' + (+x.lat).toFixed(3) + '&lon=' + (+x.lon).toFixed(3) + (x.quota != null ? '&q=' + x.quota : ''))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { SCHEDA = { x: x, j: j }; disegnaScheda(OGGI); })   // sempre su OGGI, con le ore (suo, 24/10)
      .catch(function () { sc.innerHTML = '<div class="testa"><p class="nota">Previsioni di ' + esc(x.n) + ' non disponibili ora, riprova fra poco.</p><button class="chiudi" aria-label="Chiudi">×</button></div>'; });
  }
  $('scheda').addEventListener('click', function (e) {
    if (e.target.closest('.chiudi')) { $('scheda').classList.remove('on'); return; }
    var b = e.target.closest('.giorni button'); if (b && SCHEDA) disegnaScheda(b.getAttribute('data-g'));
  });

  /* ── la casella: elenco dei comuni del sito + frazioni dal geocoder ── */
  var ELENCO = null, ARRIVO = null;
  function carica() {
    if (ELENCO) return Promise.resolve(ELENCO);
    if (!ARRIVO) ARRIVO = fetch('/data/elenco-paesi.txt').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
      ELENCO = t.split('\n').map(function (r) { var p = r.split('|'); return p.length < 6 ? null : { n: p[0], lat: +p[1], lon: +p[2], sg: p[3], reg: p[4], pop: +p[5] || 0, qn: norm(p[0]) }; }).filter(Boolean);
      return ELENCO;
    }).catch(function (e) { ARRIVO = null; throw e; });
    return ARRIVO;
  }
  function frazioni(t) {
    return fetch('/api/cerca?name=' + encodeURIComponent(t) + '&count=8&language=it&countryCode=IT').then(function (r) { return r.json(); })   // GeoNames dal sito, non piu' Open-Meteo (25/10/2026)
      .then(function (j) { return (j.results || []).map(function (x) { return { n: x.name, lat: x.latitude, lon: x.longitude, quota: x.elevation != null ? Math.round(x.elevation) : null, reg: REG, fraz: 'frazione · ' + (x.admin2 || x.admin1 || '').replace(/^Provincia (di )?/, ''), qn: norm(x.name) }; }); });
  }
  var righe = [], sel = -1, giro = 0;
  function mostra(t) {
    var qq = norm(t), drop = $('drop'); sel = -1; if (qq.length < 2) { drop.classList.remove('on'); return; }
    righe = (ELENCO || []).filter(function (x) { var i = x.qn.indexOf(qq); return i === 0 || (i > 0 && x.qn.charAt(i - 1) === ' '); })
      .sort(function (a, b) { return (b.reg === REG) - (a.reg === REG) || b.pop - a.pop; }).slice(0, 6);
    var mio = ++giro;
    function disegna() { drop.innerHTML = righe.length ? righe.map(function (x, i) { return '<div class="r" data-i="' + i + '"><span>' + esc(x.n) + '</span><small>' + esc(x.fraz || (x.sg + ' · ' + x.reg)) + '</small></div>'; }).join('') : '<div class="t">Cerco anche fra le frazioni…</div>'; drop.classList.add('on'); }
    disegna();
    if (righe.length < 6 && qq.length >= 3) setTimeout(function () {
      if (mio !== giro) return;
      frazioni(t.trim()).then(function (f) { if (mio !== giro) return; var visti = {}; righe.forEach(function (x) { visti[x.qn] = 1; });
        righe = righe.concat(f.filter(function (x) { return !visti[x.qn]; })).slice(0, 7); if (righe.length) disegna(); else drop.innerHTML = '<div class="t">Nessun posto con questo nome</div>'; })
        .catch(function () { if (mio === giro && !righe.length) drop.innerHTML = '<div class="t">Le frazioni non rispondono: prova con il nome del comune</div>'; });
    }, 350);
  }
  function scegli(x) { $('cerca').value = x.n; $('drop').classList.remove('on'); apri(x, 'cerca'); }
  $('cerca').addEventListener('focus', function () { carica().catch(function () {}); });
  $('cerca').addEventListener('input', function () { var v = this.value; carica().catch(function () {}).then(function () { mostra(v); }); });
  $('cerca').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (righe.length) scegli(righe[sel >= 0 ? sel : 0]); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var rs = $('drop').querySelectorAll('.r'); if (!rs.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rs.length) % rs.length; for (var i = 0; i < rs.length; i++) rs[i].classList.toggle('sel', i === sel); }
  });
  $('drop').addEventListener('click', function (e) { var r = e.target.closest('.r'); if (r) scegli(righe[+r.getAttribute('data-i')]); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.pz-cerca')) $('drop').classList.remove('on'); });

  /* ── il grafico, la pioggia caduta, il punto ── */
  var BARRE = [];
  function disegnaGraf() {
    var serie = RIPJ && RIPJ.serie ? RIPJ.serie.slice(0, 30).reverse() : [];
    var ultimo = RIPJ ? (RIPJ.ultimoGiorno || (RIPJ.periodi && RIPJ.periodi['1'] ? RIPJ.periodi['1'].ultimo : IERI)) : IERI;
    BARRE = serie.map(function (v, i) { return { g: piu(ultimo, i - serie.length + 1), mm: v, prev: false }; })
      .concat(G.map(function (x) { return { g: x.g, mm: x.mm, prev: true, mx: x.mmMax, dove: x.dove, pc: x.pc }; }));
    var mx = Math.max(5, Math.max.apply(null, BARRE.map(function (b) { return b.mm || 0; })));
    $('graf').innerHTML = BARRE.map(function (b, i) { return '<div class="b' + (b.prev ? ' prev' : '') + '" data-i="' + i + '" style="height:' + ((b.mm || 0) / mx * 100) + '%"></div>'; }).join('');
    if (BARRE.length) $('leg-date').textContent = 'dal ' + d(BARRE[0].g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' a ' + nome(BARRE[BARRE.length - 1].g, true);
  }
  $('graf').addEventListener('click', function (e) {
    var el = e.target.closest('.b'); if (!el) return;
    var b = BARRE[+el.getAttribute('data-i')], tutte = $('graf').querySelectorAll('.b');
    for (var i = 0; i < tutte.length; i++) tutte[i].classList.toggle('sel', tutte[i] === el);
    var giorno = d(b.g).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('graf-info').innerHTML = b.prev ? '<b>' + giorno + '</b>: previsti in media <b>' + mm(b.mm) + ' mm</b>' + (b.mx >= 0.1 ? ', fino a ' + mm(b.mx) + ' a ' + esc(b.dove) : '')
        + (b.pc != null ? '; probabilità di pioggia ' + finoAl(b.pc) : '')
      : '<b>' + giorno + '</b>: ' + (b.mm == null ? 'nessun dato dai pluviometri' : 'misurati in media <b>' + mm(b.mm) + ' mm</b> dai pluviometri ' + C.diValle);
    if (b.prev) sceglie(b.g);
  });
  function disegnaCaduta() {
    var link = {}; PLUV.forEach(function (p) { link[p.n] = p.url; });
    [['1', 'r1'], ['7', 'r7']].forEach(function (p) {
      var x = RIPJ && RIPJ.periodi ? RIPJ.periodi[p[0]] : null;
      if (!x) { $(p[1]).textContent = '–'; return; }
      $(p[1]).innerHTML = mm(x.media) + ' <small>mm di media</small>';
      $(p[1] + 't').innerHTML = (x.top || []).slice(0, 3).map(function (t) { return '<div class="nota" style="margin:2px 0">' + (link[t.n] ? '<a href="' + link[t.n] + '">' + esc(t.n) + '</a>' : esc(t.n)) + ': <b>' + mm(t.mm) + ' mm</b></div>'; }).join('');
    });
    if (RIPJ && RIPJ.periodi && RIPJ.periodi['1'] && RIPJ.periodi['1'].ultimo !== IERI) $('r1h').textContent = maiusc(nome(RIPJ.periodi['1'].ultimo, true));
  }
  function punto(tot) {
    var p = [];
    var i = RIPJ && RIPJ.periodi ? RIPJ.periodi['1'] : null, s = RIPJ && RIPJ.periodi ? RIPJ.periodi['7'] : null;
    if (i && s) {
      p.push((i.ultimo === IERI ? 'Ieri' : maiusc(nome(i.ultimo, true))) + ' ' + C.dove + ' ' + (i.media < 0.1 ? '<b>non è piovuto</b>'
        : 'sono caduti in media <b>' + mm(i.media) + ' mm</b>' + (i.top && i.top[0] ? ' (' + esc(i.top[0].n) + ' ' + mm(i.top[0].mm) + ')' : '')) + '; negli ultimi 7 giorni <b>' + mm(s.media) + ' mm</b>.');
    }
    var picco = G.slice().sort(function (a, b) { return b.mmMax - a.mmMax; })[0];
    p.push(tot < 0.5 ? 'Nei prossimi 7 giorni <b>non è prevista pioggia</b>.' : 'Nei prossimi 7 giorni sono previsti in media <b>' + mm(tot) + ' mm</b>, soprattutto ' + nome(picco.g, true) + '.');
    // la % piu' alta della settimana, e dove (25/10/2026)
    var rischio = G.filter(function (x) { return x.pc != null; }).sort(function (a, b) { return b.pc - a.pc; })[0];
    if (rischio) p.push(rischio.pc < 30 ? 'La probabilità di pioggia resta <b>sotto il 30%</b> per tutta la settimana.'
      : 'La probabilità di pioggia più alta è ' + nome(rischio.g, true) + ', <b>' + rischio.pc + '%</b> a ' + esc(rischio.dpc) + '.');
    var fr = G.slice().sort(function (a, b) { return a.mn - b.mn; })[0], cal = G.slice().sort(function (a, b) { return b.mx - a.mx; })[0];
    p.push('La notte più fredda è ' + nome(fr.g, true) + ', con <b>' + fr.mn + '°</b> a ' + esc(fr.dmn) + '; il giorno più caldo ' + nome(cal.g, true) + ', <b>' + cal.mx + '°</b> a ' + esc(cal.dmx) + '.');
    $('punto').innerHTML = '<span class="pz-quando">Il punto di stamattina</span>' + p.join(' ');
  }

  /* ── i comandi ── */
  $('giorni').addEventListener('click', function (e) { var b = e.target.closest('.pz-g'); if (b) { sceglie(b.getAttribute('data-g')); ga('giorno'); } });
  $('tab').addEventListener('click', function (e) {
    var tr = e.target.closest('tbody tr'); if (!tr || !J) return;
    var c = PAESI.filter(function (x) { return x.n === tr.getAttribute('data-n'); })[0];
    if (c) apri(posto(c), 'tabella');
  });

  function guasto() { $('punto').innerHTML = '<span class="pz-quando">Il punto di stamattina</span>Le previsioni dei paesi non rispondono in questo momento: riprova fra qualche minuto, o <a href="' + SITO + '/?r=' + REG + '&m=prev">guardale sulla mappa</a>.'; }
  Promise.all([fetch(API + '?zona=' + C.slug + '&pr=1').then(function (r) { return r.json(); }),
               fetch(RIP).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]).then(function (x) {
    J = x[0]; RIPJ = x[1];
    PAESI = (J && J.capoluoghi || []).filter(function (c) { return c.giorni && c.giorni.length; });
    G = PAESI.length ? giorniDi() : [];
    disegnaCaduta();
    if (!G.length) { guasto(); return; }
    var tot = totale(); disegnaGraf(); punto(tot); sceglie(G[0].g);
    apri(posto(PAESI[0]), 'avvio');   // le ore si vedono subito, sul primo paese dell'elenco (il principale della zona)
  }).catch(function () { guasto(); disegnaCaduta(); });
}

function pagina(z, QUOTE_DI) {
  const zslug = slug(z.n);
  const paesi = require(path.join(RADICE, 'data', 'paesi-zone.json'))[zslug];
  if (!paesi || !paesi.length) throw new Error('nessun paese per ' + zslug + ' in data/paesi-zone.json');
  const { ids, regDi } = postiDellaZona(POSTI, z);
  const anag = id => POSTI[regDi[id]].find(p => String(p[0]) === String(id));
  const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regDi[ids[0]]);
  const nomeReg = casa.nomeTitolo || casa.nome;
  // l'ente delle reti (ottavo campo dei posti, retiDei): Bagnone sta in Toscana ma il pluviometro e' di OMIRL
  const agenzie = [...new Set(retiDei(ids.map(id => [regDi[id], anag(id)])).map(agenziaDi).filter(Boolean))];
  const ENTE = diEnte(elenco(agenzie));
  const NOME = z.n, DOVE = z.dove, DI = diZona(z.dove);
  const VALLE = z.t === 'valle' ? 'valle' : 'zona';
  const REGS = perLink(casa.k, z.lat, z.lon);
  const PIN = 'pl=' + z.lat + ',' + z.lon + '&amp;pn=' + encodeURIComponent(z.n) + '&amp;pz=1';
  const quote = {};
  for (const p of paesi) quote[p.n] = QUOTE_DI[chiave(p.lat, p.lon)];
  const pluv = ids.map(anag).filter(Boolean).sort((a, b) => bello(a[1]).localeCompare(bello(b[1]), 'it')).map(p => {
    const k = regDi[p[0]];
    // l'indirizzo della pagina del pluviometro: lo stesso della tabella della zona piogge (slugRegione)
    return { id: String(p[0]), n: bello(p[1]), url: `${SITO}/funghi/${k}/${SLUG_REG[k][p[0]]}/`, q: p[3], lat: +p[4], lon: +p[5], ente: agenziaDi(regioneDati(k, p)) || '' };
  });
  const haFunghi = fs.existsSync(path.join(RADICE, 'funghi', 'zone', zslug, 'index.html'));

  const TITOLO = `Previsioni meteo ${NOME}: che tempo farà nei prossimi 7 giorni, paese per paese`;
  const DESCR = `Previsioni meteo ${DI} per i prossimi 7 giorni: pioggia prevista, minime e massime in ${paesi.length} paesi ${VALLE === 'valle' ? 'della valle' : 'della zona'}, ognuno alla sua quota, ora per ora. E quanta pioggia è già caduta nei pluviometri ${ENTE}.`;

  const modello = path.join(RADICE, casa.k, 'index.html');
  if (!fs.existsSync(modello)) { console.error('⚠️ manca ' + modello + ': lancia prima genera-pagine-regione.js'); process.exit(1); }
  const m = fs.readFileSync(modello, 'utf8');
  // il foglio della pagina regione SENZA il blocco del meteo, come le zone piogge (quelle regole sono per la sua testata)
  let STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));
  const iMeteo = STILE.indexOf('/* ── IL METEO NELLE PAGINE REGIONE');
  if (iMeteo >= 0) STILE = STILE.slice(0, iMeteo);

  const C = { sito: SITO, raw: RAW, slug: zslug, reg: casa.k, dove: DOVE, valle: VALLE, inValle: VALLE === 'valle' ? 'in valle' : 'nella zona',
    diValle: 'della ' + VALLE, rilievo: RILIEVO, quote, pluv };
  const vai = (href, testo, sotto, k) => `<a href="${href}" onclick="try{gtag('event','apri_mappa',{da:'meteo-${zslug}-${k}'})}catch(e){}">${testo}<small>${sotto}</small></a>`;

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/meteo/${zslug}/">
<meta property="og:title" content="${esc('Previsioni meteo ' + NOME + ': i prossimi 7 giorni, paese per paese')}">
<meta property="og:description" content="${esc(DESCR)}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/meteo/${zslug}/">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], ['Previsioni meteo', `${SITO}/meteo/`], [NOME, null]])}
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
<style>${STILE}${CSS}</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'meteo-${zslug}'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › <a href="${SITO}/meteo/">Previsioni meteo</a> › ${esc(NOME)}</p>
<h1>Previsioni meteo ${esc(NOME)}</h1>
<p class="sotto"><b>Che tempo farà ${esc(DOVE)} nei prossimi 7 giorni</b>: pioggia, minime e massime in ${paesi.length} paesi ${VALLE === 'valle' ? 'della valle' : 'della zona'}, ognuno alla sua quota, e quanta pioggia è già caduta nei pluviometri ${esc(ENTE)}.</p>

<div class="pz-cerca"><input id="cerca" type="search" autocomplete="off" placeholder="Cerca il tuo paese, anche una frazione" aria-label="Cerca un paese o una frazione"><div class="pz-drop" id="drop"></div></div>
<section class="pz-scheda" id="scheda" aria-live="polite"></section>

<div class="pz-punto" id="punto"><span class="pz-quando">Il punto di stamattina</span>Sto leggendo previsioni e pluviometri…</div>

<h2>I prossimi 7 giorni ${esc(DOVE)}</h2>
<p class="nota" style="margin-top:0">Tocca un giorno: la mappa e la tabella qui sotto passano a quel giorno. 💧 è la probabilità di pioggia, la più alta fra i paesi.</p>
<div class="pz-giorni" id="giorni"></div>
<p class="pz-tot" id="tot"></p>

<div class="pz-mappa-testa"><span class="dove" id="mappa-giorno"></span></div>
<div id="pz-mappa"></div>
<p class="nota" id="mappa-nota" style="margin-top:2px">Tocca un paese per vederlo ora per ora.</p>

<h2>Paese per paese</h2>
<p class="nota" style="margin-top:0">Dal più in basso al più in alto (quota del terreno, ~). Tocca un paese per le ore; scorri di lato per tutti i giorni. 💧 è la probabilità di pioggia.</p>
<div class="pz-scorri"><table class="pz-tab" id="tab"></table></div>

<h2>La pioggia caduta e quella in arrivo</h2>
<p class="nota" style="margin-top:0">Gli ultimi 30 giorni misurati dai pluviometri ${esc(ENTE)} (media ${VALLE === 'valle' ? 'della valle' : 'della zona'}) e i 7 giorni previsti. Tocca una barra.</p>
<div class="pz-graf" id="graf"></div>
<div class="pz-graf-info" id="graf-info"></div>
<div class="pz-leg"><span><i style="background:#1a5fa8"></i>misurata</span><span><i style="background:repeating-linear-gradient(45deg,#7fb0e0,#7fb0e0 3px,#b9d4ef 3px,#b9d4ef 6px)"></i>prevista</span><span id="leg-date"></span></div>
<div class="griglia" style="margin-top:14px">
  <div class="card"><h3 id="r1h">Ieri</h3><div class="numerone" id="r1">…</div><div id="r1t"></div></div>
  <div class="card"><h3>Ultimi 7 giorni</h3><div class="numerone" id="r7">…</div><div id="r7t"></div></div>
</div>

<a class="pz-radar" href="${SITO}/${casa.k}/adesso/" onclick="try{gtag('event','apri_mappa',{da:'meteo-${zslug}-radar'})}catch(e){}">📡 Sta piovendo adesso ${esc(DOVE)}?<small>Guarda il radar delle piogge in diretta</small></a>

<h2>Le altre pagine ${esc(DI)}</h2>
<div class="pz-vai">
  ${vai(`${SITO}/zone/${zslug}/`, `💧 Quanto ha piovuto ${esc(DOVE)}`, 'Ieri, 7 e 30 giorni, pluviometro per pluviometro', 'zona-piogge')}
  ${haFunghi ? vai(`${SITO}/funghi/zone/${zslug}/`, `🍄 Funghi ${esc(DOVE)}`, 'La pioggia che conta, da 13 a 20 giorni fa', 'zona-funghi') : ''}
  ${vai(`${SITO}/?r=${REGS}&amp;g=7&amp;${PIN}`, '🗺 La mappa della pioggia', `${esc(articolo(DI))} sulla mappa pluviometrica`, 'mappa')}
  ${vai(`${SITO}/?r=${casa.k}&amp;m=prev&amp;${PIN}`, '☀️ Le previsioni sulla mappa', `Tocca un paese qualsiasi ${VALLE === 'valle' ? 'della valle' : 'della zona'}`, 'previsioni')}
</div>

<h2>Come funziona questa pagina</h2>
<p>Le previsioni sono quelle del modello ECMWF, distribuite da MET Norway (CC BY 4.0), chieste per ognuno dei ${paesi.length} paesi e aggiornate più volte al giorno; la probabilità di pioggia (💧) è di Open-Meteo (CC BY 4.0). La pioggia caduta è misurata dai pluviometri ${esc(ENTE)}: non è una stima. Le due cose stanno separate anche nel grafico, perché una è un dato e l'altra una previsione.</p>
</main>

<footer>
  Previsioni: MET Norway (ECMWF) · Probabilità di pioggia: Open-Meteo · Pioggia misurata: ${esc(elenco(agenzie))} ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="${SITO}/guida/">guida alla mappa</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a>
</footer>

<script src="/lib/leaflet/1.9.4/leaflet.js"></script>
<script>
(${clientePagina.toString()})(${JSON.stringify(C)});
</script>
</body>
</html>
`;
}
/* LA PAGINA MADRE meteo/index.html (28/10/2026, suo «sì, fase A»). Le 31 zone non avevano un indice: Google le trovava
   solo dalla sitemap e dai link sparsi nelle pagine di zona. Qui le zone per regione e il bottone verso /previsioni/, la
   mappa aperta sulle previsioni. Niente previsioni dentro la pagina: 31 posti in una richiesta sono piu' di quelli
   provati col tetto di Cloudflare (21), e il tempo lo da' ogni pagina di zona. */
function paginaIndice(zone) {
  const tutti = require(path.join(RADICE, 'data', 'paesi-zone.json'));
  const perReg = {};
  for (const z of zone) {
    const { ids, regDi } = postiDellaZona(POSTI, z);
    const casa = REGIONI.find(x => x.k === z.reg) || REGIONI.find(x => x.k === regDi[ids[0]]);
    (perReg[casa.k] = perReg[casa.k] || { casa, zone: [] }).zone.push(z);
  }
  const nomeDi = c => c.nomeTitolo || c.nome;
  const gruppi = Object.values(perReg).sort((a, b) => nomeDi(a.casa).localeCompare(nomeDi(b.casa), 'it'));
  const TITOLO = `Previsioni meteo per zona: ${zone.length} valli e zone d'Italia, paese per paese`;
  const DESCR = `Che tempo farà nei prossimi 7 giorni in ${zone.length} zone d'Italia, dalla Garfagnana alla Val Brembana, ai Nebrodi: in ogni zona pioggia, minime e massime paese per paese, ognuno alla sua quota.`;
  const m = fs.readFileSync(path.join(RADICE, 'toscana', 'index.html'), 'utf8');
  let STILE = m.slice(m.indexOf('<style>') + 7, m.indexOf('</style>'));
  const iMeteo = STILE.indexOf('/* ── IL METEO NELLE PAGINE REGIONE');
  if (iMeteo >= 0) STILE = STILE.slice(0, iMeteo);
  const scheda = z => {
    const s = slug(z.n), n = (tutti[s] || []).length;
    return `<a href="${SITO}/meteo/${s}/" onclick="try{gtag('event','apri_meteo_zona',{da:'meteo-indice'})}catch(e){}">Previsioni meteo ${esc(z.n)}<small>${n} paesi ${z.t === 'valle' ? 'della valle' : 'della zona'}, ognuno alla sua quota</small></a>`;
  };
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITOLO)}</title>
<meta name="description" content="${esc(DESCR)}">
<link rel="canonical" href="${SITO}/meteo/">
<meta property="og:title" content="${esc(TITOLO)}">
<meta property="og:description" content="${esc(DESCR)}">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/meteo/">
<meta property="og:type" content="website">
${briciolaJson([['Mappa pluviometrica', `${SITO}/`], ['Previsioni meteo', null]])}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<style>${STILE}${CSS}</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'meteo-indice'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<p class="bric"><a href="${SITO}/">Mappa pluviometrica</a> › Previsioni meteo</p>
<h1>Previsioni meteo per zona</h1>
<p class="sotto"><b>Che tempo farà nei prossimi 7 giorni</b> in ${zone.length} valli e zone d'Italia, dalle Alpi all'Appennino e alla Sicilia: in ogni zona pioggia, minime e massime paese per paese, ognuno alla sua quota, e la pioggia già caduta nei pluviometri.</p>

<a class="pz-radar" href="${SITO}/previsioni/" onclick="try{gtag('event','apri_mappa',{da:'meteo-indice-previsioni'})}catch(e){}">☀️ Le previsioni su tutta Italia, sulla mappa<small>Tocca una città o una regione, o cerca il tuo paese: il tempo ora per ora</small></a>

${gruppi.map(g => `<h2 id="${g.casa.k}">${esc(nomeDi(g.casa))}</h2>
<div class="pz-vai">
  ${g.zone.sort((a, b) => a.n.localeCompare(b.n, 'it')).map(scheda).join('\n  ')}
</div>`).join('\n\n')}

<h2>Come funzionano queste pagine</h2>
<p>Ogni zona ha i suoi paesi, chiesti uno per uno alla loro quota: in valle e in cresta il tempo non è lo stesso. Le previsioni sono quelle del modello ECMWF, distribuite da MET Norway (CC BY 4.0), aggiornate più volte al giorno; la probabilità di pioggia è di Open-Meteo (CC BY 4.0). La pioggia caduta è misurata dai pluviometri delle agenzie regionali: non è una stima.</p>
</main>

<footer>
  Previsioni: MET Norway (ECMWF) · Probabilità di pioggia: Open-Meteo ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="${SITO}/guida/">guida alla mappa</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a>
</footer>
</body>
</html>
`;
}

// «della Val Brembana» → «La Val Brembana», «del Casentino» → «Il Casentino», «dei Nebrodi» → «I Nebrodi»
function articolo(di) {
  const m = di.match(/^(dell'|della |delle |degli |dei |del )(.*)$/);
  if (!m) return di;
  return { "dell'": "L'", 'della ': 'La ', 'delle ': 'Le ', 'degli ': 'Gli ', 'dei ': 'I ', 'del ': 'Il ' }[m[1]] + m[2];
}

module.exports = { ZONE_METEO, ZONE_METEO_B, linkMeteo };

if (require.main === module) {
  (async () => {
    const SOLO = process.env.SOLO;
    const tutti = require(path.join(RADICE, 'data', 'paesi-zone.json'));
    const zone = ZONE_METEO_TUTTE.filter(s => !SOLO || s === SOLO).map(s => {
      const z = ZONE.find(x => slug(x.n) === s);
      if (!z) throw new Error('zona sconosciuta: ' + s);
      return z;
    });
    const punti = [].concat(...zone.map(z => tutti[slug(z.n)] || []));
    const QUOTE_DI = await quotePaesi(punti);
    for (const z of zone) {
      scrivi(path.join(RADICE, 'meteo', slug(z.n), 'index.html'), pagina(z, QUOTE_DI));
      console.log('  meteo/' + slug(z.n) + '/');
    }
    if (SOLO) { console.log(`1 pagina scritta (SOLO=${SOLO}), sitemap non toccata.`); return; }
    scrivi(path.join(RADICE, 'meteo', 'index.html'), paginaIndice(zone));
    console.log('  meteo/ (la pagina madre)');
    const { scriviSitemap } = require('./genera-sitemap.js');
    const tot = scriviSitemap(SITO, RADICE);
    console.log(`${zone.length} pagine «Previsioni meteo» scritte, sitemap.xml con ${tot} indirizzi.`);
  })().catch(e => { console.error(e); process.exit(1); });
}
