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
 * altimetrico (Copernicus DEM a 90 m via Open-Meteo). Le due cose coincidono
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
const https = require('https');

const RADICE = path.join(__dirname, '..', '..', 'data');
const FUORI = path.join(RADICE, 'quote-terreno.json');
const RIFAI_TUTTE = process.argv.includes('--tutte');

const RETI = ['friuli-osmer'].concat(
  ['basilicata', 'calabria', 'campania', 'friuli', 'lazio', 'marche', 'molise',
   'puglia', 'sardegna', 'sicilia', 'umbria'].map(r => 'meteohub-' + r));

// ⚠️ Open-Meteo conta le richieste A PESO, non a numero: un lotto da 100 punti
// vale molto piu' di una chiamata, e il 26/8/2026 il primo giro con lotti da
// 100 ha preso 429 su tre quarti delle reti. Lotti piccoli, pausa vera, e
// soprattutto ATTESA LUNGA sul 429 invece di insistere.
const LOTTO = 50;
const PAUSA = 2500;         // ms fra un lotto e l'altro
const ATTESA_429 = 65000;   // ms dopo un rifiuto per eccesso di richieste
const TENTATIVI = 4;

function leggi(f) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(d) ? d : (d.stations || []);
}

/** Tutte le stazioni distinte di una rete, cercate in TUTTO lo storico:
 *  una stazione sparita a luglio deve avere la quota lo stesso, se no il
 *  buco resta nei giorni vecchi. */
function stazioniDi(rete) {
  const dir = path.join(RADICE, rete);
  if (!fs.existsSync(dir)) return [];
  const viste = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    for (const s of leggi(path.join(dir, f))) {
      if (!s.id || viste.has(s.id)) continue;
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      viste.set(s.id, { id: s.id, n: s.n, lat: s.lat, lon: s.lon });
    }
  }
  return [...viste.values()];
}

function chiedi(url) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': 'mappa-pluviometrica/1.0' } }, r => {
      if (r.statusCode !== 200) { r.resume(); return ko(new Error('HTTP ' + r.statusCode)); }
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { ko(e); } });
    }).on('error', ko);
  });
}

async function quotePer(punti) {
  const lat = punti.map(p => p.lat).join(',');
  const lon = punti.map(p => p.lon).join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
  for (let t = 1; t <= TENTATIVI; t++) {
    try {
      const r = await chiedi(url);
      if (!r || !Array.isArray(r.elevation) || r.elevation.length !== punti.length)
        throw new Error('risposta inattesa: ' + JSON.stringify(r).slice(0, 200));
      return r.elevation;
    } catch (e) {
      const troppe = /HTTP 429/.test(e.message);
      if (t === TENTATIVI) throw e;
      const attesa = troppe ? ATTESA_429 : 4000;
      console.log(`  ...tentativo ${t} fallito (${e.message}), aspetto ${attesa / 1000}s`);
      await new Promise(r => setTimeout(r, attesa));
    }
  }
}

(async () => {
  let fuori = { _nota: '', _fonte: '', _aggiornato: '', reti: {} };
  if (fs.existsSync(FUORI)) {
    try { fuori = JSON.parse(fs.readFileSync(FUORI, 'utf8')); } catch (e) {}
    if (!fuori.reti) fuori.reti = {};
  }

  let chieste = 0, saltate = 0, falliti = 0;
  for (const rete of RETI) {
    const staz = stazioniDi(rete);
    if (!staz.length) { console.log(`${rete}: nessun file, salto`); continue; }
    const note = fuori.reti[rete] || (fuori.reti[rete] = {});
    const daFare = RIFAI_TUTTE ? staz : staz.filter(s => note[s.id] === undefined);
    saltate += staz.length - daFare.length;
    if (!daFare.length) { console.log(`${rete}: ${staz.length} stazioni, tutte gia' note`); continue; }

    for (let i = 0; i < daFare.length; i += LOTTO) {
      const lotto = daFare.slice(i, i + LOTTO);
      try {
        const q = await quotePer(lotto);
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
      await new Promise(r => setTimeout(r, PAUSA));
    }
    const q = Object.values(note);
    console.log(`${rete}: ${staz.length} stazioni, quote note ${q.length}, ` +
      `da ${Math.min(...q)} a ${Math.max(...q)} m`);
  }

  fuori._nota = 'ALTEZZA DEL TERRENO nel punto della stazione, NON la quota dichiarata ' +
    'dall\'ente: queste reti l\'altitudine non la pubblicano. Ripiego onesto, DA RISOLVERE ' +
    'trovando l\'anagrafica vera. Il sito la mostra col ~ davanti.';
  fuori._fonte = 'Open-Meteo Elevation API (Copernicus DEM GLO-90)';
  fuori._aggiornato = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FUORI, JSON.stringify(fuori, null, 1));

  const tot = Object.values(fuori.reti).reduce((a, r) => a + Object.keys(r).length, 0);
  console.log(`\nscritto ${path.relative(process.cwd(), FUORI)}: ${tot} stazioni ` +
    `(${chieste} chieste ora, ${saltate} gia' note, ${falliti} fallite)`);
})().catch(e => { console.error(e); process.exit(1); });
