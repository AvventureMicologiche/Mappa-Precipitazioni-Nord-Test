#!/usr/bin/env node
/**
 * Le pagine «MAPPA FORESTALE» (27/9/2026): /mappa-forestale/ (la generale, fatta
 * come un geoportale delle carte forestali), /mappa-forestale/<regione>/ (21) e
 * /mappa-forestale/zone/<zona>/ (114).
 *
 * PERCHE' ESISTONO. Sua idea del 27/9: la mappa dei boschi e' completa su tutta
 * Italia, ma viveva solo dentro la mappa, dove Google non la vede. La gente cerca
 * «mappa forestale <regione>», «carta forestale <regione>», «tipi forestali»,
 * «mappa castagneti <regione>» (suggerimenti di Google, tutti per regione) e oggi
 * trova i geoportali regionali, uno per regione e con le sigle. Queste pagine
 * sono «il contrario» delle pagine funghi: i boschi in primo piano, la pioggia in
 * fondo e breve. Obiettivo: stare subito sotto i geoportali.
 *
 * ⚠️ I NUMERI NON SI CALCOLANO QUI. Vogliono la cache delle carte e le tessere,
 * che stanno solo sul banco di lavoro: li prepara
 * `audit-boschi/dati-mappa-forestale.py` in `mappa-forestale-dati.json`, qui
 * accanto. Le IMMAGINI (uno scorcio ravvicinato per pagina, con la nuvoletta
 * aperta) le fa `grafiche-social/scatta-forestale-tutti.js` e stanno accanto
 * alle pagine: `mappa-forestale/<...>/scorcio.jpg`.
 *
 * DECISIONI SUE (mockup approvati il 27/9, non ridecidere):
 *  - «altri boschi» SEMPRE in fondo alle barre, anche se pesa tanto;
 *  - l'immagine e' uno SCORCIO su una valle, mai la regione intera (sgranata,
 *    rilievo perso): chi vuole vedere il resto apre la mappa;
 *  - castagne: «assicurati che il bosco sia libero: molti castagneti sono
 *    proprieta' private»;
 *  - «A chi serve»: funghi, castagne, foliage, escursioni, mirtilli, tartufi;
 *  - pioggia in fondo, TASTI SOPRA l'immagine: 20 giorni grande, poi ieri, 7, 10,
 *    15, 30 giorni e il radar; niente frase sui 13-20 giorni;
 *  - nelle zone «I paesi intorno alla valle» in ordine di quota (le zone sono
 *    fatte coi pluviometri, e qualche paese sta nella valle accanto).
 *
 *   node .github/scripts/genera-mappa-forestale.js
 */
const fs = require('fs');
const path = require('path');
const { REGIONI, briciolaJson } = require('./genera-pagine-regione.js');
const { slug } = require('./lib-nomi.js');
const { scriviSitemap } = require('./genera-sitemap.js');

const SITO = 'https://avventurepluvio-test.netlify.app';
const RADICE = path.join(__dirname, '..', '..');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'mappa-forestale-dati.json'), 'utf8'));
const IND = JSON.parse(fs.readFileSync(path.join(RADICE, 'tessere-boschi', 'italia', 'indice.json'), 'utf8'));
const COL = Object.fromEntries(IND.gruppi);
const CANALE = 'https://www.youtube.com/@avventuremicologiche';
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime/';

// Il foglio di stile e' quello delle pagine funghi di zona (lo aveva il mockup approvato)
const modello = fs.readFileSync(path.join(RADICE, 'funghi', 'zone', 'garfagnana', 'index.html'), 'utf8');
const STILE = modello.slice(modello.indexOf('<style>') + 7, modello.indexOf('</style>'));
const STILE_MF = `
.cta{display:block;text-align:center;background:var(--blu);color:#fff !important;text-decoration:none;font-weight:700;font-size:18px;border-radius:12px;padding:15px 14px;margin:16px 0 10px;}
.img-f{width:100%;height:auto;border-radius:10px;border:1px solid var(--bordo);display:block;margin:6px 0 4px;}
.numeri{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;}
.numeri div{background:#f4f6fa;border:1px solid var(--bordo);border-radius:10px;padding:10px;text-align:center;font-size:13.5px;color:#5b6878;}
.numeri b{display:block;font-size:24px;color:var(--blu);}
.fr{margin:11px 0;} .fr-t{display:flex;align-items:center;gap:8px;font-size:16px;}
.fr-sw{display:inline-block;width:13px;height:13px;border-radius:3px;opacity:.8;flex:none;vertical-align:-2px;margin-right:4px;}
.fr-v{margin-left:auto;font-weight:800;color:var(--blu);}
.fr-b{height:9px;background:#eef2f7;border-radius:5px;margin:5px 0 3px;overflow:hidden;} .fr-b i{display:block;height:100%;opacity:.8;border-radius:5px;}
.fr-s{font-size:13.5px;color:#5b6878;}
ul.dove,ul.usi,ul.paesi{list-style:none;padding:0;margin:10px 0;}
ul.dove li{margin:0 0 12px;line-height:1.6;font-size:15.5px;}
ul.usi li{display:flex;gap:12px;margin:0 0 14px;line-height:1.55;font-size:15.5px;} ul.usi .ic{font-size:22px;line-height:1.2;flex:none;}
ul.paesi li{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--bordo);font-size:15.5px;line-height:1.5;}
ul.paesi .quota{flex:none;width:64px;text-align:right;font-weight:800;color:var(--blu);}
.pc{color:#6b7a8d;font-size:13.5px;}
.fonte{background:#f4f6fa;border:1px solid var(--bordo);border-radius:10px;padding:12px 14px;font-size:15px;}
.schede{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin:12px 0;}
.scheda{border:1px solid var(--bordo);border-radius:10px;padding:11px 12px;background:#fff;font-size:14px;line-height:1.5;}
.sc-t{display:flex;justify-content:space-between;align-items:center;font-size:16.5px;}
.sc-m{font-size:13px;background:#eef4ea;border-radius:7px;padding:2px 8px;text-decoration:none;color:#2d6a30 !important;font-weight:600;}
.sc-c{color:#1f2937;margin-top:3px;} .sc-l{color:#6b7a8d;font-size:13px;} .sc-p{margin-top:5px;font-size:13px;color:#33404f;}
.griglia{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;} .griglia a{position:relative;display:block;}
.griglia img{width:100%;height:auto;border-radius:8px;border:1px solid var(--bordo);display:block;}
.griglia span{position:absolute;left:8px;bottom:8px;background:rgba(15,45,77,.85);color:#fff;font-size:13px;font-weight:700;border-radius:6px;padding:2px 8px;}
.pioggia{border-top:1px solid var(--bordo);margin-top:26px;padding-top:6px;}
`;

// ── le 21 regioni e province, nell'ordine da nord a sud ─────────────────────
const REG = [
  ['valledaosta', "Valle d'Aosta", "della Valle d'Aosta", "in Valle d'Aosta"], ['piemonte', 'Piemonte', 'del Piemonte', 'in Piemonte'],
  ['lombardia', 'Lombardia', 'della Lombardia', 'in Lombardia'], ['liguria', 'Liguria', 'della Liguria', 'in Liguria'],
  ['trentino', 'Trentino', 'del Trentino', 'in Trentino'], ['altoadige', 'Alto Adige', "dell'Alto Adige", 'in Alto Adige'],
  ['veneto', 'Veneto', 'del Veneto', 'in Veneto'], ['friuli', 'Friuli Venezia Giulia', 'del Friuli Venezia Giulia', 'in Friuli Venezia Giulia'],
  ['emilia', 'Emilia-Romagna', "dell'Emilia-Romagna", 'in Emilia-Romagna'], ['toscana', 'Toscana', 'della Toscana', 'in Toscana'],
  ['umbria', 'Umbria', "dell'Umbria", 'in Umbria'], ['marche', 'Marche', 'delle Marche', 'nelle Marche'],
  ['lazio', 'Lazio', 'del Lazio', 'nel Lazio'], ['abruzzo', 'Abruzzo', "dell'Abruzzo", 'in Abruzzo'],
  ['molise', 'Molise', 'del Molise', 'in Molise'], ['campania', 'Campania', 'della Campania', 'in Campania'],
  ['puglia', 'Puglia', 'della Puglia', 'in Puglia'], ['basilicata', 'Basilicata', 'della Basilicata', 'in Basilicata'],
  ['calabria', 'Calabria', 'della Calabria', 'in Calabria'], ['sicilia', 'Sicilia', 'della Sicilia', 'in Sicilia'],
  ['sardegna', 'Sardegna', 'della Sardegna', 'in Sardegna'],
].filter(r => D.regioni[r[0]] && IND.regioni[r[0]]).map(([k, nome, del, inn]) => ({ k, nome, del, inn }));
const DI_REG = Object.fromEntries(REG.map(r => [r.k, r]));
const HA_PIOGGE = new Set(REGIONI.map(r => r.k));                       // /<regione>/ esiste

const SPIEGA = {
  'castagneti': 'castagno e selve da frutto', 'faggete': 'boschi di faggio, dalla media montagna in su',
  'querceti': 'roverella, rovere, farnia, cerro, leccio, sughera e i querco-carpineti', 'robinieti': 'boschi di robinia, in collina e in pianura',
  'lariceti': 'larice, e larice con cembro, in alta quota', 'abetaie e peccete': 'abete bianco e abete rosso',
  'pioppi, salici, ontani e frassini': 'i boschi lungo fiumi e torrenti', 'pinete': "pino silvestre, nero, marittimo, domestico e d'Aleppo",
  'carpino, orniello e aceri': 'carpino nero e orniello, sui versanti asciutti', 'conifere non precisate': 'conifere di cui la carta non dice la specie',
  'altri boschi': 'latifoglie miste, arbusteti, macchia e mughete',
};
const COLORE_A_PAROLE = { 'faggete': 'in verde', 'castagneti': 'in arancio', 'querceti': 'in ocra', 'abetaie e peccete': 'in blu',
  'lariceti': 'in giallo', 'pinete': 'in fucsia', 'robinieti': 'in verde chiaro', 'conifere non precisate': 'in viola',
  'carpino, orniello e aceri': 'in azzurro', 'pioppi, salici, ontani e frassini': 'in rosa', 'altri boschi': 'in grigio' };

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pc = v => String(Math.round(v * 10) / 10).replace('.', ',') + '%';
const prima = t => t.charAt(0).toUpperCase() + t.slice(1);
// il genitivo di una zona dal suo «dove»: le «in» sono tutte femminili (Val, Valle, Garfagnana, Sabina...)
const GEN = { 'in': 'della', 'sul': 'del', 'nel': 'del', 'negli': 'degli', 'sui': 'dei', 'nelle': 'delle', 'sulle': 'delle' };
function della(z) {
  if (/^sull'/.test(z.dove)) return "dell'" + z.dove.slice(5);
  const [p, ...r] = z.dove.split(' ');
  // «dell'Alpe di Poti», «dell'Alta Val d'Enza»: davanti a vocale si elide
  return ((GEN[p] || 'di') + ' ' + r.join(' ')).replace(/^della ([AEIOUaeiou])/, "dell'$1");
}
// un nome di pluviometro si puo' scrivere in una didascalia? («Rio Rudan INADEF DX briglia» no)
const pulito = n => n && n.length < 28 && !/\d/.test(n) && !/\b[A-Z]{3,}\b/.test(n) && !/ - /.test(n);
const ordina = tipi => Object.entries(tipi).sort((a, b) => (a[0] === 'altri boschi') - (b[0] === 'altri boschi') || b[1] - a[1]);
const principali = (tipi, n = 3, soglia = 5) => Object.entries(tipi).filter(([t, v]) => t !== 'altri boschi' && v >= soglia).sort((a, b) => b[1] - a[1]).slice(0, n);
// ⚠️ ZONE SENZA PAGINA FORESTALE (sua decisione, 27/9): la Valle Sabbia e' quasi
// tutta grigia, un buco della carta forestale lombarda (DUSAF), e una pagina
// «che bosco c'e'» con la risposta «non si sa» non serve a nessuno.
const ESCLUSE = new Set(['Valle Sabbia']);
const zoneDi = k => D.zone.filter(z => z.reg === k && !ESCLUSE.has(z.n));
const zlink = z => `<a href="${SITO}/mappa-forestale/zone/${slug(z.n)}/">${esc(z.n)}</a>`;
function zoneCon(k, t, soglia) {
  return zoneDi(k).filter(z => (z.tipi[t] || 0) >= soglia).sort((a, b) => b.tipi[t] - a.tipi[t]).slice(0, 3).map(zlink).join(', ');
}

// i tre tipi che hanno una pagina loro (28/9/2026): nelle barre il nome e' un link
const PAGINA_TIPO = new Set(['castagneti', 'querceti', 'abetaie e peccete']);
function barre(tipi) {
  const mx = Math.max(...Object.values(tipi));
  return ordina(tipi).filter(([, v]) => v >= 0.5).map(([t, v]) =>
    `<div class="fr"><div class="fr-t"><span class="fr-sw" style="background:${COL[t]}"></span>${PAGINA_TIPO.has(t) ? `<a href="${SITO}/mappa-forestale/${t.replace(/ /g, '-')}/"><b>${esc(t)}</b></a>` : `<b>${esc(t)}</b>`}<span class="fr-v">${pc(v)}</span></div>` +
    `<div class="fr-b"><i style="width:${Math.round(v / mx * 100)}%;background:${COL[t]}"></i></div><div class="fr-s">${esc(SPIEGA[t])}</div></div>`).join('\n');
}
const tipiInLinea = (tipi, n = 3) => principali(tipi, n).map(([t, v]) =>
  `<span class="fr-sw" style="background:${COL[t]}"></span>${esc(t)} <span class="pc">${Math.round(v)}%</span>`).join(' · ');

// «A chi serve»: ogni voce c'e' solo se in quel posto ha senso
function usi(T, dove, extra) {
  const u = [];
  const fungo = (T.castagneti || 0) + (T.faggete || 0) + (T.querceti || 0) + (T['abetaie e peccete'] || 0);
  u.push(['🍄', 'Funghi', `Porcini e compagni stanno sotto castagni, faggi, querce e abeti: ${dove} sono il ${Math.round(fungo)}% del bosco. E con la pioggia degli ultimi giorni sai anche se è il momento: ${extra.funghi}.`]);
  if (T.castagneti >= 3) u.push(['🌰', 'Castagne', `I castagneti sono il ${pc(T.castagneti)} del bosco.${extra.castagne ? ' Dove ce ne sono di più: ' + extra.castagne + '.' : ''} Prima di raccogliere assicurati che il bosco sia libero: molti castagneti sono proprietà private.`]);
  if ((T.faggete || 0) + (T.lariceti || 0) >= 5) u.push(['🍂', "Foliage d'autunno", `Il giallo e il rosso di ottobre sono delle faggete (${pc(T.faggete || 0)})${T.lariceti >= 1 ? ` e dei lariceti (${pc(T.lariceti)}), che diventano oro prima di perdere gli aghi` : ''}.${extra.faggete ? ' Faggete: ' + extra.faggete + '.' : ''}`]);
  u.push(['🥾', 'Escursioni e sentieri', 'Prima di partire guardi che bosco attraversa il sentiero, a che quota e su quale versante: tocchi un punto sulla mappa e lo apri su Google Maps.']);
  if ((T.lariceti || 0) + (T['abetaie e peccete'] || 0) >= 5) u.push(['🌿', 'Mirtilli', `Crescono sotto lariceti, peccete e faggete d'alta quota: ${dove} larici e abeti sono il ${Math.round(T.lariceti + T['abetaie e peccete'])}% del bosco.`]);
  if (T.querceti >= 10 || T['pioppi, salici, ontani e frassini'] >= 2) u.push(['🟤', 'Tartufi', `Si cercano soprattutto nei querceti (${pc(T.querceti || 0)}) e lungo i fiumi, fra pioppi, salici e ontani (${pc(T['pioppi, salici, ontani e frassini'] || 0)}).`]);
  return '<ul class="usi">\n' + u.map(([i, t, x]) => `<li><span class="ic">${i}</span><div><b>${esc(t)}</b><br>${x}</div></li>`).join('\n') + '\n</ul>';
}

function tastiPioggia(base) {
  return `<a class="cta" href="${base}&amp;g=20">💧 Apri la mappa della pioggia: ultimi 20 giorni</a>\n<div class="tasti">` +
    [[1, 'Ieri'], [7, 'Ultimi 7 gg'], [10, 'Ultimi 10 gg'], [15, 'Ultimi 15 gg'], [30, 'Ultimi 30 gg']].map(([g, t]) => `<a href="${base}&amp;g=${g}">${t}</a>`).join('') +
    `<a href="${base}&amp;radar=ora">📡 Radar adesso</a></div>\n`;
}

function testa({ titolo, descr, url, img, briciola }) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titolo)}</title>
<meta name="description" content="${esc(descr)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(titolo)}">
<meta property="og:description" content="${esc(descr)}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
${briciolaJson(briciola)}
<script async src="https://www.googletagmanager.com/gtag/js?id=G-9R7MXXS0V4"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag("js",new Date());
if(/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname))gtag("config","G-9R7MXXS0V4");
</script>
<style>${STILE}${STILE_MF}</style>
</head>
<body>
<header>
  <a href="${SITO}/" class="logo">🍄 Avventure Micologiche <span style="opacity:.65;font-weight:400">· mappa forestale</span></a>
  <a class="yt" href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'forestale'})}catch(e){}">▶ <span class="yt-l">Canale </span>YouTube</a>
</header>
<main>
`;
}
const PIEDE = `</main>
<footer><a href="${SITO}/">Mappa delle piogge</a> · <a href="${SITO}/mappa-forestale/">Mappa forestale d'Italia</a> · <a href="${SITO}/guida/">Guida</a> · <a href="${SITO}/fonti.html">tutte le fonti e licenze</a></footer>
</body>
</html>
`;
// «Vieni a trovarci su YouTube» in fondo, come sulle pagine funghi (27/9/2026, sua
// richiesta: le pagine forestali avevano solo il tasto della testata). Evento GA
// «forestale-fondo-<pagina>», per contarli a parte.
const youtube = id => `<p style="margin:22px 0 4px;"><a href="${CANALE}?sub_confirmation=1" target="_blank" rel="noopener" style="color:#e12b2b;font-weight:600;display:inline-flex;align-items:center;gap:7px;text-decoration:none;"
   onclick="try{gtag('event','click_youtube',{pulsante:'forestale-fondo-${id}'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a></p>
`;
const tit = (...v) => v.find(t => t.length <= 62) || v[v.length - 1];
const des = (...v) => v.find(t => t.length <= 158) || v[v.length - 1];
function didascalia(tipi, dove) {
  const p = principali(tipi, 3, 8).map(([t]) => `${t} ${COLORE_A_PAROLE[t]}`);
  return `${dove}: ` + (p.length ? p.join(', ') : 'i boschi colorati per tipo');
}
// la didascalia descrive il bosco intorno al PUNTO dello scorcio, non la media della
// regione (Puglia, 27/9: «querceti e pinete» sotto una foto tutta faggete della Foresta Umbra)
const tipiDelPunto = (S, riserva) => { const p = S && Object.values(D.paesi).find(x => x.n === S.paese); return p ? p.tipi : riserva; };
const scriviFile = (rel, testo) => {
  const f = path.join(RADICE, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, testo, 'utf8');
};

// ═══ LA PAGINA DI UNA REGIONE ═══════════════════════════════════════════════
function paginaRegione(r) {
  const T = D.regioni[r.k].tipi, S = D.regioni[r.k].scorcio, F = IND.regioni[r.k];
  const url = `${SITO}/mappa-forestale/${r.k}/`;
  const MAPPA = `${SITO}/?r=${r.k}&amp;boschi=1`;
  const Z = zoneDi(r.k);
  // la didascalia: il nome della zona in cui cade lo scorcio, o il paese se e' presentabile
  const zS = S && Z.find(z => z.posti.some(id => D.paesi[id] && D.paesi[id].n === S.paese));
  const doveS = zS ? zS.n : (S && pulito(S.paese) ? 'Intorno a ' + S.paese : r.nome + ', da vicino');
  const titolo = tit(`Mappa forestale ${r.del}: che bosco c'è, tipo per tipo`, `Mappa forestale ${r.del}: che bosco c'è`, `Mappa forestale ${r.del}`);
  const primi = principali(T, 4, 1).map(([t]) => t).join(', ');
  const descr = des(`La carta forestale ${r.del} in una mappa facile, anche dal telefono: ${primi}. Per funghi, castagne, foliage ed escursioni.`,
                    `La carta forestale ${r.del} in una mappa facile, anche dal telefono. Per funghi, castagne, foliage ed escursioni.`);
  const funghi = fs.existsSync(path.join(RADICE, 'funghi', r.k, 'index.html'))
    ? `<a href="${SITO}/funghi/${r.k}/">piogge per funghi ${esc(r.inn)}</a>` : `<a href="${SITO}/funghi/">piogge per funghi</a>`;
  let h = testa({ titolo, descr, url, img: `${url}scorcio.jpg`,
    briciola: [["Mappa forestale d'Italia", `${SITO}/mappa-forestale/`], [r.nome]] });
  h += `<p class="nota" style="margin-bottom:6px"><a href="${SITO}/mappa-forestale/" style="color:var(--blu)">‹ Mappa forestale d'Italia</a> <span style="color:#9aa7b8">›</span> ${esc(r.nome)}</p>
<h1>${esc(titolo)}</h1>
<p class="breve" style="margin-top:-2px">La carta forestale ${esc(r.del)} in una mappa sola, anche dal telefono: undici colori sopra il rilievo, e tocchi un punto per sapere che bosco è, a che quota e su quale versante. Per chi va a funghi, a castagne, a vedere il foliage o a camminare.</p>
<a class="cta" href="${MAPPA}">🌲 Apri la mappa forestale ${esc(r.del)}</a>
<a href="${MAPPA}"><img class="img-f" src="scorcio.jpg" alt="La mappa forestale ${esc(r.del)} da vicino: i boschi colorati per tipo sopra il rilievo, con la nuvoletta di un bosco" width="1200" height="750"></a>
<p class="nota">${esc(didascalia(tipiDelPunto(S, zS ? zS.tipi : T), doveS))}. Tocchi un bosco e la nuvoletta ti dice che cos'è, a che quota, su quale versante. <a href="${MAPPA}">Apri la mappa</a> per vedere tutta la regione.</p>

<h2>Che boschi ci sono ${esc(r.inn)}</h2>
<p class="breve">Quanto pesa ogni tipo sul bosco della regione, misurato sulla nostra mappa.</p>
${barre(T)}

<h2>A chi serve</h2>
${usi(T, esc(r.inn), { funghi, castagne: zoneCon(r.k, 'castagneti', 30), faggete: zoneCon(r.k, 'faggete', 25) })}
`;
  if (Z.length) {
    h += `
<h2>Le valli e le zone ${esc(r.del)}</h2>
<p class="breve">Che bosco c'è in ogni zona, intorno ai suoi pluviometri. Ogni zona ha la sua pagina con la mappa.</p>
<ul class="dove">
${Z.slice().sort((a, b) => a.n.localeCompare(b.n, 'it')).map(z => `<li>${zlink(z).replace(/>([^<]+)<\/a>$/, '><b>$1</b></a>')} <span class="pc">· bosco sul ${Math.round(z.bosco)}% del territorio</span><br>${tipiInLinea(z.tipi)}</li>`).join('\n')}
</ul>
`;
  }
  h += `
<h2>Come si usa</h2>
<p>Apri la mappa, avvicinati e <b>tocca un bosco</b>: una nuvoletta ti dice il tipo, la quota, il versante e la pendenza, e lo apri su Google Maps.</p>

<h2>Da dove viene la carta</h2>
<div class="fonte"><b>${esc(F.fonte)}</b><br>Licenza ${esc(F.licenza)} · <a href="${esc(F.link)}" target="_blank" rel="noopener">scheda ufficiale</a><br>
<span style="color:#5b6878;font-size:14px">I tipi forestali della carta sono raggruppati negli undici colori della nostra legenda; il rilievo viene da TINITALY (INGV).</span></div>

<h2>Le altre regioni</h2>
<nav class="altre"><p>${REG.filter(x => x.k !== r.k).map(x => `<a href="${SITO}/mappa-forestale/${x.k}/">${esc(x.nome)}</a>`).join(' · ')}</p></nav>

${youtube(r.k)}
<div class="pioggia">
<h2>E la pioggia? Sulla stessa mappa</h2>
<p>La mappa forestale sta dentro la nostra <b>mappa pluviometrica</b>: i pluviometri ${esc(r.del)}, con la pioggia vera giorno per giorno. Scegli un periodo e vedi i colori della pioggia, poi con <b>⇆ Confronta con piogge</b> li metti accanto ai boschi.</p>
${tastiPioggia(`${SITO}/?r=${r.k}`)}${HA_PIOGGE.has(r.k) ? `<a href="${SITO}/${r.k}/"><img class="img-f" src="${ANTEPRIME}${r.k}.jpg" alt="La pioggia degli ultimi giorni ${esc(r.inn)}, pluviometro per pluviometro" width="1600" height="1000" loading="lazy"></a>
<p><a href="${SITO}/${r.k}/">Dove ha piovuto ${esc(r.inn)}</a> · ${funghi.replace('>p', '>P')}</p>` : `<p>${funghi.replace('>p', '>P')}</p>`}
</div>
` + PIEDE;
  scriviFile(path.join('mappa-forestale', r.k, 'index.html'), h);
}

// ═══ LA PAGINA DI UNA ZONA ══════════════════════════════════════════════════
function paginaZona(z) {
  const r = DI_REG[z.reg], T = z.tipi, s = slug(z.n), DELLA = della(z);
  const url = `${SITO}/mappa-forestale/zone/${s}/`;
  const MAPPA = `${SITO}/?r=${z.reg}&amp;boschi=1&amp;z=12&amp;c=${z.lat},${z.lon}`;
  const titolo = tit(`Mappa forestale ${DELLA}: che bosco c'è`, `Mappa forestale ${DELLA}`);
  const primi = principali(T, 3, 1).map(([t]) => t).join(', ');
  const descr = des(`La mappa forestale ${DELLA}: ${primi}, paese per paese e dal basso alle cime. Per funghi, castagne, foliage ed escursioni.`,
                    `La mappa forestale ${DELLA}, paese per paese. Per funghi, castagne, foliage ed escursioni.`);
  const paesi = z.posti.map(id => ({ id, ...D.paesi[id] })).filter(p => p.n).sort((a, b) => a.q - b.q);
  const S = z.scorcio;
  const doveS = S && pulito(S.paese) ? `${z.n}, intorno a ${S.paese}` : `${z.n}, da vicino`;
  let h = testa({ titolo, descr, url, img: `${url}scorcio.jpg`,
    briciola: [["Mappa forestale d'Italia", `${SITO}/mappa-forestale/`], [r.nome, `${SITO}/mappa-forestale/${r.k}/`], [z.n]] });
  h += `<p class="nota" style="margin-bottom:6px"><a href="${SITO}/mappa-forestale/" style="color:var(--blu)">‹ Mappa forestale d'Italia</a> <span style="color:#9aa7b8">›</span> <a href="${SITO}/mappa-forestale/${r.k}/" style="color:var(--blu)">${esc(r.nome)}</a> <span style="color:#9aa7b8">›</span> ${esc(z.n)}</p>
<h1>${esc(titolo)}</h1>
<p class="breve" style="margin-top:-2px">La carta forestale ${esc(DELLA)}, colorata sopra il rilievo. Tocchi un punto e sai che bosco è, a che quota e su quale versante. Per chi va a funghi, a castagne, a vedere il foliage o a camminare.</p>
<a class="cta" href="${MAPPA}">🌲 Apri la mappa forestale ${esc(DELLA)}</a>
<a href="${MAPPA}"><img class="img-f" src="scorcio.jpg" alt="La mappa forestale ${esc(DELLA)} da vicino, con la nuvoletta di un bosco" width="1200" height="750"></a>
<p class="nota">${esc(didascalia(tipiDelPunto(S, T), doveS))}. <a href="${MAPPA}">Apri la mappa</a> per vedere il resto della zona.</p>

<h2>Che boschi ci sono ${esc(z.dove)}</h2>
<p class="breve">Il bosco copre il ${Math.round(z.bosco)}% del territorio intorno ai pluviometri della zona. Ecco come si divide.</p>
${barre(T)}
`;
  if (paesi.length) h += `
<h2>I paesi intorno alla valle</h2>
<p class="breve">Che bosco c'è entro 3 km da ogni paese, dal più basso al più alto. Il nome porta alla sua pagina con la pioggia per i funghi.</p>
<ul class="paesi">
${paesi.map(p => `<li><span class="quota">${p.q ? p.q + ' m' : ''}</span><div><a href="${SITO}/funghi/${p.reg}/${p.slug}/"><b>${esc(p.n)}</b></a><br><span class="pc">${tipiInLinea(p.tipi) || 'poco bosco intorno'}</span></div></li>`).join('\n')}
</ul>
`;
  const zfunghi = fs.existsSync(path.join(RADICE, 'funghi', 'zone', s, 'index.html'));
  h += `
<h2>A chi serve</h2>
${usi(T, 'qui', { funghi: zfunghi ? `<a href="${SITO}/funghi/zone/${s}/">funghi ${esc(z.dove)} oggi</a>` : `<a href="${SITO}/funghi/${z.reg}/">piogge per funghi ${esc(r.inn)}</a>` })}

<h2>Da dove viene la carta</h2>
<div class="fonte"><b>${esc(IND.regioni[z.reg].fonte)}</b><br>Licenza ${esc(IND.regioni[z.reg].licenza)} · <a href="${esc(IND.regioni[z.reg].link)}" target="_blank" rel="noopener">scheda ufficiale</a></div>

<h2>Le altre zone ${esc(r.del)}</h2>
<nav class="altre"><p>${zoneDi(z.reg).filter(x => x.n !== z.n).sort((a, b) => a.n.localeCompare(b.n, 'it')).map(zlink).join(' · ') || '—'}</p></nav>
<p><a href="${SITO}/mappa-forestale/${r.k}/">‹ Mappa forestale ${esc(r.del)}</a></p>

${youtube('zona-' + s)}
<div class="pioggia">
<h2>E la pioggia? Sulla stessa mappa</h2>
<p>La mappa forestale sta dentro la nostra <b>mappa pluviometrica</b>: ${z.posti.length} pluviometri intorno alla zona, con la pioggia vera giorno per giorno. Con <b>⇆ Confronta con piogge</b> metti accanto boschi e pioggia.</p>
${tastiPioggia(`${SITO}/?r=${z.reg}&amp;z=11&amp;c=${z.lat},${z.lon}`)}${HA_PIOGGE.has(z.reg) ? `<a href="${SITO}/zone/${s}/"><img class="img-f" src="${ANTEPRIME}${z.reg}.jpg" alt="La pioggia degli ultimi giorni ${esc(r.inn)}" width="1600" height="1000" loading="lazy"></a>\n` : ''}<p><a href="${SITO}/zone/${s}/">Dove ha piovuto ${esc(z.dove)}</a>${zfunghi ? ` · <a href="${SITO}/funghi/zone/${s}/">Funghi ${esc(z.dove)} oggi</a>` : ''}</p>
</div>
` + PIEDE;
  scriviFile(path.join('mappa-forestale', 'zone', s, 'index.html'), h);
}

// ═══ LE PAGINE PER TIPO DI BOSCO (28/9/2026) ════════════════════════════════
// Solo tre, per sua decisione: castagneti, querceti, abetaie e peccete.
// ⚠️ TUTTO IL TESTO sta in testi-tipi-bosco/testi-<tipo>.txt e lo scrive LUI:
// qui ci sono solo i numeri e l'impaginazione. Non ricopiare frasi nel codice.
// I numeri (ettari e altitudini) vengono da mappa-forestale-tipi.json.
const TIPI_PAGINA = ['castagneti', 'querceti', 'abetaie e peccete'];
const slugTipo = t => t.replace(/, /g, '-').replace(/ /g, '-');
const TP = JSON.parse(fs.readFileSync(path.join(__dirname, 'mappa-forestale-tipi.json'), 'utf8'));
const n1 = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// il file di testo: blocchi «== nome ==», righe con # = appunti, riga vuota = nuovo paragrafo
function leggiTesti(file) {
  const B = {}; let cur = null;
  for (const riga of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = riga.match(/^==\s*(.+?)\s*==\s*$/);
    if (h) { cur = h[1].toLowerCase(); B[cur] = []; continue; }
    if (cur === null || /^\s*#/.test(riga)) continue;
    B[cur].push(riga);
  }
  for (const k in B) B[k] = B[k].join('\n').trim();
  return B;
}
// testo scritto -> html: **grassetto**, *corsivo*, {segnaposto}; «piogge per funghi» diventa un link
function htmlT(t, V) {
  let s = esc(t).replace(/\{(\w+)\}/g, (x, k) => (k in V ? V[k] : x))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  return s.replace(/piogge per funghi/i, x => `<a href="${SITO}/funghi/">${x}</a>`);
}
const paragrafiT = (t, V, cls) => t ? t.split(/\n\s*\n/).map(p => `<p${cls ? ` class="${cls}"` : ''}>${htmlT(p.replace(/\n/g, ' '), V)}</p>`).join('\n') : '';
const righeT = t => (t || '').split('\n').map(r => r.trim()).filter(Boolean);

function paginaTipo(T) {
  const slugT = slugTipo(T);
  const B = leggiTesti(path.join(__dirname, 'testi-tipi-bosco', `testi-${slugT}.txt`));
  const imp = Object.fromEntries(righeT(B['impostazioni']).map(r => { const [k, ...v] = r.split(':'); return [k.trim(), v.join(':').trim()]; }));
  const RR = TP.tipi[T];
  const perReg = REG.map(r => ({ r, ha: RR[r.k] ? RR[r.k].ha : 0, pc: D.regioni[r.k].tipi[T] || 0 })).filter(x => x.ha > 0).sort((a, b) => b.ha - a.ha);
  const tot = perReg.reduce((s, x) => s + x.ha, 0);
  const boscoTot = REG.reduce((s, r) => s + (TP.tot_bosco[r.k] || 0), 0);
  const NB = Object.values(RR)[0].q100.length, isto = new Array(NB).fill(0);
  for (const r of REG) if (RR[r.k]) RR[r.k].q100.forEach((v, i) => isto[i] += v);
  const totQ = isto.reduce((a, b) => a + b, 0);
  const quantile = p => { let s = 0; for (let i = 0; i < NB; i++) { s += isto[i]; if (s >= p * totQ) return i * 100 + 100 * (1 - (s - p * totQ) / isto[i]); } return NB * 100; };
  const r50 = v => Math.round(v / 50) * 50;
  const quota = (a, z) => Math.round(isto.slice(a / 100, z / 100).reduce((x, y) => x + y, 0) / totQ * 100);
  // la fascia: quella scelta da lui nelle impostazioni, se c'e'; se no quella dal 20 all'80%
  const ft = (imp['fascia testo'] || '').match(/(\d+)\s*-\s*(\d+)/);
  const fascia = ft ? [+ft[1], +ft[2]] : [Math.floor(quantile(0.2) / 100) * 100, Math.ceil(quantile(0.8) / 100) * 100];
  const V = {
    ettari: n1(Math.round(tot / 1000) * 1000), percento: String(Math.round(tot / boscoTot * 1000) / 10).replace('.', ','),
    quota_25: n1(r50(quantile(0.25))), quota_75: n1(r50(quantile(0.75))), quota_mezzo: n1(r50(quantile(0.5))),
    fascia_da: n1(fascia[0]), fascia_a: n1(fascia[1]), fascia_percento: quota(fascia[0], fascia[1]),
    testo_da: n1(fascia[0]), testo_a: n1(fascia[1]), testo_percento: quota(fascia[0], fascia[1]),
  };
  const ultima = Math.min(NB - 1, isto.reduce((u, v, i) => v / totQ > 0.002 ? i : u, 0) + 1);
  function profilo() {
    const W = 640, H = 150, n = ultima + 1, bw = (W - 2) / n, mx = Math.max(...isto.slice(0, n));
    let s = `<svg viewBox="0 0 ${W} ${H + 30}" width="100%" role="img" aria-label="Quanti ettari di ${esc(T)} a ogni altitudine, a fasce di 100 metri" style="display:block;margin:10px 0 2px">`;
    for (let i = 0; i < n; i++) {
      const h = isto[i] / mx * (H - 8), on = i * 100 >= fascia[0] && i * 100 < fascia[1];
      s += `<rect x="${(1 + i * bw).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${on ? COL[T] : '#c9d2cc'}" opacity="${on ? 0.85 : 1}"/>`;
    }
    const passo = n > 20 ? 1000 : 500;
    for (let q = 0; q <= n * 100; q += passo) s += `<text x="${(1 + q / 100 * bw).toFixed(1)}" y="${H + 22}" font-size="17" fill="#5b6878" text-anchor="${q === 0 ? 'start' : (q + passo / 2 > n * 100 ? 'end' : 'middle')}">${n1(q)} m</text>`;
    return s + '</svg>';
  }
  const zone = D.zone.filter(z => !ESCLUSE.has(z.n) && DI_REG[z.reg] && (z.tipi[T] || 0) >= 20).sort((a, b) => b.tipi[T] - a.tipi[T]).slice(0, +(imp.valli || 10));
  const paesi = Object.values(D.paesi).filter(p => p.tipi && p.bosco >= 50 && (p.tipi[T] || 0) >= 70 && p.q)
    .sort((a, b) => (b.tipi[T] * b.bosco) - (a.tipi[T] * a.bosco)).slice(0, +(imp.paesi || 12)).sort((a, b) => a.q - b.q);
  const url = `${SITO}/mappa-forestale/${slugT}/`;
  const vista = `r=${imp.regione}&amp;z=${imp.zoom}&amp;c=${imp.centro}`;
  const MAPPA = `${SITO}/?${vista}&amp;boschi=1`;
  const tit = k => htmlT(B[k] || '', V);
  const piano = k => (B[k] || '').replace(/\{(\w+)\}/g, (x, c) => (c in V ? V[c] : x)).replace(/\*/g, '');

  let h = testa({ titolo: piano('titolo'), descr: piano('descrizione'), url, img: `${url}scorcio.jpg`,
    briciola: [["Mappa forestale d'Italia", `${SITO}/mappa-forestale/`], [prima(T)]] });
  h += `<p class="nota" style="margin-bottom:6px"><a href="${SITO}/mappa-forestale/" style="color:var(--blu)">‹ Mappa forestale d'Italia</a> <span style="color:#9aa7b8">›</span> ${esc(prima(T))}</p>
<h1>${tit('titolo grande')}</h1>
${paragrafiT(B['apertura'], V, 'breve')}
<style>.numeri b{white-space:nowrap;font-size:clamp(16px,5.2vw,24px)}</style>
<div class="numeri">${righeT(B['tre numeri']).map(r => { const [a, b] = r.split('|').map(x => x.trim()); return `<div><b>${htmlT(a, V)}</b>${htmlT(b || '', V)}</div>`; }).join('')}</div>
<a class="cta" href="${MAPPA}">${tit('tasto mappa')}</a>
<a href="${MAPPA}"><img class="img-f" src="scorcio.jpg" alt="${esc(piano('foto, testo nascosto per chi non vede'))}" width="1200" height="750"></a>
<p class="nota">${tit('didascalia foto')} <a href="${MAPPA}">Apri la mappa</a> e vai dove vuoi.</p>

<h2>${tit('regioni: titolo')}</h2>
${paragrafiT(B['regioni: testo'], V, 'breve')}
${perReg.filter(x => x.ha >= 1000).map(x => `<div class="fr"><div class="fr-t"><span class="fr-sw" style="background:${COL[T]}"></span><a href="${SITO}/mappa-forestale/${x.r.k}/"><b>${esc(x.r.nome)}</b></a><span class="fr-v">${n1(Math.round(x.ha / 100) * 100)} ha</span></div>` +
  `<div class="fr-b"><i style="width:${Math.round(x.ha / perReg[0].ha * 100)}%;background:${COL[T]}"></i></div><div class="fr-s">il ${pc(x.pc)} del bosco ${esc(x.r.del)}</div></div>`).join('\n')}

<h2>${tit('altitudine: titolo')}</h2>
${paragrafiT(B['altitudine: testo'], V, 'breve')}
${profilo()}
${paragrafiT(B['altitudine: sotto il grafico'], V, 'nota')}
<a class="cta" style="background:#2d6a30" href="${MAPPA}&amp;quota=${fascia[0]}-${fascia[1]}">${tit('altitudine: tasto')}</a>
${paragrafiT(B['altitudine: sotto il tasto'], V, 'nota')}
`;
  const funghi = righeT(B['funghi: elenco']).filter(r => r.includes('|')).map(r => r.split('|').map(x => x.trim()));
  if (funghi.length) h += `
<h2>${tit('funghi: titolo')}</h2>
${paragrafiT(B['funghi: testo'], V, 'breve')}
<ul class="usi">
${funghi.map(([n, alt, lat, d]) => `<li><span class="ic"><span class="fr-sw" style="background:${COL[T]};margin:6px 0 0"></span></span><div><b>${htmlT(n, V)}</b>${alt ? ` <span class="pc">o ${htmlT(alt, V)}</span>` : ''}${lat ? ` · <i>${esc(lat)}</i>` : ''}<br>${htmlT(d || '', V)}</div></li>`).join('\n')}
</ul>
${B['funghi: avviso'] ? `<div class="fonte" style="border-color:#e3b3ad;background:#fdf3f2">⚠️ ${htmlT(B['funghi: avviso'], V)}</div>` : ''}
${paragrafiT(B['funghi: dopo'], V)}
`;
  h += `
<h2>${tit('valli: titolo')}</h2>
${paragrafiT(B['valli: testo'], V, 'breve')}
<ul class="dove">
${zone.map(z => `<li>${zlink(z).replace(/>([^<]+)<\/a>$/, '><b>$1</b></a>')} <span class="pc">· ${esc(DI_REG[z.reg].nome)}</span><br><span class="fr-sw" style="background:${COL[T]}"></span>${esc(T)} <b>${Math.round(z.tipi[T])}%</b> del bosco <span class="pc">· bosco sul ${Math.round(z.bosco)}% del territorio</span></li>`).join('\n')}
</ul>
`;
  if (paesi.length) h += `
<h2>${tit('paesi: titolo')}</h2>
${paragrafiT(B['paesi: testo'], V, 'breve')}
<ul class="paesi">
${paesi.map(p => `<li><span class="quota">${p.q} m</span><div><a href="${SITO}/funghi/${p.reg}/${p.slug}/"><b>${esc(p.n)}</b></a> <span class="pc">· ${esc(DI_REG[p.reg] ? DI_REG[p.reg].nome : p.reg)}</span><br><span class="pc"><span class="fr-sw" style="background:${COL[T]}"></span>${esc(T)} ${Math.round(p.tipi[T])}% del bosco intorno</span></div></li>`).join('\n')}
</ul>
`;
  h += `
<h2>${tit('che cosa mettiamo: titolo')}</h2>
<div class="fonte">${htmlT(B['che cosa mettiamo: testo'] || '', V).replace(/\n\s*\n/g, '<br><br>').replace(/\n/g, ' ')}</div>

<h2>${tit('a chi serve: titolo')}</h2>
<ul class="usi">
${righeT(B['a chi serve: elenco']).filter(r => r.includes('|')).map(r => { const [i, t, x] = r.split('|').map(y => y.trim()); return `<li><span class="ic">${esc(i)}</span><div><b>${htmlT(t, V)}</b><br>${htmlT(x || '', V)}</div></li>`; }).join('\n')}
</ul>

<h2>${tit('altri boschi: titolo')}</h2>
<nav class="altre"><p>${TIPI_PAGINA.filter(t => t !== T).map(t => `<span class="fr-sw" style="background:${COL[t]}"></span><a href="${SITO}/mappa-forestale/${slugTipo(t)}/">${esc(prima(t))}</a>`).join(' · ')} · <a href="${SITO}/mappa-forestale/">Tutti i boschi, regione per regione</a></p></nav>

${youtube('tipo-' + slugT)}
<div class="pioggia">
<h2>${tit('pioggia: titolo')}</h2>
${paragrafiT(B['pioggia: testo'], V)}
${tastiPioggia(`${SITO}/?${vista}`)}
<p><a href="${SITO}/funghi/">Piogge per funghi</a> · <a href="${SITO}/guida/">Guida</a></p>
</div>
` + PIEDE;
  // una sezione cancellata nel file di testo non lascia titoli o riquadri vuoti
  h = h.replace(/<h2>\s*<\/h2>\n?/g, '').replace(/<div class="fonte">\s*<\/div>\n?/g, '').replace(/<ul class="usi">\s*<\/ul>\n?/g, '');
  const resti = [...new Set(h.match(/\{\w+\}/g) || [])];
  if (resti.length) console.warn(`⚠️ ${slugT}: segnaposto sconosciuti nel testo: ${resti.join(' ')}`);
  scriviFile(path.join('mappa-forestale', slugT, 'index.html'), h);
}

// ═══ LA PAGINA GENERALE ═════════════════════════════════════════════════════
function paginaItalia() {
  const I = D.italia, url = `${SITO}/mappa-forestale/`, MAPPA = `${SITO}/?boschi=1`;
  const titolo = "Mappa forestale d'Italia: le carte forestali di tutte le regioni";
  const descr = 'Le carte forestali di tutte le regioni italiane in una mappa sola: faggete, castagneti, querceti, pinete e lariceti. Per funghi, castagne, foliage ed escursioni.';
  let h = testa({ titolo, descr, url, img: `${url}scorcio.jpg`, briciola: [["Mappa forestale d'Italia"]] });
  h += `<h1>${esc(titolo)}</h1>
<p class="breve" style="margin-top:-2px">Ogni regione pubblica la sua carta forestale, ognuna sul suo geoportale e con le sue sigle. Qui sono <b>tutte insieme, in una mappa sola</b>: undici colori sopra il rilievo, anche dal telefono. Tocchi un punto e sai che bosco è, a che quota e su quale versante.</p>
<div class="numeri"><div><b>${REG.length}</b>regioni e province</div><div><b>11</b>tipi di bosco</div><div><b>10 m</b>il rilievo</div></div>
<a class="cta" href="${MAPPA}">🌲 Apri la mappa forestale d'Italia</a>
<a href="${MAPPA}"><img class="img-f" src="scorcio.jpg" alt="La mappa forestale da vicino, con la nuvoletta di un bosco" width="1200" height="750"></a>
<p class="nota">${esc(didascalia(D.regioni.toscana.tipi, 'Toscana, da vicino'))}. <a href="${MAPPA}">Apri la mappa</a> e vai dove vuoi.</p>

<h2>Le carte forestali, regione per regione</h2>
<p class="breve">Per ogni regione: la carta ufficiale da cui viene il colore, con la sua licenza e il collegamento al geoportale, e i tre boschi più diffusi. Il nome porta alla pagina della regione.</p>
<div class="schede">
${REG.map(r => { const f = IND.regioni[r.k]; return `<div class="scheda"><div class="sc-t"><a href="${SITO}/mappa-forestale/${r.k}/"><b>${esc(r.nome)}</b></a><a class="sc-m" href="${SITO}/?r=${r.k}&amp;boschi=1">🌲 mappa</a></div>` +
  `<div class="sc-c">${esc(f.fonte)}</div><div class="sc-l">Licenza ${esc(f.licenza)} · <a href="${esc(f.link)}" target="_blank" rel="noopener">carta ufficiale</a></div>` +
  `<div class="sc-p">${tipiInLinea(D.regioni[r.k].tipi)}</div></div>`; }).join('\n')}
</div>

<h2>Che boschi ci sono in Italia</h2>
<p class="breve">Quanto pesa ogni tipo sul bosco italiano, misurato sulla nostra mappa.</p>
${barre(I)}
<p>Tre boschi hanno una pagina loro, con dove sono, a che altitudine e i loro funghi: ${TIPI_PAGINA.map(t => `<a href="${SITO}/mappa-forestale/${slugTipo(t)}/">${esc(t)}</a>`).join(', ')}.</p>

<h2>A chi serve</h2>
${usi(I, 'in Italia', { funghi: `<a href="${SITO}/funghi/">piogge per funghi</a>` })}

<h2>Come si usa</h2>
<p>Apri la mappa, avvicinati e <b>tocca un bosco</b>: la nuvoletta ti dice il tipo, la quota, il versante e la pendenza, e lo apri su Google Maps. Ai confini fra due regioni le carte si uniscono senza cuciture.</p>

${youtube('italia')}
<div class="pioggia">
<h2>E la pioggia? Sulla stessa mappa</h2>
<p>La mappa forestale sta dentro la nostra <b>mappa pluviometrica</b>: oltre 5.000 pluviometri in Italia e nei paesi vicini, con la pioggia vera giorno per giorno. Con <b>⇆ Confronta con piogge</b> metti accanto boschi e pioggia.</p>
<a class="cta" href="${SITO}/">💧 Apri la mappa della pioggia</a>
<div class="griglia">${[['piemonte', 'Piemonte'], ['toscana', 'Toscana'], ['veneto', 'Veneto'], ['campania', 'Campania']].map(([k, n]) =>
  `<a href="${SITO}/${k}/"><img src="${ANTEPRIME}${k}.jpg" alt="La pioggia degli ultimi giorni in ${n}" width="1600" height="1000" loading="lazy"><span>${n}</span></a>`).join('')}</div>
<p><a href="${SITO}/funghi/">Piogge per funghi</a> · <a href="${SITO}/guida/">Guida</a></p>
</div>
` + PIEDE;
  scriviFile(path.join('mappa-forestale', 'index.html'), h);
}

if (require.main === module) {
  paginaItalia();
  for (const r of REG) paginaRegione(r);
  for (const t of TIPI_PAGINA) paginaTipo(t);
  let nz = 0;
  for (const z of D.zone) { if (DI_REG[z.reg] && z.bosco > 0 && !ESCLUSE.has(z.n)) { paginaZona(z); nz++; } }
  for (const n of ESCLUSE) fs.rmSync(path.join(RADICE, 'mappa-forestale', 'zone', slug(n)), { recursive: true, force: true });
  // lo scorcio della pagina generale e' quello della Toscana
  const src = path.join(RADICE, 'mappa-forestale', 'toscana', 'scorcio.jpg');
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(RADICE, 'mappa-forestale', 'scorcio.jpg'));
  const tot = scriviSitemap(SITO, RADICE);
  console.log(`mappa forestale: 1 generale, ${REG.length} regioni, ${TIPI_PAGINA.length} tipi, ${nz} zone; sitemap con ${tot} indirizzi`);
}
