/**
 * L'INTENSITA' DELLA PIOGGIA: quante ore e' piovuto, e quanto nell'ora piu'
 * carica. Due numeri per stazione e per giorno, nel campo compatto `i`.
 *
 * PERCHE' ESISTE (12/9/2026). La stessa pioggia in un'ora vale meno che in
 * otto: quella che scende piano entra nel terreno, quella che scroscia corre
 * via. Il 10 settembre 2026, in Liguria, Fontana Fresca ha contato 35,6 mm e
 * Passo della Cisa 34,6: stessi millimetri, ma i primi in TRE ore con una
 * punta di 19,8 mm, i secondi in OTTO sparse dalle tre del mattino alle sette
 * di sera. Sulla mappa erano la stessa giornata. Per chi cerca funghi no.
 *
 * ⚠️ IL DATO LO SCARICAVAMO GIA' E LO BUTTAVAMO VIA. I collector percorrono
 * gia' la serie oraria per fare la somma del giorno, e contano gia' le ore
 * valide (e' cosi' che distinguono una stazione asciutta da una muta). Qui
 * dentro non si chiede niente a nessuno: **zero richieste in piu'**. E' la
 * stessa ricetta con cui sono entrati temperatura, vento e umidita'.
 *
 * ⚠️ SI CONTA SEMPRE PER ORE PIENE, anche quando la rete pubblica ogni 10 o
 * 30 minuti. Senza questo passaggio una rete a 10 minuti direbbe «84 fasce
 * bagnate» e una oraria «7», e i due numeri non sarebbero confrontabili né
 * fra loro né con la scala meteorologica, che è in millimetri ALL'ORA. Per
 * questo il collector non conta i campioni: li versa dentro l'ora a cui
 * appartengono con `segna()`, e il conto lo fa `intensita()` alla fine.
 *
 * ⚠️ LA SCADENZA, ED E' MISURATA. Il passato non si recupera: le finestre
 * delle API sono corte. Provato il 12/9/2026 su OMIRL: le ore del 10 e
 * dell'11 settembre rispondono con 198 stazioni, quelle del 9 con ZERO. Da
 * qui in avanti il dato cresce di un giorno al giorno, all'indietro non c'è
 * niente da prendere. Vale lo stesso per il Piemonte (~2 giorni).
 *
 * CHI NON PUO'. Toscana (il SIR pubblica solo la differenza su 24 ore),
 * Emilia e Trentino (solo l'aggregato del giorno), Veneto e Alto Adige
 * (contatori cumulativi letti sei o sette volte al giorno: con sette letture
 * l'ora non si ricostruisce). Sono quasi le stesse reti rimaste fuori dal
 * vento, e non e' un caso: chi non pubblica la serie non pubblica nemmeno
 * quella.
 *
 * COME SI LEGGE `i`. `i: [ore bagnate, punta oraria in mm]`. I millimetri
 * all'ora si ricavano dividendo `mm` per le ore bagnate, non si scrivono:
 * sarebbe un terzo numero che si puo' calcolare dagli altri due.
 *
 * Uso, dentro il ciclo che il collector ha gia':
 *
 *     const { creaOre, segna, intensita } = require('./lib-intensita.js');
 *     const ore = creaOre();
 *     ...per ogni campione valido del giorno:
 *          segna(ore, chiaveOra, mm);       // chiaveOra = l'ora locale
 *     ...alla fine:
 *          const i = intensita(ore);        // [bagnate, punta] oppure null
 *
 * Non fa niente da solo: e' un modulo, si richiede.
 */

// Sotto questa copertura non si scrive niente. Un giorno con dodici ore lette
// puo' dire quanto e' piovuto in quelle dodici, ma NON per quante ore e'
// piovuto in tutto, che e' proprio la domanda: direbbe «due ore» dove magari
// erano cinque. E' la stessa soglia di temperatura, vento e umidita'.
const MIN_ORE = 20;

function creaOre() {
  return Object.create(null);
}

/**
 * Versa un campione dentro la sua ora.
 *
 * ⚠️ SI CHIAMA ANCHE PER GLI ZERI, ed e' importante: il secchiello vuoto e'
 * la prova che quell'ora l'abbiamo LETTA. Chiamandola solo quando piove, un
 * giorno con due ore di pioggia e ventidue di silenzio risulterebbe letto per
 * due ore e finirebbe scartato dalla soglia qui sopra.
 *
 * `chiave` e' qualunque cosa identifichi l'ora in modo univoco dentro il
 * giorno: la marca temporale di un punto orario, oppure «0».. «23».
 */
function segna(ore, chiave, mm) {
  if (ore[chiave] === undefined) ore[chiave] = 0;
  if (typeof mm === 'number' && isFinite(mm) && mm > 0) ore[chiave] += mm;
}

/**
 * [ore bagnate, punta oraria] — oppure `null`, che vuol dire «non lo so» e si
 * traduce in nessun campo `i` nel file.
 *
 * Torna null in tre casi, tutti e tre voluti:
 *  - meno di MIN_ORE ore lette: la durata non e' misurabile;
 *  - nessuna ora bagnata: e' una giornata asciutta, e `mm: 0` lo dice gia';
 *  - la somma delle ore e' sotto SOGLIA_MM: sotto mezzo millimetro in tutto
 *    il giorno «e' piovuto per un'ora» e' rumore, non un'informazione.
 */
const SOGLIA_MM = 0.5;

function intensita(ore) {
  const chiavi = Object.keys(ore);
  if (chiavi.length < MIN_ORE) return null;
  let bagnate = 0, punta = 0, tot = 0;
  for (let k = 0; k < chiavi.length; k++) {
    const v = ore[chiavi[k]];
    if (v > 0) {
      bagnate++;
      tot += v;
      if (v > punta) punta = v;
    }
  }
  if (!bagnate || tot < SOGLIA_MM) return null;
  return [bagnate, Math.round(punta * 10) / 10];
}

module.exports = { MIN_ORE, SOGLIA_MM, creaOre, segna, intensita };
