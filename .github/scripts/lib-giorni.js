/**
 * Il calendario dell'archivio: che giorno e' in Italia, quali sono gli ultimi
 * N giorni, e come si legge il file di una cartella.
 *
 * PERCHE' ESISTE. Queste tre funzioni stavano dentro `genera-riepiloghi.js`.
 * Dal 2/9/2026 le usa anche `genera-funghi.js`, che prepara i numeri delle
 * pagine «Piogge per funghi»: due copie del calendario che divergessero
 * darebbero due pagine con finestre diverse sullo stesso giorno, e nessuno se
 * ne accorgerebbe. Stanno qui una volta sola.
 *
 * Non fa niente da solo: e' un modulo, si richiede.
 */

const fs = require('fs');
const path = require('path');

const DATI = path.resolve(__dirname, '..', '..', 'data');

// Il giorno di calendario ITALIANO, non quello del runner (che e' a UTC): alle
// 00:30 italiane di lunedi' a Londra e' ancora domenica, e i file si chiamano
// col giorno italiano. Intl fa il lavoro dell'ora legale senza tabelle a mano.
function oggiItalia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

// [ieri, altroieri, ...] a partire da un giorno ISO.
function giorniIndietro(isoOggi, n) {
  const [a, m, g] = isoOggi.split('-').map(Number);
  const base = Date.UTC(a, m - 1, g, 12);           // mezzogiorno: niente sorprese di fuso
  const out = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(base - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Le stazioni di una cartella in un giorno, o null se il file non c'e', non si
// legge, o e' vuoto. Un giorno che manca non e' un errore: si va avanti.
function leggi(dir, giorno) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATI, dir, giorno + '.json'), 'utf8'));
    return Array.isArray(j.stations) && j.stations.length ? j.stations : null;
  } catch (e) { return null; }
}

module.exports = { DATI, oggiItalia, giorniIndietro, leggi };
