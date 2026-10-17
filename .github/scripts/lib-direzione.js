/**
 * LA DIREZIONE DEL VENTO: da dove e' venuto il vento in un giorno. Un numero
 * per stazione e per giorno, nel campo compatto `wd`.
 *
 * PERCHE' ESISTE (2/10/2026). Il vento lo salviamo dall'11/8 come velocita'
 * (`w:[media,raffica]`), ma senza la direzione: «15 km/h» non dice se era
 * tramontana o scirocco. Censimento del 29/9: tutte le reti reali la
 * pubblicano, e in dodici su sedici sta GIA' nelle risposte che scarichiamo.
 * Si mostra come dato misurato, mai come fattore di un voto sui funghi.
 *
 * COME SI LEGGE `wd`.
 *   wd: 45     gradi DA CUI viene il vento, 0-359 (0 = tramontana, 45 = grecale,
 *              90 = levante, 135 = scirocco, 180 = ostro, 225 = libeccio,
 *              270 = ponente, 315 = maestrale). E' la convenzione dei
 *              meteorologi e quella di tutte le fonti.
 *   wd: "V"    variabile: il vento ha girato senza una direzione prevalente.
 *   (assente)  meno di 20 ore lette, oppure calma piatta tutto il giorno.
 *
 * ⚠️ MAI LA MEDIA DEI GRADI. 350° e 10° sono tutti e due tramontana, ma la loro
 * media fa 180°, cioe' ostro: il contrario. Si usa la MEDIA VETTORIALE, che e'
 * il metodo dell'OMM: ogni campione diventa una freccia lunga quanto la sua
 * velocita', le frecce si sommano, e la direzione e' quella della somma. Cosi'
 * una brezza debole da sud non annulla un vento forte da nord. Dove la rete
 * non da' la velocita' accanto alla direzione, ogni campione pesa uno.
 *
 * ⚠️ «VARIABILE» SI MISURA, NON SI INDOVINA. Il rapporto fra la lunghezza della
 * somma e la somma delle lunghezze (la «costanza») va da 0 (vento che gira
 * tutto intorno) a 1 (sempre dalla stessa parte). Sotto SOGLIA_COSTANZA si
 * scrive "V" invece di inventare una direzione.
 *
 * ⚠️ SI CONTANO LE ORE, non i campioni, come per l'intensita': una rete a 10
 * minuti e una oraria devono superare la stessa soglia. Il collector versa
 * ogni campione nella sua ora con `segnaDir()`, il conto lo fa `direzione()`.
 *
 * Uso, dentro il ciclo che il collector ha gia':
 *
 *     const { creaDir, segnaDir, direzione } = require('./lib-direzione.js');
 *     const acc = creaDir();
 *     ...per ogni campione del giorno:
 *          segnaDir(acc, chiaveOra, gradi, velocita);   // velocita' facoltativa
 *     ...alla fine:
 *          const wd = direzione(acc);        // numero, "V" oppure null
 *          if (wd !== null) rec.wd = wd;
 *
 * Per le fonti che pubblicano gia' la direzione del giorno (settore
 * prevalente) c'e' `daSettore()`: la riporta ai gradi e basta.
 */

const MIN_ORE = 20;             // stessa soglia di temperatura, vento e umidita'
const SOGLIA_COSTANZA = 0.3;    // sotto: "V"

function creaDir() {
  return { ore: Object.create(null), x: 0, y: 0, peso: 0 };
}

/**
 * Versa un campione. `gradi` = provenienza (0-360). `vel` = velocita' nella
 * stessa unita' per tutti i campioni della stazione (serve solo come peso);
 * se manca, il campione pesa 1. Una lettura a velocita' ZERO conta come ora
 * letta ma non sposta la freccia: con la calma la direzione non esiste.
 */
function segnaDir(acc, chiave, gradi, vel) {
  // ⚠️ CON LA CALMA MOLTE RETI LASCIANO VUOTA LA DIREZIONE (ARPA Piemonte scrive
  // `wind: 0, wind_direction: null`). L'ora e' stata letta lo stesso: se non la
  // si contasse, una stazione con sei ore di calma notturna finirebbe sotto la
  // soglia delle 20 ore e perderebbe la direzione di tutto il giorno. Misurato
  // il 2/10/2026: 38 stazioni piemontesi su 80 cadevano per questo.
  if (vel === 0) { acc.ore[chiave] = true; return; }
  if (typeof gradi !== 'number' || !isFinite(gradi) || gradi < 0 || gradi > 360) return;
  acc.ore[chiave] = true;
  let p = 1;
  if (vel !== undefined && vel !== null) {
    if (typeof vel !== 'number' || !isFinite(vel) || vel < 0) return;
    p = vel;
  }
  if (p === 0) return;
  const r = gradi * Math.PI / 180;
  acc.x += p * Math.sin(r);
  acc.y += p * Math.cos(r);
  acc.peso += p;
}

/** Numero 0-359, "V", oppure null (poche ore o calma tutto il giorno). */
function direzione(acc) {
  if (Object.keys(acc.ore).length < MIN_ORE) return null;
  if (!(acc.peso > 0)) return null;
  const costanza = Math.sqrt(acc.x * acc.x + acc.y * acc.y) / acc.peso;
  if (costanza < SOGLIA_COSTANZA) return 'V';
  let g = Math.round(Math.atan2(acc.x, acc.y) * 180 / Math.PI);
  if (g < 0) g += 360;
  return g % 360;
}

// Sigle italiane e inglesi dei 16 settori, per le fonti che danno il settore
// invece dei gradi (Emilia, il settore prevalente piemontese, OMIRL).
const SETTORI = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SSO: 202.5, SW: 225, SO: 225, WSW: 247.5, OSO: 247.5,
  W: 270, O: 270, WNW: 292.5, ONO: 292.5, NW: 315, NO: 315, NNW: 337.5, NNO: 337.5
};
function daSettore(s) {
  if (typeof s === 'number' && isFinite(s)) return Math.round(s) % 360;
  if (typeof s !== 'string') return null;
  const k = s.trim().toUpperCase();
  return (k in SETTORI) ? Math.round(SETTORI[k]) % 360 : null;
}

module.exports = { creaDir, segnaDir, direzione, daSettore, MIN_ORE, SOGLIA_COSTANZA };
