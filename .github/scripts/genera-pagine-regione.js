#!/usr/bin/env node
/**
 * Genera le pagine statiche per regione (/lombardia/, /piemonte/, ...).
 *
 * PERCHE' ESISTONO. Il sito, per Google, e' UNA pagina sola: un URL, un titolo,
 * e ogni volta che si aggiunge una nazione cambia il nome a quella stessa
 * pagina. Chi cerca «dove ha piovuto in Trentino» non trova mai una pagina che
 * parli di quello. L'analisi GA4 del 14/8/2026 dice che Google porta solo il
 * 9,5% delle sessioni ma con la permanenza piu' alta di tutti (2m41s): il
 * canale migliore e' anche il piu' chiuso. Queste pagine lo aprono.
 *
 * COME SONO FATTE. Sono GUSCI STATICI: il testo non cambia mai, i numeri li
 * scarica il browser del visitatore dai file data/ su raw.githubusercontent,
 * la stessa strada che usa la mappa. Quindi NON vanno mai rigenerate quando
 * arrivano dati nuovi, e i collector continuano a non far partire nessun
 * deploy (data/ e' nella regola ignore di netlify.toml). Si rigenerano solo
 * se cambia il MODELLO qui sotto: `node .github/scripts/genera-pagine-regione.js`.
 *
 * ⚠️ STAZIONI: il numero scritto e' quello che la mappa MOSTRA, non quello dei
 * file. Piemonte e Toscana hanno liste curate (170 su 273, 165 su 379), la
 * Lombardia esclude 3 sensori con coordinate corrotte e l'Emilia le 8 gemelle
 * liguri. Scrivere il conteggio grezzo sarebbe una bugia verificabile.
 *
 * ⚠️ GEMELLE (24/8/2026): quando una regione legge PIU' cartelle, le stazioni
 * si uniscono per POSIZIONE, non per cartella+id. Il Friuli e' il caso che l'ha
 * imposto: la pagina leggeva la sola OSMER (41 pluviometri) mentre dichiarava
 * «oltre 130», perche' dal 21/8 la mappa unisce OSMER e la rete regionale
 * completa via MeteoHub. Ma MeteoHub ripubblica le stesse stazioni OSMER con un
 * altro id (`46.51697_12.86492` invece di `osmer_BIC`): unendo per cartella+id,
 * 37 pluviometri su 141 sarebbero stati contati DUE volte, con la stessa
 * pioggia due volte in classifica. La regola e' quella gia' usata in mappa da
 * `loadOSMERFriuliRegion` — vince la PRIMA cartella dell'elenco (la fonte di
 * casa), le altre perdono le stazioni entro ~1 km. Friuli: 41 + 141 − 37 = 145.
 * Sulla Svizzera (svizzera+ticino) non scarta niente: le 9 sovrapposte erano
 * gia' state sanate l'11/8 passando le SMN ticinesi a MeteoSwiss OGD.
 *
 * ⚠️ L'ABRUZZO NON HA UNA PAGINA, ed e' voluto: e' l'unica regione a stime
 * Open-Meteo live, non ha cartella dati, e i due riepiloghi non potrebbero
 * calcolare niente. Una pagina che promette numeri e non li ha lavora contro.
 *
 * ⚠️ I bottoni portano ANCHE le date: il meccanismo ?r= della mappa e' quello
 * dei link condivisi e senza da/a viene ignorato in silenzio (?r=lombardia da
 * solo apre la mappa generica). Con le date la mappa apre con la regione gia'
 * scelta, l'analisi in corso e il preset del periodo acceso.
 */

const fs = require('fs');
const path = require('path');
const { scriviSitemap } = require('./genera-sitemap.js');
const { slug } = require('./lib-nomi.js');
// 25/9/2026: le barre, il riquadro in cima e i tasti delle pagine funghi
const { STILE_NUOVO, RILIEVO, QUIZ_REGIONI, QUIZ_CSS, coppiaQuiz } = require('./lib-pagina-funghi.js');
// 11/10/2026: i numeri cotti nella pagina, con la STESSA funzione del browser
const { numeriRegione } = require('./lib-numeri-regione.js');
// Le zone, per l'elenco «dove ha piovuto, zona per zona» (13/9/2026): ogni
// regione rimanda alle pagine piogge delle sue zone, che senza questi link
// sarebbero orfane.
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));

const SITO = 'https://avventurepluvio-test.pages.dev';
const GA_ID = 'G-9R7MXXS0V4';
const VIDEO_FAQ = 'https://youtu.be/fvsBZJ_Ylf4';
const CANALE = 'https://www.youtube.com/@avventuremicologiche';
// Il bottone del quiz esame tartufi accanto a YouTube (12/10/2026): costanti e
// markup stanno in lib-pagina-funghi.js (QUIZ_REGIONI, QUIZ_CSS, coppiaQuiz),
// gli stessi delle pagine funghi, zone e paesi.
const RAW = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/main/data/';

// Le anteprime della mappa stanno su un RAMO A SE', `anteprime`, coi file alla
// radice: le rifa' genera-anteprime.js ogni tre giorni riscrivendo il ramo da
// capo, cosi' gli 8 MB di immagini non si accumulano nella storia di main.
// raw.githubusercontent serve qualunque ramo, quindi rinfrescarle NON fa
// scattare un deploy Netlify.
const ANTEPRIME = 'https://raw.githubusercontent.com/AvventureMicologiche/Mappa-Precipitazioni-Nord/anteprime';

// chiave = quella delle caselle della mappa (?r=<chiave>) e della cartella pagina.
// dirs   = cartelle dati da sommare. prep = preposizione del titolo.
// staz   = come si dice il numero di stazioni CHE LA MAPPA MOSTRA.
const REGIONI = [
  { k:'lombardia',   nome:'Lombardia',              prep:'in',   dirs:['lombardia'],            agenzia:'ARPA Lombardia',        url:'https://www.dati.lombardia.it/', staz:'oltre 250',        geo:"dalla Valchiavenna all'Oltrepò" },
  { k:'piemonte',    nome:'Piemonte',               prep:'in',   dirs:['piemonte'],             agenzia:'ARPA Piemonte',         url:'', staz:'oltre 250',        geo:'dalle Alpi Marittime al Lago Maggiore' },
  { k:'valledaosta', nome:"Valle d'Aosta",          prep:'in',   dirs:['valledaosta-cf'],       agenzia:'Centro Funzionale della Valle d’Aosta', agenziaCorta:'Centro Funzionale VdA', url:'', staz:'oltre 60',  geo:'dal fondovalle della Dora ai ghiacciai del Monte Rosa' },
  { k:'liguria',     nome:'Liguria',                prep:'in',   dirs:['liguria'],              agenzia:'ARPA Liguria (OMIRL)',  url:'', staz:'quasi 200',        geo:'dalle Alpi Liguri alla Lunigiana' },
  { k:'emilia',      nome:'Emilia-Romagna',         prep:'in',   dirs:['emilia'],               agenzia:'ARPAE Emilia-Romagna',  url:'', staz:'oltre 300',        geo:'dal crinale appenninico al delta del Po' },
  { k:'veneto',      nome:'Veneto',                 prep:'in',   dirs:['veneto'],               agenzia:'ARPA Veneto',           url:'', staz:'oltre 180',        geo:'dalle Dolomiti bellunesi alla laguna' },
  { k:'friuli',      nome:'Friuli Venezia Giulia',  prep:'in',   dirs:['friuli-osmer','meteohub-friuli'], agenzia:'ARPA FVG (OSMER e rete regionale)', agenziaCorta:'ARPA FVG', nomeTitolo:'Friuli', url:'', staz:'oltre 130',geo:'dalle Alpi Carniche al Carso' },
  { k:'trentino',    nome:'Trentino',               prep:'in',   dirs:['trentino'],             agenzia:'Meteotrentino',         url:'', staz:'oltre 100',        geo:'dalle Dolomiti di Brenta alla Valsugana' },
  { k:'altoadige',   nome:'Alto Adige',             prep:'in',   dirs:['altoadige'],            agenzia:'Provincia autonoma di Bolzano', agenziaCorta:'Provincia di Bolzano', url:'', staz:'oltre 50', geo:'dalla Val Venosta alle Dolomiti' },
  { k:'toscana',     nome:'Toscana',                prep:'in',   dirs:['toscana'],              agenzia:'SIR Toscana',           url:'', staz:'oltre 350',        geo:'dalla Lunigiana al Monte Amiata' },
  { k:'umbria',      nome:'Umbria',                 prep:'in',   dirs:['meteohub-umbria'],      agenzia:'MeteoHub',              url:'', staz:'oltre 70',         geo:"dall'Appennino umbro-marchigiano al Trasimeno" },
  { k:'marche',      nome:'Marche',                 prep:'nelle',dirs:['meteohub-marche'],      agenzia:'MeteoHub',              url:'', staz:'oltre 110',        geo:'dai Monti Sibillini alla costa adriatica' },
  { k:'lazio',       nome:'Lazio',                  prep:'nel',  dirs:['meteohub-lazio'],       agenzia:'MeteoHub',              url:'', staz:'oltre 200',        geo:'dai Monti della Laga al litorale pontino' },
  { k:'molise',      nome:'Molise',                 prep:'in',   dirs:['meteohub-molise'],      agenzia:'MeteoHub',              url:'', staz:'circa 25',  geo:'dal Matese al basso Molise' },
  { k:'campania',    nome:'Campania',               prep:'in',   dirs:['meteohub-campania'],    agenzia:'MeteoHub',              url:'', staz:'oltre 150',        geo:'dal Cilento al Matese' },
  { k:'puglia',      nome:'Puglia',                 prep:'in',   dirs:['meteohub-puglia'],      agenzia:'MeteoHub',              url:'', staz:'oltre 120',        geo:'dal Gargano al Salento' },
  { k:'basilicata',  nome:'Basilicata',             prep:'in',   dirs:['meteohub-basilicata'],  agenzia:'MeteoHub',              url:'', staz:'circa 60',         geo:'dal Pollino alle Murge lucane' },
  { k:'calabria',    nome:'Calabria',               prep:'in',   dirs:['meteohub-calabria'],    agenzia:'MeteoHub',              url:'', staz:'circa 140',        geo:"dal Pollino all'Aspromonte" },
  { k:'sicilia',     nome:'Sicilia',                prep:'in',   dirs:['meteohub-sicilia'],     agenzia:'MeteoHub',              url:'', staz:'oltre 400',        geo:"dall'Etna alle Madonie" },
  { k:'sardegna',    nome:'Sardegna',               prep:'in',   dirs:['meteohub-sardegna'],    agenzia:'MeteoHub',              url:'', staz:'oltre 90',         geo:'dalla Gallura al Sulcis' },
  { k:'svizzera',    nome:'Svizzera',               prep:'in',   dirs:['svizzera','ticino'],    agenzia:'MeteoSvizzera e OASI Ticino', agenziaCorta:'MeteoSvizzera', url:'', staz:'oltre 300',  geo:'dal Ticino ai Grigioni, dal Vallese al Giura' },
  { k:'austria',     nome:'Austria',                prep:'in',   dirs:['austria'],              agenzia:'GeoSphere Austria',     url:'', staz:'quasi 270',        geo:'dai ghiacciai del Tirolo alle colline del Burgenland' },
  { k:'slovenia',    nome:'Slovenia',               prep:'in',   dirs:['slovenia'],             agenzia:'ARSO Slovenia',         url:'', staz:'oltre 110',        geo:'dalle Alpi Giulie al Carso', nota:'ARSO pubblica con circa 36 ore di ritardo: nei riepiloghi qui sotto gli ultimi uno o due giorni possono mancare, ed è normale.' },
];

// ── I LINK FRA LE PAGINE ────────────────────────────────────────────────────
// ⚠️ Fino al 2/9/2026 le 42 pagine del sito erano ORFANE: nessuna ne linkava
// un'altra, nemmeno la mappa, e l'unica porta d'ingresso era la sitemap.
// Misurato quel giorno: sulla pagina di una regione l'unico href con dentro
// «funghi» era il suo stesso canonico. La sitemap ti fa SCOPRIRE, i link
// interni ti danno PESO: sono due mestieri diversi, e il secondo mancava.
//
// ⚠️ SI LINKA SOLO QUELLO CHE ESISTE. Le pagine funghi sono 19 e le regione 23:
// il Molise non arriva alla soglia di bosco, e Austria, Svizzera e Slovenia non
// sono cose italiane. L'elenco vero e' `funghi-posti.json`, non un elenco
// scritto a mano qui che poi si scorda di aggiornarsi: un link a
// /funghi/molise/ sarebbe un 404 servito ai motori di ricerca.
const FUNGHI = Object.keys(JSON.parse(
  fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8')));

const nomeDi = r => r.nomeTitolo || r.nome;

// «Pluviometria DELLA Toscana», «mappa pluviometrica DEL Piemonte»: nell'anagrafe
// c'e' solo la preposizione semplice. Se una chiave manca, la pagina direbbe
// «undefined»: il controllo in fondo al file ferma il generatore.
const GEN = {
  lombardia: 'della Lombardia', piemonte: 'del Piemonte', valledaosta: "della Valle d'Aosta",
  liguria: 'della Liguria', emilia: "dell'Emilia-Romagna", veneto: 'del Veneto',
  friuli: 'del Friuli Venezia Giulia', trentino: 'del Trentino', altoadige: "dell'Alto Adige",
  toscana: 'della Toscana', umbria: "dell'Umbria", marche: 'delle Marche', lazio: 'del Lazio',
  molise: 'del Molise', campania: 'della Campania', puglia: 'della Puglia', basilicata: 'della Basilicata',
  calabria: 'della Calabria', sicilia: 'della Sicilia', sardegna: 'della Sardegna',
  svizzera: 'della Svizzera', austria: "dell'Austria", slovenia: 'della Slovenia',
};

// ⚠️ UNA LISTA SOLA, E SEMPRE QUELLA DELL'ALTRA FAMIGLIA (8/9/2026).
// Fino a oggi ogni pagina ne elencava DUE: «Dove ha piovuto, regione per
// regione» e «Piogge per funghi, regione per regione». Stessa forma, stessa
// faccia, gli stessi nomi due volte di fila. Non si capiva che sono due tagli
// diversi degli stessi dati: si leggeva un doppione, e basta.
// Adesso una pagina non ripete MAI la propria famiglia. Su una pagina regione
// c'e' solo il blocco verde dei funghi, su una pagina funghi solo quello della
// pioggia. Il doppione sparisce perche' non c'e' piu' niente di ripetuto, e i
// ponti fra le due famiglie restano tutti.
//
// ⚠️ PERCHE' NON «SOLO I FUNGHI DAPPERTUTTO», che era la proposta piu' netta:
// contato sui file, le pagine regione sarebbero scese da 43 link in entrata
// (minimo) a UNO. Austria, Molise e Slovenia non hanno una pagina funghi,
// quindi nessuno le nominerebbe piu' tranne la striscia della mappa, e sono
// pagine vive (Slovenia 26 viste in 28 giorni, Austria 21). Con la lista
// incrociata il minimo resta 20, che e' abbondante.
//
// ⚠️ IL NOME NON PROMETTE FUNGHI. «Le zone piu' promettenti» sarebbe piaciuto,
// ma il patto in cima a ogni pagina dice a chiare lettere che non prevediamo
// quanti funghi ci saranno: l'etichetta dice dove ha PIOVUTO di piu', che e'
// l'unica cosa che misuriamo.
// ⚠️ E BAGNATE, non PIOVOSE: «zone piovose» suona come una caratteristica del
// posto, cioe' una media climatica, mentre qui si parla degli otto giorni che
// abbiamo misurato. La stessa frase sta in tre punti — qui, sulla pastiglia in
// fondo alla mappa e sul bottone della home del sito — e devono restare uguali.
//
// ⚠️ LO STILE STA QUI DENTRO, in due attributi, e non nei fogli di stile. Le
// due famiglie hanno fogli separati, quindi la regola andrebbe scritta due
// volte e tenuta allineata a mano; ma soprattutto quello delle pagine funghi lo
// COPIANO anche le 948 pagine di paese e le 114 di zona, che navAltre non la
// chiamano nemmeno: sei righe di CSS inutile avrebbero riscritto 1.062 file.
const BOSCO = 'background:#f4fbf3;border:1px solid #cfe8cf;border-radius:9px;' +
              'padding:1px 15px 11px;margin-top:16px;';

// L'elenco delle 19 pagine funghi e quello delle 23 pagine regione, scritti in
// un posto solo perche' li usa anche il ponte dentro `fonti.html`.
const listaFunghi = () => REGIONI.filter(r => FUNGHI.includes(r.k))
  .map(r => `<a href="${SITO}/funghi/${r.k}/">${nomeDi(r)}</a>`).join(' · ');
const listaRegioni = () => REGIONI
  .map(r => `<a href="${SITO}/${r.k}/">${nomeDi(r)}</a>`).join(' · ');

// `tipo` = 'regione' | 'funghi': la famiglia della pagina che si sta scrivendo.
// Si elenca l'ALTRA.
function navAltre(tipo) {
  if (tipo === 'regione') {
    // ⚠️ DUE STRADE, E SI DEVE CAPIRE CHE SONO DUE. La riga porta a cose
    // diverse: «La nostra selezione» e' la classifica nazionale delle localita'
    // piu' bagnate, i diciannove nomi sono il riepilogo di UNA regione. Finche'
    // c'era la sola etichetta, chi leggeva non aveva modo di indovinarlo, e un
    // link di cui non si sa dove porta non lo clicca nessuno. Stessa forma
    // della striscia in fondo alla mappa: domanda, la selezione, il riepilogo.
    return `<nav class="altre">
  <div style="${BOSCO}">
    <b style="color:#2d6a30">🍄 Dove ha piovuto di più?</b>
    <p><a href="${SITO}/funghi/" style="color:#2d6a30;font-weight:600">La nostra selezione, le località più bagnate</a>
    <span style="color:#7a8b9a">·</span> oppure il riepilogo delle regioni: ${listaFunghi()}</p>
  </div>
</nav>`;
  }
  return `<nav class="altre">
  <b>Dove ha piovuto: tutti i pluviometri, pianura compresa</b>
  <p>${listaRegioni()}</p>
</nav>`;
}

/* ── LA PAGINA «COTTA» (11/10/2026) ──────────────────────────────────────────
   Se c'e' un riepilogo FRESCO (scritto da meno di 36 ore, la stessa regola
   del browser) la pagina esce coi numeri gia' dentro: riquadro di ieri,
   barre, i tre periodi, le zone in ordine, e titolo e descrizione con la data
   e i millimetri. Senza riepilogo esce il guscio di prima, identico.
   ⚠️ Il giro che la rigenera deve partire DOPO genera-riepiloghi.js. */
function oggiItalia() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
}
function riepilogoFresco(radice, k) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(radice, 'data', 'riepiloghi', k + '.json'), 'utf8'));
    const eta = Date.now() - new Date(j.generato).getTime();
    if (j.periodi && j.periodi['7'] && j.periodi['20'] && eta >= 0 && eta < 36 * 3600 * 1000) return j;
  } catch (e) { /* niente riepilogo: guscio */ }
  return null;
}
// «10 ottobre», «1° …» no: le date dei titoli come le scrive la pagina
const MESI_L = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const lungoIso = s => { const p = s.split('-'); return (+p[2]) + ' ' + MESI_L[+p[1] - 1]; };
// «a Terrinca» ma «ad Alberschwende»
const aDi = n => (/^[aA]/.test(n) ? 'ad ' : 'a ') + n;
const virgola = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const attr = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Titolo e descrizione coi numeri. «Pluviometria <regione>» resta IN TESTA:
// e' la parola che porta quasi meta' delle apparizioni. Stessi tetti di
// prima, 62 e 158 caratteri, provando forme sempre piu' corte.
function titoloCotto(r, j, N) {
  const nome = r.nomeTitolo || r.nome, quando = lungoIso(N.ultimo);
  const qui = N.ieri ? `ieri, ${quando}` : `il ${quando}`;
  return [`Pluviometria ${nome}: dove ha piovuto ${qui}`, `Pluviometria ${nome}: pioggia di ${N.ieri ? 'ieri, ' : ''}${quando}`]
    .find(t => t.length <= 62) || null;
}
// ── «MAPPA» NEL TITOLO (12/10/2026, sua scelta) ──
// Search Console 13/9-11/10: «pluviometria toscana» 13.451 viste e 1,1% di
// clic in sesta posizione, sotto CFR, SIR e la Panoramica AI che dicono tutti
// solo «Pluviometria». Le ricerche con «mappa» cliccano il 20-33%, «ultimo
// mese» l'11%. Quindi le parole che gli ufficiali non hanno: mappa, quanti
// pluviometri, 30 giorni. RESTANO col titolo di ieri le tre che cliccano gia'
// bene (10-18%) e fanno da confronto: la misura vera e' la Toscana, l'unica con
// numeri abbastanza grandi. Tetto 64: la forma lunga della Toscana fa 64.
const TITOLO_IERI = new Set(['lazio', 'umbria', 'liguria']);
function titoloMappa(r, n) {
  const nome = r.nomeTitolo || r.nome;
  return [`Pluviometria ${nome}: mappa di ${n} pluviometri, ieri e 30 giorni`,
          `Pluviometria ${nome}: mappa di ${n} pluviometri, 30 giorni`,
          `Pluviometria ${nome}: mappa di ${n} pluviometri`].find(t => t.length <= 64) || `Pluviometria ${nome}: mappa dei pluviometri`;
}
// La descrizione: Google spesso la ignora e compone dal testo della pagina, ma
// quando la usa deve dire subito cosa c'e' (la mappa) e poi i numeri del giorno.
// ARPA Piemonte scrive i nomi in maiuscolo («COLLE DELL'AGNELLO (Cuneo)»): nella
// riga grigia di Google si leggono come un grido. Solo dove non c'e' nemmeno
// una minuscola, e lasciando minuscole le preposizioni dentro il nome.
const bello = s => s.toLowerCase()
  .replace(/(^|[\s(\-'])([a-zà-ü])/g, (m, a, c) => a + c.toUpperCase())
  .replace(/(\s)(Di|Del|Dello|Della|Dei|Degli|Delle|Dell'|D'|Al|Allo|Alla|Sul|Sulla|In|La|Le|Lo)(?=[\s'A-Z])/g, (m, a, p) => a + p.toLowerCase());
// il nome e la provincia fra parentesi si guardano a parte: «COLLE DELL'AGNELLO (Cuneo)»
const nomeBello = n => {
  const m = String(n).match(/^(.*?)(?:\s*\(([^)]*)\))?$/); let base = m[1], prov = m[2];
  if (!/[a-zà-ü]/.test(base)) base = bello(base);
  if (prov && prov.length > 2 && !/[a-zà-ü]/.test(prov)) prov = bello(prov);
  return base + (prov != null ? ' (' + prov + ')' : '');
};
function descrMappa(r, j, N, n) {
  const ag = r.agenziaCorta || r.agenzia;
  const di = /^Provincia/.test(ag) ? 'della ' : /^Centro/.test(ag) ? 'del ' : '';
  const apre = `Mappa di ${n} pluviometri ${di}${ag} aggiornata ogni mattina.`;
  const coda = 'Tocca un paese e vedi il grafico.';
  if (!N) return [`${apre} Quanto ha piovuto ieri e negli ultimi 7, 20 e 30 giorni. ${coda}`, `${apre} Ieri e ultimi 30 giorni. ${coda}`, apre].find(t => t.length <= 158);
  const d1 = j.periodi['1'], d7 = j.periodi['7'], t1 = d1 && d1.top && d1.top[0], t7 = d7 && d7.top && d7.top[0];
  const quando = N.ieri ? 'Ieri' : 'Il ' + lungoIso(N.ultimo);
  const uno = !d1 || !d1.giorni ? null : t1 && t1.mm >= 1 ? `${quando} ${virgola(t1.mm)} mm ${aDi(nomeBello(t1.n))}` : `${quando} giornata ${t1 && t1.mm > 0 ? 'quasi ' : ''}asciutta`;
  const sette = t7 && t7.mm >= 1 ? `in 7 giorni ${Math.round(t7.mm)} mm ${aDi(nomeBello(t7.n))}` : null;
  const numeri = [uno, sette].filter(Boolean).join(', ');
  const forme = [`${apre} ${numeri}. ${coda}`, `${apre} ${numeri}.`, `${apre} ${uno ? uno + '.' : ''} ${coda}`, apre];
  return forme.map(t => t.replace(/\s+/g, ' ').replace(/ \./g, '.').trim()).find(t => t.length <= 158);
}
function descrCotta(r, j, N) {
  const ag = r.agenziaCorta || r.agenzia, d1 = j.periodi['1'], d7 = j.periodi['7'];
  const quando = (N.ieri ? 'Ieri ' : 'Il ') + lungoIso(N.ultimo);
  const t1 = d1 && d1.top && d1.top[0], t7 = d7.top && d7.top[0];
  const primo = !d1 || !d1.giorni ? null
    : t1 && t1.mm >= 1 ? `${quando}: ${virgola(t1.mm)} mm ${aDi(t1.n)}.`
    : `${quando}: giornata ${t1 && t1.mm > 0 ? 'quasi ' : ''}asciutta ${r.prep} ${r.nome}.`;
  const sette = `Ultimi 7 giorni: ${virgola(d7.media)} mm di media su ${d7.stazioni} pluviometri ${ag}`;
  const forme = [
    [primo, sette + (t7 && t7.mm >= 1 ? `, ${Math.round(t7.mm)} mm ${aDi(t7.n)}.` : '.')],
    [primo, sette + '.'],
    [primo, `Ultimi 7 giorni: ${virgola(d7.media)} mm di media.`],
    [primo],
  ];
  for (const f of forme) { const t = f.filter(Boolean).join(' '); if (t.length <= 158) return t; }
  return null;
}

// ⚠️ SOLO LE REGIONI SANE (11/10/2026, sua scelta). Restano col guscio quelle
// che nel mese hanno avuto problemi veri: Basilicata (6 buchi MeteoHub in un
// mese), Molise (5, e 28 pluviometri), Puglia (4, e il guasto POLARIS), Sicilia
// (6-7/10 a 84 stazioni su 424, coperte con stime), Slovenia (36 ore di
// ritardo: «ieri» non ce l'ha mai), Svizzera (riepilogo fermo a due giorni
// prima, da capire). L'Abruzzo una pagina non ce l'ha. Una regione si aggiunge
// o si toglie da qui e basta.
const COTTE = ['lombardia','piemonte','valledaosta','liguria','emilia','veneto','friuli','trentino',
  'altoadige','toscana','austria','marche','umbria','campania','calabria','sardegna','lazio',
  // 15/10/2026: entrano anche queste cinque, i loro riepiloghi sono freschi tutti i
  // giorni. Fuori resta solo la SLOVENIA: ARSO pubblica con ~34 ore di ritardo e per
  // lei «ieri» non esiste mai.
  'svizzera','puglia','sicilia','basilicata','molise'];

function pagina(r, radice){
  const rip = radice && COTTE.includes(r.k) ? riepilogoFresco(radice, r.k) : null;
  const N = rip ? numeriRegione(rip, oggiItalia(), r.k, SITO) : null;
  // il valore cotto se c'e', se no quello del guscio
  const cotto = (fn, guscio) => N ? fn() : guscio;
  // ⚠️ TITOLO E DESCRIZIONE rifatti il 23/8/2026 sui dati di Search Console, e
  // qui dentro devono restare uguali a quelli pubblicati: la pagina Liguria era
  // vista 70 volte per «mappa pluviometri liguria» e cliccata zero, e la parola
  // «pluviometri» nel titolo non c'era. Fuori anche il suffisso «| Mappa
  // Pluviometrica», che mangiava spazio ripetendo la stessa parola, e i titoli
  // sono passati da 78-93 caratteri (tagliati da Google) a 51-59.
  // «misurata» nella descrizione fa un lavoro preciso: dice che non siamo una
  // previsione. Limiti da rispettare: titolo <= 62, descrizione <= 158.
  const nomeCorto = r.nomeTitolo || r.nome;
  // ⚠️ 25/9/2026, SEARCH CONSOLE 90 GIORNI: «pluviometria toscana» 6.216 viste
  // e 0,7% di clic in 8ª posizione, «pluviometria toscana ultimo mese» 747,
  // «pluviometro toscana» 763, «mappa pluviometri liguria» 234. Il titolo della
  // scheda diceva gia' «Pluviometria», il testo della pagina quasi mai: le
  // parole ora stanno anche nel testo fisso (sottotitolo, «ultimo mese»,
  // «mappa pluviometrica»). Ricontrollare con `sc.py` verso meta' ottobre.
  const gen = GEN[r.k];
  const titolo = `Dove ha piovuto ${r.prep} ${r.nome}`;
  // ⚠️ 13/9/2026: «PLUVIOMETRIA» IN TESTA. Search Console, 28 giorni: la gente
  // cerca «pluviometria toscana» (1.527 viste, nono posto, 0,6% di clic),
  // «pluviometria emilia romagna», «dati pluviometrici basilicata», e il
  // titolo quelle parole non le aveva in nessuna regione. «Dove ha piovuto»
  // resta, perche' e' la ricerca dei funghi. Tetto 62 caratteri come prima:
  // si prova la forma lunga e si accorcia solo dove il nome non ci sta
  // (Valle d'Aosta, Emilia-Romagna).
  const titoloTag = [
    `Pluviometria ${nomeCorto}: dove ha piovuto e dati dei pluviometri`,
    `Pluviometria ${nomeCorto}: dove ha piovuto, dati pluviometrici`,
    `Pluviometria ${nomeCorto}: dove ha piovuto e i pluviometri`,
  ].find(t => t.length <= 62) || `Pluviometria ${nomeCorto}: dove ha piovuto`;
  const agMeta = r.agenziaCorta || r.agenzia;
  const code = ['Le zone più bagnate, aggiornate ogni giorno.', 'Zone più bagnate, aggiornate ogni giorno.',
                'Zone più bagnate, ogni giorno.', 'Aggiornate ogni giorno.', ''];
  const prep2 = /^(Provincia|Centro)/.test(agMeta) ? (agMeta.startsWith('Provincia') ? 'della' : 'del') : 'di';
  let descr = '';
  for (const coda of code) {
    descr = `Dove ha piovuto ieri ${r.prep} ${nomeCorto} e negli ultimi 7, 20 e 30 giorni: dati pluviometrici di ${r.staz} pluviometri ${prep2} ${agMeta}. ${coda}`.trim();
    if (descr.length <= 158) break;
  }
  const fonteFooter = r.url
    ? `<a href="${r.url}" target="_blank" rel="noopener">${r.agenzia}</a>`
    : r.agenzia;
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attr(TITOLO_IERI.has(r.k) ? ((N && titoloCotto(r, rip, N)) || titoloTag) : titoloMappa(r, N ? rip.periodi['7'].stazioni : r.staz))}</title>
<meta name="description" content="${attr(TITOLO_IERI.has(r.k) ? ((N && descrCotta(r, rip, N)) || descr) : descrMappa(r, rip, N, N ? rip.periodi['7'].stazioni : r.staz))}">
<link rel="canonical" href="${SITO}/${r.k}/">
<meta property="og:title" content="${titolo}: ieri e negli ultimi giorni">
<meta property="og:description" content="Riepilogo degli ultimi 7, 20 e 30 giorni con le zone più bagnate, da ${r.staz} pluviometri di ${r.agenzia}.">
<meta property="og:image" content="${SITO}/preview.jpg">
<meta property="og:url" content="${SITO}/${r.k}/">
<meta property="og:type" content="website">
<!-- Google tag (gtag.js) — stessa proprietà del sito.
     ⚠️ Il config sta dietro al controllo sull'HOSTNAME, come in index.html dal
     22/7/2026: senza, le stesse pagine pubblicate sul sito di TEST manderebbero
     eventi alla proprietà vera, e sono proprio i numeri per regione che si
     stanno usando per giudicare titoli e descrizioni. Senza quel config gtag.js
     non invia nulla e le chiamate gtag('event',…) sparse nella pagina restano
     innocue. La regex copre dominio nudo e www. -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (/(^|\\.)avventuremicologiche\\.it$/.test(location.hostname)) {
    gtag('config', '${GA_ID}');
  }
</script>
<style>
:root{--blu:#1b3f6e;--blu-scuro:#123252;--grigio:#f0f4fb;--bordo:#d0d8e8;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#222;background:#fff;font-size:17px;line-height:1.6;}
header{background:var(--blu);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
header a{color:#fff;text-decoration:none;}
header .logo{font-weight:600;font-size:15px;display:flex;align-items:center;gap:7px;}
header .yt{margin-left:auto;background:#e12b2b;font-size:13px;font-weight:600;padding:6px 11px;border-radius:7px;white-space:nowrap;}
main{max-width:760px;margin:0 auto;padding:22px 16px 4px;}
h1{color:var(--blu-scuro);font-size:30px;line-height:1.25;margin-bottom:8px;}
h1,h2{text-wrap:balance;}
p,li{text-wrap:pretty;}
.sotto{color:#555;font-size:17px;margin-bottom:12px;}
h2{color:var(--blu-scuro);font-size:22px;margin:34px 0 10px;}
p{margin-bottom:12px;}
.cta{display:block;text-align:center;background:var(--blu);color:#fff;font-size:19px;font-weight:600;padding:15px 18px;border-radius:9px;text-decoration:none;margin:22px 0;}
.cta:hover{background:#2a5490;}
.griglia{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0;}
.card{background:var(--grigio);border:1px solid var(--bordo);border-radius:9px;padding:14px 15px;display:flex;flex-direction:column;}
.card h3{margin:0 0 4px;font-size:17px;color:var(--blu-scuro);}
.numerone{font-size:30px;font-weight:700;color:var(--blu-scuro);line-height:1.2;}
.numerone small{font-size:14px;font-weight:400;color:#555;}
.card .vai{margin-top:auto;padding-top:10px;font-size:15px;font-weight:600;color:var(--blu);text-decoration:none;}
.attesa{color:#777;font-style:italic;}
.nota{font-size:14px;color:#666;margin-top:8px;}
.top-staz{margin:6px 0 0;font-size:15px;}
.top-staz li{margin:3px 0 3px 20px;}
.verdetto .top{font-size:16px;opacity:.92;margin-top:8px;}
.verdetto .top b{font-weight:700;}
#attesa{color:#6a7789;font-size:16px;padding:18px 0;}
ol.zone-dove{list-style:none;margin:10px 0 6px;padding:0;counter-reset:z;}
ol.zone-dove li{counter-increment:z;display:flex;align-items:baseline;gap:10px;padding:8px 2px;border-bottom:1px solid var(--bordo);}
ol.zone-dove li:before{content:counter(z);min-width:22px;text-align:right;color:#8a97a6;font-size:13px;}
ol.zone-dove a{font-weight:600;color:var(--blu);text-decoration:none;}
ol.zone-dove .zmm{margin-left:auto;font-weight:700;white-space:nowrap;color:var(--blu-scuro);}
ol.zone-dove .zmm small{font-weight:400;color:#6a7789;font-size:13px;margin-left:6px;}
footer{border-top:1px solid var(--bordo);margin-top:8px;padding:14px 16px 24px;font-size:14px;color:#555;text-align:center;}
footer a{color:var(--blu);}
nav.altre{border-top:1px solid var(--bordo);margin-top:30px;padding-top:14px;font-size:15px;color:#555;}
nav.altre b{display:block;color:var(--blu-scuro);font-size:16px;margin:14px 0 2px;}
nav.altre p{line-height:1.9;}
nav.altre a{color:var(--blu);}
footer nav.altre{border-top:none;margin-top:0;padding-top:0;}
.capo-btns{display:flex;gap:9px;flex-wrap:wrap;margin-top:13px;}
.capo-btn{display:inline-block;text-decoration:none;color:#0f2d4d;font-weight:700;font-size:14.5px;
  padding:9px 15px 10px;border-radius:9px;border:1px solid #b9c7da;
  background:linear-gradient(180deg,#ffffff 0%,#f5f8fd 48%,#e8eef8 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95), 0 3px 0 #aebfd4, 0 6px 13px rgba(0,0,0,.28);}
@media(max-width:480px){h1{font-size:25px;}body{font-size:16px;}}
${STILE_NUOVO}
/* Sulle pagine piogge l'etichetta sta SOPRA la sua barra, non in cima al
   grafico: con 30 barre strette, in cima non si capiva di chi fosse. */
.gg .b b{position:static;transform:none;align-self:center;margin-bottom:2px;line-height:1.1;}
/* ── IL BOTTONE DI IERI, versione V2 (11/10/2026, sua scelta fra tre) ──
   Guardando la pagina dal PC: «le scritte cosi' piccole fanno schifo, i
   bottoni non sembrano bottoni». Fondo pieno, ombra profonda con un bordo
   sotto come un tasto, e la freccia in un tondo: il segno che si tocca.
   Gli altri bottoni (previsioni, tasti dei periodi, «Apri la mappa» delle
   schede, scritte del riquadro) stanno nel blocco COMUNE RILIEVO di
   lib-pagina-funghi.js, uguale per tutte le pagine: qui sotto, in fondo. */
.ieri-btn{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:12px;width:100%;
  text-decoration:none;background:#fff;color:#10263f;padding:14px 16px 15px 20px;border-radius:14px;line-height:1.35;
  box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 2px 0 #c9d6e6,0 6px 0 #7f97b6,0 12px 22px rgba(0,0,0,.38);
  transition:transform .08s,box-shadow .08s;}
.ieri-btn b{font-size:19px;font-weight:700;}
.ieri-btn small{font-size:15px;font-weight:500;color:#3f5672;}
.ieri-btn i{grid-row:1/span 2;grid-column:2;font-style:normal;width:40px;height:40px;border-radius:50%;
  background:#2a5490;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 0 #183a68;}
.ieri-btn:hover{background:#f3f7fc;}
.ieri-btn:active{transform:translateY(4px);box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 2px 0 #7f97b6,0 5px 10px rgba(0,0,0,.3);}
@media(max-width:480px){.ieri-btn b{font-size:17.5px;}.ieri-btn small{font-size:14px;}}
${RILIEVO}${QUIZ_REGIONI[r.k] ? QUIZ_CSS : ''}</style>
</head>
<body>
<header>
  <a class="logo" href="${SITO}/">🌧️ Mappa Pluviometrica</a>
  <a class="yt" href="${CANALE}" target="_blank" rel="noopener"
     onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}'})}catch(e){}">▶ Iscriviti</a>
</header>
<main>
<h1>${titolo}</h1>
<p class="sotto"><b>Pluviometria ${gen}</b>: i dati di ${r.staz} pluviometri di ${r.agenzia}, ieri e nell'ultimo mese, ${r.geo}.</p>

<!-- ⚠️ 25/9/2026: LO SCHEMA «PRIMA I DATI», lo stesso delle pagine funghi del
     24/9 (deciso da lui guardando Santo Stefano d'Aveto): in cima la risposta
     alla domanda del titolo, cioe' IERI, poi le barre, poi i periodi, le zone,
     le mappe. Le spiegazioni stanno in fondo, in piccolo. -->
<div id="attesa"${N ? ' style="display:none"></div>' : '>Sto leggendo i pluviometri…</div>'}
<div id="verdetto">${cotto(() => N.verdetto, '')}</div>
<a class="banda-prev" href="${SITO}/?r=${r.k}&amp;m=prev"
   onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-banda-previsioni'})}catch(e){}">
  <span class="ic">☀️</span><span><b>Che tempo farà ${r.prep} ${r.nome}</b><span>Previsioni per i prossimi 7 giorni</span></span><span class="fr">→</span></a>

<h2>La pioggia degli ultimi 30 giorni</h2>
<div id="grafico">${cotto(() => N.grafico, '')}</div>

<h2>Dove ha piovuto di più</h2>
<div class="griglia">
  <div class="card">
    <h3>Ultimi 7 giorni</h3>
    <div class="numerone" id="rip7-media">${cotto(() => N.periodi['7'].media || '', '<span class="attesa">…</span>')}</div>
    <div id="rip7-top">${cotto(() => N.periodi['7'].top || '', '')}</div>
    <p class="nota" id="rip7-date">${cotto(() => N.periodi['7'].date || '', '')}</p>
    <!-- ⚠️ L'indirizzo scritto qui deve GIA' portare alla regione (23/8/2026):
         lo script in fondo lo riscrive con le date esatte, ma solo dopo che i
         dati sono arrivati. Il parametro g sono i giorni: la mappa li fa date. -->
    <a class="vai" id="cta7" href="${cotto(() => attr(N.tasti['cta7']), `${SITO}/?r=${r.k}&amp;g=7`)}"
       onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-7gg'})}catch(e){}">Apri la mappa →</a>
  </div>
  <div class="card">
    <h3>Ultimi 20 giorni</h3>
    <div class="numerone" id="rip20-media">${cotto(() => N.periodi['20'].media || '', '<span class="attesa">…</span>')}</div>
    <div id="rip20-top">${cotto(() => N.periodi['20'].top || '', '')}</div>
    <p class="nota" id="rip20-date">${cotto(() => N.periodi['20'].date || '', '')}</p>
    <a class="vai" id="cta20" href="${cotto(() => attr(N.tasti['cta20']), `${SITO}/?r=${r.k}&amp;g=20`)}"
       onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-20gg'})}catch(e){}">Apri la mappa →</a>
  </div>
  <div class="card" id="card30"${N && N.periodi['30'].nascondi ? ' style="display:none"' : ''}>
    <h3>Ultimo mese</h3>
    <div class="numerone" id="rip30-media">${cotto(() => N.periodi['30'].media || '', '<span class="attesa">…</span>')}</div>
    <div id="rip30-top">${cotto(() => N.periodi['30'].top || '', '')}</div>
    <p class="nota" id="rip30-date">${cotto(() => N.periodi['30'].date || '', '')}</p>
    <a class="vai" id="cta30" href="${cotto(() => attr(N.tasti['cta30']), `${SITO}/?r=${r.k}&amp;g=30`)}"
       onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-30gg'})}catch(e){}">Apri la mappa →</a>
  </div>
</div>
${(() => {
  // I link alle zone sono COTTI nell'HTML (li legge Google); il javascript
  // riempie i millimetri e riordina le righe spostando i nodi.
  const zz = ZONE.filter(z => z.reg === r.k).sort((a, b) => a.n.localeCompare(b.n, 'it'));
  if (!zz.length) return '';
  // cotta: dal valore piu' alto, le zone senza numero in fondo (come il browser)
  const zv = z => N && N.zone[slug(z.n)];
  if (N) zz.sort((a, b) => { const va = zv(a), vb = zv(b);
    if (!va || va.val == null) return 1; if (!vb || vb.val == null) return -1; return vb.val - va.val; });
  return `
<h2>Dove ha piovuto, zona per zona</h2>
<p class="nota" style="margin-top:0" id="zone-nota">Negli ultimi 7 giorni, media dei pluviometri di ogni zona. Ogni nome porta alla sua pagina.</p>
<ol class="zone-dove" id="zone">
${zz.map(z => `<li data-z="${slug(z.n)}"><a href="${SITO}/zone/${slug(z.n)}/">${z.n}</a><span class="zmm">${zv(z) ? zv(z).html : ''}</span></li>`).join('\n')}
</ol>
`;
})()}
<h2>Mappa pluviometrica ${gen}: guardala in dettaglio</h2>
<div class="tasti">
  <a class="forte" id="t1" href="${cotto(() => attr(N.tasti['t1']), `${SITO}/?r=${r.k}&amp;g=1`)}"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-1gg'})}catch(e){}">Ieri</a>
  <a id="t7" href="${cotto(() => attr(N.tasti['t7']), `${SITO}/?r=${r.k}&amp;g=7`)}"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-7gg'})}catch(e){}">Ultimi 7 gg</a>
  <a id="t15" href="${cotto(() => attr(N.tasti['t15']), `${SITO}/?r=${r.k}&amp;g=15`)}"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-15gg'})}catch(e){}">Ultimi 15 gg</a>
  <a id="t20" href="${cotto(() => attr(N.tasti['t20']), `${SITO}/?r=${r.k}&amp;g=20`)}"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-20gg'})}catch(e){}">Ultimi 20 gg</a>
  <a id="t30" href="${cotto(() => attr(N.tasti['t30']), `${SITO}/?r=${r.k}&amp;g=30`)}"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-30gg'})}catch(e){}">Ultimi 30 gg</a>
  <a href="${SITO}/?r=${r.k}&amp;radar=ora"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-radar'})}catch(e){}">📡 Radar adesso</a>
  <a class="t-prev" href="${SITO}/?r=${r.k}&amp;m=prev"
     onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-previsioni'})}catch(e){}">☀️ Previsioni</a>
</div>
<p class="breve">La pioggia degli ultimi 20 giorni ${r.prep} ${r.nome}, pluviometro per pluviometro.</p>
<a href="${cotto(() => attr(N.tasti['lnk-img']), `${SITO}/?r=${r.k}&amp;g=20`)}" id="lnk-img" style="display:block;text-decoration:none;"
   onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-anteprima'})}catch(e){}">
  <img class="img-mappa" src="${ANTEPRIME}/${r.k}.jpg" alt="La mappa delle piogge ${r.prep} ${r.nome}: le zone più bagnate, stazione per stazione"
       width="1600" height="1000" loading="lazy"></a>
${FUNGHI.includes(r.k) ? `
<h2>Piogge per funghi ${r.prep} ${nomeCorto}</h2>
<p style="margin-bottom:6px">Sei un appassionato di funghi? Guarda le nostre analisi in dettaglio:</p>
<ul style="margin:0 0 12px 22px;line-height:1.9">
  <li><a href="${SITO}/funghi/${r.k}/">Funghi ${r.prep} ${nomeCorto} oggi, dove stanno nascendo</a></li>
  <li><a href="${SITO}/funghi/">La nostra selezione delle località più bagnate</a></li>
</ul>` : ''}

<div class="noioso">
<h2>Come funziona questa pagina</h2>
<p>I millimetri li misurano <b>${r.staz} pluviometri di ${r.agenzia}</b>, strumenti a terra, non stime da modello.
I numeri in cima sono la media dei pluviometri della regione, giorno per giorno; sotto, i più bagnati di ogni periodo.
La giornata di oggi non è contata perché i pluviometri la stanno ancora misurando.</p>${r.nota ? `\n<p>${r.nota}</p>` : ''}
<h2>Dove piove oggi ${r.prep} ${r.nome}? La diretta radar</h2>
<p>Per la pioggia in corso c'è la <a href="${SITO}/?r=${r.k}&amp;radar=ora"
   onclick="try{gtag('event','apri_mappa',{da:'pagina-${r.k}-radar-testo'})}catch(e){}">diretta radar</a>:
dove sta piovendo in questo momento, le ultime due ore e i quaranta minuti seguenti. Il radar misura dal cielo,
a 2 km di risoluzione, e serve a vedere dove piove adesso; i millimetri di questa pagina sono quelli misurati a terra.</p>
<h2>Come si legge la mappa</h2>
<p>Il colore mostra i millimetri cumulati nel periodo che scegli: più è acceso, più acqua è caduta. Ogni pallino è
un pluviometro: cliccandolo trovi quota, grafico della pioggia degli ultimi 30 giorni e, dove ci sono i sensori,
temperatura, vento e umidità.</p>
<p><a href="${SITO}/guida/" onclick="try{gtag('event','click_guida',{pulsante:'pagina-${r.k}'})}catch(e){}">📖 Guida alla mappa: come si usa, tutte le funzioni</a></p>
${coppiaQuiz(r.k, `<a href="${CANALE}" target="_blank" rel="noopener" class="yt-btn"
   onclick="try{gtag('event','click_youtube',{pulsante:'pagina-${r.k}-fondo'})}catch(e){}"><svg width="21" height="15" viewBox="0 0 42 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="42" height="30" rx="6" fill="#e12b2b"/><polygon points="16,7 16,23 31,15" fill="#fff"/></svg>Vieni a trovarci su YouTube</a>`, `pagina-${r.k}-fondo`)}
</div>
</main>

<footer>
${navAltre('regione')}
  Dati: ${fonteFooter} ·
  <a href="${SITO}/fonti">tutte le fonti e licenze</a> ·
  <a href="https://avventuremicologiche.it">Avventure Micologiche</a><br>
  La mappa copre Italia, Svizzera, Austria, Francia e Slovenia — 5000+ stazioni.
</footer>

<script>
(function(){
  var DIRS=${JSON.stringify(r.dirs)}, K=${JSON.stringify(r.k)}, SITO=${JSON.stringify(SITO)};
  // In locale si legge la cartella del repo, come fa la mappa per l'indice dei
  // funghi: cosi' un riepilogo appena rigenerato si prova senza pubblicarlo.
  var BASE=/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)?'/data/':'${RAW}';
  var MESI=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  var MESI_L=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  var GIORNI=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  var NG=30;
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function giornoFa(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
  function daIso(s){ var p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
  function menoDa(s,n){ var d=daIso(s); d.setDate(d.getDate()-n); return d; }
  function breve(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI[(+p[1])-1]; }
  function lungo(s){ var p=String(s).split('-'); return (+p[2])+' '+MESI_L[(+p[1])-1]; }
  function num(n){ return (Math.round(n*10)/10).toFixed(1).replace('.', ','); }
  // Sotto i 10 mm il decimale conta (0,4 non e' zero), sopra no.
  function mm(n){ return n===0 ? '0' : n<10 ? num(n) : String(Math.round(n)); }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  // «Ieri» solo se e' davvero ieri: il riepilogo puo' essere di altroieri.
  function nomeGiorno(s){
    if(s===iso(giornoFa(1))) return 'Ieri';
    return GIORNI[daIso(s).getDay()]+' '+lungo(s);
  }
  function link(da,a){ return SITO+'/?r='+K+'&da='+da+'&a='+a+'&s=p'; }
  // «dal 18 al 24 settembre»: il mese una volta sola, l'apostrofo davanti a 1, 8, 11
  function dalAl(a,b){ var pa=a.split('-'), pb=b.split('-'), da=+pa[2], db=+pb[2];
    var ap=function(n){ return n===1||n===8||n===11; };
    return (ap(da)?'Dall’':'Dal ')+(pa[1]===pb[1]?da:lungo(a))+(ap(db)?' all’':' al ')+lungo(b); }

  // Indirizzi di partenza: portano gia' alla regione col periodo giusto anche
  // prima che arrivino i numeri. tasti() li riscrive con le date VERE.
  function tasti(ultimo){
    [['t1',1],['t7',7],['t15',15],['t20',20],['t30',30],['cta7',7],['cta20',20],['cta30',30],['lnk-img',20]].forEach(function(x){
      var el=document.getElementById(x[0]); if(el) el.href=link(iso(menoDa(ultimo,x[1]-1)),ultimo);
    });
  }
  tasti(iso(giornoFa(1)));

  // ⚠️ 11/10/2026: IL DISEGNO DEI NUMERI sta in lib-numeri-regione.js ed e'
  // la STESSA funzione con cui il generatore cuoce la pagina ogni mattina: qui
  // la copia il generatore. Se i numeri cambiano faccia, si cambia la' e basta.
  ${numeriRegione.toString()}

  function disegna(j){
    document.getElementById('attesa').style.display='none';
    var N=numeriRegione(j, iso(new Date()), K, SITO);
    Object.keys(N.tasti).forEach(function(id){ var el=document.getElementById(id); if(el) el.href=N.tasti[id]; });
    document.getElementById('verdetto').innerHTML=N.verdetto;
    document.getElementById('grafico').innerHTML=N.grafico;
    ['7','20','30'].forEach(function(k){
      var x=N.periodi[k];
      if(x.nascondi){ var c=document.getElementById('card'+k); if(c) c.style.display='none'; return; }
      document.getElementById('rip'+k+'-media').innerHTML=x.media;
      document.getElementById('rip'+k+'-top').innerHTML=x.top;
      document.getElementById('rip'+k+'-date').textContent=x.date;
    });
    // Le zone: si riempiono i numeri e si RIORDINANO le righe spostando i nodi,
    // cosi' i link cotti nell'HTML restano quelli che Google legge.
    var ol=document.getElementById('zone');
    if(ol&&j.zone&&j.zone.length){
      var li=[].slice.call(ol.querySelectorAll('li[data-z]'));
      li.forEach(function(x){ var z=N.zone[x.getAttribute('data-z')]; x.valore=z?z.val:null;
        if(z) x.querySelector('.zmm').innerHTML=z.html; });
      li.sort(function(a,b){ if(a.valore==null) return 1; if(b.valore==null) return -1; return b.valore-a.valore; })
        .forEach(function(x){ ol.appendChild(x); });
    }
  }

  // ── RIPIEGO: i giorni uno per uno, come faceva la pagina fino al 24/8/2026 ──
  // Una regione puo' leggere piu' cartelle (la Svizzera somma MeteoSvizzera e
  // OASI Ticino): si scaricano tutte e si uniscono.
  function prendi(d){
    return Promise.all(DIRS.map(function(dir){
      return fetch(BASE+dir+'/'+iso(d)+'.json')
        .then(function(res){ return res.ok?res.json():null; })
        .catch(function(){ return null; })
        .then(function(j){ return j&&j.stations ? {dir:dir,stations:j.stations} : null; });
    })).then(function(parti){ parti=parti.filter(Boolean); return parti.length ? parti : null; });
  }
  // GEMELLE: le stazioni delle cartelle successive entro ~1 km da una della
  // PRIMA cartella (la fonte di casa) sono la stessa stazione letta da un'altra
  // porta e si scartano. ⚠️ Questa e' la copia del RIPIEGO: quella che lavora
  // tutti i giorni sta in genera-riepiloghi.js. Le due devono restare gemelle.
  function scartaGemelle(files){
    var fuori={};
    if(DIRS.length<2) return fuori;
    var pos={};
    files.forEach(function(parti){ if(!parti) return; parti.forEach(function(p){
      if(p.dir!==DIRS[0]) return;
      p.stations.forEach(function(s){ pos[s.id]=[s.lat,s.lon]; });
    });});
    var casa=Object.keys(pos).map(function(k){ return pos[k]; });
    files.forEach(function(parti){ if(!parti) return; parti.forEach(function(p){
      if(p.dir===DIRS[0]) return;
      p.stations.forEach(function(s){
        var id=p.dir+':'+s.id;
        if(id in fuori) return;
        fuori[id]=casa.some(function(q){ return Math.abs(q[0]-s.lat)<0.009 && Math.abs(q[1]-s.lon)<0.013; });
      });
    });});
    return fuori;
  }
  function calcolaDaiFile(){
    var giorni=[]; for(var i=1;i<=NG;i++) giorni.push(giornoFa(i));
    return Promise.all(giorni.map(prendi)).then(function(files){
      var gemelle=scartaGemelle(files), periodi={}, serie=[];
      files.forEach(function(parti){
        if(!parti){ serie.push(null); return; }
        var t=0,n=0;
        parti.forEach(function(p){ p.stations.forEach(function(s){
          if(s.mm==null||gemelle[p.dir+':'+s.id]) return; t+=s.mm; n++; }); });
        serie.push(n?Math.round(t/n*10)/10:null);
      });
      [1,7,20,30].forEach(function(quanti){
        var somma={}, nomi={}, presenti=0, ultimo=null, primo=null;
        for(var k=0;k<quanti;k++){
          var parti=files[k]; if(!parti) continue;
          presenti++; if(!ultimo) ultimo=giorni[k]; primo=giorni[k];
          parti.forEach(function(p){ p.stations.forEach(function(s){
            if(s.mm==null) return; var id=p.dir+':'+s.id; if(gemelle[id]) return;
            somma[id]=(somma[id]||0)+s.mm; nomi[id]=s.n; }); });
        }
        var chiavi=Object.keys(somma);
        if(!presenti||!chiavi.length) return;
        var media=chiavi.reduce(function(a,id){ return a+somma[id]; },0)/chiavi.length;
        var top=chiavi.sort(function(a,b){ return somma[b]-somma[a]; }).slice(0,5)
          .map(function(id){ return {n:nomi[id], mm:somma[id]}; });
        periodi[String(quanti)]={media:media, top:top, primo:iso(primo), ultimo:iso(ultimo), giorni:presenti, stazioni:chiavi.length};
      });
      if(!periodi['7']){ document.getElementById('attesa').textContent='Non riesco a leggere l’archivio delle piogge in questo momento: riprova fra qualche minuto.'; return; }
      disegna({periodi:periodi, serie:serie});
    });
  }

  // ── STRADA NORMALE: il riepilogo gia' fatto, UNA richiesta ──
  // ⚠️ La freschezza si misura su QUANDO E' STATO SCRITTO (36 ore), non
  // sull'ultimo giorno che contiene: la Slovenia pubblica con 34 ore di ritardo
  // e la Puglia ha giornate che MeteoHub non consegna, quindi un riepilogo
  // sanissimo puo' finire due giorni indietro.
  function fresco(j){
    if(!j||!j.generato||!j.periodi||!j.periodi['20']||!j.periodi['7']) return false;
    var eta=Date.now()-new Date(j.generato).getTime();
    return eta>=0 && eta<36*3600*1000;
  }
  fetch(BASE+'riepiloghi/'+K+'.json')
    .then(function(res){ return res.ok?res.json():null; })
    .catch(function(){ return null; })
    .then(function(j){ if(j&&fresco(j)) return disegna(j); return calcolaDaiFile(); })
    .catch(function(){ return calcolaDaiFile(); });
})();
</script>
</body>
</html>
`;
}

// La sitemap sta in `genera-sitemap.js` dal 2/9/2026: da quando le famiglie di
// pagine sono due (regione e funghi) la scrivono tutt'e due i generatori, e una
// copia sola vuol dire che non possono divergere. Le date di nascita e la
// regola del `lastmod` stanno li'.

// ⚠️ Il repo ha fine riga MISTE e vanno rispettate, se no il diff esplode:
// gli HTML (index.html, fonti.html) sono a CRLF, sitemap.xml e robots.txt a
// LF. Scrivendo la sitemap a CRLF il diff passava da 20 righe a 144.
function scrivi(dest, testo, crlf){
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const norm = testo.replace(/\r\n/g, '\n');
  fs.writeFileSync(dest, crlf ? norm.replace(/\n/g, '\r\n') : norm, 'utf8');
}

// La tabella REGIONI e' l'anagrafe: quali cartelle dati legge una regione, come
// si chiama, quante stazioni dichiara. La usa anche `genera-riepiloghi.js`, che
// prepara i numeri per queste stesse pagine, e deve restare UNA SOLA: due
// elenchi di cartelle che divergono darebbero pagina e riepilogo diversi sullo
// stesso indirizzo. Per questo il file si lascia anche richiedere come modulo,
// e la scrittura vera parte solo se lo si lancia a mano.
/* ── LA BRICIOLA, VERSIONE PER I MOTORI DI RICERCA (8/9/2026) ───────────────
   Il pezzetto di dati strutturati che descrive il percorso della pagina. In
   pagina non si vede: serve a far comparire nei risultati di ricerca la riga
   «Piogge per funghi › Umbria › Cascia» al posto dell'indirizzo nudo. Chi cerca
   il nome di un paese capisce a colpo d'occhio che quella e' la scheda di quel
   posto e non una pagina qualunque del sito.
   ⚠️ L'ULTIMA voce e' la pagina stessa e va SENZA indirizzo: e' la forma che
   Google documenta, e mettendoci l'indirizzo corrente il controllo dei
   risultati arricchiti la segnala come errore.
   ⚠️ Deve dire ESATTAMENTE quello che dice la briciola visibile in cima alla
   pagina: se le due divergono, e' Google a dirlo e lo dice tardi. */
function briciolaJson(voci) {
  const dati = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: voci.map(([name, item], i) => {
      const v = { '@type': 'ListItem', position: i + 1, name };
      if (item) v.item = item;
      return v;
    }),
  };
  return `<script type="application/ld+json">${JSON.stringify(dati)}</script>`;
}

/* ── LA MAPPA DEL SITO, in fondo a `fonti.html` (9/9/2026) ──────────────────
   PERCHE' PROPRIO LI'. Misurato rendendo ogni pagina a 390 px, la finestra con
   cui Google le scansiona: su tutte le famiglie i link interni sono accesi al
   100% (indice 180 su 180, paese 35 su 35, zona 27 su 28, regione 27 su 27),
   TRANNE la mappa, che ne ha 1 acceso su 23. La striscia coi 20 link e le due
   voci del pie' di pagina sono display:none sotto i 600 px, e l'unico link che
   sopravvive e' «invia feedback», che porta qui. Per il programma che indicizza
   il sito, quindi, la mappa rimanda a una pagina sola, e quella pagina finora
   rimandava soltanto indietro alla mappa: un vicolo cieco.

   ⚠️ SI CHIAMA «MAPPA DEL SITO» e non «Tutte le pagine»: e' una sezione che i
   siti hanno da sempre e nessuno trova fuori posto in fondo a una pagina di
   servizio. La prima versione, provata l'8/9, aveva l'altro titolo ed e' stata
   scartata perche' sembrava messa li' a caso.

   ⚠️ SI SCRIVE FRA DUE SEGNAPOSTI e non si batte a mano: un secondo elenco di
   regioni da tenere allineato al primo e' la trappola che questo progetto ha
   gia' pagato. Se i segnaposti non ci sono si dice e non si scrive niente, che
   e' meglio di riscrivere il file a caso.
   ⚠️ `fonti.html` e' a CRLF: si riscrive con lo stesso `scrivi(..., true)`. */
function mappaDelSito(radice) {
  /* Dal 12/9/2026 i file sono DUE: `fonti.html` e la guida. L'elenco e' lo
     stesso e si scrive nello stesso modo, quindi si cicla invece di copiare la
     funzione: due elenchi che divergono sono la trappola gia' pagata. */
  for (const rel of ['fonti.html', path.join('guida', 'index.html')]) mappaInUnFile(radice, rel);
}

function mappaInUnFile(radice, rel) {
  const F = path.join(radice, rel);
  const A = '<!-- PAGINE:INIZIO -->', B = '<!-- PAGINE:FINE -->';
  if (!fs.existsSync(F)) { console.log(`  ⚠️ ${rel} non c'e': mappa del sito saltata`); return; }
  const testo = fs.readFileSync(F, 'utf8');
  const i = testo.indexOf(A), j = testo.indexOf(B);
  if (i < 0 || j < 0 || j < i) {
    console.log(`  ⚠️ ${rel} senza segnaposti PAGINE: mappa del sito saltata`);
    return;
  }
  const dentro = [
    A,
    '<p><b>Dove ha piovuto: tutti i pluviometri, pianura compresa</b></p>',
    `<p>${listaRegioni()}</p>`,
    '<div class="bosco">',
    '<p><b>🍄 Dove potrebbero esserci le prime nascite di funghi</b></p>',
    `<p><a href="${SITO}/funghi/">La nostra selezione, le località più bagnate</a> · ${listaFunghi()}</p>`,
    '</div>',
  ].join('\r\n') + '\r\n';
  const nuovo = testo.slice(0, i) + dentro + testo.slice(j);
  if (nuovo === testo) { console.log(`  ${rel}  (invariato)`); return; }
  scrivi(F, nuovo, true);
  console.log(`  ${rel}  mappa del sito: ${REGIONI.length} regioni e ${FUNGHI.length} funghi`);
}

module.exports = { REGIONI, FUNGHI, navAltre, briciolaJson };

if (require.main === module) {
  const radice = path.resolve(__dirname, '..', '..');
  const senza = REGIONI.filter(r => !GEN[r.k]).map(r => r.k);
  if (senza.length) { console.error('⚠️ manca il genitivo in GEN per: ' + senza.join(', ')); process.exit(1); }
  // SOLO=toscana,liguria rigenera solo quelle (prove, e il giro del mattino
  // che tocca le sole pagine regione): niente sitemap ne' mappa del sito.
  // SOLO=cotte = le regioni della lista COTTE: e' quello che usa il giro del mattino.
  const solo = process.env.SOLO === 'cotte' ? COTTE : (process.env.SOLO || '').split(',').filter(Boolean);
  REGIONI.filter(r => !solo.length || solo.includes(r.k)).forEach(r => {
    const html = pagina(r, radice);
    scrivi(path.join(radice, r.k, 'index.html'), html, true);
    const cotta = /<div id="attesa" style="display:none">/.test(html);
    console.log(`  /${r.k}/  ${r.nome} — ${r.staz} staz., ${r.dirs.join('+')}${cotta ? ' · cotta' : COTTE.includes(r.k) ? ' · guscio (riepilogo assente o vecchio)' : ' · guscio (fuori da COTTE)'}`);
  });
  if (solo.length) process.exit(0);
  mappaDelSito(radice);
  const voci = scriviSitemap(SITO, radice);
  console.log(`\n${REGIONI.length} pagine scritte, sitemap.xml con ${voci} indirizzi.`);
}
