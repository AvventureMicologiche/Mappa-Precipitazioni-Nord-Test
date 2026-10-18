/**
 * IL GIORNO SOLARE ITALIANO IN UTC: da quale istante a quale istante.
 *
 * PERCHE' ESISTE (18/10/2026, quarto check generale). Sei collector
 * costruivano la finestra del giorno prendendo il fuso di MEZZOGIORNO e
 * contando 24 ore da li'. Va bene 363 giorni l'anno e sbaglia i due del
 * cambio d'ora:
 *   - domenica 25/10/2026 la mezzanotte e' ancora in ora legale (22:00 UTC
 *     del 24) ma il mezzogiorno e' gia' in ora solare: la finestra partiva
 *     alle 23:00 UTC e l'ora fra mezzanotte e l'una NON FINIVA IN NESSUN FILE;
 *   - l'ultima domenica di marzo il contrario: l'ultima ora del sabato
 *     contata due volte, nel sabato e nella domenica.
 * La Liguria sbagliava in un altro modo, col fuso del MOMENTO in cui gira:
 * la domenica rileggeva il sabato col fuso nuovo e lo spostava di un'ora.
 *
 * ⚠️ IL GIORNO NON DURA SEMPRE 24 ORE. Dura 23 ore a fine marzo e 25 a fine
 * ottobre. Quindi la fine NON e' «inizio + 24 ore»: e' la mezzanotte del
 * giorno dopo, calcolata col SUO fuso.
 *
 * ⚠️ IL CAMBIO E' ALLE 01:00 UTC, non a mezzanotte UTC. La vecchia
 * `getItalyOffset` dei collector lo mette a mezzanotte UTC: per sapere che
 * giorno e' oggi non cambia niente (l'ora sbagliata e' in piena notte e la
 * data resta quella), ma per i confini del giorno si'. Questa e' la regola
 * della Slovenia (`offsetItalia` in collect-slovenia-arso.js), validata ad
 * agosto con la correlazione oraria contro l'Austria.
 *
 * Controllata contro l'orologio ufficiale `Europe/Rome` su ogni giorno dal
 * 2026 al 2028: zero differenze (prova nello scratchpad della scheda 87,
 * `prova-giorno-italiano.js`).
 */

// +2 dall'ultima domenica di marzo alle 01:00 UTC all'ultima domenica di
// ottobre alle 01:00 UTC, +1 il resto dell'anno.
function offsetItalia(d) {
  const y = d.getUTCFullYear();
  const ultimaDom = (mese) => {
    const x = new Date(Date.UTC(y, mese + 1, 0));
    x.setUTCDate(x.getUTCDate() - x.getUTCDay());
    x.setUTCHours(1, 0, 0, 0);
    return x;
  };
  return (d >= ultimaDom(2) && d < ultimaDom(9)) ? 2 : 1;
}

// Mezzanotte italiana del giorno 'AAAA-MM-GG', in millisecondi UTC. Il fuso si
// guarda alla mezzanotte UTC dello stesso giorno: la mezzanotte italiana sta
// sempre un'ora o due prima, e il cambio cade alle 01:00 UTC, quindi da quel
// punto il fuso e' sempre quello giusto.
function mezzanotte(giorno) {
  const d = new Date(giorno + 'T00:00:00Z');
  return d.getTime() - offsetItalia(d) * 3600000;
}

function giornoDopo(giorno) {
  const d = new Date(giorno + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// { start, end } in millisecondi UTC: dalla mezzanotte italiana del giorno a
// quella del giorno dopo. Con le marche a FINE intervallo il giorno e'
// (start, end]; con le marche a INIZIO intervallo e' [start, end).
function finestraGiorno(giorno) {
  return { start: mezzanotte(giorno), end: mezzanotte(giornoDopo(giorno)) };
}

module.exports = { offsetItalia, mezzanotte, giornoDopo, finestraGiorno };
