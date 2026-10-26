/**
 * Il fattore del vento medio MeteoHub, stazione per stazione (26/10/2026). Su alcune stazioni MeteoHub da' il vento
 * medio (B11002) diviso per 3,6 una volta di troppo (km/h -> m/s fatto due volte a monte): 1 = giusto, 3.6 = si
 * moltiplica, 0 = il vento di MeteoHub non si usa. La tabella e il perche' stanno in meteohub-vento.json.
 * La usano collect-meteohub.js e backfill-meteo-meteohub.js, che devono restare uguali. Il Piemonte ha la sua
 * (piemonte-meteohub.json, campo fv), perche' li' i fattori sono misurati contro ARPA.
 */
const TAB = require('./meteohub-vento.json').stazioni;
function fattoreVento(id) { const x = TAB[id]; return x ? x.fv : 1; }
module.exports = { fattoreVento };
