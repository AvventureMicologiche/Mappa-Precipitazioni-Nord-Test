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

// Di chi e' la carta, per la frase «con i disegni della ...» del blocco (19/9/2026):
// era scritto «della Regione» per tutti, ma il Trentino e l'Alto Adige hanno la
// carta della Provincia e sette regioni la Carta della Natura di ISPRA. Si
// guarda la fonte dell'indice, come cartaBreve, cosi' non c'e' una lista da tenere.
function cartaDi(k) {
  const f = (regioni[k] || {}).fonte || '';
  if (/ISPRA/.test(f)) return 'della Carta della Natura di ISPRA';
  if (/Provincia/.test(f)) return 'della carta forestale della Provincia';
  return 'della carta forestale della Regione';
}

// La fonte nella nota sotto l'anteprima: «la carta «Tipi forestali 2025»». Per le
// regioni ISPRA la forma corta e' «Carta della Natura, ISPRA (habitat 1:50.000)» e
// la frase diventava «la carta «Carta della Natura, ISPRA (...)»»: li' si scrive
// «la «Carta della Natura» di ISPRA, scala 1:50.000». Le altre restano identiche.
function fonteNota(k) {
  const breve = cartaBreve(k);
  const m = breve.match(/^Carta della Natura, ISPRA \(habitat ([\d.:]+)\)$/);
  return m ? `la «Carta della Natura» di ISPRA, scala ${m[1]}` : `la carta «${breve}»`;
}

module.exports = { haBoschi, cartaBreve, cartaDi, fonteNota };
