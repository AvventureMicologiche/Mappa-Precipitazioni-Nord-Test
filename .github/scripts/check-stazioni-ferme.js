/**
 * check-stazioni-ferme.js — GitHub Actions (1 run a settimana, il lunedì)
 *
 * Trova i pluviometri MORTI: quelli che continuano a consegnare il dato ogni
 * giorno, ma il dato è sempre zero (o quasi) mentre intorno a loro piove.
 *
 * Perché serve (21/8/2026). Una stazione spenta si vede subito: il file non
 * arriva e ci pensa check-fonti.js. Una stazione FERMA invece è invisibile:
 * il file c'è, la stazione c'è, il numero c'è, ed è 0. Sulla mappa diventa un
 * buco bianco in mezzo alla pioggia e abbassa la media della regione. Il
 * 20/8/2026, cercandoli a mano, ne sono usciti quattro in un pomeriggio: fra
 * questi 3014 Ferriere Pluvio (Emilia, 9% dei vicini in 46 giorni) e VIFRA
 * Villafranca Lunigiana (Liguria, 0,0 mm in 46 giorni). Quel pomeriggio è la
 * ragione di questo file: la stessa domanda, fatta ogni lunedì da sola.
 *
 * NON CHIAMA NESSUNA FONTE ESTERNA. Legge solo i nostri file, che sono già nel
 * checkout: nessuna rete, nessuna chiave, nessun limite di quota da rispettare.
 * È l'opposto di check-mnw-sud.js, che interrogava un testimone di fuori e in
 * 45 giorni non ha trovato un solo errore dimostrabile. Qui il testimone sono
 * i pluviometri vicini, che sono già nostri.
 *
 * NON TOCCA UN SOLO DATO e non esclude niente da sola: manda l'elenco, la
 * decisione di escludere resta una scelta umana, come è stato per 3014 e VIFRA.
 *
 * LE SOGLIE, e perché queste.
 *  - FINESTRA 45 giorni: è la misura con cui i quattro morti sono stati
 *    trovati a mano, ed è il minimo per avere pioggia quasi ovunque anche in
 *    un'estate secca. Più corta, in una settimana asciutta sarebbero tutti
 *    "fermi"; più lunga, un pluviometro riparato resterebbe accusato per mesi.
 *  - ALMENO 30 GIORNI DI DATO REALE nella finestra: sotto quella soglia il
 *    problema è un buco di raccolta, e quello è mestiere di check-fonti.js e
 *    check-gaps-nord.js. Qui si giudica solo chi ha consegnato con regolarità.
 *  - 5 VICINI ENTRO 25 KM, mediana: un solo vicino può essere rotto pure lui,
 *    la mediana di cinque no. Venticinque chilometri perché oltre, in montagna,
 *    due stazioni non vedono più lo stesso tempo.
 *  - I VICINI DEVONO AVERE ALMENO 50 mm nel periodo: senza pioggia intorno non
 *    c'è niente da misurare e uno zero è la verità, non un guasto. È questa
 *    condizione che tiene buono il controllo in una regione asciutta.
 *  - SOTTO IL 15% della mediana dei vicini: Ferriere stava al 9%, VIFRA a 0%.
 *    Un pluviometro sano, anche in un punto riparato, non scende sotto un
 *    quinto dei vicini su 45 giorni.
 *
 * I GIORNI STIMATI NON CONTANO. Se il giorno è stato coperto con Open-Meteo
 * (campo `source` che contiene "open-meteo") viene saltato: la stima è
 * calcolata sulle coordinate della stazione e darebbe pioggia anche a un
 * pluviometro morto, cioè coprirebbe esattamente il guasto che cerchiamo.
 * Stesso test usato da check-fonti.js.
 *
 * IL REGISTRO data/stazioni-ferme.json serve a non ripetersi: una stazione si
 * segnala una volta sola. Se torna a misurare esce dal registro in silenzio,
 * senza mail: un rientro è una buona notizia, e le buone notizie non svegliano
 * nessuno (vedi la regola sugli avvisi per i casi rari).
 *
 * Variabili d'ambiente: DATA_DIR (default data/), FINESTRA, MIN_GIORNI,
 * MIN_VICINI_MM, RAPPORTO, RAGGIO_KM, SOLO_ELENCO=1 (stampa e basta, non
 * scrive registro né mail: è il modo in cui si prova in locale).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR      = process.env.DATA_DIR || 'data';
const FINESTRA      = parseInt(process.env.FINESTRA || '45', 10);
const MIN_GIORNI    = parseInt(process.env.MIN_GIORNI || '30', 10);
const MIN_VICINI_MM = parseFloat(process.env.MIN_VICINI_MM || '50');
const RAPPORTO      = parseFloat(process.env.RAPPORTO || '0.15');
const RAGGIO_KM     = parseFloat(process.env.RAGGIO_KM || '25');
const N_VICINI      = 5;
// Il vicino piu' prossimo e' il testimone piu' forte che esista: se la stazione
// non e' bassa nemmeno rispetto a lui, la mediana dei cinque puo' essere gonfiata
// da pluviometri dall'altra parte di un crinale. Aggiunta il 21/8/2026 dopo la
// Val Borbera: Cabella Ligure faceva 27,7 mm contro una mediana di 92 (il 30%),
// ma a 5,5 km Roccaforte ne faceva 14 e sulle creste ne facevano 99. Era il
// gradiente fondovalle-crinale, non un guasto.
const VICINO_RAP    = parseFloat(process.env.VICINO_RAP || '0.50');
const VICINO_MIN_MM = 20;   // sotto questa pioggia il vicino non fa testimonianza
const SOLO_ELENCO   = process.env.SOLO_ELENCO === '1';
const REGISTRO      = path.join(DATA_DIR, 'stazioni-ferme.json');

const fmt = d => d.toISOString().slice(0, 10);
const eStima = j => !!j && typeof j.source === 'string' && /open-meteo/i.test(j.source);

function giorniFinestra() {
  const g = [];
  const oggi = new Date();
  for (let i = FINESTRA; i >= 1; i--) {
    const d = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate() - i));
    g.push(fmt(d));
  }
  return g;
}

// Distanza in km, formula dell'emisenoverso. Basta e avanza: qui si decide se
// due pluviometri vedono lo stesso temporale, non si naviga.
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const mediana = a => {
  const v = [...a].sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function regioni() {
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

// ── Somma dei 45 giorni, regione per regione ────────────────────────────────
const giorni = giorniFinestra();
const stazioni = [];   // { regione, id, nome, prov, quota, lat, lon, tot, giorni }
let filiLetti = 0, filiStima = 0;

for (const reg of regioni()) {
  const dir = path.join(DATA_DIR, reg);
  const acc = new Map();
  for (let gi = 0; gi < giorni.length; gi++) {
    const g = giorni[gi];
    const f = path.join(dir, g + '.json');
    if (!fs.existsSync(f)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    if (eStima(j)) { filiStima++; continue; }
    filiLetti++;
    for (const s of (j.stations || [])) {
      if (typeof s.mm !== 'number' || typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      const k = String(s.id);
      let a = acc.get(k);
      if (!a) { a = { regione: reg, id: k, nome: s.n, prov: s.p, quota: s.q, lat: s.lat, lon: s.lon, tot: 0, giorni: 0, per: new Array(giorni.length).fill(null) }; acc.set(k, a); }
      a.per[gi] = s.mm;
      a.tot += s.mm;
      a.giorni++;
      a.nome = s.n || a.nome;          // l'ultimo nome visto, se cambia grafia
      a.lat = s.lat; a.lon = s.lon;
    }
  }
  for (const a of acc.values()) stazioni.push(a);
}

// Solo chi ha consegnato con regolarità puo' essere giudicato: gli altri sono
// un problema di buchi, non di pluviometro fermo.
const giudicabili = stazioni.filter(s => s.giorni >= MIN_GIORNI);

console.log(`Finestra ${giorni[0]} → ${giorni[giorni.length - 1]} (${FINESTRA} giorni)`);
console.log(`File reali letti: ${filiLetti}, giorni stimati saltati: ${filiStima}`);
console.log(`Stazioni totali: ${stazioni.length}, giudicabili (>=${MIN_GIORNI} giorni): ${giudicabili.length}`);

// ── Il confronto con i vicini ───────────────────────────────────────────────
// ⚠️ SI SOMMA SUI SOLI GIORNI CHE LA STAZIONE HA CONSEGNATO. Confrontare il suo
// totale con vicini sommati su tutti i 45 giorni fa sembrare rotta ogni stazione
// che ha dei buchi: e' l'errore che il 21/8/2026 aveva fatto escludere Croce
// Arcana (27 giorni su 40), che sui SUOI giorni fa il 71% dei vicini, cioe' e'
// sana. Un vicino vale come testimone solo se copre almeno il 90% di quei giorni.
function sommaSuiGiorni(v, indici) {
  let t = 0, n = 0;
  for (const i of indici) { if (v.per[i] === null) continue; t += v.per[i]; n++; }
  return n >= indici.length * 0.9 ? t : null;
}

const sospette = [];
for (const s of giudicabili) {
  const indici = [];
  s.per.forEach((v, i) => { if (v !== null) indici.push(i); });
  const mio = indici.reduce((a, i) => a + s.per[i], 0);
  const vicini = [];
  for (const v of giudicabili) {
    if (v === s) continue;
    const d = km(s, v);
    if (d > RAGGIO_KM) continue;
    const tot = sommaSuiGiorni(v, indici);
    if (tot === null) continue;             // ha buchi diversi dai suoi: non fa testo
    vicini.push({ d, tot, nome: v.nome, regione: v.regione });
  }
  if (vicini.length < N_VICINI) continue;   // troppo isolata per essere giudicata
  vicini.sort((a, b) => a.d - b.d);
  const primi = vicini.slice(0, N_VICINI);
  const med = mediana(primi.map(v => v.tot));
  if (med < MIN_VICINI_MM) continue;        // non e' piovuto: uno zero e' la verita'
  if (mio >= med * RAPPORTO) continue;
  const vicino = vicini.filter(v => v.tot >= VICINO_MIN_MM)[0];
  if (!vicino || mio >= vicino.tot * VICINO_RAP) continue;   // vedi VICINO_RAP
  sospette.push({
    chiave: s.regione + '/' + s.id,
    regione: s.regione, id: s.id, nome: s.nome, prov: s.prov, quota: s.quota,
    tot: Math.round(mio * 10) / 10,
    vicini: Math.round(med * 10) / 10,
    perc: med > 0 ? Math.round((mio / med) * 1000) / 10 : 0,
    vicinoNome: vicino.nome, vicinoTot: Math.round(vicino.tot * 10) / 10, vicinoKm: Math.round(vicino.d * 10) / 10,
    giorniDato: s.giorni,
    esempiVicini: primi.slice(0, 3).map(v => `${v.nome} ${Math.round(v.tot)} mm a ${v.d.toFixed(1)} km`)
  });
}
sospette.sort((a, b) => a.perc - b.perc);

console.log(`\nSOSPETTE: ${sospette.length}`);
for (const s of sospette) {
  console.log(`  ${s.perc.toFixed(1)}%  ${s.regione}/${s.id} ${s.nome}${s.prov ? ' (' + s.prov + ')' : ''}` +
              `  ${s.tot} mm contro ${s.vicini} mm dei vicini, ${s.giorniDato} giorni di dato`);
  console.log(`         vicini: ${s.esempiVicini.join(' · ')}`);
}

if (SOLO_ELENCO) { console.log('\n(solo elenco: nessun registro, nessuna mail)'); process.exit(0); }

// ── Registro e mail: si segnala solo chi non e' gia' segnalato ──────────────
let registro = { aggiornato: null, ferme: [] };
if (fs.existsSync(REGISTRO)) {
  try { registro = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch (e) {}
}
const gia = new Set((registro.ferme || []).map(x => x.chiave));
const nuove = sospette.filter(s => !gia.has(s.chiave));
const oraSospette = new Set(sospette.map(s => s.chiave));
const rientrate = (registro.ferme || []).filter(x => !oraSospette.has(x.chiave));

registro = {
  aggiornato: fmt(new Date()),
  finestra: FINESTRA,
  ferme: sospette.map(s => ({
    chiave: s.chiave, nome: s.nome, regione: s.regione, perc: s.perc,
    dal: (registro.ferme || []).find(x => x.chiave === s.chiave)?.dal || fmt(new Date())
  }))
};
fs.writeFileSync(REGISTRO, JSON.stringify(registro, null, 2) + '\n');

if (rientrate.length) {
  console.log('\nRientrate (tolte dal registro, nessuna mail): ' +
              rientrate.map(x => x.chiave + ' ' + x.nome).join(', '));
}

const out = process.env.GITHUB_OUTPUT;
const scrivi = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };
scrivi('registro', 'true');

if (!nuove.length) {
  console.log('\nNessuna stazione ferma nuova: nessuna mail.');
  scrivi('mail', 'false');
  process.exit(0);
}

// Nei testi che legge una persona i decimali vanno con la virgola, e la
// percentuale sta fra parentesi: così si evita anche il problema dell'articolo
// («il 0,0%» era sgrammaticato).
const vir = n => String(n).replace('.', ',');
const righe = nuove.map(s =>
  `• ${s.nome}${s.prov ? ' (' + s.prov + ')' : ''} — ${s.regione}, id ${s.id}\n` +
  `  ${vir(s.tot)} mm in ${FINESTRA} giorni contro ${vir(s.vicini)} mm dei cinque vicini piu' prossimi (${vir(s.perc.toFixed(1))}%).\n` +
  `  Vicini: ${s.esempiVicini.join('; ')}.`
).join('\n\n');

const corpo =
`Queste stazioni consegnano il dato tutti i giorni ma non misurano piu' niente,
mentre intorno a loro piove. Sono candidate all'esclusione, come lo sono state
3014 Ferriere Pluvio e VIFRA Villafranca Lunigiana il 20 agosto.

${righe}

Come si controlla, prima di escludere: apri la mappa sulla regione con il
periodo di 30 giorni e guarda il punto. Se e' un buco bianco in mezzo al
colore, e' morto. Se la zona e' asciutta anche intorno, e' un falso allarme e
va segnalato, perche' vuol dire che la soglia dei vicini non ha funzionato.

Finestra ${giorni[0]} - ${giorni[giorni.length - 1]}. Nessun dato e' stato
modificato: questo controllo non tocca niente e non esclude niente da solo.`;

const oggetto = nuove.length === 1
  ? `Pluviometro fermo: ${nuove[0].nome} (${nuove[0].regione})`
  : `${nuove.length} pluviometri fermi da controllare`;

const mail =
`From: ${process.env.MAIL_USER || 'bot'}\r\n` +
`To: ${process.env.MAIL_TO || 'bot'}\r\n` +
`Subject: ${oggetto}\r\n` +
`Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
corpo.replace(/\n/g, '\r\n') + '\r\n';

fs.writeFileSync('ferme-mail.eml', mail);
console.log(`\nMail preparata per ${nuove.length} stazioni nuove.`);
scrivi('mail', 'true');
