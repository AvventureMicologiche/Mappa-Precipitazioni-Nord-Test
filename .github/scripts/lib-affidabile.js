/**
 * Da quando lo storico di ogni CARTELLA è considerato affidabile (le date
 * "Dati corretti da" delle schede in CLAUDE.md). Chi guarda il passato si ferma
 * alla più tarda fra le cartelle coinvolte.
 *
 * Non è pignoleria: con la finestra piena di 120 giorni il confine
 * Emilia↔Liguria risultava sbilanciato al 67%, con 39 stazioni su 45 dallo
 * stesso lato — sembrava un collector rotto. Erano invece i giorni emiliani
 * precedenti al 5/6/2026, dove l'evento dell'1-2 giugno è sul giorno
 * sbagliato e quasi raddoppiato. Tagliando lì: +0,96 mm e 58%. Uno strumento
 * che pesca in acque dichiarate torbide accusa gli innocenti.
 *
 * PERCHE' STA IN UN FILE A SE' (4/9/2026). La usava solo `check-confini.js`;
 * dal 4/9 la usa anche `lib-clima.js`, che scrive nelle pagine il ritratto di
 * ogni pluviometro. Due copie che divergessero direbbero due passati diversi
 * sullo stesso dato, e nessuno se ne accorgerebbe. ⚠️ Le chiavi sono le
 * CARTELLE, non le chiavi di regione: `friuli-osmer`, non `friuli`.
 *
 * ⚠️ Le cartelle che non stanno qui non hanno taglio: per loro la difesa è il
 * filtro sulle stime (`source: open-meteo-*`), che nelle reti MeteoHub coincide
 * con la frontiera del dato reale perché prima di quella data i file SONO il
 * backfill.
 *
 * Non fa niente da solo: è un modulo, si richiede.
 */

const AFFIDABILE_DA = {
  lombardia: '2026-01-01', ticino: '2026-03-18', emilia: '2026-06-05',
  veneto: '2026-06-04', altoadige: '2026-06-04', trentino: '2026-06-06',
  piemonte: '2026-06-12', liguria: '2026-06-19', toscana: '2026-07-12',
  'valledaosta-cf': '2026-07-16', 'friuli-osmer': '2026-07-18',
  // Austria: il backfill GeoSphere è fatto di dati REALI di stazione fin dal
  // primo giorno (non stime), quindi non c'è una data prima della quale
  // diffidare — vale tutto lo storico disponibile.
  austria: '2025-08-05',
  svizzera: '2025-08-04', // backfill dagli archivi MeteoSwiss: reale da subito
  // Slovenia: come l'Austria, il backfill ARSO è fatto di mezz'ore REALI di
  // stazione dal primo giorno (mai stime), quindi vale tutto lo storico.
  slovenia: '2025-08-11',
};

module.exports = { AFFIDABILE_DA };
