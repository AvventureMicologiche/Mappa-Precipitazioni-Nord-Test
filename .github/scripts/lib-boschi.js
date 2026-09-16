/*
 * Quali regioni hanno la carta dei boschi, per il blocco «Che boschi ci sono
 * qui?» delle pagine funghi (16/9/2026).
 *
 * ⚠️ SI LEGGE `tessere-boschi/italia/indice.json`, lo stesso file che usa la
 * mappa, e non una lista scritta qui. Due elenchi divergenti vorrebbero dire una
 * pagina che promette i boschi di una regione in cui la mappa poi dichiara
 * «carta non ancora disponibile». Quando si aggiunge una regione alle tessere,
 * alla prossima generazione il blocco compare da solo.
 *
 * Se l'indice non c'e' (un checkout senza tessere), nessuna regione ha la
 * carta e il blocco semplicemente non esce: una pagina senza il blocco e'
 * giusta, una pagina che rimanda a una mappa vuota no.
 */
const fs = require('fs');
const path = require('path');

const INDICE = path.join(__dirname, '..', '..', 'tessere-boschi', 'italia', 'indice.json');

let regioni = {};
try { regioni = JSON.parse(fs.readFileSync(INDICE, 'utf8')).regioni || {}; } catch (e) { regioni = {}; }

// true se la regione ha la carta dei boschi
function haBoschi(k) { return Object.prototype.hasOwnProperty.call(regioni, k); }

// «Tipi forestali 2025, Regione Liguria» -> «Tipi forestali 2025»: la stessa
// forma corta che la legenda della mappa scrive sotto i colori
function cartaBreve(k) {
  const r = regioni[k];
  return r ? r.fonte.replace(/, (Regione|Provincia) .*$/, '').replace(/ regionale/, '') : '';
}

module.exports = { haBoschi, cartaBreve };
