#!/usr/bin/env node
/**
 * BACKFILL SLOVENIA — una tantum, da lanciare in LOCALE (non e nei workflow).
 *
 *   node backfill-slovenia-arso.js [giorni] [blocco]
 *   es.  node backfill-slovenia-arso.js 365 60
 *
 * Non riscrive la ricetta: lancia il collector vero (collect-slovenia-arso.js)
 * a blocchi di N giorni via DATA_OVERRIDE, cosi il risultato e identico a quello
 * dei run automatici e c'e un posto solo dove la ricetta puo sbagliare.
 *
 * Perche a blocchi: chiedendo un anno intero in una sola volta la serie in
 * memoria diventa 124 stazioni x 365 giorni x 144 letture (con la temperatura
 * la granularita scende a 10 minuti) = oltre sei milioni di record, piu di un
 * giga. A 60 giorni per blocco si sta largamente dentro.
 *
 * E ripartibile: i giorni gia scritti vengono semplicemente riscritti uguali,
 * quindi se si interrompe basta rilanciarlo.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const GIORNI = Number(process.argv[2] || 365);
const BLOCCO = Number(process.argv[3] || 60);
const COLLECTOR = path.join(__dirname, 'collect-slovenia-arso.js');
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'slovenia');

const iso = (d) => d.toISOString().slice(0, 10);
const oggi = new Date();

// si parte da D-2: l'archivio ARSO ha ~34 ore di ritardo e ieri non e mai completo
const giorni = [];
for (let i = 2; i < 2 + GIORNI; i++) {
  const d = new Date(oggi); d.setUTCDate(d.getUTCDate() - i); giorni.push(iso(d));
}
giorni.sort();

const blocchi = [];
for (let i = 0; i < giorni.length; i += BLOCCO) blocchi.push(giorni.slice(i, i + BLOCCO));

console.log(`Backfill Slovenia: ${giorni[0]} -> ${giorni[giorni.length - 1]} (${giorni.length} giorni, ${blocchi.length} blocchi da ${BLOCCO})`);
const t0 = Date.now();

blocchi.forEach((b, i) => {
  const avanti = new Date();
  console.log(`\n=== blocco ${i + 1}/${blocchi.length}: ${b[0]} -> ${b[b.length - 1]}  (${avanti.toISOString().slice(11, 19)})`);
  try {
    execFileSync('node', [COLLECTOR], {
      stdio: 'inherit',
      env: { ...process.env, DATA_OVERRIDE: b.join(','), PAUSA_MS: process.env.PAUSA_MS || '120' },
    });
  } catch (e) {
    console.log(`  blocco ${i + 1} fallito (${e.message}) — si continua, e ripartibile`);
  }
});

const scritti = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length : 0;
console.log(`\nFATTO in ${Math.round((Date.now() - t0) / 60000)} minuti. File totali in data/slovenia: ${scritti}`);
