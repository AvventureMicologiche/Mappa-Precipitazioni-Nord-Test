/**
 * pulisci-temperature.js — toglie dai file del giorno le temperature IMPOSSIBILI
 * (4/10/2026, dopo Roccadaspide −28,3° per trenta giorni di fila e Marolles −33° ad agosto).
 *
 * La regola e' quella di genera-temperature-ieri.js, ma con una soglia molto piu' larga:
 * almeno VICINI_MIN stazioni entro KM, di QUALUNQUE rete, correzione per la quota a
 * −6,5 °C ogni 1000 m; se la minima O la massima sta a piu' di SOGLIA gradi dalla mediana
 * dei vicini, la giornata perde `t` e nel grafico compare il trattino («se il dato non e'
 * pervenuto deve esserci un trattino»). Si toglie la coppia intera: un sensore che segna
 * −28 di notte non e' credibile nemmeno a mezzogiorno (Roccadaspide: −28,3 / 48,8).
 *
 * ⚠️ PERCHE' 15 E NON 10: misurato su 430 giorni di tutte le reti. A 15 gradi i casi sono
 * 97 e sono tutti guasti evidenti; a 10 diventano 342 e i 245 in piu' sono quasi tutti
 * CIME con l'inversione notturna (Pic du Midi, Chasseral, Schmittenhöhe: minima di 8-12°
 * mentre i fondovalle vicini stanno a 0). Quelle sono vere e devono restare.
 * Chi non ha vicini non si giudica e resta com'e'.
 *
 * Zero rete, tocca solo `t`. Lo lancia riepiloghi.yml sugli ultimi GIORNI giorni (default 3,
 * cosi' ripassa anche sui file che un collector ha riscritto dopo).
 * Storico: DA=2025-08-01 A=2026-10-03 node pulisci-temperature.js
 * Prova senza scrivere: PROVA=1
 *
 * SOLO=meteohub- (21/10/2026): giudica con TUTTI i vicini ma tocca solo le cartelle che
 * cominciano cosi'. Lo lancia meteohub.yml prima del suo commit: MeteoHub riscriveva a ogni
 * giro la minima impossibile (Baunei 19/10, −12,8°), questo passo la toglieva, e il file e'
 * stato riscritto 22 volte in due giorni, con la temperatura sbagliata in mezzo per ore e i
 * due commit a pestarsi nel push. Le altre cartelle restano intatte: il workflow aggiunge solo
 * data/meteohub-*, e un file toccato fuori lascerebbe l'albero sporco al `git pull --rebase`.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const KM = 25, VICINI_MIN = 3, SOGLIA = 15, GRADIENTE = -0.0065;
const SOLO = process.env.SOLO || '';

function giornoItalia(indietro) {
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const d = new Date(oggi + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - indietro);
  return d.toISOString().slice(0, 10);
}

function mediana(a) {
  a = a.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const cartelle = fs.readdirSync(DATA).filter(d => fs.statSync(path.join(DATA, d)).isDirectory());

function giorni() {
  if (process.env.DA) {
    const tutti = new Set();
    for (const dir of cartelle) for (const f of fs.readdirSync(path.join(DATA, dir)))
      if (/^\d{4}-\d\d-\d\d\.json$/.test(f)) tutti.add(f.slice(0, 10));
    const a = process.env.A || giornoItalia(0);
    return [...tutti].filter(g => g >= process.env.DA && g <= a).sort();
  }
  const n = +(process.env.GIORNI || 3), out = [];
  for (let i = n; i >= 0; i--) out.push(giornoItalia(i));
  return out;
}

function pulisci(giorno) {
  const file = {}, tutte = [];
  for (const dir of cartelle) {
    const f = path.join(DATA, dir, giorno + '.json');
    if (!fs.existsSync(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    // le stime non sono misure: non fanno da vicine e non si toccano
    if (/open-meteo/.test(j.source || '') || !Array.isArray(j.stations)) continue;
    file[f] = j;
    for (const s of j.stations) {
      const t = s.t;
      if (!t || typeof t[0] !== 'number' || typeof t[1] !== 'number') continue;
      if (s.om || (s.src && /open-meteo/.test(s.src))) continue;
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      tutte.push({ f, dir, s, lat: s.lat, lon: s.lon, q: s.q || 0, mn: t[0], mx: t[1] });
    }
  }
  const cella = s => Math.floor(s.lat * 4) + ':' + Math.floor(s.lon * 3);
  const griglia = {};
  tutte.forEach(s => (griglia[cella(s)] = griglia[cella(s)] || []).push(s));
  // prima si giudica tutto, poi si tocca: le mediane si fanno sui valori originali
  const via = [];
  for (const s of tutte) {
    const vic = [];
    const la = Math.floor(s.lat * 4), lo = Math.floor(s.lon * 3);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const o of griglia[(la + a) + ':' + (lo + b)] || []) {
        if (o === s || (Math.abs(o.lat - s.lat) + Math.abs(o.lon - s.lon)) < 0.0005) continue;   // se stessa o la gemella di un'altra rete
        const km = Math.hypot((s.lat - o.lat) * 111, (s.lon - o.lon) * 111 * Math.cos(s.lat * Math.PI / 180));
        if (km <= KM) vic.push(o);
      }
    }
    if (vic.length < VICINI_MIN) continue;
    const dq = o => (s.q - o.q) * GRADIENTE;
    const attMx = mediana(vic.map(o => o.mx + dq(o))), attMn = mediana(vic.map(o => o.mn + dq(o)));
    if (Math.abs(s.mx - attMx) > SOGLIA || Math.abs(s.mn - attMn) > SOGLIA) via.push({ s, attMn, attMx });
  }
  const toccati = new Set();
  let tolte = 0;
  for (const { s, attMn, attMx } of via) {
    if (SOLO && s.dir.indexOf(SOLO) !== 0) continue;
    tolte++;
    console.log(`${giorno} ${s.dir} ${s.s.id} ${s.s.n}: [${s.mn}, ${s.mx}] contro [${attMn.toFixed(1)}, ${attMx.toFixed(1)}] -> tolta`);
    delete s.s.t;
    toccati.add(s.f);
  }
  if (!process.env.PROVA) for (const f of toccati) fs.writeFileSync(f, JSON.stringify(file[f]));
  return tolte;
}

let tot = 0;
const lista = giorni();
for (const g of lista) tot += pulisci(g);
console.log(`temperature impossibili: ${tot} tolte su ${lista.length} giorni (${lista[0]} -> ${lista[lista.length - 1]})${process.env.PROVA ? ' [PROVA, nessun file scritto]' : ''}`);
