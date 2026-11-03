/* ── I CAPOLUOGHI DI PROVINCIA PRIMA DEGLI ALTRI PAESI (28/10/2026, suo: «i capoluoghi di provincia si devono vedere
   sempre, è più importante Savona di Millesimo», e «questa cosa la devi sistemare in tutte le pagine») ──
   In data/capoluoghi.json «s» e' la SIGLA della provincia e non dice chi e' il capoluogo (Millesimo e Savona: SV), e
   col numero di abitanti non basta (Busto Arsizio > Varese, Marsala > Trapani, Gela > Caltanissetta): l'elenco e'
   scritto qui. Province con piu' capoluoghi: tutti.
   Chi lo usa: l'anteprima «Previsioni» delle pagine meteo (ordineCitta), le tabelle «Che tempo farà» di meteoClient
   (CAPI, la stessa lista scritta come la normalizza il browser) e le citta' delle pagine «adesso». */
const fs = require('fs');
const path = require('path');
const RADICE = path.join(__dirname, '..', '..');

const normNome = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const NOMI = [
  'Torino', 'Alessandria', 'Asti', 'Biella', 'Cuneo', 'Novara', 'Verbania', 'Vercelli', 'Aosta',
  'Milano', 'Bergamo', 'Brescia', 'Como', 'Cremona', 'Lecco', 'Lodi', 'Mantova', 'Monza', 'Pavia', 'Sondrio', 'Varese',
  'Trento', 'Bolzano', 'Venezia', 'Belluno', 'Padova', 'Rovigo', 'Treviso', 'Verona', 'Vicenza',
  'Trieste', 'Gorizia', 'Pordenone', 'Udine', 'Genova', 'Imperia', 'La Spezia', 'Savona',
  'Bologna', 'Ferrara', 'Forlì', 'Cesena', 'Modena', 'Parma', 'Piacenza', 'Ravenna', 'Reggio Emilia', "Reggio nell'Emilia", 'Rimini',
  'Firenze', 'Arezzo', 'Grosseto', 'Livorno', 'Lucca', 'Massa', 'Carrara', 'Pisa', 'Pistoia', 'Prato', 'Siena',
  'Perugia', 'Terni', 'Ancona', 'Ascoli Piceno', 'Fermo', 'Macerata', 'Pesaro', 'Urbino',
  'Roma', 'Frosinone', 'Latina', 'Rieti', 'Viterbo', "L'Aquila", 'Chieti', 'Pescara', 'Teramo', 'Campobasso', 'Isernia',
  'Napoli', 'Avellino', 'Benevento', 'Caserta', 'Salerno', 'Bari', 'Barletta', 'Andria', 'Trani', 'Brindisi', 'Foggia', 'Lecce', 'Taranto',
  'Potenza', 'Matera', 'Catanzaro', 'Cosenza', 'Crotone', 'Reggio Calabria', 'Reggio di Calabria', 'Vibo Valentia',
  'Palermo', 'Agrigento', 'Caltanissetta', 'Catania', 'Enna', 'Messina', 'Ragusa', 'Siracusa', 'Trapani',
  'Cagliari', 'Sassari', 'Nuoro', 'Oristano', 'Carbonia', 'Iglesias', 'Olbia', 'Tempio Pausania', 'Tortolì', 'Lanusei', 'Sanluri', 'Villacidro',
];
const CAPOLUOGHI_PROVINCIA = new Set(NOMI.map(normNome));
const capoluogo = n => CAPOLUOGHI_PROVINCIA.has(normNome(n));

/* La stessa lista per il codice del browser (meteoClient): normalizzata come la sua norm() — minuscole, senza accenti,
   apostrofi punti e trattini in spazi — tra due «|»: CAPI.indexOf('|' + norm(nome) + '|') >= 0. */
const normClient = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim();
const CAPI = '|' + NOMI.map(normClient).join('|') + '|';

// gli abitanti dall'elenco dei comuni (lo stesso della casella di ricerca): nome|lat|lon|sigla|regione|abitanti
let ABITANTI = null;
function abitanti(n, reg) {
  if (!ABITANTI) {
    ABITANTI = {};
    for (const r of fs.readFileSync(path.join(RADICE, 'data', 'elenco-paesi.txt'), 'utf8').split('\n')) {
      const p = r.split('|'); if (p.length >= 6) ABITANTI[normNome(p[0]) + '|' + p[4]] = +p[5] || 0;
    }
  }
  return ABITANTI[normNome(n) + '|' + reg] || 0;
}
// prima il capoluogo di regione (c), poi i capoluoghi di provincia, poi gli altri; ognuno dal piu' abitato
const confronta = reg => (a, b) => (b.c ? 1 : 0) - (a.c ? 1 : 0) || (capoluogo(b.n) ? 1 : 0) - (capoluogo(a.n) ? 1 : 0) || abitanti(b.n, reg) - abitanti(a.n, reg);

// le citta' dell'anteprima «Previsioni» nell'ordine in cui si mettono; i primi `cap` sono capoluoghi e non si tolgono
function ordineCitta(reg) {
  const tutte = JSON.parse(fs.readFileSync(path.join(RADICE, 'data', 'capoluoghi.json'), 'utf8'))[reg] || [];
  const ord = tutte.slice().sort(confronta(reg));
  return { ord: ord.map(c => c.n), cap: ord.filter(c => c.c || capoluogo(c.n)).length };
}

module.exports = { normNome, capoluogo, CAPI, abitanti, confronta, ordineCitta };
