/**
 * check-campi.js — GitHub Actions (1 run al giorno, dentro alert-fonti.yml)
 *
 * I CAMPI CHE SPARISCONO IN SILENZIO (12/10/2026). Dal giro delle 23:31 UTC del
 * 9/10/2026 OMIRL ha pubblicato la direzione del vento per 5 stazioni liguri
 * invece di 46-47, per tre giorni, senza un solo errore: la pioggia arrivava, il
 * file si scriveva, check-fonti e guardiano erano contenti. L'ha visto lui, per
 * caso, da uno scatto di Giacopiane. Il 9/10 e' poi uscito dalle ~69 ore di OMIRL
 * e ha richiesto una riparazione mirata, quando un rilancio la mattina del 10/10
 * sarebbe bastato.
 *
 * Tutti gli altri controlli guardano se i file ARRIVANO (check-fonti, guardiano)
 * o se la pioggia e' COPIATA (check-doppioni). Questo guarda se dentro un file
 * arrivato mancano a un tratto le stazioni, la temperatura, il vento, la
 * direzione o l'umidita'.
 *
 * NON CHIAMA NESSUNA FONTE ESTERNA: legge i nostri file, gia' nel checkout.
 * NON TOCCA UN SOLO DATO: manda l'elenco, il rilancio resta una scelta umana.
 *
 * COME CONTA. Per ogni rete, ieri e l'altro ieri (cosi' un run saltato non perde
 * niente): quante stazioni ci sono e quante hanno t, w, wd, u. Il confronto e'
 * con la mediana dei 14 giorni prima (almeno 7 validi). Suona se un conteggio
 * scende sotto il 60% della mediana. Le reti dove quel campo non arriva ad
 * almeno 5 stazioni non si guardano (Alto Adige senza wd, e simili).
 * L'intensita' `i` NON si guarda: si scrive solo da 0,5 mm, nei giorni asciutti
 * e' vuota per forza.
 *
 * COSA SALTA: i file di stima Open-Meteo, i file con `gapfill` (MeteoHub
 * completa il giorno dopo con stazioni che hanno solo la pioggia: sono buchi
 * gia' dichiarati, e da soli facevano 19 falsi allarmi su 26) e i file
 * `repaired`. Saltati anche dal calcolo della mediana.
 *
 * LA MISURA (20/8-11/10/2026, tutte le reti): 5 casi, tutti veri. Alto Adige
 * u 1/9 (0 contro 55), Sardegna t e w 7/9 (19 contro 93), Friuli w e u 11-14/9
 * (14 contro 36), Liguria wd 9-11/10 (5 contro 47).
 *
 * Un buco di piu' giorni manda la mail due mattine di fila; un campo sparito per
 * sempre si zittisce da solo in circa una settimana, quando la mediana si adegua.
 *
 * Prova in locale:  node .github/scripts/check-campi.js          (ieri e l'altro ieri)
 *                   GIORNO=2026-09-07 node .github/scripts/check-campi.js
 *                   DATA_DIR=<cartella> GIORNO=... per i file di un altro momento
 * Senza GITHUB_OUTPUT non scrive output ne' mail .eml, stampa e basta.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || 'data';
const SOGLIA   = parseFloat(process.env.SOGLIA || '0.6');  // sotto il 60% della mediana
const MIN_BASE = 5;    // reti dove il campo arriva ad almeno 5 stazioni
const STORIA   = 14;   // giorni della mediana
const MIN_VAL  = 7;    // giorni validi minimi per avere una mediana
const GIORNI   = 2;    // ieri e l'altro ieri

const CAMPI = [
  ['staz', 'stazioni'],
  ['t',    'temperatura'],
  ['w',    'vento'],
  ['wd',   'direzione del vento'],
  ['u',    'umidita\''],
];

const fmt = d => d.toISOString().slice(0, 10);
const eStima = j => !!j && typeof j.source === 'string' && /open-meteo/i.test(j.source);

const cache = new Map();
function conta(regione, giorno) {
  const k = regione + '/' + giorno;
  if (cache.has(k)) return cache.get(k);
  let r = null;
  const p = path.join(DATA_DIR, regione, giorno + '.json');
  if (fs.existsSync(p)) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && Array.isArray(j.stations) && !eStima(j) && !j.gapfill && !j.repaired) {
        const st = j.stations;
        r = {};
        for (const [c] of CAMPI) r[c] = c === 'staz' ? st.length : st.filter(s => s[c] != null).length;
      }
    } catch (e) {}
  }
  cache.set(k, r);
  return r;
}

function mediana(a) {
  const s = a.filter(x => x != null).sort((x, y) => x - y);
  return s.length >= MIN_VAL ? s[Math.floor(s.length / 2)] : null;
}

// la data di riferimento: ieri (il giorno chiuso), o GIORNO per le prove
const rif = process.env.GIORNO ? new Date(process.env.GIORNO + 'T12:00:00Z') : new Date(Date.now() - 86400000);
const giorno = k => fmt(new Date(rif.getTime() + k * 86400000));
const daGuardare = [];
for (let k = GIORNI - 1; k >= 0; k--) daGuardare.push(giorno(-k));

// abruzzo: la PROVA del 27/10/2026 (MeteoNetwork + stime ICON-2I), fuori dalla sorveglianza finche' non si decide
const regioni = fs.readdirSync(DATA_DIR).filter(n => {
  const p = path.join(DATA_DIR, n);
  return fs.statSync(p).isDirectory() && !/vento|funghi|riepiloghi|vetrine|quiz|abruzzo/.test(n);
}).sort();

const allarmi = [];
console.log(`Campi: giorni ${daGuardare.join(', ')}, soglia ${Math.round(SOGLIA * 100)}% della mediana dei ${STORIA} giorni prima\n`);
for (const r of regioni) {
  for (const g of daGuardare) {
    const oggi = conta(r, g);
    if (!oggi) continue;
    const prima = [];
    for (let k = STORIA; k >= 1; k--) prima.push(conta(r, fmt(new Date(Date.parse(g + 'T12:00:00Z') - k * 86400000))));
    for (const [c, nome] of CAMPI) {
      const base = mediana(prima.map(x => x ? x[c] : null));
      if (base == null || base < MIN_BASE) continue;
      if (oggi[c] < base * SOGLIA) {
        console.log(`${r.padEnd(20)} ${g} ${c.padEnd(4)} ${oggi[c]} contro ${base}`);
        allarmi.push({ regione: r, giorno: g, campo: c, nome, n: oggi[c], base, staz: oggi.staz });
      }
    }
  }
}

const out = process.env.GITHUB_OUTPUT;
const scrivi = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };

if (!allarmi.length) {
  console.log('Nessun campo sotto soglia: nessuna mail.');
  scrivi('mail', 'false');
  process.exit(0);
}

const righe = allarmi.map(x =>
  x.campo === 'staz'
    ? `• ${x.regione}, ${x.giorno}: ${x.n} stazioni contro le ${x.base} di solito.`
    : `• ${x.regione}, ${x.giorno}: ${x.nome} su ${x.n} stazioni contro le ${x.base} di solito (stazioni nel file: ${x.staz}).`
).join('\n');

const corpo =
`In queste reti un campo che arriva tutti i giorni e' crollato all'improvviso,
senza nessun errore nei giri: il file c'e', ma dentro manca qualcosa. E' quello
che e' successo alla direzione del vento in Liguria dal 9 all'11/10/2026, visto
solo per caso tre giorni dopo.

${righe}

Cosa fare: guardare se la fonte ha ripreso a pubblicare quel campo; se si',
rilanciare il collector della regione per quel giorno (Run workflow sul suo
.yml con date_override = il giorno) FINCHE' la fonte tiene ancora i dati.
Attenzione Liguria: OMIRL tiene circa 69 ore; oltre, il rilancio riscrive la
pioggia con ore parziali, e serve una riparazione mirata del solo campo.
Se la fonte non lo pubblica piu', non c'e' niente da fare: il controllo si
zittisce da solo in circa una settimana.

Nessun dato e' stato modificato: questo controllo non tocca niente.`;

const reti = [...new Set(allarmi.map(x => x.regione))];
const oggetto = reti.length === 1
  ? `Campi spariti in ${reti[0]}: ${[...new Set(allarmi.map(x => x.nome))].join(', ')}`
  : `Campi spariti in ${reti.length} reti (${reti.join(', ')})`;

const mail =
`From: ${process.env.MAIL_USER || 'bot'}\r\n` +
`To: ${process.env.MAIL_TO || 'bot'}\r\n` +
`Subject: ${oggetto}\r\n` +
`Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
corpo.replace(/\n/g, '\r\n') + '\r\n';

if (out) fs.writeFileSync('campi-mail.eml', mail);
console.log(`\nALLARME: ${allarmi.length} campi sotto soglia.` + (out ? ' Mail preparata.' : ' (prova locale: nessuna mail)'));
console.log('\n' + corpo);
scrivi('mail', 'true');
