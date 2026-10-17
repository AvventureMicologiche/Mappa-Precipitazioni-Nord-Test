/**
 * genera-temperature-ieri.js — le minime e massime di IERI che si possono mostrare sulla mappa
 * (3/10/2026, tasto «🌡 2 ott» accanto ai pallini).
 *
 * ⚠️ LA REGOLA DELL'UTENTE: «le temperature spesso hanno dati sbagliati e questo non deve
 * accadere». Quindi qui dentro entra SOLO cio' che passa il controllo coi vicini:
 *   - almeno VICINI_MIN stazioni entro KM, di QUALUNQUE rete (il confine non conta);
 *   - correzione per la quota a −6,5 °C ogni 1000 m;
 *   - massima entro ±TOLL_MAX dalla mediana dei vicini, minima entro ±TOLL_MIN (piu' larga:
 *     le minime soffrono le inversioni dei fondovalle).
 * Chi non ha vicini non e' verificabile e NON entra: meglio un pallino senza etichetta che un
 * numero sbagliato. Misurato su 10 giorni di agosto-settembre: 0,3% fuori, 6% senza vicini.
 * Non prende gli errori piccoli (2-3°): e' la stessa differenza fra un fondovalle e un versante.
 *
 * Zero rete: legge i file del giorno gia' nel checkout. Scrive data/temperature-ieri.json
 * (data/ e' nella regola ignore di Netlify: zero crediti). Lo lancia riepiloghi.yml.
 *
 * Prove: GIORNO=2026-10-02 node genera-temperature-ieri.js
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const OUT = path.join(DATA, 'temperature-ieri.json');
const KM = 25, VICINI_MIN = 3, TOLL_MAX = 6, TOLL_MIN = 9, GRADIENTE = -0.0065;

function ieriItalia() {
  if (process.env.GIORNO) return process.env.GIORNO;
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const d = new Date(oggi + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function mediana(a) {
  a = a.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function main() {
  const giorno = ieriItalia();
  const tutte = [];
  for (const dir of fs.readdirSync(DATA)) {
    const f = path.join(DATA, dir, giorno + '.json');
    if (!fs.existsSync(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    // le stime non sono misure: fuori i file di Open-Meteo e le stazioni stimate
    if (/open-meteo/.test(j.source || '') || !Array.isArray(j.stations)) continue;
    for (const s of j.stations) {
      const t = s.t;
      if (!t || typeof t[0] !== 'number' || typeof t[1] !== 'number' || t[0] === t[1]) continue;
      if (s.om || (s.src && /open-meteo/.test(s.src))) continue;
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      tutte.push({ lat: s.lat, lon: s.lon, q: s.q || 0, mn: t[0], mx: t[1] });
    }
  }
  // griglia per cercare i vicini senza confrontare tutti con tutti
  const cella = s => Math.floor(s.lat * 4) + ':' + Math.floor(s.lon * 3);
  const griglia = {};
  tutte.forEach(s => (griglia[cella(s)] = griglia[cella(s)] || []).push(s));
  const buone = [];
  let fuori = 0, soli = 0;
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
    if (vic.length < VICINI_MIN) { soli++; continue; }
    const dq = o => (s.q - o.q) * GRADIENTE;
    const attMx = mediana(vic.map(o => o.mx + dq(o))), attMn = mediana(vic.map(o => o.mn + dq(o)));
    if (Math.abs(s.mx - attMx) > TOLL_MAX || Math.abs(s.mn - attMn) > TOLL_MIN) { fuori++; continue; }
    buone.push([s.lat, s.lon, s.mn, s.mx]);
  }
  const out = { giorno, generato: new Date().toISOString(), lette: tutte.length, scartate: fuori, senza_vicini: soli, s: buone };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`temperature ${giorno}: ${tutte.length} lette, ${buone.length} verificate, ${fuori} fuori dai vicini, ${soli} senza vicini`);
}

main();
