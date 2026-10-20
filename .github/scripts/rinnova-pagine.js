#!/usr/bin/env node
/**
 * IL RINNOVO STAGIONALE DELLE PAGINE DI PAESE E DI ZONA.
 *
 * PERCHE' ESISTE (4/9/2026). Dentro quelle pagine c'e' il «ritratto» del
 * pluviometro cotto nell'HTML: quanto ha piovuto in tutto l'archivio, il giorno
 * piu' bagnato, il mese piu' piovoso (vedi `lib-clima.js`). Quei numeri **non
 * scadono**, perche' ogni frase dichiara il suo periodo: «da giugno a settembre
 * 2026, in 77 giorni, ha contato 242 mm» resta vero per sempre. Quello che
 * invecchia e' l'UTILITA': con un anno di archivio in piu' il ritratto dice
 * molto di piu', e «il giorno piu' bagnato di tutto l'archivio» va rifatto.
 *
 * ⚠️ IL PUSH NON PUBBLICA NIENTE (dal 7/10/2026 il sito e' su Cloudflare Pages):
 * le pagine nuove vanno online solo con `node cloudflare-pages\pubblica-pages.js`
 * lanciato a mano dal PC, e pubblicare si chiede. Per questo gira **quattro
 * volte l'anno e non ogni notte**, e i millimetri di ieri restano nel javascript.
 *
 * ⚠️ NON TOCCA LE 23 PAGINE REGIONE NE' LE 19 FUNGHI. Quelle il ritratto non
 * ce l'hanno: rigenerarle non cambierebbe un byte, e la loro data in
 * `pagine-lastmod.json` deve restare quella vera dell'ultima modifica.
 * (`genera-pagine-funghi.js` viene comunque lanciato, perche' le pagine di
 * paese e di zona leggono il foglio di stile da li'.)
 *
 * ⚠️ LE ZONE PIOGGE (20/10/2026, sesto check): `genera-pagine-zona-piogge.js` e'
 * l'UNICO che scrive `data/paesi-zone.json`, l'elenco dei paesi che
 * /api/previsioni?zona= legge per «Che tempo farà»: senza questo giro restava
 * fermo all'ultima volta che qualcuno l'aveva lanciato a mano. Prende lo stile
 * dalla pagina REGIONE gia' nel checkout (qui non si rigenera), quindi l'ordine
 * rispetto alle altre famiglie e' libero; si lancia per ultimo.
 *
 * COSA FA, nell'ordine:
 *   1. rigenera funghi → localita' → zone funghi → zone piogge (+ paesi-zone.json);
 *   2. se `funghi/` e `zone/` non sono cambiati, si ferma senza toccare le date;
 *   3. se sono cambiati, scrive la data di oggi in `pagine-lastmod.json` per le
 *      famiglie toccate e rifa' la sitemap;
 *   4. lascia al workflow il commit e il push.
 *
 * Uso: `node .github/scripts/rinnova-pagine.js` — con `DRY_RUN=1` guarda e
 * dice cosa cambierebbe senza scrivere le date.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const QUI = __dirname;
const RADICE = path.join(QUI, '..', '..');
const LASTMOD = path.join(QUI, 'pagine-lastmod.json');
const DRY = process.env.DRY_RUN === '1';

function lancia(script) {
  process.stdout.write('  ▸ ' + script + '\n');
  execFileSync(process.execPath, [path.join(QUI, script)], { cwd: RADICE, stdio: 'inherit' });
}

// Quante pagine sono cambiate davvero, secondo git: `funghi/` (le 948 di paese
// e le 114 di zona funghi), `zone/` (le 114 zone piogge) e l'elenco dei paesi.
// ⚠️ Si guarda il PERCORSO dall'inizio: «funghi/zone/» contiene anche «zone/».
function cambiate() {
  const out = execFileSync('git', ['status', '--porcelain', '--', 'funghi', 'zone', 'data/paesi-zone.json'],
    { cwd: RADICE, encoding: 'utf8' });
  const percorsi = out.split('\n').filter(r => r.trim()).map(r => r.slice(3));
  const funghi = percorsi.filter(p => p.startsWith('funghi/'));
  const zone = funghi.filter(p => p.startsWith('funghi/zone/')).length;
  const zonePiogge = percorsi.filter(p => p.startsWith('zone/')).length;
  const paesiZone = percorsi.includes('data/paesi-zone.json');
  return { tutte: funghi.length + zonePiogge, zone, localita: funghi.length - zone, zonePiogge, paesiZone };
}

const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

console.log('Rinnovo delle pagine di paese e di zona — ' + oggi);
lancia('genera-pagine-funghi.js');
lancia('genera-pagine-localita.js');
lancia('genera-pagine-zona.js');
lancia('genera-pagine-zona-piogge.js');

const c = cambiate();
console.log('');
console.log('  pagine cambiate: ' + c.tutte + '  (paese ' + c.localita + ', zona ' + c.zone + ', zona piogge ' + c.zonePiogge + ')'
  + (c.paesiZone ? '; data/paesi-zone.json cambiato' : ''));

if (!c.tutte) {
  console.log('  Nessuna pagina cambiata: date della sitemap invariate.'
    + (c.paesiZone ? ' Il solo data/paesi-zone.json lo committa il workflow.' : ''));
  process.exit(0);
}

const dati = JSON.parse(fs.readFileSync(LASTMOD, 'utf8'));
// ⚠️ La data si muove SOLO per le famiglie che hanno pagine cambiate: dire a
// Google che sono cambiate anche le altre e' una bugia piccola che costa
// fiducia sulle prossime.
if (c.localita) dati.localita = oggi;
if (c.zone) dati.zone = oggi;
if (c.zonePiogge) dati.zonePiogge = oggi;

if (DRY) {
  console.log('  DRY_RUN: le date resterebbero ' + JSON.stringify({ localita: dati.localita, zone: dati.zone, zonePiogge: dati.zonePiogge }));
  process.exit(0);
}

fs.writeFileSync(LASTMOD, JSON.stringify(dati, null, 2) + '\n', 'utf8');
console.log('  date aggiornate: paese ' + dati.localita + ', zona ' + dati.zone + ', zona piogge ' + dati.zonePiogge);

// La sitemap si rifa' DOPO aver scritto le date, se no resta con le vecchie.
lancia('genera-pagine-zona.js');
console.log('');
console.log('  ⚠️ Il push non pubblica: online solo con pubblica-pages.js lanciato a mano (gratis, ma si chiede).');
