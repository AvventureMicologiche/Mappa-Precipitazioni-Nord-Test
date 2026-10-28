/**
 * IL METEO DI IERI SI CALCOLA UNA VOLTA SOLA (27/10/2026, fase 2 dell'alleggerimento delle fonti).
 *
 * PERCHE' ESISTE. Dopo OMIRL (Liguria), ARPA Piemonte e OASI (Ticino), tre fonti
 * che hanno smesso di rispondere ai server di GitHub, si e' contato quanto chiediamo:
 * ~18.800 richieste al giorno. Temperatura, vento e umidita' costano una o piu'
 * richieste PER STAZIONE (Alto Adige 228 a giro, Liguria ~350, Trentino ~104) e si
 * rifacevano a ogni giro, anche se la mappa mostra solo ieri e ieri, chiuso, non
 * cambia piu'.
 *
 * LA REGOLA, una sola per Alto Adige, Trentino e Liguria: il meteo di ieri si fa nel
 * primo giro dopo le 3 italiane (il giorno e' chiuso da tre ore e le fonti hanno
 * pubblicato le ultime ore) che trova il file di ieri ancora senza. I giri dopo lo
 * trovano fatto e saltano. Di norma e' il giro delle 4:30 della sveglia su Cloudflare.
 *
 * «Fatto» = almeno `soglia` stazioni con uno dei campi. I campi non spariscono ai giri
 * dopo, perche' chi riscrive il file li tiene (lib-tieni-meteo.js). Se un tentativo
 * resta sotto soglia (fonte che rifiuta le raffiche, stazioni senza risposta) ci
 * riprova il giro dopo, come prima.
 *
 * ⚠️ La soglia sta sotto il conto normale ma lontana da zero: Alto Adige 40 (di solito
 * 56-57 con t), Liguria 120 (176-177), Trentino 30 con u o w (41-45). Un giorno con
 * meta' dei sensori guasti si rifa' a ogni giro, cioe' come prima: costa, non sbaglia.
 */
const fs = require('fs');
const { offsetItalia } = require('./lib-giorno-italiano.js');

const ORA_DA = 3;

function oraItaliana(adesso) {
  return new Date(adesso.getTime() + offsetItalia(adesso) * 3600000).getUTCHours();
}

// { fare, perche }: `perche` va nel log, cosi' dal giro si capisce cosa ha deciso.
function meteoIeriDaFare(file, campi, soglia, adesso = new Date()) {
  if (oraItaliana(adesso) < ORA_DA) return { fare: false, perche: `prima delle ${ORA_DA} italiane, lo faccio al giro dopo` };
  let n = 0;
  try { n = (JSON.parse(fs.readFileSync(file, 'utf8')).stations || []).filter(s => campi.some(c => s[c])).length; }
  catch (e) { /* file che non c'e' ancora: si fa */ }
  if (n >= soglia) return { fare: false, perche: `gia' fatto, ${n} stazioni con ${campi.join('/')}` };
  return { fare: true, perche: `${n} stazioni con ${campi.join('/')}, sotto ${soglia}` };
}

module.exports = { meteoIeriDaFare };
