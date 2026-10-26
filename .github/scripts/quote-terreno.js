/**
 * QUOTA DELLE STAZIONI CHE LA FONTE NON DICHIARA  (26/8/2026)
 * ===========================================================
 *
 * Undici reti non hanno l'altitudine e non e' un nostro bug: l'API dei
 * metadati di MeteoHub espone SOLO nome e lat/lon (sta scritto in cima a
 * collect-meteohub.js), e OSMER Friuli non la pubblica nel tracciato che
 * usiamo. Sono ~1.650 stazioni fra Basilicata, Calabria, Campania, Friuli,
 * Lazio, Marche, Molise, Puglia, Sardegna, Sicilia e Umbria: fino al 26/8 il
 * sito scriveva «0 m slm», cioe' dichiarava il livello del mare su pluviometri
 * che stanno in montagna.
 *
 * ⚠️ QUELLO CHE SCRIVE QUESTO SCRIPT NON E' LA QUOTA DELLA STAZIONE: e'
 * l'ALTEZZA DEL TERRENO nel punto in cui la stazione sta, presa da un modello
 * altimetrico (fino al 25/10/2026 Copernicus DEM a 90 m via Open-Meteo, poi le
 * tessere terrarium di lib-terrarium.js). Le due cose coincidono
 * quasi sempre, ma non sono la stessa affermazione: la quota vera la dichiara
 * l'ente, questa la deduciamo noi dalle coordinate. Per questo il dato viene
 * marcato come «terreno» e il sito lo mostra col ~ davanti.
 * ⚠️ RESTA DA RISOLVERE: la strada giusta e' trovare l'anagrafica vera di
 * queste reti (vedi la lezione della Toscana: non «l'endpoint che uso ha il
 * dato?» ma «l'ente lo pubblica da qualche parte?»). Questo e' un ripiego
 * onesto, non l'arrivo.
 *
 * Scrive data/quote-terreno.json. Si rilancia solo quando compaiono stazioni
 * nuove: chiede le quote SOLO per quelle che non ha gia'.
 *
 * uso: node .github/scripts/quote-terreno.js [--tutte]
 *      --tutte  rifa' anche le stazioni gia' note
 */

const fs = require('fs');
const path = require('path');
// ⚠️ DAL 25/10/2026 LE QUOTE NUOVE VENGONO DALLE TESSERE TERRARIUM, non piu' da Open-Meteo Elevation (il suo
// piano gratuito vieta i siti con pubblicita'). Quelle gia' scritte nel file restano: sono dati del Copernicus
// DEM, e si rifanno tutte solo con --tutte.
const { quoteTerrarium, FONTE } = require('./lib-terrarium.js');

const RADICE = path.join(__dirname, '..', '..', 'data');
const FUORI = path.join(RADICE, 'quote-terreno.json');
const RIFAI_TUTTE = process.argv.includes('--tutte');

const RETI = ['friuli-osmer'].concat(
  ['basilicata', 'calabria', 'campania', 'friuli', 'lazio', 'marche', 'molise',
   'puglia', 'sardegna', 'sicilia', 'umbria'].map(r => 'meteohub-' + r));

// Reti che la quota la dichiarano, ma per qualche stazione dichiarano 0 m anche
// dove non c'e' il mare (14/10/2026: il SIR per Bulera e Ponte Orgia). Di queste
// si chiedono SOLO le stazioni a 0: il collector usa il terreno se sta sopra i
// 20 m (correggiZeri in lib-quota-terreno.js), se no lo 0 resta.
const RETI_ZERI = ['toscana'];

const LOTTO = 200;   // solo per non perdere tutta una rete se una tessera non arriva

function leggi(f) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(d) ? d : (d.stations || []);
}

/** Tutte le stazioni distinte di una rete, cercate in TUTTO lo storico:
 *  una stazione sparita a luglio deve avere la quota lo stesso, se no il
 *  buco resta nei giorni vecchi. */
function stazioniDi(rete, soloZeri) {
  const dir = path.join(RADICE, rete);
  if (!fs.existsSync(dir)) return [];
  const viste = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    for (const s of leggi(path.join(dir, f))) {
      if (!s.id || viste.has(s.id)) continue;
      if (soloZeri && s.q !== 0) continue;
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      viste.set(s.id, { id: s.id, n: s.n, lat: s.lat, lon: s.lon });
    }
  }
  return [...viste.values()];
}

(async () => {
  let fuori = { _nota: '', _fonte: '', _aggiornato: '', reti: {} };
  if (fs.existsSync(FUORI)) {
    try { fuori = JSON.parse(fs.readFileSync(FUORI, 'utf8')); } catch (e) {}
    if (!fuori.reti) fuori.reti = {};
  }

  let chieste = 0, saltate = 0, falliti = 0;
  for (const rete of RETI.concat(RETI_ZERI)) {
    const staz = stazioniDi(rete, RETI_ZERI.includes(rete));
    if (!staz.length) { console.log(`${rete}: nessun file, salto`); continue; }
    const note = fuori.reti[rete] || (fuori.reti[rete] = {});
    const daFare = RIFAI_TUTTE ? staz : staz.filter(s => note[s.id] === undefined);
    saltate += staz.length - daFare.length;
    if (!daFare.length) { console.log(`${rete}: ${staz.length} stazioni, tutte gia' note`); continue; }

    for (let i = 0; i < daFare.length; i += LOTTO) {
      const lotto = daFare.slice(i, i + LOTTO);
      try {
        const q = await quoteTerrarium(lotto);
        lotto.forEach((s, k) => {
          const v = q[k];
          if (typeof v === 'number' && isFinite(v)) note[s.id] = Math.round(v);
          else falliti++;
        });
        chieste += lotto.length;
      } catch (e) {
        falliti += lotto.length;
        console.log(`  ⚠️ lotto ${rete} ${i}-${i + lotto.length}: ${e.message}`);
      }
    }
    const q = Object.values(note);
    console.log(`${rete}: ${staz.length} stazioni, quote note ${q.length}, ` +
      `da ${Math.min(...q)} a ${Math.max(...q)} m`);
  }

  fuori._nota = 'ALTEZZA DEL TERRENO nel punto della stazione, NON la quota dichiarata ' +
    'dall\'ente: queste reti l\'altitudine non la pubblicano (toscana: solo le stazioni che il ' +
    'SIR dichiara a 0 m). Misurata il 14/10/2026 contro 1.848 quote dichiarate: scarto mediano ' +
    '5 m, 90% entro 26 m. Il sito la mostra col ~ davanti.';
  fuori._fonte = RIFAI_TUTTE ? FONTE
    : FONTE + ' dal 25/10/2026; le quote scritte prima vengono da Open-Meteo Elevation (Copernicus DEM GLO-90)';
  fuori._aggiornato = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FUORI, JSON.stringify(fuori, null, 1));

  const tot = Object.values(fuori.reti).reduce((a, r) => a + Object.keys(r).length, 0);
  console.log(`\nscritto ${path.relative(process.cwd(), FUORI)}: ${tot} stazioni ` +
    `(${chieste} chieste ora, ${saltate} gia' note, ${falliti} fallite)`);
})().catch(e => { console.error(e); process.exit(1); });
