/**
 * I POSTI FUNGHI CHE STANNO IN UNA REGIONE E PRENDONO I DATI DA UN'ALTRA (19/10/2026, quinto check, bug 17).
 *
 * In `funghi-posti.json` un posto e' [id, nome, provincia, quota, lat, lon, bosco%] e sta sotto la regione dove sta
 * il paese. Quasi sempre e' anche la regione della rete che lo pubblica; cinque no: OMIRL pubblica Bagnone e Casoni
 * di Suvero (Massa-Carrara) e Alto (Cuneo), ARPAE pubblica Romagnese e Valverde (Pavia). Fino al 19/10 stavano sotto
 * Liguria ed Emilia, con la briciola e gli elenchi sbagliati. Ora stanno nella loro regione con un OTTAVO campo, la
 * regione della rete da cui arrivano i dati: ["BGNNE","Bagnone","MS",320,44.3097,9.9842,48,"liguria"].
 *
 * Chi legge i dati di una regione deve leggere anche le cartelle di quella rete (cartelleDi), e chi guarda le
 * esclusioni della mappa le guarda nella lista della rete (regioneDati): le liste sono per rete, non per paese.
 * Senza ottavo campo tutto resta come prima.
 */

// [{ k, dir }]: le cartelle della regione, piu' quelle delle reti dei suoi posti «ospiti». k e' la regione della
// rete a cui la cartella appartiene (serve alle esclusioni).
function cartelleConRete(r, posti, REGIONI) {
  const out = (r ? r.dirs : []).map(dir => ({ k: r.k, dir }));
  for (const p of (posti || [])) {
    if (!p[7]) continue;
    const altra = REGIONI.find(x => x.k === p[7]);
    if (!altra) throw new Error(`funghi-posti.json: ${p[1]} prende i dati da «${p[7]}», che non e' una regione`);
    for (const dir of altra.dirs) if (!out.some(c => c.dir === dir)) out.push({ k: altra.k, dir });
  }
  return out;
}
// solo i nomi delle cartelle
function cartelleDi(r, posti, REGIONI) { return cartelleConRete(r, posti, REGIONI).map(c => c.dir); }
// la regione delle esclusioni di un posto: quella della sua rete
function regioneDati(k, p) { return (p && p[7]) || k; }

module.exports = { cartelleDi, cartelleConRete, regioneDati };
