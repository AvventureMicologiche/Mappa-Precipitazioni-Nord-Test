/**
 * ripara-zero-falso.js — UNA TANTUM, a mano. NON sta in nessun workflow.
 *
 * Ripara gli "zeri falsi": un giorno in cui una stazione consegna 0,0 mm
 * mentre lo STESSO pluviometro, pubblicato anche da un'altra agenzia, dice
 * che ha piovuto. Non e' una stima e non e' un'interpolazione: e' la stessa
 * misura, letta dall'altra porta.
 *
 * PERCHE' ESISTE (21/8/2026). Gli zeri falsi ARPAE sono al quarto caso. Il
 * 20/8/2026 in Emilia ce n'erano nove in un giorno solo, contro i quattro del
 * giorno peggiore precedente. Di quei nove, uno solo si puo' DIMOSTRARE:
 * Lago Paduli (id 3078) segnava 0,0 mentre la sua gemella SIR, a 863 metri,
 * segnava 21,1 mm e Ospitaletto, a 1,8 km, ne segnava 39. Gli altri otto non
 * hanno una gemella e restano com'erano: senza prova non si tocca niente.
 *
 * ⚠️ NON si esclude la stazione. Verificato sui 60 giorni precedenti: ARPAE e
 * SIR su Lago Paduli sono d'accordo TUTTI gli altri giorni (79,0 mm contro
 * 100,1, e la differenza e' tutta in quel 20 agosto). Il pluviometro sta bene,
 * era sbagliato un dato. Toglierlo avrebbe buttato via una stazione sana e
 * lasciato un buco sul crinale a chi guarda la sola Emilia — lo stesso errore
 * fatto la mattina del 21/8 con le gemelle della Lunigiana.
 *
 * LE REGOLE, strette apposta:
 *  - si ripara SOLO chi sta a 0,0 mm;
 *  - la gemella deve stare entro 1 km (stesso pluviometro, non un vicino) e
 *    segnare almeno 2 mm;
 *  - i vicini devono confermare: mediana dei 5 piu' prossimi entro 15 km
 *    sopra 5 mm, altrimenti la gemella potrebbe essere lei quella sbagliata;
 *  - si scrive il valore della gemella e si marca la stazione con
 *    `zf: '<rete>'`, cosi' resta riconoscibile per sempre;
 *  - il file originale finisce in data/<regione>/_pre-zerofalso/<giorno>.json
 *    prima di essere toccato.
 *
 * Uso:  node .github/scripts/ripara-zero-falso.js 2026-08-20 [--scrivi]
 * Senza --scrivi stampa e basta.
 */
const fs = require('fs');
const path = require('path');

const GIORNO  = process.argv[2];
const SCRIVI  = process.argv.includes('--scrivi');
const REGIONE = process.env.REGIONE || 'emilia';
const TESTIMONI = (process.env.TESTIMONI || 'toscana,liguria,lombardia,veneto,meteohub-marche').split(',');
const DATA_DIR = process.env.DATA_DIR || 'data';
const MAX_KM_GEMELLA = 1, MIN_MM_GEMELLA = 2, MIN_MM_VICINI = 5, RAGGIO_VICINI = 15;

if (!/^\d{4}-\d{2}-\d{2}$/.test(GIORNO || '')) {
  console.error('Serve un giorno: node ripara-zero-falso.js 2026-08-20 [--scrivi]');
  process.exit(1);
}

function km(a, b) {
  const dy = (a.lat - b.lat) * 110.57;
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}
const mediana = a => { const v = [...a].sort((x, y) => x - y); const m = Math.floor(v.length / 2);
                       return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
function leggi(reg) {
  const f = path.join(DATA_DIR, reg, GIORNO + '.json');
  if (!fs.existsSync(f)) return { file: f, json: null, st: [] };
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (typeof json.source === 'string' && /open-meteo/i.test(json.source)) return { file: f, json, st: [] };
  const st = (json.stations || []).filter(s => typeof s.mm === 'number' && typeof s.lat === 'number');
  return { file: f, json, st: st.map(s => ({ ...s, rete: reg })) };
}

const base = leggi(REGIONE);
if (!base.json) { console.error('niente file per ' + GIORNO + ' in ' + REGIONE); process.exit(1); }
let testimoni = [];
for (const r of TESTIMONI) testimoni = testimoni.concat(leggi(r).st);

console.log(`${REGIONE} ${GIORNO}: ${base.st.length} stazioni, ${testimoni.length} testimoni da ${TESTIMONI.join(', ')}`);
const riparabili = [];
for (const s of base.st) {
  if (s.mm > 0.05) continue;
  const gem = testimoni.map(v => ({ v, d: km(s, v) }))
                       .filter(x => x.d <= MAX_KM_GEMELLA && x.v.mm >= MIN_MM_GEMELLA)
                       .sort((a, b) => a.d - b.d)[0];
  if (!gem) continue;
  const vicini = base.st.concat(testimoni).filter(v => v !== s)
    .map(v => ({ d: km(s, v), mm: v.mm })).filter(x => x.d <= RAGGIO_VICINI)
    .sort((a, b) => a.d - b.d).slice(0, 5);
  if (vicini.length < 5) continue;
  const med = mediana(vicini.map(x => x.mm));
  if (med < MIN_MM_VICINI) continue;
  riparabili.push({ s, gem, med });
}
console.log(`\nda riparare: ${riparabili.length}`);
for (const r of riparabili) {
  console.log(`  ${r.s.n} (id ${r.s.id}) 0,0 mm -> ${r.gem.v.mm} mm` +
              `   gemella ${r.gem.v.n} [${r.gem.v.rete}] a ${Math.round(r.gem.d * 1000)} m,` +
              ` mediana dei 5 vicini ${r.med.toFixed(1)} mm`);
}
if (!riparabili.length || !SCRIVI) { console.log(SCRIVI ? '' : '\n(prova: niente scritto. Aggiungi --scrivi)'); process.exit(0); }

const backupDir = path.join(DATA_DIR, REGIONE, '_pre-zerofalso');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, GIORNO + '.json');
if (!fs.existsSync(backup)) fs.copyFileSync(base.file, backup);
for (const r of riparabili) {
  const vera = (base.json.stations || []).find(x => String(x.id) === String(r.s.id));
  if (!vera) continue;
  vera.mm = r.gem.v.mm;
  vera.zf = r.gem.v.rete;
}
fs.writeFileSync(base.file, JSON.stringify(base.json) + '\n');
console.log(`\nscritto ${base.file}; originale in ${backup}`);
