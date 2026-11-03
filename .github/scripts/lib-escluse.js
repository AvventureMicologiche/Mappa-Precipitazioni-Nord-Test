/**
 * lib-escluse.js — i pluviometri che la MAPPA esclude perche' misurano male,
 * letti dalle liste *_ESCLUSE di index.html (17/10/2026).
 *
 * PERCHE'. Le esclusioni stanno in index.html e valevano solo per la mappa:
 * le pagine funghi non le leggevano. Il 17/10/2026 otto posti esclusi dalla
 * mappa come guasti avevano ancora la loro pagina coi numeri sbagliati
 * (Cantagallo fermo a zero dal 19/9 con Acquerino a 4 km a 49 mm in tre giorni,
 * Sassa, Gabbro, Serra Pistoiese, Parana, Cimone, Sella Giassina, Osini).
 * Una lista sola, quella della mappa: quando una stazione rientra la sua pagina
 * torna normale al primo giro, senza ricordarsi di niente.
 *
 * ⚠️ LE CHIAVI VALGONO PER REGIONE, come nella mappa: l'Emilia esclude l'id
 * '8' (Loiano) e in Lombardia ci sono id numerici piccoli. Una lista unica
 * avrebbe tolto pluviometri sani di un'altra regione, in silenzio.
 * Piemonte per NOME (s.n, maiuscolo, come in mappa), le altre per id.
 *
 * Se index.html cambia forma e una lista non si legge piu', lo si stampa e si
 * va avanti senza: le pagine tornano come prima, non si rompe il giro.
 */
const fs = require('fs');
const path = require('path');

const PER_LISTA = {
  LOMB_ESCLUSE: 'lombardia', PIEMONTE_ESCLUSE: 'piemonte', LIGURIA_ESCLUSE: 'liguria',
  EMILIA_ESCLUSE: 'emilia', TOSCANA_ESCLUSE: 'toscana',
  FRIULI_ESCLUSE: 'friuli',   // 31/10/2026: Pontebba, nelle due cartelle friuli-osmer e meteohub-friuli (per ID)
  // ⚠️ PROMEMORIA (19/10/2026, quinto check, bug 18): FRANCIA_ESCLUSE di index.html (Bastia 20033015)
  // qui NON si legge. Oggi non serve, nessuna pagina usa le stazioni francesi. Se un giorno arrivano,
  // aggiungerla con la chiave delle cartelle (francia-corsica, francia-provenza…), non 'francia'.
};

// Il testo fra la graffa di apertura e quella che la chiude.
function blocco(h, nome) {
  const i = h.indexOf('var ' + nome + '={');
  if (i < 0) return null;
  let d = 0;
  for (let j = h.indexOf('{', i); j < h.length; j++) {
    if (h[j] === '{') d++;
    else if (h[j] === '}' && --d === 0) return h.slice(h.indexOf('{', i) + 1, j);
  }
  return null;
}
const senzaCommenti = t => t.split('\n').map(r => r.replace(/\/\/.*$/, '')).join('\n');
const chiavi = t => [...t.matchAll(/['"]([^'"]+)['"]\s*:/g)].map(m => m[1]);

// { regione: Set(chiavi) }
function escluse(radice) {
  const h = fs.readFileSync(path.join(radice, 'index.html'), 'utf8');
  const out = {};
  for (const [nome, reg] of Object.entries(PER_LISTA)) {
    const b = blocco(h, nome);
    if (b == null) { console.warn(`  ⚠️ lib-escluse: ${nome} non trovata in index.html`); continue; }
    out[reg] = new Set(chiavi(senzaCommenti(b)));
  }
  const mh = blocco(h, 'MH_ESCLUSE');
  if (mh == null) console.warn('  ⚠️ lib-escluse: MH_ESCLUSE non trovata in index.html');
  else for (const m of senzaCommenti(mh).matchAll(/([a-z]+)\s*:\s*\{([^}]*)\}/g)) {
    out[m[1]] = new Set([...(out[m[1]] || []), ...chiavi(m[2])]);
  }
  return out;
}

// Il posto p di funghi-posti.json ([id, nome, ...]) della regione reg e' escluso?
function escluso(ESC, reg, p) {
  const s = ESC[reg];
  return !!(s && (s.has(String(p[0])) || s.has(String(p[1]))));
}

module.exports = { escluse, escluso };
