#!/usr/bin/env node
/**
 * Scrive i riepiloghi delle pagine regione: data/riepiloghi/<regione>.json
 *
 * PERCHE' ESISTE. Ogni pagina regione (/friuli/, /toscana/, ...) si calcolava i
 * suoi due numeri scaricando i file giornalieri UNO PER UNO dal browser del
 * visitatore: 20 giorni per ogni cartella dati, cioe' 20 richieste a
 * raw.githubusercontent per la maggior parte delle regioni e 40 per Friuli e
 * Svizzera, che di cartelle ne hanno due. Funzionava, ma:
 *  - raw limita le raffiche per IP e risponde 429 (misurato il 18/8/2026: su
 *    120 file in raffica, 2-3 lo prendono davvero). Sulla mappa c'e' la riserva
 *    sulla copia Netlify; sulle pagine no, e un 429 fa sparire in silenzio il
 *    giorno di quella cartella — cioe' una media piu' bassa senza dirlo;
 *  - la scheda comparve dopo qualche secondo invece che subito.
 * Con questo script il conto si fa UNA VOLTA AL GIORNO qui, sui file gia' nel
 * checkout (nessuna rete, nessuna API di nessun ente), e la pagina fa UNA sola
 * richiesta. La vecchia strada resta nella pagina come ripiego, se il riepilogo
 * manca o e' piu' vecchio di due giorni.
 *
 * DOVE SCRIVE E QUANTO COSTA. `data/riepiloghi/`, che sta dentro `data/` e
 * quindi e' nella regola ignore di netlify.toml: **nessun deploy**, come per i
 * collector. I file sono ~1 KB l'uno.
 *
 * ⚠️ L'ANAGRAFE DELLE REGIONI NON SI RICOPIA: si prende da
 * `genera-pagine-regione.js` (module.exports). Se le due liste di cartelle
 * divergessero, la pagina direbbe una cosa e il riepilogo un'altra sullo stesso
 * indirizzo, e nessuno se ne accorgerebbe.
 *
 * ⚠️ LE GEMELLE: quando una regione legge piu' cartelle si unisce per POSIZIONE
 * e non per cartella+id, se no il Friuli conta due volte i 37 pluviometri che
 * MeteoHub ripubblica dall'OSMER. Stessa regola della mappa e del ripiego dentro
 * la pagina: le tre copie devono restare gemelle.
 *
 * Uso: `node .github/scripts/genera-riepiloghi.js` (nessun parametro).
 */

const fs = require('fs');
const path = require('path');
const { REGIONI } = require('./genera-pagine-regione.js');
const { DATI, oggiItalia, giorniIndietro, leggi } = require('./lib-giorni.js');

const USCITA = path.join(DATI, 'riepiloghi');
// 1 = l'ultimo giorno COMPLETO, di solito ieri (13/9/2026). 30 dal 13/9/2026.
const PERIODI = [1, 7, 20, 30];
// Due giorni di margine oltre i 30: quando ieri non e' ancora completo le
// finestre partono da altroieri, e servono i giorni per contarlo.
const FINESTRA = 34;

// Il calendario (che giorno e' in Italia, quali sono gli ultimi N giorni, come
// si legge il file di una cartella) sta in lib-giorni.js dal 2/9/2026: lo usa
// anche genera-funghi.js, e due copie che divergessero darebbero due pagine
// con finestre diverse sullo stesso giorno.

// Le stazioni delle cartelle successive che cadono entro ~1 km da una della
// PRIMA cartella sono la stessa stazione fisica letta da un'altra porta: si
// tengono quelle della prima, che e' la fonte di casa. Tolleranza larga
// apposta (le due fonti arrotondano le coordinate in modo diverso, e due
// pluviometri veri non stanno mai cosi' vicini).
function gemelleDaScartare(dirs, giorni) {
  const fuori = new Set();
  if (dirs.length < 2) return fuori;
  const casa = new Map();
  for (const g of giorni) {
    for (const s of leggi(dirs[0], g) || []) casa.set(s.id, [s.lat, s.lon]);
  }
  const pos = [...casa.values()];
  const visti = new Set();
  for (const dir of dirs.slice(1)) {
    for (const g of giorni) {
      for (const s of leggi(dir, g) || []) {
        const id = dir + ':' + s.id;
        if (visti.has(id)) continue;
        visti.add(id);
        if (pos.some(q => Math.abs(q[0] - s.lat) < 0.009 && Math.abs(q[1] - s.lon) < 0.013)) fuori.add(id);
      }
    }
  }
  return fuori;
}

// La provincia si scrive solo se DICE qualcosa: le reti MeteoHub ci mettono la
// sigla della REGIONE (tutte le siciliane «SIC»), il Friuli «FVG», la VdA «AO».
// Ripetere lo stesso valore su ogni riga e' rumore. Il Piemonte scrive
// «PROVINCIA DI ALESSANDRIA» in maiuscolo, la Liguria il comune.
function etichette(prov) {
  const distinti = new Set(Object.values(prov));
  const mostra = distinti.size > 1;
  return (id, nome) => {
    if (!mostra || !prov[id]) return nome;
    let p = String(prov[id]).replace(/^PROVINCIA DI\s+/i, '');
    if (p === p.toUpperCase() && p.length > 4) p = p.charAt(0) + p.slice(1).toLowerCase();
    return nome + ' (' + p + ')';
  };
}

function riepilogo(r, giorni, fuori) {
  const somma = {}, nomi = {}, prov = {};
  let presenti = 0, primo = null, ultimo = null;
  for (const g of giorni) {
    let qualcosa = false;
    for (const dir of r.dirs) {
      const staz = leggi(dir, g);
      if (!staz) continue;
      qualcosa = true;
      for (const s of staz) {
        if (s.mm == null) continue;
        const id = dir + ':' + s.id;
        if (fuori.has(id)) continue;
        somma[id] = (somma[id] || 0) + s.mm;
        nomi[id] = s.n;
        if (s.p) prov[id] = s.p;
      }
    }
    if (!qualcosa) continue;
    presenti++;
    if (!ultimo) ultimo = g;      // giorni e' ordinato dal piu' recente
    primo = g;
  }
  if (!presenti) return null;
  const chiavi = Object.keys(somma);
  if (!chiavi.length) return null;
  const et = etichette(prov);
  const media = chiavi.reduce((a, id) => a + somma[id], 0) / chiavi.length;
  const top = chiavi.sort((a, b) => somma[b] - somma[a]).slice(0, 5)
    .map(id => ({ n: et(id, nomi[id]), mm: Math.round(somma[id] * 10) / 10 }));
  return {
    media: Math.round(media * 10) / 10,
    giorni: presenti,
    stazioni: chiavi.length,
    primo, ultimo, top,
  };
}

// ── LA SERIE GIORNO PER GIORNO (25/9/2026) ──────────────────────────────────
// Le pagine piogge nello schema «prima i dati» disegnano le barre degli ultimi
// 30 giorni, come le pagine funghi. Qui si scrive la MEDIA dei pluviometri
// giorno per giorno, dall'ultimo giorno completo all'indietro: serie[0] e'
// quel giorno. Un giorno senza file e' null, non zero: un buco non e' una
// giornata asciutta.
const GIORNI_SERIE = 30;
function mediaGiorno(r, g, fuori) {
  let t = 0, n = 0, qualcosa = false;
  for (const dir of r.dirs) {
    const staz = leggi(dir, g);
    if (!staz) continue;
    qualcosa = true;
    for (const s of staz) {
      if (s.mm == null || fuori.has(dir + ':' + s.id)) continue;
      t += s.mm; n++;
    }
  }
  return qualcosa && n ? Math.round(t / n * 10) / 10 : null;
}

const oggi = oggiItalia();
const giorni = giorniIndietro(oggi, FINESTRA);
fs.mkdirSync(USCITA, { recursive: true });

// ── L'ULTIMO GIORNO COMPLETO (13/9/2026) ────────────────────────────────────
// La scheda «Ieri» e' quella che si legge per prima, e un ieri a meta' e' la
// cosa peggiore da mostrare: una giornata piovosa che sembra asciutta. Due
// guardie, tutte e due gia' pagate altrove:
//  1. il giro di notte (23:20 UTC, cioe' fra mezzanotte e l'una e mezza
//     italiane) NON prende mai il giorno appena chiuso: i collector lo scrivono
//     la mattina dopo. E' la stessa trappola della riga «pluviometri letti» del
//     25/8/2026, sei ore col numero dimezzato;
//  2. un giorno vale se ha almeno il 90% delle stazioni dei due giorni dopo:
//     una rete che non ha ancora consegnato abbassa il conto e si vede.
// Se il giorno buono e' altroieri, TUTTE le finestre partono da li': 7 giorni
// sono i 7 giorni che finiscono con l'ultimo giorno completo. La pagina scrive
// la data vera accanto al numero, quindi non c'e' niente di nascosto.
const ORA_ITALIA = Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
function stazioniDelGiorno(dirs, i) {
  return dirs.reduce((n, d) => n + ((leggi(d, giorni[i]) || []).length), 0);
}
function ultimoCompleto(dirs) {
  for (const i of (ORA_ITALIA >= 5 ? [0, 1, 2] : [1, 2])) {
    const n = stazioniDelGiorno(dirs, i);
    const dopo = Math.max(stazioniDelGiorno(dirs, i + 1), stazioniDelGiorno(dirs, i + 2));
    if (n && n >= 0.9 * dopo) return i;
  }
  return null;
}

// ── LETTURE DEL GIORNO, per la riga «5.584 pluviometri letti stamattina» ──
//
// PERCHE': il sito non aveva nessun modo di dire che dietro c'e' una macchina
// che si sveglia ogni mattina. Questa riga lo dice con un numero verificabile:
// torni domani e l'ora e' cambiata. Il conto e' gratis, i file sono gia' qui.
//
// ⚠️ SI CONTA UN GIORNO SOLO, IERI, non «l'ultimo giorno che ogni rete ha».
// Sommare l'ultimo giorno disponibile cartella per cartella gonfierebbe il
// totale mescolando giorni diversi. Cosi' invece le reti in ritardo dichiarato
// (Slovenia 34 ore, Puglia quando MeteoHub salta) semplicemente non entrano, e
// il numero esce piu' BASSO del vero: e' il verso giusto in cui sbagliare.
//
// ⚠️ `letto` e' l'istante in cui gira QUESTO script, non l'ora dei collector:
// e' l'ora in cui abbiamo guardato, ed e' quella che la pagina scrive.
function letture(giorno) {
  let stazioni = 0, cartelle = 0;
  for (const d of fs.readdirSync(DATI)) {
    if (d === 'riepiloghi') continue;
    let st;
    try {
      if (!fs.statSync(path.join(DATI, d)).isDirectory()) continue;
      st = leggi(d, giorno);
    } catch (e) { continue; }
    if (!st) continue;
    stazioni += st.length;
    cartelle++;
  }
  return { giorno, stazioni, cartelle, letto: new Date().toISOString() };
}
// ⚠️ NON «ieri» e basta: questo script gira DUE volte, alle 7:10 e all'1:20.
// All'1:20 il giorno di ieri e' appena finito ma i collector lo devono ancora
// scrivere — girano fra le 6:00 e le 7:15 della mattina dopo. Il 25/8/2026
// alle 1:40 il conto usciva 2.957 pluviometri in 19 cartelle, e restava
// esposto sul sito fino al giro del mattino: alle 7:42 lo stesso identico
// giorno ne dava 5.573 in 36. Quasi sei ore col numero dimezzato, proprio la
// fascia di chi apre presto (segnalato dall'utente alle 7:24).
//
// Si sceglie fra ieri e l'altroieri quello con piu' CARTELLE, non con piu'
// stazioni: le cartelle dicono quante reti hanno consegnato (19 contro 36 e'
// un giorno a meta'), mentre il totale delle stazioni oscilla di suo di qualche
// decina da un giorno all'altro (5.573 contro 5.597 il 24 e il 23) e sceglierlo
// come arbitro terrebbe fisso l'altroieri per una manciata di pluviometri.
// Resta comunque UN GIORNO SOLO: la regola di non mescolare giorni non si tocca.
const cIeri  = letture(giorni[0]);
const cPrima = letture(giorni[1]);
const conteggio = (cPrima.cartelle > cIeri.cartelle) ? cPrima : cIeri;
// Questo file si riscrive SEMPRE, anche identico: l'ora e' il suo contenuto.
fs.writeFileSync(path.join(USCITA, 'letture.json'), JSON.stringify(conteggio, null, 1) + '\n', 'utf8');
console.log(`  letture: ${conteggio.stazioni} pluviometri in ${conteggio.cartelle} cartelle il ${conteggio.giorno}\n`);

// ⚠️ Le regioni si CALCOLANO qui ma si SCRIVONO dopo le zone (25/9/2026): il
// file di regione porta anche l'elenco delle sue zone coi loro numeri, per la
// lista «zona per zona» della pagina, e quei numeri escono dal giro delle zone.
// Cosi' la pagina regione resta a UNA richiesta.
const perRegione = {};
const saltati = [];
for (const r of REGIONI) {
  const fuori = gemelleDaScartare(r.dirs, giorni);
  const periodi = {};
  const da = ultimoCompleto(r.dirs);
  if (da !== null) {
    for (const n of PERIODI) {
      const p = riepilogo(r, giorni.slice(da, da + n), fuori);
      if (p) periodi[String(n)] = p;
    }
  }
  // ⚠️ Se non e' uscito niente NON si scrive: si lascia il file di ieri e la
  // pagina, vedendolo vecchio, si ricalcola i numeri da sola. Sovrascrivere con
  // un riepilogo vuoto sarebbe il modo peggiore di gestire una fonte ferma —
  // la pagina direbbe «dati non disponibili» credendo di essere aggiornata.
  // ⚠️ Si guarda il 20 e non la FINESTRA: e' la scheda che la pagina esige per
  // fidarsi del riepilogo, e il 30 aggiunto il 13/9 non deve cambiare chi viene
  // saltato.
  if (!periodi['20']) { saltati.push(r.k); continue; }
  const serie = giorni.slice(da, da + GIORNI_SERIE).map(g => mediaGiorno(r, g, fuori));
  perRegione[r.k] = { periodi, serie };
}

// ── LE ZONE: i riepiloghi delle pagine «dove ha piovuto» di zona (13/9/2026) ──
//
// PERCHE'. Garfagnana, Lunigiana, Mugello si cercano anche per la pioggia, e
// fino a oggi di una zona esisteva solo la pagina FUNGHI (la finestra 13-20
// giorni fa). Queste sono le pagine della PIOGGIA: ieri, 7 e 30 giorni.
// Un file per zona, ~1 KB: la pagina fa UNA richiesta, come le regioni.
//
// ⚠️ UNA ZONA STA A CAVALLO DI PIU' REGIONI (la Garfagnana ha pluviometri
// dell'Emilia), quindi ogni pluviometro si legge dalle cartelle della SUA
// regione. I pluviometri sono quelli di funghi-zone.json, gli stessi della
// pagina funghi della zona: stessa zona, stessi strumenti, altro periodo.
// ⚠️ L'ULTIMO GIORNO COMPLETO della zona e' il piu' vecchio fra quelli delle
// sue regioni: se una delle due non ha ancora consegnato ieri, si parte da
// altroieri per tutte, e non si mescolano giorni diversi nella stessa media.
const { slug, bello } = require('./lib-nomi.js');
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-zone.json'), 'utf8'));
const POSTI = JSON.parse(fs.readFileSync(path.join(__dirname, 'funghi-posti.json'), 'utf8'));
const USCITA_ZONE = path.join(USCITA, 'zone');
fs.mkdirSync(USCITA_ZONE, { recursive: true });

const regDi = {}, nomeDi = {};
for (const k of Object.keys(POSTI)) for (const p of POSTI[k]) { regDi[p[0]] = k; nomeDi[p[0]] = bello(p[1]); }

const cache = {};
function datiRegione(k) {
  if (cache[k]) return cache[k];
  const r = REGIONI.find(x => x.k === k);
  const out = { da: r ? ultimoCompleto(r.dirs) : null, mm: [] };
  for (let i = 0; i < FINESTRA; i++) {
    const m = new Map();
    for (const d of (r ? r.dirs : [])) {
      for (const st of leggi(d, giorni[i]) || []) {
        if (st.mm != null && !m.has(st.id)) m.set(st.id, st.mm);
      }
    }
    out.mm.push(m);
  }
  return (cache[k] = out);
}
const uno = x => Math.round(x * 10) / 10;

let zScritte = 0, zSaltate = [];
const zonePer = {};
for (const r of REGIONI) if (perRegione[r.k]) zonePer[r.k] = [];
for (const z of ZONE) {
  const ids = z.posti.filter(id => regDi[id]);
  const regs = [...new Set(ids.map(id => regDi[id]))];
  const inizi = regs.map(k => datiRegione(k).da).filter(x => x !== null);
  if (!ids.length || !inizi.length) { zSaltate.push(z.n); continue; }
  const da = Math.max(...inizi);

  const valori = {};                         // id -> [ieri, 7 giorni, 30 giorni]
  const periodi = {};
  for (const [j, n] of [[0, 1], [1, 7], [2, 30]]) {
    const giorniConDati = new Set();
    for (const id of ids) {
      const rd = datiRegione(regDi[id]);
      let somma = 0, visti = 0;
      for (let i = da; i < da + n; i++) {
        const v = rd.mm[i].get(id);
        if (v == null) continue;
        somma += v; visti++; giorniConDati.add(i);
      }
      (valori[id] = valori[id] || [null, null, null])[j] = visti ? uno(somma) : null;
    }
    const con = ids.filter(id => valori[id][j] != null);
    if (!con.length) continue;
    const ord = con.slice().sort((a, b) => valori[b][j] - valori[a][j]);
    const dentro = [...giorniConDati].sort((a, b) => a - b);
    periodi[String(n)] = {
      media: uno(con.reduce((t, id) => t + valori[id][j], 0) / con.length),
      stazioni: con.length,
      giorni: dentro.length,
      primo: giorni[dentro[dentro.length - 1]],
      ultimo: giorni[dentro[0]],
      top: ord.slice(0, 3).map(id => ({ n: nomeDi[id], mm: valori[id][j] })),
    };
  }
  if (!periodi['7']) { zSaltate.push(z.n); continue; }

  // La serie della zona: media dei suoi pluviometri giorno per giorno (25/9).
  const serie = [];
  for (let i = da; i < da + GIORNI_SERIE; i++) {
    let t = 0, n = 0;
    for (const id of ids) {
      const v = datiRegione(regDi[id]).mm[i].get(id);
      if (v != null) { t += v; n++; }
    }
    serie.push(n ? uno(t / n) : null);
  }

  const dest = path.join(USCITA_ZONE, slug(z.n) + '.json');
  const testo = JSON.stringify({ zona: z.n, generato: new Date().toISOString(),
    ultimoGiorno: giorni[da], periodi, posti: valori, serie }) + '\n';
  const prima = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  const uguale = prima && prima.replace(/"generato":"[^"]+",/, '') === testo.replace(/"generato":"[^"]+",/, '');
  if (!uguale) { fs.writeFileSync(dest, testo, 'utf8'); zScritte++; }

  // ⚠️ Nella lista della regione vanno gli STESSI numeri della pagina di zona:
  // chi clicca deve trovare il numero che ha appena letto (la lezione delle 41
  // zone su 114 che non tornavano, 13/9/2026).
  if (zonePer[z.reg]) zonePer[z.reg].push({ s: slug(z.n), n: z.n, ultimo: giorni[da],
    m1: (periodi['1'] || {}).media ?? null, m7: periodi['7'].media, m30: (periodi['30'] || {}).media ?? null });
}
console.log(`${zScritte} riepiloghi di zona scritti su ${ZONE.length}${zSaltate.length ? ', SALTATE: ' + zSaltate.join(', ') : ''}`);

// ── ORA LE REGIONI, con dentro le loro zone ─────────────────────────────────
let scritti = 0;
for (const r of REGIONI) {
  const x = perRegione[r.k];
  if (!x) continue;
  const dest = path.join(USCITA, r.k + '.json');
  const testo = JSON.stringify({ regione: r.k, generato: new Date().toISOString(),
    periodi: x.periodi, serie: x.serie, zone: zonePer[r.k] || [] }, null, 1) + '\n';
  const prima = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  // Il campo `generato` cambia a ogni giro: se il resto e' identico non si
  // riscrive, cosi' un run in piu' non produce un commit di sole date.
  const uguale = prima && prima.replace(/"generato":[^,]+,/, '') === testo.replace(/"generato":[^,]+,/, '');
  if (!uguale) { fs.writeFileSync(dest, testo, 'utf8'); scritti++; }
  const p20 = x.periodi['20'];
  console.log(`  ${r.k.padEnd(12)} ${String(p20.stazioni).padStart(4)} staz.  ${String(Math.round(p20.media)).padStart(3)} mm/20gg  ${p20.primo}→${p20.ultimo}${uguale ? '  (invariato)' : ''}`);
}
console.log(`\n${scritti} riepiloghi scritti su ${REGIONI.length}${saltati.length ? ', SALTATI (nessun dato): ' + saltati.join(', ') : ''}`);
