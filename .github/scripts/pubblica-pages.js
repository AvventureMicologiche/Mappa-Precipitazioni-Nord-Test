// Pubblica un repo del sito su Cloudflare Pages con l'UPLOAD DIRETTO (6/10/2026).
//
// ⚠️ DALL'11/10/2026 STA NEL REPO: lo usa anche il giro automatico del mattino
// (pagine-regione.yml), che rigenera le pagine regione «cotte» e le pubblica.
// La copia nel banco di lavoro (cloudflare-pages/pubblica-pages.js) chiama
// questa: una sola ricetta di pubblicazione, non due.
//
// Perche' l'upload diretto e non il collegamento a GitHub: i collector fanno ~90 commit
// al giorno in data/, e su Pages ogni commit sarebbe una build (500 al mese). Cosi'
// si pubblica solo quando lo decidiamo, dal PC, e nessun cron puo' spendere niente.
//
// Cosa fa:
//  1. costruisce la cartella _pages/ dentro il repo (e' in .gitignore? NO: la
//     cartella si CANCELLA a fine corsa, e comunque non si fa mai `git add -A`);
//     copia tutto il repo tranne: .git .github .netlify .claude netlify/ prove/
//     tessere-boschi/italia (31.503 PNG che nessuno legge piu': le tessere vengono
//     da jsDelivr), netlify.toml, i .md, gli script morti alla radice;
//     di data/ tiene TUTTO quello che ci sta sotto il tetto Pages di 20.000 file per
//     deploy (TETTO_FILE, con margine): i giorni dal piu' recente al piu' vecchio, e
//     taglia i piu' vecchi solo se sfora (6/10 pomeriggio: prima erano 90 giorni fissi,
//     ma la riserva serve anche per i giorni vecchi, e in prod ci sta tutto lo storico);
//  2. scrive _headers (CORS su /data/* e sui geojson, cache 30 gg su quello che non
//     cambia indirizzo) e _redirects (quello del repo + /index-5.html → /),
//     cioe' l'equivalente di netlify.toml;
//  3. lancia `wrangler pages deploy` sul progetto indicato.
//
// uso:  node pubblica-pages.js <cartella repo> <nome progetto Pages> [--solo-cartella] [--ramo=<nome>]
//   es. node pubblica-pages.js "D:/video youtube/claudio/claudio pluviometro/Mappa-Precipitazioni-Nord-Test" avventurepluvio-test --solo-cartella
// --solo-cartella: costruisce _pages/ e si ferma (per provarla con `python -m http.server`).
// --ramo=<nome> (25/10/2026): ANTEPRIMA, non produzione. Cloudflare la mette su https://<nome>.<progetto>.pages.dev
//   con dentro la cartella del repo COM'E' ADESSO (anche le modifiche non committate), e il sito vero non cambia.
//   Prende il posto del sito di test per guardare una modifica dal telefono prima di pubblicarla: e' sempre la
//   produzione piu' la modifica, quindi non c'e' niente da allineare. Le anteprime Cloudflare non le indicizza
//   (noindex) e GA non conta (il config parte solo sul dominio vero). Stesso nome = stesso indirizzo, aggiornato.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const REPO = process.argv[2], PROGETTO = process.argv[3], SOLO = process.argv.includes('--solo-cartella');
if (!REPO || !PROGETTO) { console.log('uso: node pubblica-pages.js <repo> <progetto> [--solo-cartella] [--ramo=<nome>]'); process.exit(1); }
// il nome come lo scrive Cloudflare nell'indirizzo: minuscole, cifre e trattini
const RAMO = ((process.argv.find(a => a.startsWith('--ramo=')) || '').slice(7)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
if (process.argv.some(a => a.startsWith('--ramo=')) && (!RAMO || RAMO === 'main')) { console.log('--ramo vuole un nome diverso da «main» (main e\' la produzione)'); process.exit(1); }
const OUT = path.join(REPO, '_pages');
const TETTO_FILE = 19500; // Pages: 20.000 per deploy, con un po' di margine

// ── cosa NON si pubblica ──
// 22/10/2026: fuori anche `_anteprime-prova` (le mappe di prova che le pagine leggono solo in locale, escluse da git con
// .git/info/exclude): pubblicando dal PC finivano sul sito vero.
const CARTELLE_FUORI = new Set(['.git', '.github', '.netlify', '.claude', 'netlify', 'prove', '_pages', 'node_modules', 'functions', '.wrangler', '_anteprime-prova']);
// 6/10 pomeriggio: fuori anche alert-mail.eml (mail di allarme costruita al volo, e' in .gitignore) e i due file di git.
const FILE_FUORI = /^(netlify\.toml|.*\.md|backfill-.*\.js|populate-history.*\.js|diagnose-.*\.js|_headers|_redirects|alert-mail\.eml|\.gitattributes|\.gitignore)$/;
const dentroTessere = rel => rel.startsWith('tessere-boschi' + path.sep + 'italia');
const giornoDi = nome => { const m = nome.match(/^(\d{4}-\d{2}-\d{2})\.json$/); return m && m[1]; };

let copiati = 0, saltatiGiorni = 0, byte = 0;
const giorni = []; // i file-giorno di data/: si copiano dopo, dal piu' recente, finche' ci stanno
function copia(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name), src = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!rel && CARTELLE_FUORI.has(e.name)) continue;
      if (dentroTessere(r)) continue;
      copia(src, r); continue;
    }
    if (!rel && FILE_FUORI.test(e.name)) continue;
    if (rel.startsWith('data') && giornoDi(e.name)) { giorni.push({ g: giornoDi(e.name), src, r }); continue; }
    copiaFile(src, r);
  }
}
function copiaFile(src, r) {
  const dst = path.join(OUT, r);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst); copiati++; byte += fs.statSync(src).size;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
copia(REPO, '');
// i giorni: dal piu' recente, finche' si sta sotto il tetto (3 = _headers, _redirects, 404.html)
giorni.sort((a, b) => b.g < a.g ? -1 : b.g > a.g ? 1 : 0);
const posto = TETTO_FILE - copiati - 3;
let limite = giorni.length ? giorni[Math.min(posto, giorni.length) - 1].g : '-';
for (const d of giorni) { if (d.g >= limite && copiati < TETTO_FILE - 3) copiaFile(d.src, d.r); else saltatiGiorni++; }

// ── _redirects: quello del repo (i 37 paesi doppi) + i generali di netlify.toml ──
const redirRepo = fs.existsSync(path.join(REPO, '_redirects')) ? fs.readFileSync(path.join(REPO, '_redirects'), 'utf8').replace(/\r\n/g, '\n') : '';
fs.writeFileSync(path.join(OUT, '_redirects'),
  '# Generato da pubblica-pages.js: i rimandi di netlify.toml piu\' quelli del repo.\n' +
  '/index-5.html / 301\n\n' + redirRepo);

// ── 404.html: SENZA questo file Pages risponde 200 con index.html a QUALUNQUE percorso
// mancante (modo «SPA»). Misurato il 6/10: /data/toscana/2026-06-01.json (fuori dalla
// riserva) tornava 200 con dentro l'HTML della mappa, e la riserva lo avrebbe letto
// come JSON rotto. Con un 404.html, Pages torna 404 come fa Netlify.
fs.writeFileSync(path.join(OUT, '404.html'), `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagina non trovata</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;background:#f4f7fb;color:#1b3f6e;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}main{padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#4a5f7d;margin:0 0 18px}a{display:inline-block;background:#1b3f6e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700}</style></head><body><main><h1>Pagina non trovata</h1><p>L'indirizzo non esiste o è cambiato.</p><a href="/">Vai alla mappa</a></main></body></html>`);

// ── _headers: CORS + cache lunga (stesse regole di netlify.toml di produzione, 5/10/2026) ──
const geojson = fs.readdirSync(OUT).filter(f => f.endsWith('-confine.geojson'));
let h = '# Generato da pubblica-pages.js (equivalente di netlify.toml).\n' +
  '# CORS su /data/*: il sito di test legge la riserva di prod da un altro dominio.\n' +
  '/data/*\n  Access-Control-Allow-Origin: *\n\n' +
  '# Cache 30 giorni su quello che non cambia indirizzo quando cambia (index.html NO).\n';
for (const g of geojson) h += `/${g}\n  Cache-Control: public, max-age=2592000\n  Access-Control-Allow-Origin: *\n\n`;
// /lib/* (13/10/2026): Leaflet copiato da unpkg, la versione sta nel percorso (lib/leaflet/1.9.4/), quindi si tiene a lungo
for (const d of ['/data/vetrine/*', '/tessere-boschi/*', '/novita/*', '/lib/*']) h += `${d}\n  Cache-Control: public, max-age=2592000\n\n`;
fs.writeFileSync(path.join(OUT, '_headers'), h);

const nFile = (function conta(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? conta(path.join(d, e.name)) : 1; return n; })(OUT);
console.log(`_pages/: ${nFile} file (${(byte / 1e6).toFixed(0)} MB), file-giorno ${giorni.length - saltatiGiorni} su ${giorni.length} (riserva dal ${limite}${saltatiGiorni ? ', ' + saltatiGiorni + ' vecchi tagliati per il tetto' : ', tutto lo storico'}), ${geojson.length} geojson con cache lunga`);
if (nFile > 20000) { console.log('⚠️ troppi file per Pages (tetto 20.000): fermo.'); process.exit(2); }
if (SOLO) { console.log('--solo-cartella: mi fermo qui. Prova: cd _pages && python -m http.server 8890'); process.exit(0); }

console.log(RAMO ? `Pubblico l'ANTEPRIMA «${RAMO}» del progetto ${PROGETTO} (il sito vero non cambia)...` : `Pubblico su Cloudflare Pages, progetto ${PROGETTO}...`);
// ⚠️ LE PAGES FUNCTIONS (cartella `functions/` del repo, 7/10/2026) wrangler le cerca nella cartella da cui
// viene LANCIATO, non in quella pubblicata: con cwd nel banco la funzione non saliva (404). Quindi cwd = repo
// quando il repo ha `functions/`, e la cache .wrangler/ che lascia li' si toglie subito dopo.
const conFunzioni = fs.existsSync(path.join(REPO, 'functions'));
execSync(`npx --yes wrangler@4 pages deploy "${OUT}" --project-name ${PROGETTO} --branch ${RAMO || 'main'} --commit-dirty=true`, { stdio: 'inherit', cwd: conFunzioni ? REPO : __dirname });
if (conFunzioni) fs.rmSync(path.join(REPO, '.wrangler'), { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
console.log('Fatto, _pages/ rimossa.' + (RAMO ? ` Anteprima: https://${RAMO}.${PROGETTO}.pages.dev/` : ''));
