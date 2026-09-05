/**
 * IL RITRATTO DI UN PLUVIOMETRO, ricavato da tutto l'archivio che abbiamo.
 *
 * PERCHE' ESISTE (4/9/2026). Le 948 pagine di localita' e le 114 di zona sono
 * gusci: il testo e' lo stesso per tutte e i numeri li scarica il browser.
 * Misurato quel giorno su due pagine sorelle della Liguria: su 35 frasi, 28
 * IDENTICHE parola per parola. E' il profilo classico delle pagine che Google
 * scansiona e poi lascia in «scansionata, attualmente non indicizzata»: non e'
 * lentezza, e' un verdetto, e rivederlo costa piu' tempo che prenderlo bene la
 * prima volta.
 *
 * COSA SI CUOCE E COSA NO. Qui dentro stanno solo i numeri che NON cambiano:
 * il totale dell'archivio, i giorni di pioggia, il giorno piu' bagnato, il mese
 * piu' piovoso. Si scrivono una volta e restano veri per sempre, perche' sono
 * dichiarati col loro periodo («da agosto 2025 ad agosto 2026»). I millimetri
 * di oggi restano dove sono, li scarica il browser: cuocerli vorrebbe dire un
 * deploy al giorno, ~15 crediti l'uno, 450 al mese su 1.000.
 *
 * ⚠️ SI DICHIARA SEMPRE QUANTO SI E' MISURATO. L'archivio non parte lo stesso
 * giorno per tutti: 394 giorni in Piemonte, 246 in Lombardia, 106 nel Lazio. E
 * dentro una regione una stazione puo' esserci entrata dopo. Perche' un numero
 * si scriva servono almeno GIORNI_MINIMI giorni suoi, e la frase dice sempre su
 * quanti giorni e' fatto il conto: «in 312 giorni di misura» non «in un anno».
 * Un totale annuo su una stazione che ha misurato mezzo anno sarebbe falso.
 *
 * ⚠️ NIENTE MEDIE CLIMATICHE. Un anno solo non fa una normale: si dice quanto
 * e' caduto in QUEL periodo, con le sue date, e basta. E' la regola 1 del
 * CLAUDE.md, la frontiera del dato reale.
 *
 * Non fa niente da solo: e' un modulo, si richiede.
 */

const fs = require('fs');
const path = require('path');
const { DATI } = require('./lib-giorni.js');
const { AFFIDABILE_DA } = require('./lib-affidabile.js');

// 30 giorni, scelto su un conto e non a occhio (4/9/2026): con questa soglia
// il ritratto lo hanno tutti e 948 i posti, con 45 ne restavano fuori 66 e con
// 60 addirittura 410 — la meta' del centro-sud, dove il dato reale comincia a
// luglio. Sotto i 30 giorni «il giorno piu' bagnato» non vuol dire niente.
const GIORNI_MINIMI = 30;
const PIOGGIA = 1;             // mm sotto i quali il giorno non conta piovoso

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// Tutti i giorni che una cartella ha in archivio, dal piu' vecchio al piu'
// recente. Si guarda il disco, non un calendario: i buchi sono normali.
function giorniDi(dirs) {
  const s = new Set();
  for (const dir of dirs) {
    let f = [];
    try { f = fs.readdirSync(path.join(DATI, dir)); } catch (e) { continue; }
    const da = AFFIDABILE_DA[dir] || '';
    for (const n of f) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(n)) continue;
      const g = n.slice(0, 10);
      // ⚠️ Il taglio e' PER CARTELLA, non sulla finestra intera: una regione a
      // due cartelle (Friuli, Svizzera) perderebbe i giorni sani dell'altra.
      if (da && g < da) continue;
      s.add(g);
    }
  }
  return [...s].sort();
}

// ⚠️ QUI SI CONTANO SOLO LE MISURE VERE. `leggi` di lib-giorni.js restituisce
// le stazioni di un file qualunque sia la sua provenienza; per il ritratto di un
// pluviometro le stime Open-Meteo del backfill non valgono, perche' la frase che
// scriviamo dice «questo strumento ha misurato». Si scartano a due livelli, gli
// stessi di check-confini.js: il FILE intero (`source: open-meteo-*`, il caso
// insidioso perche' le singole stazioni non portano contrassegno) e la singola
// stazione dentro un file vero (`om:true`, `src` di stima).
// ⚠️ Il test sul file e' per ESCLUSIONE: Piemonte e Veneto il campo `source` non
// lo scrivono affatto, e per inclusione sparirebbero interi.
function leggiVere(dir, giorno) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DATI, dir, giorno + '.json'), 'utf8')); }
  catch (e) { return null; }
  if (!Array.isArray(j.stations) || !j.stations.length) return null;
  if (/open-meteo/.test(j.source || '')) return null;
  return j.stations.filter(s => !s.om && !/open-meteo/.test(s.src || ''));
}

const cache = new Map();

/**
 * { id: { giorni, dal, al, mm, piovosi, maxMm, maxData, mese, meseMm } }
 * Le cartelle di una regione si sommano per id, come in genera-funghi.js:
 * l'Alto Adige e il Friuli hanno pluviometri che una fonte sola pubblica.
 */
function clima(dirs) {
  const chiave = dirs.join('+');
  if (cache.has(chiave)) return cache.get(chiave);

  const out = {};
  for (const g of giorniDi(dirs)) {
    const somma = {};                      // id -> mm del giorno, sommati fra cartelle
    for (const dir of dirs) {
      if (AFFIDABILE_DA[dir] && g < AFFIDABILE_DA[dir]) continue;
      const staz = leggiVere(dir, g);
      if (!staz) continue;
      for (const s of staz) if (s.mm != null) somma[s.id] = (somma[s.id] || 0) + s.mm;
    }
    const mese = g.slice(0, 7);
    for (const id of Object.keys(somma)) {
      const v = somma[id];
      const c = out[id] || (out[id] = { giorni: 0, dal: g, al: g, mm: 0, piovosi: 0,
        maxMm: 0, maxData: null, perMese: {} });
      c.giorni++;
      c.al = g;
      c.mm += v;
      if (v >= PIOGGIA) c.piovosi++;
      if (v > c.maxMm) { c.maxMm = v; c.maxData = g; }
      const pm = c.perMese[mese] || (c.perMese[mese] = { mm: 0, giorni: 0 });
      pm.mm += v; pm.giorni++;
    }
  }

  // Il mese piu' piovoso, fra quelli INTERI. Un mese in cui la stazione ha
  // misurato dieci giorni su trentuno perderebbe il confronto per un motivo che
  // col tempo non c'entra niente: si scarta, non si corregge a stima.
  for (const id of Object.keys(out)) {
    const c = out[id];
    let mese = null, meseMm = -1;
    for (const m of Object.keys(c.perMese)) {
      const [a, n] = m.split('-').map(Number);
      const quanti = new Date(Date.UTC(a, n, 0)).getUTCDate();
      if (c.perMese[m].giorni < quanti * 0.9) continue;
      if (c.perMese[m].mm > meseMm) { meseMm = c.perMese[m].mm; mese = m; }
    }
    c.mese = mese;
    c.meseMm = mese ? meseMm : null;
    c.mm = Math.round(c.mm);
    c.maxMm = Math.round(c.maxMm * 10) / 10;
    if (c.meseMm != null) c.meseMm = Math.round(c.meseMm);
    delete c.perMese;
  }

  cache.set(chiave, out);
  return out;
}

// «3 ottobre 2025»
function dataBella(iso) {
  if (!iso) return '';
  const [a, m, g] = iso.split('-').map(Number);
  return g + ' ' + MESI[m - 1] + ' ' + a;
}
// «agosto 2025»
function meseBello(iso) {
  if (!iso) return '';
  const [a, m] = iso.split('-').map(Number);
  return MESI[m - 1] + ' ' + a;
}
// 1243 -> «1.243»
const migliaia = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// ⚠️ SEMPRE un decimale, come il  che le pagine usano ovunque: senza,
// una distanza tonda usciva «5 km» in mezzo a «3,4 km» e «8,8 km».
const virgola = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

// Il periodo in parole: «da agosto 2025 a settembre 2026».
function periodo(c) {
  const a = meseBello(c.dal), b = meseBello(c.al);
  return a === b ? 'in ' + a : 'da ' + a + ' a ' + b;
}

// Basta l'archivio di questa stazione per scriverne qualcosa?
const buono = c => !!c && c.giorni >= GIORNI_MINIMI;

module.exports = { clima, buono, periodo, dataBella, meseBello, migliaia, virgola,
  GIORNI_MINIMI, MESI };
