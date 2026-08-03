/**
 * _origini.js — chi può chiamare le nostre Netlify Functions.
 *
 * Il file inizia con "_" apposta: Netlify non lo pubblica come endpoint, è
 * solo una libreria condivisa dalle altre function.
 *
 * PERCHÉ (3/8/2026): tutte le function rispondevano
 * `Access-Control-Allow-Origin: *`, cioè autorizzavano QUALSIASI sito a
 * chiamarle dal browser e a leggerne la risposta. Un clone del sito poteva
 * quindi appoggiarsi al nostro dominio per interrogare ARPA, consumando le
 * nostre quote Netlify e risparmiandosi il lavoro.
 *
 * COME: il browser manda l'header `Origin` SOLO nelle chiamate cross-origin.
 * Le pagine del nostro sito chiamano le function con percorso relativo
 * (`/.netlify/functions/...`), quindi sono same-origin e non mandano nulla:
 * per loro non cambia niente. Se invece l'header c'è ed è di un dominio
 * estraneo, si risponde 403.
 *
 * Nota sulla cache: le risposte hanno `s-maxage` e vengono tenute dal CDN.
 * Quando l'header di risposta dipende dall'Origin va aggiunto `Vary: Origin`,
 * altrimenti il CDN servirebbe a tutti la copia salvata per la prima origine.
 */

const CONSENTITI = [
  /^https?:\/\/(www\.)?avventuremicologiche\.it$/,
  /^https?:\/\/precipitazioni\.avventuremicologiche\.it$/,
  /^https?:\/\/avventurepluvio-test\.netlify\.app$/,
  /^https?:\/\/[a-z0-9-]+--avventurepluvio-test\.netlify\.app$/, // anteprime di deploy
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

function origine(event) {
  const h = event.headers || {};
  return h.origin || h.Origin || '';
}

/** true se la chiamata arriva da un sito estraneo (e quindi va rifiutata). */
function estranea(event) {
  const o = origine(event);
  if (!o) return false;                    // same-origin o chiamata non da browser
  return !CONSENTITI.some(r => r.test(o));
}

/** Header CORS da mettere nelle risposte. */
function cors(event) {
  const o = origine(event);
  if (!o) return {};                       // same-origin: nessun header necessario
  return { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin' };
}

/** Risposta pronta per le chiamate da domini estranei. */
function rifiuto() {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Origine non autorizzata' }),
  };
}

module.exports = { cors, estranea, rifiuto };
