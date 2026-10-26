/* ⚠️ VENTI FALSI (19/10/2026, quinto check, bug 9). La seconda rete dopo VENTO_MAX_MS, come i picchi falsi della
   pioggia: un anemometro bloccato su un gradino piu' basso del tetto passerebbe. Il vento vero, anche forte, si vede
   sui vicini; quello di San Vito Lo Capo (157,1 km/h il 16/10) aveva intorno 3-8 km/h. Si toglie il vento della
   stazione (w e wd, solo quel giorno) se la media e' >= VENTO_FALSO_KMH, ha almeno VENTO_FALSO_VICINI vicini col
   vento entro VENTO_FALSO_KM e il piu' ventoso di loro sta sotto 1/VENTO_FALSO_RAPPORTO del suo valore.
   Provata sullo storico MeteoHub dal 1/8/2026: prende i 4 giorni guasti di San Vito e Manfredonia e nient'altro.
   Solo MeteoHub: vette e capi delle altre reti (Mont Aigoual 74 km/h) il vento forte ce l'hanno davvero.
   In collect-meteohub.js gira in writeDay DOPO tieniMeteo, cosi' toglie anche un valore falso ripreso dal file del
   giorno. Dal 20/10/2026 (settimo check, bug 11) sta qui perche' la usa anche backfill-meteo-meteohub.js, che prima
   aveva il solo tetto dei 40 m/s e poteva rimettere un vento falso. */
const VENTO_FALSO_KMH = 30, VENTO_FALSO_KM = 35, VENTO_FALSO_VICINI = 3, VENTO_FALSO_RAPPORTO = 4;
function togliVentiFalsi(stations, dateStr) {
  const km = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) * 111.2;
  const conW = stations.filter(s => s.w && s.w[0] != null && s.lat != null && s.lon != null);
  const falsi = conW.filter(s => {
    if (!(s.w[0] >= VENTO_FALSO_KMH)) return false;
    const vicini = conW.filter(x => x !== s && km(s, x) <= VENTO_FALSO_KM);
    if (vicini.length < VENTO_FALSO_VICINI) return false;
    const mx = Math.max(...vicini.map(x => x.w[0]));
    if (mx * VENTO_FALSO_RAPPORTO >= s.w[0]) return false;
    console.warn(`  ⚠️ ${dateStr}: ${s.n} vento medio ${s.w[0]} km/h con ${vicini.length} vicini entro ${VENTO_FALSO_KM} km, il piu' ventoso a ${mx}: anemometro guasto, vento tolto dal giorno`);
    return true;
  });
  falsi.forEach(s => { delete s.w; delete s.wd; });   // tutti decisi prima di togliere: un vicino non cambia il giudizio di un altro
  return falsi.length;
}

module.exports = { togliVentiFalsi, VENTO_FALSO_KMH, VENTO_FALSO_KM, VENTO_FALSO_VICINI, VENTO_FALSO_RAPPORTO };
