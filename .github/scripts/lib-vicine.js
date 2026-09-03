/* Le REGIONI VICINE a un punto, con lo stesso criterio della ricerca per
 * localita' del sito (3/9/2026).
 *
 * ⚠️ PERCHE' ESISTE. Le pagine di paese e di zona aprivano la mappa sulla sola
 * regione di casa. Ma un pluviometro sul confine ha meta' dei suoi vicini
 * dall'altra parte: Alpe Gorreto sta in Liguria e ha l'Emilia a due passi, e
 * chi arriva li' vede mezza mappa vuota. Nel sito il problema era gia' risolto
 * per la ricerca scritta (`locRegioniVicine` in index.html): qui si usa LA
 * STESSA griglia e LA STESSA regola, cosi' le due strade non possono divergere.
 *
 * ⚠️ La griglia e' `data/regioni-vicine.txt`, un file gia' nel repo: chiave =
 * latitudine e longitudine arrotondate a 0,05 gradi, valore = le regioni
 * separate da «+». Nessuna rete, nessuna API.
 *
 * ⚠️ Il taglio a 3 non e' una scelta di gusto: e' il massimo che la mappa
 * accetta (`MAX 3` della selezione multipla). Superandolo il link perde le
 * regioni in coda senza dirlo.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'regioni-vicine.txt');

let _griglia = null;

function carica() {
  if (_griglia) return _griglia;
  _griglia = new Map();
  const t = fs.readFileSync(FILE, 'utf8');
  for (const riga of t.split('\n')) {
    const c = riga.indexOf(':');
    if (c > 0) _griglia.set(riga.slice(0, c), riga.slice(c + 1));
  }
  return _griglia;
}

// Le regioni che la griglia conosce in quel punto, in ordine di vicinanza.
function vicine(lat, lon) {
  const g = carica();
  const k = (Math.round(lat / 0.05) * 0.05).toFixed(2) + ',' +
            (Math.round(lon / 0.05) * 0.05).toFixed(2);
  const v = g.get(k);
  return v ? v.split('+') : [];
}

/* La lista pronta per il parametro `r=` del link: la regione di casa per
 * prima, poi le vicine, al massimo tre. Se la griglia non sa niente di quel
 * punto resta la sola regione di casa, che e' il comportamento di prima. */
function perLink(reg, lat, lon) {
  const v = vicine(lat, lon).filter(k => k !== reg);
  return [reg].concat(v).slice(0, 3).join(',');
}

module.exports = { vicine, perLink };
