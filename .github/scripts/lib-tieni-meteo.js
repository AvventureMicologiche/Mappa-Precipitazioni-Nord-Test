/**
 * I CAMPI METEO GIA' SALVATI NON SI PERDONO (19/10/2026, quinto check, bug 6).
 *
 * Quasi tutti i collector riscrivono lo stesso giorno piu' volte (ieri, l'altro
 * ieri, la finestra di auto-riparazione), e temperatura, vento, umidita' e
 * direzione arrivano spesso da richieste SEPARATE dalla pioggia, ognuna dentro un
 * `try` perche' un loro guasto non tocchi mai i millimetri. Giusto, ma il file poi
 * si riscriveva con quello che c'era a QUEL giro: se la richiesta meteo era caduta,
 * t/w/u/wd salvati dai giri prima sparivano.
 *
 * Il caso vero: Lombardia, 6/10/2026. La direzione c'era (122 stazioni) fino
 * all'8/10 alle 13:36; il giro delle 17:51 l'ha persa, quello delle 21:00 ha perso
 * anche t e w, alle 23:28 t e w sono tornati e `wd` no, e da li' il giorno non l'ha
 * piu' riscritto nessuno: il file del 6/10 ha 0 direzioni contro le 122 dei giorni
 * intorno. Stesso difetto, per strade diverse, in MeteoHub (un `try` solo per tutte
 * le query meteo, poi file riscritto da capo) e in Liguria (si recuperavano solo le
 * stazioni ASSENTI, non i campi delle presenti).
 *
 * LA REGOLA, una sola per tutti: quando si riscrive un giorno, per ogni stazione
 * che c'era gia', un campo che ORA manca e PRIMA c'era si tiene dal file vecchio.
 * Un valore nuovo vince sempre: si riempiono solo i buchi. E' la regola che il
 * Piemonte usa da agosto in `mergePerOre` («il nuovo comanda, ma non perdere t/w
 * gia' presenti»). Vale qualunque sia la causa: errore, anagrafe che non risponde,
 * una stazione sola, una strada che non conosciamo ancora.
 *
 * ⚠️ Solo t/w/u/wd. NON `mm` e NON `i`: la pioggia e la sua intensita' le decide il
 * giro nuovo (il Piemonte toglie `i` apposta quando l'ufficiale sostituisce il
 * totale), e una stazione che la fonte invalida deve poter perdere i millimetri.
 * ⚠️ Solo fra due versioni dello STESSO giorno: chi chiama passa le stazioni del
 * file di quel giorno, mai di un altro.
 */
const CAMPI_METEO = ['t', 'w', 'u', 'wd'];

/**
 * Riempie i campi meteo mancanti di `nuove` con quelli di `vecchie` (stesso giorno).
 * Modifica `nuove` sul posto; restituisce quante stazioni hanno ripreso almeno un campo.
 * `chiave(s)` dice come si riconosce una stazione fra i due file (di solito l'id).
 */
function tieniMeteo(nuove, vecchie, chiave) {
  if (!Array.isArray(nuove) || !Array.isArray(vecchie) || !vecchie.length) return 0;
  const k = chiave || (s => s.id);
  const prima = new Map();
  vecchie.forEach(s => { if (s && k(s) != null) prima.set(String(k(s)), s); });
  let riprese = 0;
  nuove.forEach(s => {
    const v = s && k(s) != null ? prima.get(String(k(s))) : null;
    if (!v) return;
    let preso = false;
    CAMPI_METEO.forEach(c => { if (s[c] == null && v[c] != null) { s[c] = v[c]; preso = true; } });
    if (preso) riprese++;
  });
  return riprese;
}

module.exports = { tieniMeteo, CAMPI_METEO };
