/* ── LA TESTATA DEL SITO (28/10/2026, suo: «non c'è intestazione nell'header, ma solo mappa pluviometrica, non c'è
   scritto chi siamo o altri bottoni ma solo quello iscriviti») ──
   Scelta fra tre proposte provate sulla pagina vera di Sassello, dopo aver guardato 3B Meteo, ilMeteo e Meteo.it: la
   «B», come ilMeteo. Nata sulle pagine «Meteo <paese>», poi portata su tutte le famiglie (stesso giorno, suo: «prendi
   le idee nuove che abbiamo messo in queste pagine e applicale dove è possibile»).
   - In alto la striscia scura col menu, le voci come i due bottoni della home (suo, «come in home»): Storico piogge
     (la mappa) · Previsioni meteo · Guida; a destra Chi siamo e Contatti (la home, #noi e #piede). Tolti su sua
     richiesta Radar, Pioggia caduta (doppione dello storico), Meteo dei paesi (doppione delle previsioni) e Mappa
     boschi. La voce della famiglia e' gialla (`attiva`: 'storico' le pagine piogge, 'previsioni' le pagine meteo).
   - Sotto la fascia bianca: 🌧️ Mappa Pluviometrica, «Previsioni, radar e pioggia misurata in tutta Italia · un
     progetto di Avventure Micologiche», Iscriviti.
   - LARGA COME LA PAGINA (suo: «le scritte in alto non sono simmetriche»): la colonna di main, 760 px con 16 di
     margine; nella striscia 5 px, che con gli 11 delle voci fanno i 16 della pagina.
   - Al telefono il menu sta SOTTO il nome e scorre di lato, senza ☰ da scoprire.
   - LA LENTE (pagine col cerca di meteoClient: regioni, zone, funghi, mappa forestale): meteoClient la mette nella
     fascia bianca prima di Iscriviti; toccandola la casella si apre sopra la fascia, al computer come al telefono
     (larga 728 px la fascia non ha posto per una casella fissa accanto alla frase).
   Classi tutte «t-»: le pagine meteo usano gia' .pc (la probabilita' di pioggia).
   ⚠️ `header` ha gia' display:flex, align-items:center e flex-wrap:wrap dallo stile della pagina regione: senza nowrap
   e stretch la striscia al telefono si allargava quanto le sue voci e la pagina sbordava a 741 px.
   ⚠️ TESTATA_CSS va IN FONDO al foglio di ogni pagina: deve vincere su header{} della regione e su METEO_CSS. */

const TESTATA_CSS = `
/* ── LA TESTATA (lib-testata.js, 28/10/2026) ── */
header.tB{display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:10px;padding:0;background:#fff;color:#123252;border-bottom:1px solid #d0d8e8}
/* opacity: la pagina delle fonti ha header a{opacity:.85}, che non deve arrivare qui */
.tB a{text-decoration:none;opacity:1}
/* la colonna e' quella di main della famiglia: --t-max e --t-pad (760 e 16 di partenza; funghi e mappa forestale 860 e,
   sotto i 640 px, 12: TESTATA_CSS_FUNGHI). Nella striscia il margine e' 11 px piu' stretto: le voci hanno 11 px di imbottitura */
.tB .t-in{max-width:var(--t-max,760px);margin:0 auto;width:100%;padding:0 var(--t-pad,16px);display:flex;align-items:center}
.tB .t-striscia{background:#0f2d4f}
.tB .t-striscia .t-in{gap:2px;height:38px;padding:0 calc(var(--t-pad,16px) - 11px)}
.tB .t-striscia a{color:rgba(255,255,255,.86);font-size:13.5px;font-weight:600;padding:0 11px;height:38px;display:flex;align-items:center;white-space:nowrap}
.tB .t-striscia a:hover{color:#fff;background:rgba(255,255,255,.08)}
.tB .t-striscia a.on{color:#0f2d4f;background:#f9c93e}
.tB .t-striscia .t-dx{margin-left:auto;display:flex;gap:2px}
.tB .t-banda .t-in{position:relative;gap:16px;padding-top:14px;padding-bottom:14px}
.tB .t-marchio{display:flex;align-items:center;gap:12px}
.tB .t-goccia{font-size:34px;line-height:1}
.tB .t-marchio b{display:block;font-size:24px;font-weight:800;letter-spacing:-.015em;line-height:1.1;color:#123252}
.tB .t-marchio small{display:block;font-size:13.5px;color:#4a5a6e;font-weight:500;margin-top:3px;line-height:1.3}
.tB .t-tel{display:none}
.tB .t-ytp{margin-left:auto;display:inline-flex;align-items:center;gap:8px;background:#e12b2b;color:#fff;font-size:14.5px;font-weight:700;padding:9px 16px 9px 13px;border-radius:999px;white-space:nowrap}
.tB .t-ytp svg{width:18px;height:18px;fill:#fff}
/* la lente del cerca (meteoClient): tonda, blu, accanto a Iscriviti; la casella si apre sopra la fascia */
.tB .mk-lente{display:flex;align-items:center;justify-content:center;margin-left:auto;flex:none;width:40px;height:40px;border:0;border-radius:50%;background:#1b3f6e;cursor:pointer}
.tB .mk-lente ~ .t-ytp{margin-left:0}
.tB .mk-cerca{display:none;position:absolute;left:var(--t-pad,16px);right:var(--t-pad,16px);top:50%;transform:translateY(-50%);margin:0;max-width:none;z-index:60}
.tB .mk-cerca input{border:2px solid #1b3f6e;padding:11px 12px 11px 36px}
header.tB.mk-aperto .mk-cerca{display:block}
header.tB.mk-aperto .t-marchio,header.tB.mk-aperto .t-ytp,header.tB.mk-aperto .mk-lente{visibility:hidden}
/* con la lente nella fascia mancavano 64 px al computer (la frase andava su due righe) e 14 a 393 (il nome su due):
   la frase perde «in tutta Italia», il nome al telefono scende di 2 px. Senza lente la testata resta quella approvata */
.tB .t-in:has(.mk-lente) .t-it{display:none}
@media (max-width:760px){
  .tB .t-striscia{order:2}
  .tB .t-banda .t-in{padding-top:10px;padding-bottom:10px;gap:10px}
  .tB .t-goccia{font-size:26px}
  .tB .t-marchio b{font-size:18px}
  .tB .t-marchio small{font-size:12px;margin-top:1px}
  .tB .t-pc{display:none}.tB .t-tel{display:inline}
  .tB .t-ytp{font-size:13px;padding:7px 11px 7px 9px;gap:6px}
  .tB .mk-lente{width:34px;height:34px}
  .tB .t-in:has(.mk-lente) .t-marchio b{font-size:16px}
  .tB .t-striscia .t-in{overflow-x:auto;scrollbar-width:none;padding:0 calc(var(--t-pad,16px) - 11px);-webkit-mask-image:linear-gradient(90deg,#000 86%,transparent);mask-image:linear-gradient(90deg,#000 86%,transparent)}
  .tB .t-striscia .t-in::-webkit-scrollbar{display:none}
  .tB .t-striscia .t-dx{margin-left:0;padding-right:30px}
}
/* a 360 px «Mappa Pluviometrica» andava su due righe */
@media (max-width:389px){.tB .t-marchio{gap:8px}.tB .t-goccia{font-size:23px}.tB .t-marchio b{font-size:16px;white-space:nowrap}
  .tB .t-banda .t-in{gap:8px}.tB .t-ytp{padding:7px 9px}.tB .mk-lente ~ .t-ytp span{display:none}}
`;

// le pagine funghi e la mappa forestale hanno main largo 860 px e, sotto i 640, 12 px di margine (genera-pagine-funghi.js):
// la testata segue la loro colonna, cosi' il logo parte dove parte il titolo. Va DOPO TESTATA_CSS.
const TESTATA_CSS_FUNGHI = `header.tB{--t-max:860px}@media (max-width:640px){header.tB{--t-pad:12px}}
`;

const YT_ICONA ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>';

// sito, canale; reg: la regione della pagina (le voci aprono la mappa li'), vuota = tutta Italia; ga: il prefisso degli
// eventi della pagina; attiva: 'storico' | 'previsioni' | '' (la voce gialla)
function testata({ sito, canale, reg, ga, attiva }) {
  const vai = k => ` onclick="try{gtag('event','apri_mappa',{da:'${ga}-testata-${k}'})}catch(e){}"`;
  const on = k => attiva === k ? ' class="on"' : '';
  return `<header class="tB">
  <nav class="t-striscia" aria-label="Menu"><div class="t-in">`
    + `<a${on('storico')} href="${sito}/${reg ? '?r=' + reg : ''}"${vai('storico')}>Storico piogge</a>`
    + `<a${on('previsioni')} href="${sito}/previsioni/${reg ? '?r=' + reg : ''}"${vai('previsioni')}>Previsioni meteo</a>`
    + `<a href="${sito}/guida/">Guida</a>`
    + `<span class="t-dx"><a href="https://avventuremicologiche.it/#noi">Chi siamo</a><a href="https://avventuremicologiche.it/#piede">Contatti</a></span></div></nav>
  <div class="t-banda"><div class="t-in">
    <a class="t-marchio" href="${sito}/"><span class="t-goccia">🌧️</span><span><b>Mappa Pluviometrica</b><small><span class="t-pc">Previsioni, radar e pioggia misurata<span class="t-it"> in tutta Italia</span> · un progetto di Avventure Micologiche</span><span class="t-tel">di Avventure Micologiche</span></small></span></a>
    <a class="t-ytp" href="${canale}${canale.includes('?') ? '' : '?sub_confirmation=1'}" target="_blank" rel="noopener" onclick="try{gtag('event','click_youtube',{pulsante:'${ga}'})}catch(e){}">${YT_ICONA}<span>Iscriviti</span></a>
  </div></div>
</header>
<script>(function(){var a=document.querySelector('.tB .t-striscia a.on'),f=a&&a.parentNode;if(f&&a.offsetLeft+a.offsetWidth>f.clientWidth-30)f.scrollLeft=a.offsetLeft-40;})()</script>`;
}

module.exports = { TESTATA_CSS, TESTATA_CSS_FUNGHI, testata };
