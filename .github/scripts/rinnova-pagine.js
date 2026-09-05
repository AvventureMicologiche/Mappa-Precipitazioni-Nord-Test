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
 * ⚠️ QUESTO GIRO COSTA UN DEPLOY NETLIFY, ~15 crediti su un piano da 1.000.
 * Le pagine stanno nella radice del repo, quindi NON sono nella regola ignore
 * di `netlify.toml` come `data/` e `.github/`. Per questo gira **quattro volte
 * l'anno e non ogni notte**: 60 crediti l'anno, che e' il 6% del piano.
 * Cuocere invece i millimetri di ieri vorrebbe dire un deploy al giorno, cioe'
 * 450 crediti al mese: e' il motivo per cui quelli restano nel javascript.
 *
 * ⚠️ NON TOCCA LE 23 PAGINE REGIONE NE' LE 19 FUNGHI. Quelle il ritratto non
 * ce l'hanno: rigenerarle non cambierebbe un byte, e la loro data in
 * `pagine-lastmod.json` deve restare quella vera dell'ultima modifica.
 * (`genera-pagine-funghi.js` viene comunque lanciato, perche' le pagine di
 * paese e di zona leggono il foglio di stile da li'.)
 *
 * COSA FA, nell'ordine:
 *   1. rigenera funghi → localita' → zone;
 *   2. se `funghi/` non e' cambiato, si ferma e non committa niente;
 *   3. se e' cambiato, scrive la data di oggi in `pagine-lastmod.json` per le
 *      due famiglie toccate e rifa' la sitemap;
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

// Quante pagine sono cambiate davvero, secondo git. Si guarda SOLO `funghi/`:
// e' li' che stanno le 948 di paese e le 114 di zona.
function cambiate() {
  const out = execFileSync('git', ['status', '--porcelain', '--', 'funghi'],
    { cwd: RADICE, encoding: 'utf8' });
  const righe = out.split('\n').filter(r => r.trim());
  const zone = righe.filter(r => r.includes('funghi/zone/')).length;
  return { tutte: righe.length, zone, localita: righe.length - zone };
}

const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

console.log('Rinnovo delle pagine di paese e di zona — ' + oggi);
lancia('genera-pagine-funghi.js');
lancia('genera-pagine-localita.js');
lancia('genera-pagine-zona.js');

const c = cambiate();
console.log('');
console.log('  pagine cambiate: ' + c.tutte + '  (paese ' + c.localita + ', zona ' + c.zone + ')');

if (!c.tutte) {
  console.log('  Niente da pubblicare: nessun deploy, nessun credito speso.');
  process.exit(0);
}

const dati = JSON.parse(fs.readFileSync(LASTMOD, 'utf8'));
// ⚠️ La data si muove SOLO per le famiglie che hanno pagine cambiate: dire a
// Google che sono cambiate anche le altre e' una bugia piccola che costa
// fiducia sulle prossime.
if (c.localita) dati.localita = oggi;
if (c.zone) dati.zone = oggi;

if (DRY) {
  console.log('  DRY_RUN: le date resterebbero ' + JSON.stringify({ localita: dati.localita, zone: dati.zone }));
  process.exit(0);
}

fs.writeFileSync(LASTMOD, JSON.stringify(dati, null, 2) + '\n', 'utf8');
console.log('  date aggiornate: paese ' + dati.localita + ', zona ' + dati.zone);

// La sitemap si rifa' DOPO aver scritto le date, se no resta con le vecchie.
lancia('genera-pagine-zona.js');
console.log('');
console.log('  ⚠️ Questo giro fa partire un deploy Netlify: ~15 crediti.');
