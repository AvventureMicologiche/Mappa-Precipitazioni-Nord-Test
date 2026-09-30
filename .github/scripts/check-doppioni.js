/**
 * check-doppioni.js — GitHub Actions (1 run al giorno, dentro alert-fonti.yml)
 *
 * LA SPIA CHE MANCAVA (30/9/2026). Trova la pioggia di ieri TRASCINATA sul giorno
 * dopo: stazioni bagnate che hanno LO STESSO valore, al decimo, in due giorni
 * consecutivi. E' la firma comune dei bug #17, #18 e #19, e fino a oggi la si
 * cercava solo a mano (punto 6 del check periodico). Cosi' e' passato inosservato
 * per cinque settimane il caso Toscana: dal 26/8/2026 i tre giri di chiusura serali
 * partivano con due ore e mezza di ritardo, atterravano dopo mezzanotte e
 * chiudevano il giorno sbagliato; 1.240 mm doppi in settembre (Empoli 78,5 mm
 * il 17 E il 18/9), trovati per caso confrontando i pluviometri con Open-Meteo.
 *
 * Tutti gli altri controlli guardano se i dati ARRIVANO (check-fonti, guardiano).
 * Questo guarda se i dati di oggi sono una COPIA di ieri.
 *
 * NON CHIAMA NESSUNA FONTE ESTERNA: legge i nostri file, gia' nel checkout.
 * NON TOCCA UN SOLO DATO: manda l'elenco, la riparazione resta una scelta umana.
 *
 * COME CONTA. Per ogni regione con file giornalieri a stazioni, confronta gli
 * ultimi due giorni chiusi (ieri e l'altro ieri, piu' la coppia prima per non
 * perdere niente se un giorno il run salta). Una stazione conta se e' bagnata
 * il giorno dopo con almeno 1 mm e il valore e' identico al decimo a quello del
 * giorno prima. Sotto 1 mm le coincidenze vere (pioviggine) sono normali.
 *
 * LA SOGLIA: almeno 5 stazioni identiche O almeno 30 mm doppi in una coppia di
 * giorni. Su 40 giorni di tutte le regioni (agosto-settembre 2026) le
 * coincidenze vere non hanno mai superato 2 stazioni fuori dalla Toscana,
 * mentre i giorni malati toscani stavano a 5-47 stazioni e 48-566 mm.
 *
 * Prova in locale:  node .github/scripts/check-doppioni.js          (ieri e l'altro ieri)
 *                   GIORNO=2026-09-18 node .github/scripts/check-doppioni.js
 * Senza GITHUB_OUTPUT non scrive output ne' mail .eml, stampa e basta.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || 'data';
const MIN_STAZ   = parseInt(process.env.MIN_STAZ || '5', 10);
const MIN_MM     = parseFloat(process.env.MIN_MM || '30');
const SOGLIA_MM  = 1;      // sotto, le coincidenze sono normali
const COPPIE     = 2;      // quante coppie di giorni guardare all'indietro

const fmt = d => d.toISOString().slice(0, 10);
const eStima = j => !!j && typeof j.source === 'string' && /open-meteo/i.test(j.source);

function leggi(regione, giorno) {
  const p = path.join(DATA_DIR, regione, giorno + '.json');
  if (!fs.existsSync(p)) return null;
  try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return (j && Array.isArray(j.stations) && !eStima(j)) ? j : null; }
  catch (e) { return null; }
}

// la data di riferimento: ieri (il giorno chiuso), o GIORNO per le prove
const rif = process.env.GIORNO ? new Date(process.env.GIORNO + 'T12:00:00Z') : new Date(Date.now() - 86400000);
const giorni = [];
for (let k = COPPIE; k >= 0; k--) giorni.push(fmt(new Date(rif.getTime() - k * 86400000)));

const regioni = fs.readdirSync(DATA_DIR).filter(n => {
  const p = path.join(DATA_DIR, n);
  return fs.statSync(p).isDirectory() && !/vento|funghi|riepiloghi|vetrine/.test(n);
}).sort();

const allarmi = [];
console.log(`Doppioni: coppie ${giorni.map((g, i) => i ? giorni[i - 1] + '->' + g : '').filter(Boolean).join(', ')}\n`);
for (const r of regioni) {
  for (let i = 1; i < giorni.length; i++) {
    const a = leggi(r, giorni[i - 1]), b = leggi(r, giorni[i]);
    if (!a || !b) continue;
    const chiave = s => s.id != null ? String(s.id) : s.n;
    const prima = new Map(a.stations.map(s => [chiave(s), +s.mm || 0]));
    const bagnate = b.stations.filter(s => (+s.mm || 0) > 0);
    const identiche = bagnate.filter(s => prima.has(chiave(s)) && (+s.mm || 0) >= SOGLIA_MM && Math.abs(prima.get(chiave(s)) - (+s.mm || 0)) < 0.05);
    const mm = identiche.reduce((t, s) => t + (+s.mm || 0), 0);
    if (identiche.length) console.log(`${r.padEnd(20)} ${giorni[i - 1]} -> ${giorni[i]}: ${identiche.length} identiche su ${bagnate.length} bagnate, ${mm.toFixed(1)} mm`);
    if (identiche.length >= MIN_STAZ || mm >= MIN_MM) {
      identiche.sort((x, y) => (+y.mm || 0) - (+x.mm || 0));
      allarmi.push({ regione: r, da: giorni[i - 1], a: giorni[i], n: identiche.length, bagnate: bagnate.length, mm, esempi: identiche.slice(0, 5).map(s => `${s.n || s.id} ${String(s.mm).replace('.', ',')}`) });
    }
  }
}

const out = process.env.GITHUB_OUTPUT;
const scrivi = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };

if (!allarmi.length) {
  console.log('\nNessun doppione sopra soglia: nessuna mail.');
  scrivi('mail', 'false');
  process.exit(0);
}

const vir = n => String(n).replace('.', ',');
const righe = allarmi.map(x =>
  `• ${x.regione}: ${x.n} stazioni con lo stesso valore il ${x.da} e il ${x.a} (su ${x.bagnate} bagnate), ${vir(x.mm.toFixed(1))} mm doppi.\n` +
  `  Per esempio: ${x.esempi.join('; ')}.`
).join('\n\n');

const corpo =
`In queste regioni la pioggia di un giorno si ritrova IDENTICA, al decimo, il
giorno dopo, su piu' stazioni insieme. Una coincidenza vera sopra 1 mm capita
su una o due stazioni, non su cinque: e' la firma della pioggia trascinata sul
giorno dopo (bug #17, #18, #19). Il caso toscano di settembre 2026 si e'
presentato esattamente cosi' e nessuno l'ha visto per cinque settimane.

${righe}

Cosa fare: aprire i due file in data/<regione>/ e confrontare stazione per
stazione; controllare a che ora sono partiti davvero i giri di chiusura del
collector (gh run list --workflow <regione>.yml, ora italiana); se la pioggia
del giorno dopo non e' vera, ripararla come a luglio 2026 (campo repaired).

Nessun dato e' stato modificato: questo controllo non tocca niente.`;

const oggetto = allarmi.length === 1
  ? `Pioggia doppia in ${allarmi[0].regione}: ${allarmi[0].n} stazioni uguali il ${allarmi[0].da} e il ${allarmi[0].a}`
  : `Pioggia doppia in ${allarmi.length} regioni (${[...new Set(allarmi.map(x => x.regione))].join(', ')})`;

const mail =
`From: ${process.env.MAIL_USER || 'bot'}\r\n` +
`To: ${process.env.MAIL_TO || 'bot'}\r\n` +
`Subject: ${oggetto}\r\n` +
`Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
corpo.replace(/\n/g, '\r\n') + '\r\n';

if (out) fs.writeFileSync('doppioni-mail.eml', mail);
console.log(`\nALLARME: ${allarmi.length} coppie sopra soglia.` + (out ? ' Mail preparata.' : ' (prova locale: nessuna mail)'));
console.log('\n' + corpo);
scrivi('mail', 'true');
