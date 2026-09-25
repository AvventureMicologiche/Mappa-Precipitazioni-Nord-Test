/**
 * check-fonti.js — GitHub Actions (1 run/giorno)
 *
 * Allarme via mail quando la fonte dati di una regione smette di rispondere.
 *
 * Perché serve (31/7/2026). Da oggi i giorni mancanti del Nord vengono coperti
 * con stime Open-Meteo (check-gaps-nord.js). È la cosa giusta per la mappa —
 * meglio una stima dichiarata di un buco silenzioso che falsa i totali — ma
 * rende INVISIBILE il guasto: passata la grazia il file compare, la mappa non
 * mostra niente di strano, e una regione morta sembrerebbe viva per sempre.
 * Questo controllo guarda quindi solo i file di dati REALI e ignora le stime.
 *
 * SCELTA DELLA SOGLIA, sulla stessa misura fatta per il gapfill (45 giorni di
 * cronologia git): il file di un giorno arriva entro D+1 in tutte le regioni,
 * mai oltre. Tre giorni consecutivi senza dato reale non è un ritardo, è un
 * guasto. Tre è anche il giorno in cui il gapfill inizia a coprire: la mail
 * arriva esattamente quando il buco smetterebbe di vedersi.
 * ECCEZIONE Ticino: 5 giorni, perché il suo collector interroga l'archivio
 * OASI fino a D-7 e recupera davvero (in 135 giorni: zero buchi). Allarmarlo
 * a 3 vorrebbe dire allarmare su un dato che stava arrivando.
 *
 * SECONDO TIPO DI GUASTO — il giorno che arriva mezzo vuoto (aggiunto il
 * 31/7/2026 su richiesta dell'utente). Una fonte che consegna il 6% delle
 * stazioni è rotta quanto una spenta, ma il file c'è e il primo controllo la
 * vedrebbe sana. Peggio: la mappa somma quello che trova e mostra un totale
 * plausibile, con le zone scoperte che risultano asciutte anche se ha piovuto.
 * Un giorno è "malato" se ha meno del 50% delle stazioni della mediana dei
 * 14 giorni reali precedenti; la mail parte agli STESSI giorni consecutivi
 * dell'altro caso (3, o 5 per il Ticino).
 *
 * PERCHÉ IL 50% NON PUÒ DARE FALSI ALLARMI, misurato il 31/7/2026 su 731
 * giorni-regione di storico: il calo più profondo mai registrato è 97,8% (sei
 * stazioni su 272 in Piemonte, sette su 323 in Emilia). Nessun giorno sotto il
 * 90%, mai. Fra il rumore vero (2,2%) e la soglia c'è un abisso.
 *
 * IL GUASTO LUNGO CHE SI NORMALIZZA — trovato provando, non ragionando. Con la
 * sola mediana a 14 giorni, una Liguria a 20 stazioni su 199 per venti giorni
 * di fila NON suonava: la finestra si era riempita di giorni degradati, la
 * mediana era scesa a 20 e il guasto era diventato la normalità. Su un guasto
 * già dichiarato sarebbe pure partito un falso rientro. Il riferimento è quindi
 * il massimo fra tre numeri (dettagli in `analizza`): mediana a 14 giorni,
 * mediana a 45, e riferimento congelato nel registro all'apertura dell'allarme.
 * Provato: 20 giorni → suona; 35 giorni, con entrambe le mediane ormai
 * degradate → continua a suonare grazie al valore congelato.
 *
 * Un file con ZERO stazioni conta come giorno mancante, non come malato.
 *
 * TERZO TIPO DI GUASTO — gli eventi-buco MeteoHub (migrazione Italia v5.0).
 * Per le 10 reti del centro-sud il conteggio stazioni MENTE: il gapfill
 * MeteoHub integra le stazioni mancanti dentro il file (om:true) e a copertura
 * avvenuta il giorno sembra sano. Si legge quindi il registro
 * data/meteohub-gaps.json, che i giorni rotti li misura PRIMA della copertura:
 * 3 giorni consecutivi con eventi (mancante o parziale) che finiscono a ieri
 * (tolleranza 1 giorno per il ritardo di rilevamento) fanno partire la mail.
 * Nessuna soglia nuova da tarare: si riusa la misura già validata sul campo.
 *
 * Una sola mail per run, che raccoglie tutto: allarmi nuovi, promemoria dei
 * guasti ancora aperti, rientri, e il lunedì il riepilogo delle 11 regioni.
 * Il registro `data/alert-fonti.json` serve a non ripetersi: alla rilevazione
 * parte la mail, poi un promemoria ogni 3 giorni finché il problema resta.
 *
 * Prove a mano (nessuna tocca il registro):
 *   TEST_MAIL=1 node check-fonti.js            → mail di prova
 *   SIMULA=liguria:4 node check-fonti.js       → Liguria ferma da 4 giorni
 *   SIMULA=liguria:4:staz node check-fonti.js  → Liguria a stazioni ridotte da 4 giorni
 *   SIMULA=puglia:4:eventi node check-fonti.js → Puglia con eventi-buco da 4 giorni
 *   (per le reti MeteoHub vale anche il nome corto: puglia = meteohub-puglia)
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const REGISTRO = path.join(DATA_ROOT, 'alert-fonti.json');
const MAIL_FILE = path.join(__dirname, '..', '..', 'alert-mail.eml');
const REPO = 'https://github.com/AvventureMicologiche/Mappa-Precipitazioni-Nord';

const SOGLIA_DEFAULT = 3;
// Grazia lunga per le fonti che si auto-riparano dall'archivio: Ticino (OASI,
// query storiche, recupera fino a D-7) e Svizzera (MeteoSwiss, il file recent
// copre l'anno intero e il collector ricostruisce D-3..D-10 da solo).
const SOGLIA_PER_REGIONE = { ticino: 5, svizzera: 5, austria: 5,
  // Slovenia: 4 e non 3, e il motivo e strutturale, non prudenza. L'archivio
  // ARSO pubblica con ~34 ore di ritardo, quindi il file di IERI non esiste
  // MAI. `mancanti` si conta da ieri all'indietro: la Slovenia parte SEMPRE
  // da 1 anche quando funziona tutto. Con la soglia 3 delle altre suonerebbe
  // dopo appena DUE giorni veri di guasto; con 4 la sensibilita' torna quella
  // di tutti, cioe' tre giorni veri. Se dovesse risultare rumorosa si alza a
  // 5 come Austria e Svizzera (anche qui c'e' auto-riparazione: ogni run
  // ricostruisce D-2..D-9 e le query storiche rispondono su qualsiasi data).
  slovenia: 4,
  'francia-aura': 4, 'francia-bfc': 4, 'francia-bretagna': 4, 'francia-centro': 4, 'francia-corsica': 4, 'francia-grandest': 4, 'francia-hdf': 4, 'francia-idf': 4, 'francia-normandia': 4, 'francia-naq': 4, 'francia-occitania': 4, 'francia-loira': 4, 'francia-provenza': 4 };
const PROMEMORIA_GIORNI = 3;    // ogni quanto ripetere la mail su un guasto aperto
const MAX_INDIETRO = 30;        // oltre non serve guardare: è comunque un guasto grave
const SOGLIA_STAZIONI = 0.5;    // sotto metà della normalità il giorno è "malato"
const FINESTRA_MEDIANA = 14;    // normalità recente
const FINESTRA_LUNGA = 45;      // normalità che regge anche ai guasti lunghi
const MIN_RIFERIMENTO = 7;      // meno di così di storico e il confronto non si fa

// Le regioni attive: 11 del Nord + 10 MeteoHub del centro-sud (migrazione
// Italia v5.0). Escluse `valledaosta` e `friuli` (Open-Meteo, dismesse il
// 26/7/2026 e sostituite da valledaosta-cf e friuli-osmer) e
// `meteohub-lombardia` (rete di controllo del pilota, ferma per scelta):
// le loro cartelle sono ferme apposta, allarmarle sarebbe rumore.
const REGIONI = [
  { dir: 'altoadige',      nome: 'Alto Adige',    wf: 'altoadige.yml',      sito: 'https://weather.provinz.bz.it/' },
  { dir: 'emilia',         nome: 'Emilia Romagna', wf: 'emilia.yml',        sito: 'https://apps.arpae.it/REST/meteo_giornalieri' },
  { dir: 'friuli-osmer',   nome: 'Friuli VG',     wf: 'friuli-osmer.yml',   sito: 'https://www.meteo.fvg.it/' },
  { dir: 'liguria',        nome: 'Liguria',       wf: 'liguria.yml',        sito: 'https://omirl.regione.liguria.it/' },
  { dir: 'lombardia',      nome: 'Lombardia',     wf: 'lombardia.yml',      sito: 'https://dati.lombardia.it/' },
  { dir: 'piemonte',       nome: 'Piemonte',      wf: 'piemonte.yml',       sito: 'https://utility.arpa.piemonte.it/api_realtime' },
  { dir: 'ticino',         nome: 'Ticino',        wf: 'ticino.yml',         sito: 'https://oasi.ti.ch/' },
  { dir: 'svizzera',       nome: 'Svizzera (MeteoSwiss)', wf: 'svizzera.yml', sito: 'https://opendatadocs.meteoswiss.ch/' },
  { dir: 'austria',        nome: 'Austria (GeoSphere)',   wf: 'austria.yml',  sito: 'https://data.hub.geosphere.at/' },
  { dir: 'slovenia',       nome: 'Slovenia (ARSO)',       wf: 'slovenia.yml', sito: 'https://meteo.arso.gov.si/' },
  // Francia: 13 régions, un solo collector/workflow (Météo-France, dal 10/8/2026);
  // soglia 4 come le altre auto-riparanti (il pacchetto orario tiene ~5 giorni).
  { dir: 'francia-aura', nome: 'Francia — Alvernia-Rodano-Alpi', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-bfc', nome: 'Francia — Borgogna-Franca Contea', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-bretagna', nome: 'Francia — Bretagna', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-centro', nome: 'Francia — Centro-Valle Loira', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-corsica', nome: 'Francia — Corsica', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-grandest', nome: 'Francia — Grand Est', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-hdf', nome: 'Francia — Hauts-de-France', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-idf', nome: 'Francia — Île-de-France', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-normandia', nome: 'Francia — Normandia', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-naq', nome: 'Francia — Nuova Aquitania', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-occitania', nome: 'Francia — Occitania', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-loira', nome: 'Francia — Paesi della Loira', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'francia-provenza', nome: 'Francia — Provenza-Costa Azzurra', wf: 'francia.yml', sito: 'https://portail-api.meteofrance.fr/' },
  { dir: 'toscana',        nome: 'Toscana',       wf: 'toscana.yml',        sito: 'https://sir.toscana.it/monitoraggio/stazioni.php?type=pluvio' },
  { dir: 'trentino',       nome: 'Trentino',      wf: 'trentino.yml',       sito: 'https://dati.meteotrentino.it/' },
  { dir: 'valledaosta-cf', nome: "Valle d'Aosta", wf: 'valledaosta-cf.yml', sito: 'https://presidi2.regione.vda.it/' },
  { dir: 'veneto',         nome: 'Veneto',        wf: 'veneto.yml',         sito: 'https://www.arpa.veneto.it/' },
  // Centro-sud via MeteoHub (una sola piattaforma, un solo workflow)
  // Friuli: NON entra nel registro buchi di check-meteohub-gaps.js, e non e' una
  // dimenticanza. Li' un buco viene coperto con stime Open-Meteo, che qui non
  // servono: se MeteoHub salta un giorno restano le ~41 stazioni OSMER a coprire
  // il Friuli, quindi la mappa perde densita' ma non inventa una giornata asciutta.
  { dir: 'meteohub-friuli',     nome: 'Friuli (rete completa)', wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-marche',     nome: 'Marche',     wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-umbria',     nome: 'Umbria',     wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-lazio',      nome: 'Lazio',      wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-molise',     nome: 'Molise',     wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-campania',   nome: 'Campania',   wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-puglia',     nome: 'Puglia',     wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-basilicata', nome: 'Basilicata', wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-calabria',   nome: 'Calabria',   wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-sicilia',    nome: 'Sicilia',    wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' },
  { dir: 'meteohub-sardegna',   nome: 'Sardegna',   wf: 'meteohub.yml', sito: 'https://meteohub.agenziaitaliameteo.it/' }
];

const GAPS_METEOHUB = path.join(DATA_ROOT, 'meteohub-gaps.json');

const TEST_MAIL = process.env.TEST_MAIL === '1' || process.env.TEST_MAIL === 'true';
const SIMULA = (process.env.SIMULA || '').trim();

/* ---------- date (stessa logica degli altri script del progetto) ---------- */
function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
const fmtDate = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const daysDiff = (a, b) =>
  Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);
const itaDate = g => { const [y, m, d] = g.split('-'); return `${d}/${m}/${y}`; };

function leggi(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
/** File nato da stime nostre (gapfill, backfill, archivio), non dato di stazione. */
const eStima = j => !!j && typeof j.source === 'string' && /open-meteo/.test(j.source);

/* ---------- analisi di una regione ---------- */
const mediana = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Legge i giorni da ieri all'indietro e ne ricava i due conteggi.
 *
 * `mancanti`  giorni consecutivi senza dati reali, a partire da ieri.
 * `malati`    giorni reali consecutivi sotto la soglia di stazioni, da ieri.
 *
 * `rifMin` è il riferimento memorizzato nel registro quando l'allarme si è
 * aperto: serve a impedire che un guasto lungo si "normalizzi" (vedi sotto).
 *
 * Piemonte e Veneto non scrivono il campo `source`: il test "è una stima" è per
 * esclusione (lo è solo se il source dice open-meteo), quindi vanno bene uguale.
 */
function analizza(dir, noon, rifMin) {
  const giorni = [];
  for (let i = 1; i <= MAX_INDIETRO + FINESTRA_LUNGA; i++) {
    const g = fmtDate(new Date(noon - i * 86400000));
    const j = leggi(path.join(dir, g + '.json'));
    const n = (j && j.stations || []).length;
    giorni.push({ g, reale: !!j && !eStima(j) && n > 0, n, fonte: (j && j.source) || '(senza campo source)' });
  }

  // 1. giorni interamente mancanti, da ieri all'indietro
  let mancanti = 0;
  while (mancanti < MAX_INDIETRO && !giorni[mancanti].reale) mancanti++;
  const primoReale = giorni[mancanti] && giorni[mancanti].reale ? giorni[mancanti] : null;

  // 2. giorni reali sotto soglia di stazioni.
  //    Il riferimento è il MASSIMO fra tre numeri, e ognuno copre un caso:
  //    - mediana a 14 giorni → la normalità recente, quella che conta all'inizio
  //      del guasto (quando la finestra è ancora tutta sana);
  //    - mediana a 45 giorni → regge anche se il guasto dura settimane: finché i
  //      giorni degradati sono meno della metà della finestra, la mediana resta
  //      quella buona;
  //    - riferimento memorizzato nel registro all'apertura dell'allarme → una
  //      volta che il guasto è dichiarato, il metro non si tocca più.
  //    Senza queste tre reti insieme un guasto lungo si "normalizza": la
  //    mediana scivola verso il basso, il livello degradato diventa la norma e
  //    l'allarme si spegne da solo mandando pure un falso rientro. Misurato:
  //    con la sola mediana a 14 giorni, 20 giorni di Liguria a 20 stazioni su
  //    199 non suonavano affatto.
  const reali = giorni.filter(x => x.reale);
  const finestra = reali.slice(1, 1 + FINESTRA_LUNGA).map(x => x.n);
  let malati = 0, riferimento = 0;
  if (finestra.length >= MIN_RIFERIMENTO) {
    riferimento = Math.max(mediana(finestra.slice(0, FINESTRA_MEDIANA)), mediana(finestra), rifMin || 0);
    while (malati < reali.length && riferimento > 0 && reali[malati].n < SOGLIA_STAZIONI * riferimento) malati++;
  }

  return {
    mancanti,
    ultimoReale: primoReale ? primoReale.g : null,
    stazioni: primoReale ? primoReale.n : 0,
    fonte: primoReale ? primoReale.fonte : '?',
    malati,
    stazioniIeri: reali.length ? reali[0].n : 0,
    riferimento
  };
}

/* ---------- eventi-buco MeteoHub (dal registro, misura pre-copertura) ---------- */
// Il conteggio stazioni da solo NON basta per MeteoHub: check-meteohub-gaps.js
// integra le stazioni mancanti dentro il file marcandole `om:true`, quindi a
// copertura avvenuta il giorno torna pieno e sembra sano (il 27/7 la Puglia
// aveva 0 stazioni buone su 128: guardata dopo, non si vedeva più). Il registro
// data/meteohub-gaps.json quei giorni li ha misurati PRIMA della copertura.
// Regola: 3 giorni consecutivi con eventi (mancante o parziale) che finiscono
// a ieri. Tolleranza di 1 giorno sull'inizio del conteggio: il rilevamento
// arriva con 1-2 giorni di ritardo (campo `rilevato`), senza tolleranza un
// guasto ancora in corso suonerebbe in ritardo.
// Dal 4/8/2026 gli eventi marcati `lieve` NON contano: sono cali che lasciano
// la rete sopra il 60% della sua normalità, quindi con abbastanza stazioni per
// disegnare bene lo stesso. La Sicilia a 341 su 426 aveva fatto suonare
// l'allarme pur avendo, con quelle 341, una densità migliore di Lombardia e
// Piemonte in giornata piena. Restano nel registro perché la frequenza degli
// eventi è la metrica con cui si giudica MeteoHub, ma non svegliano nessuno.
function eventiMeteoHub(rete, noon) {
  const reg = leggi(GAPS_METEOHUB);
  const eventi = (reg && reg.eventi) || [];
  const perGiorno = {};
  eventi.filter(e => e.rete === rete && !e.lieve).forEach(e => { perGiorno[e.data] = e; });
  const inizio = perGiorno[fmtDate(new Date(noon - 86400000))] ? 1 : 2;
  let n = 0, ultimo = null;
  for (let i = inizio; i <= MAX_INDIETRO; i++) {
    const ev = perGiorno[fmtDate(new Date(noon - i * 86400000))];
    if (!ev) break;
    if (!ultimo) ultimo = ev;
    n++;
  }
  return { n, ultimo };
}

/* ---------- composizione della mail ---------- */
const coda = r => ['', `    workflow  ${REPO}/actions/workflows/${r.wf}`, `    fonte     ${r.sito}`, ''];

function blocco(r, st, soglia, dal, tipo) {
  if (tipo === 'eventi') {
    const u = st.ultimoEvento || {};
    return [
      `  ${r.nome}`,
      `    rete MeteoHub      ${u.rete || r.dir.replace('meteohub-', '')}`,
      `    eventi-buco        ${st.eventi} giorni consecutivi (soglia ${soglia})`,
      `    ultimo evento      ${u.data ? itaDate(u.data) : '?'} — ${u.tipo || '?'}${u.stazioniAttese ? `, ${u.stazioniViste ?? '?'} stazioni buone su ${u.stazioniAttese}` : ''}`,
      `    stato copertura    ${u.stato || 'aperto'}`,
      `    in questo stato da ${itaDate(dal)}`,
      ...coda(r)
    ].join('\n');
  }
  if (tipo === 'stazioni') {
    const perc = st.riferimento ? Math.round(st.stazioniIeri / st.riferimento * 100) : 0;
    return [
      `  ${r.nome}`,
      `    fonte              ${st.fonte}`,
      `    stazioni ieri      ${st.stazioniIeri} — normalmente ${st.riferimento} (${perc}%)`,
      `    giorni sotto metà  ${st.malati} (soglia ${soglia} giorni, sotto il ${Math.round(SOGLIA_STAZIONI * 100)}%)`,
      `    in questo stato da ${itaDate(dal)}`,
      ...coda(r)
    ].join('\n');
  }
  const primoMancante = fmtDate(new Date(new Date(st.ultimoReale || dal).getTime() + 86400000));
  return [
    `  ${r.nome}`,
    `    fonte              ${st.fonte}`,
    `    ultimo dato reale  ${st.ultimoReale ? `${itaDate(st.ultimoReale)} (${st.stazioni} stazioni)` : `nessuno negli ultimi ${MAX_INDIETRO} giorni`}`,
    `    giorni mancanti    ${st.mancanti}${st.ultimoReale ? `, dal ${itaDate(primoMancante)}` : ''} (soglia ${soglia})`,
    `    ferma da           ${itaDate(dal)}`,
    ...coda(r)
  ].join('\n');
}

/** Subject con accenti ed emoji: encoded-word base64, spezzato per non sforare i 75 caratteri. */
function encodeSubject(s) {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const chars = [...s];              // per code point: non spezza le coppie surrogate delle emoji
  const parti = [];
  for (let i = 0; i < chars.length; i += 15) {
    const pezzo = chars.slice(i, i + 15).join('');
    parti.push(`=?UTF-8?B?${Buffer.from(pezzo, 'utf8').toString('base64')}?=`);
  }
  return parti.join('\r\n ');
}

function scriviEml(subject, body) {
  const from = process.env.MAIL_USER || 'alert@example.invalid';
  const to = process.env.MAIL_TO || from;
  const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const eml = [
    `From: Mappa Precipitazioni <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    ''
  ].join('\r\n');
  fs.writeFileSync(MAIL_FILE, eml);
}

function output(chiave, valore) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${chiave}=${valore}\n`);
}

/* ---------- main ---------- */
function main() {
  const now = new Date();
  const oraItalia = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  const oggi = fmtDate(oraItalia);
  const noon = new Date(oggi + 'T12:00:00Z').getTime();
  const lunedi = oraItalia.getUTCDay() === 1;
  const prova = TEST_MAIL || !!SIMULA;   // le prove non devono sporcare il registro

  console.log(`=== check-fonti — ${oggi}${prova ? ' (PROVA, registro non toccato)' : ''} ===`);

  const registro = fs.existsSync(REGISTRO) ? leggi(REGISTRO) : null;
  const reg = registro && registro.regioni ? registro : {
    nota: 'Stato delle fonti dati per regione e mail di allarme già inviate. Scritto da .github/scripts/check-fonti.js',
    regioni: {},
    ultimoHeartbeat: null
  };

  const [simReg, simGiorni, simTipo] = SIMULA ? SIMULA.split(':') : [null, null, null];

  const allarmi = [], promemoria = [], rientri = [], riepilogo = [];
  let cambiato = false;

  for (const r of REGIONI) {
    const dir = path.join(DATA_ROOT, r.dir);
    if (!fs.existsSync(dir)) { console.log(`-- ${r.dir}: cartella assente, salto`); continue; }

    const soglia = SOGLIA_PER_REGIONE[r.dir] ?? SOGLIA_DEFAULT;
    const prec = reg.regioni[r.dir] || { stato: 'ok' };
    // Con l'allarme già aperto il metro resta quello di allora, non si rinegozia.
    const rifMin = (prec.stato === 'allarme' && prec.tipo === 'stazioni') ? (prec.riferimento || 0) : 0;
    const st = analizza(dir, noon, rifMin);

    // Terzo guasto, solo reti MeteoHub: giorni consecutivi con eventi-buco
    // nel registro (misura pre-copertura, vedi eventiMeteoHub).
    const rete = r.dir.startsWith('meteohub-') ? r.dir.slice('meteohub-'.length) : null;
    const ev = rete ? eventiMeteoHub(rete, noon) : { n: 0, ultimo: null };
    st.eventi = ev.n; st.ultimoEvento = ev.ultimo;

    // La simulazione accetta sia il nome cartella che quello corto
    // (`SIMULA=puglia:4` vale per `meteohub-puglia`).
    if (simReg === r.dir || (rete && simReg === rete)) {
      const n = parseInt(simGiorni || '99', 10);
      if (simTipo === 'staz') {
        st.malati = n;
        st.riferimento = st.riferimento || st.stazioni;
        st.stazioniIeri = Math.round(st.riferimento * 0.2);
      } else if (simTipo === 'eventi') {
        st.eventi = n;
        st.ultimoEvento = { rete: rete || r.dir, data: fmtDate(new Date(noon - 86400000)), tipo: 'parziale', stazioniViste: 5, stazioniAttese: 100, stato: 'aperto' };
      } else {
        st.mancanti = n;
        st.ultimoReale = fmtDate(new Date(noon - (n + 1) * 86400000)); // coerente col conteggio
      }
    }

    // Il guasto più grave vince: una regione spenta non è anche "a stazioni
    // ridotte", e va segnalata per quello che è. Per le reti MeteoHub gli
    // eventi-buco del registro battono il conteggio stazioni (che dopo la
    // copertura om:true mentirebbe).
    const tipo = st.mancanti >= soglia ? 'assente'
      : (st.eventi >= soglia ? 'eventi'
      : (st.malati >= soglia ? 'stazioni' : null));
    riepilogo.push({ r, st, soglia, tipo });
    const stato = () => ({
      ultimoReale: st.ultimoReale, giorniMancanti: st.mancanti,
      giorniMalati: st.malati, giorniEventi: st.eventi,
      stazioniIeri: st.stazioniIeri, riferimento: st.riferimento
    });

    if (tipo) {
      const descr = tipo === 'assente'
        ? `ferma da ${st.mancanti} giorni`
        : tipo === 'eventi'
        ? `eventi-buco MeteoHub da ${st.eventi} giorni consecutivi`
        : `${st.stazioniIeri} stazioni su ${st.riferimento} da ${st.malati} giorni`;
      // Se cambia la natura del guasto (si spegne del tutto dopo essersi
      // svuotata) si riparte da capo: è un'altra notizia, va mandata.
      if (prec.stato !== 'allarme' || prec.tipo !== tipo) {
        allarmi.push(blocco(r, st, soglia, oggi, tipo));
        reg.regioni[r.dir] = { stato: 'allarme', tipo, dal: oggi, ...stato(), ultimaMail: oggi };
        cambiato = true;
        console.log(`🔴 ${r.dir}: ${descr} (soglia ${soglia}) — ALLARME NUOVO [${tipo}]`);
      } else {
        const attesa = prec.ultimaMail ? daysDiff(oggi, prec.ultimaMail) : 99;
        if (attesa >= PROMEMORIA_GIORNI) {
          promemoria.push(blocco(r, st, soglia, prec.dal || oggi, tipo));
          prec.ultimaMail = oggi;
          console.log(`🔴 ${r.dir}: ${descr} — promemoria`);
        } else {
          console.log(`🔴 ${r.dir}: ${descr} — già segnalata, prossimo promemoria fra ${PROMEMORIA_GIORNI - attesa}g`);
        }
        reg.regioni[r.dir] = { ...prec, ...stato() };
        cambiato = true;
      }
    } else {
      if (prec.stato === 'allarme') {
        rientri.push(prec.tipo === 'stazioni'
          ? `  ${r.nome} — stazioni tornate normali (ieri ${st.stazioniIeri}, di norma ${st.riferimento}).\n` +
            `    Era a meno di metà dal ${itaDate(prec.dal)}. I giorni ridotti restano com'erano: quello che\n` +
            `    non è stato misurato allora non si recupera.\n`
          : prec.tipo === 'eventi'
          ? `  ${r.nome} — nessun nuovo evento-buco MeteoHub. In guasto dal ${itaDate(prec.dal)}.\n` +
            `    I giorni coperti nel frattempo restano integrazioni Open-Meteo (om:true nel file).\n`
          : `  ${r.nome} — dati reali di nuovo presenti (ultimo: ${itaDate(st.ultimoReale)}, ${st.stazioni} stazioni).\n` +
            `    Era ferma dal ${itaDate(prec.dal)}. I giorni scoperti nel frattempo restano stime Open-Meteo.\n`);
        console.log(`🟢 ${r.dir}: rientrata [${prec.tipo || 'assente'}]`);
        cambiato = true;
      }
      reg.regioni[r.dir] = { stato: 'ok', ...stato() };
      if (prec.stato !== 'ok' || prec.ultimoReale !== st.ultimoReale) cambiato = true;
      console.log(`   ${r.dir}: ultimo dato reale ${st.ultimoReale || '—'} (${st.mancanti} indietro), ` +
                  `ieri ${st.stazioniIeri} stazioni su ${st.riferimento || '?'} — soglia ${soglia}g`);
    }
  }

  /* --- heartbeat del lunedì --- */
  const heartbeat = TEST_MAIL || (lunedi && reg.ultimoHeartbeat !== oggi);
  if (heartbeat && !prova) { reg.ultimoHeartbeat = oggi; cambiato = true; }

  /* --- una sola mail, con dentro tutto quello che c'è --- */
  const sezioni = [];
  if (TEST_MAIL) sezioni.push(`PROVA DI CONSEGNA\n\n  Se leggi questa mail, l'allarme sulle fonti dati funziona.\n  Sotto trovi lo stato delle ${REGIONI.length} regioni.\n`);
  const problemi = riepilogo.filter(x => x.tipo);
  const assenti = problemi.filter(x => x.tipo === 'assente').length;
  const ridotte = problemi.filter(x => x.tipo === 'stazioni').length;
  const buchi = problemi.filter(x => x.tipo === 'eventi').length;
  if (allarmi.length) {
    sezioni.push(`ALLARME — ${problemi.length === 1 ? '1 regione' : `${problemi.length} regioni`}\n\n` + allarmi.join('\n') +
      (assenti ? '\n  La rete di sicurezza sta coprendo i giorni mancanti con stime Open-Meteo:\n' +
                 '  la mappa non mostra buchi, ma quei totali sono stime, non pioggia misurata.\n' : '') +
      (ridotte ? '\n  Attenzione al caso delle stazioni ridotte: i giorni ci sono e il totale in\n' +
                 '  mappa sembra normale, ma è calcolato su una frazione della rete. Le zone\n' +
                 '  rimaste scoperte risultano asciutte anche se ci ha piovuto.\n' : '') +
      (buchi ? '\n  Gli eventi-buco MeteoHub sono misurati PRIMA della copertura: a schermo i\n' +
               '  giorni sembrano pieni, ma le stazioni mancanti sono integrazioni Open-Meteo\n' +
               '  (om:true nel file). Il registro è data/meteohub-gaps.json.\n' : '') +
      `\n  Prossimo promemoria fra ${PROMEMORIA_GIORNI} giorni, se resta così.\n`);
  }
  if (promemoria.length) sezioni.push('ANCORA IN GUASTO\n\n' + promemoria.join('\n'));
  if (rientri.length) sezioni.push('RIENTRATA\n\n' + rientri.join('\n'));
  if (heartbeat) {
    const righe = riepilogo.map(x =>
      `  ${x.r.nome.padEnd(15)} ${(x.st.ultimoReale ? itaDate(x.st.ultimoReale) : '—').padEnd(12)} ` +
      `${String(x.st.stazioniIeri).padStart(4)}/${String(x.st.riferimento || '?').padEnd(4)} ${x.tipo ? '🔴' : '🟢'}`);
    sezioni.push('STATO DELLE FONTI\n\n  regione         ultimo dato  staz./norma\n' + righe.join('\n') + '\n');
  }

  if (!sezioni.length) {
    console.log('=== Niente da segnalare ===');
    output('mail', 'false');
    output('registro', String(cambiato && !prova));
    if (cambiato && !prova) salvaRegistro(reg);
    return;
  }

  let subject;
  if (TEST_MAIL) subject = '🧪 Pluviometro: prova di consegna';
  else if (allarmi.length || promemoria.length) {
    if (problemi.length === 1) {
      const p = problemi[0];
      subject = p.tipo === 'assente'
        ? `🔴 Pluviometro: ${p.r.nome} ferma da ${p.st.mancanti} giorni`
        : p.tipo === 'eventi'
        ? `🔴 Pluviometro: ${p.r.nome} con buchi MeteoHub da ${p.st.eventi} giorni`
        : `🔴 Pluviometro: ${p.r.nome} a ${Math.round(p.st.stazioniIeri / (p.st.riferimento || 1) * 100)}% delle stazioni`;
    } else {
      subject = `🔴 Pluviometro: ${problemi.length} regioni in guasto`;
    }
  }
  else if (rientri.length) subject = `🟢 Pluviometro: ${rientri.length === 1 ? 'fonte rientrata' : 'fonti rientrate'}`;
  else subject = '🟢 Pluviometro: tutte le fonti attive';

  const ora = `${itaDate(oggi)} ${String(oraItalia.getUTCHours()).padStart(2, '0')}:${String(oraItalia.getUTCMinutes()).padStart(2, '0')}`;
  const body = sezioni.join('\n') +
    `\n--\nMappa Precipitazioni Nord · controllo automatico delle fonti\n${ora} (ora italiana) · ${REPO}/actions/workflows/alert-fonti.yml\n`;

  scriviEml(subject, body);
  output('mail', 'true');
  output('registro', String(cambiato && !prova));
  if (cambiato && !prova) salvaRegistro(reg);

  console.log(`=== Mail pronta: ${subject} ===`);
  if (!process.env.GITHUB_OUTPUT) console.log('\n' + body);
}

function salvaRegistro(reg) {
  reg.aggiornato = new Date().toISOString();
  fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 2));
}

// ⚠️ Si lascia anche `require`, come genera-pagine-regione.js: la tabella
// REGIONI (cartella dati -> workflow che la produce) serve al guardiano, e due
// elenchi che divergono darebbero due verita' diverse sulla stessa cosa senza
// che nessuno se ne accorga. Lanciato a mano fa il suo lavoro di sempre.
if (require.main === module) {
  try { main(); } catch (e) { console.error('❌', e.message); process.exit(1); }
}

module.exports = { REGIONI, SOGLIA_PER_REGIONE };
