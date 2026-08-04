/**
 * check-meteohub-gaps.js — GitHub Actions (1 run/giorno)
 *
 * Sorveglianza automatica dei buchi di ingestione MeteoHub:
 *  1. scansiona gli ultimi WINDOW_DAYS giorni (fino a ieri) di ogni rete attiva;
 *  2. rileva buchi TOTALI (file mancante) e PARZIALI (stazioni sotto il
 *     PARTIAL_RATIO della mediana della finestra);
 *  3. tiene il registro eventi in data/meteohub-gaps.json — è la fonte della
 *     verità per la metrica "frequenza dei buchi" della valutazione MeteoHub,
 *     e sopravvive alla copertura (coprire non nasconde più l'evento);
 *  4. se MeteoHub ingerisce in ritardo (il collector auto-ripara ieri/altroieri
 *     e i giorni con file mancante o <10 stazioni), l'evento si chiude da solo
 *     come "risolto-meteohub";
 *  5. un buco del giorno G ancora aperto viene COPERTO con Open-Meteo quando
 *     oggi >= G + GRACE_DAYS: file interi con source "open-meteo-gapfill",
 *     giorni parziali integrati SOLO sulle stazioni mancanti (marcate om:true),
 *     i dati reali non si toccano.
 *
 * Il collector non riscrive mai un file esistente con >=10 stazioni fuori da
 * ieri/altroieri, quindi le coperture (che avvengono a G+GRACE_DAYS) sono
 * stabili: nessun ping-pong.
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const LEDGER = path.join(DATA_ROOT, 'meteohub-gaps.json');

// Giorni di attesa prima di coprire un buco con le stime Open-Meteo.
// Da 3 a 2 il 31/7/2026. Sui primi tre eventi il terzo giorno non ha MAI
// recuperato nulla (Puglia 27/7 ferma a 0 stazioni buone anche oggi, quattro
// giorni dopo; Basilicata 27/7 ferma a 50 su 61; Molise 29/7 a 23 su 28):
// quando MeteoHub perde un giorno non lo ripubblica, e l'attesa non compra
// niente. Soprattutto, dal 30/7 coprire non è più una scelta irreversibile —
// il collector continua a riprovare i giorni coperti fino a 9 giorni indietro
// e rimpiazza le stime se il dato reale ricompare. Restiamo a 2 e non a 1
// perché il giorno subito dopo l'ingestione si sta ancora completando.
const GRACE_DAYS = 2;
const WINDOW_DAYS = 10;    // finestra di scansione (= finestra pubblica MeteoHub)
const PARTIAL_RATIO = 0.9; // sotto il 90% della mediana → giorno parziale
// Sotto quale quota della normalità un calo merita davvero le stime (4/8/2026).
// Il 90% qui sopra serve ad ACCORGERSI del calo e a scriverlo nel registro; è
// una soglia sensibile apposta, perché la frequenza degli eventi è la metrica
// con cui si giudica MeteoHub. Ma ACCORGERSI non vuol dire INTERVENIRE: il
// 3/8 la Sicilia è scesa a 341 stazioni reali su 426 (80%) e il gapfill ci ha
// infilato 91 stime — in una regione che con 341 stazioni ha una densità
// migliore di Lombardia e Piemonte in giornata normale (13,2 contro 10,6 e
// 11,1 ogni 1000 km²). Stime al posto di niente vanno bene; stime aggiunte a
// una rete già fitta sono solo rumore su misure vere. Da qui in poi si integra
// solo quando il calo è tale da compromettere davvero la copertura.
const SOGLIA_GRAVE = 0.6;  // parziale sopra il 60% della normalità = lieve, non si copre

// Reti attive (meteohub-lombardia è chiusa dal 27/7, resta solo come storico)
const REGIONS = ['marche','umbria','lazio','campania','puglia','calabria','sicilia','sardegna','basilicata','molise'];

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
}
function daysDiff(a, b) { // a - b in giorni (stringhe YYYY-MM-DD)
  return Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);
}
function median(arr) {
  const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function loadDay(region, day) {
  const p = path.join(DATA_ROOT, 'meteohub-' + region, day + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}
function isReal(j) { return j && typeof j.source === 'string' && j.source.startsWith('meteohub'); }

async function fetchOpenMeteoDay(stations, dateStr, pastDays) {
  // Batch da 50 coordinate; forecast API con past_days (l'archive ha ~5 giorni di lag)
  const out = new Map();
  for (let i = 0; i < stations.length; i += 50) {
    const batch = stations.slice(i, i + 50);
    const lat = batch.map(s => s.lat).join(',');
    const lon = batch.map(s => s.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum&past_days=${pastDays}&forecast_days=1&timezone=Europe%2FRome`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    let j = await res.json();
    if (!Array.isArray(j)) j = [j];
    j.forEach((loc, k) => {
      const idx = loc.daily.time.indexOf(dateStr);
      const v = idx >= 0 ? loc.daily.precipitation_sum[idx] : null;
      out.set(batch[k].id, (typeof v === 'number') ? Math.round(v * 10) / 10 : 0);
    });
    await new Promise(r => setTimeout(r, 800));
  }
  return out;
}

async function main() {
  console.log('=== check-meteohub-gaps avviato ===');
  const now = new Date();
  const todayStr = fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));
  const noon = new Date(todayStr + 'T12:00:00Z').getTime();
  const days = [];
  for (let i = WINDOW_DAYS; i >= 1; i--) days.push(fmtDate(new Date(noon - i * 86400000)));

  const ledger = fs.existsSync(LEDGER)
    ? JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
    : { nota: 'Registro buchi ingestione MeteoHub. Evento storico pre-registro: 16-17/7/2026 blackout totale piattaforma (coperto a mano il 27/7).', eventi: [] };
  const find = (rete, data) => ledger.eventi.find(e => e.rete === rete && e.data === data);

  let cambiato = false;

  for (const region of REGIONS) {
    // anagrafe (union dei file reali della finestra) + mediana stazioni
    const registry = new Map();
    const counts = [];
    for (const day of days) {
      const j = loadDay(region, day);
      if (!isReal(j)) continue;
      counts.push(j.count || j.stations.length);
      for (const s of j.stations) if (!s.om) registry.set(s.id, { id: s.id, n: s.n, lat: s.lat, lon: s.lon, q: s.q, p: s.p });
    }
    const tipico = median(counts);
    if (counts.length < 3 || tipico < 10) { console.log(`-- ${region}: finestra troppo scarna (${counts.length} file reali), salto`); continue; }
    const soglia = Math.floor(tipico * PARTIAL_RATIO);

    for (const day of days) {
      const j = loadDay(region, day);
      const nReali = j ? j.stations.filter(s => !s.om).length : 0;
      const buco = !j ? 'mancante' : (isReal(j) && nReali < soglia ? 'parziale' : null);
      let ev = find(region, day);

      // chiusura automatica: MeteoHub ha (ri)consegnato i dati.
      // Vale anche per un evento GIÀ COPERTO con le stime: dal 30/7/2026 il
      // collector rilegge i giorni coperti fino a 9 giorni indietro e, se il
      // dato reale ricompare abbastanza ricco, sostituisce le stime — qui si
      // prende atto che il buco si è chiuso davvero. Serve isReal(): su un file
      // di sole stime `buco` è null, ma non è certo un giorno risolto.
      if (ev && (ev.stato === 'aperto' || ev.stato === 'coperto-openmeteo') && !buco && isReal(j)) {
        const tardivo = ev.stato === 'coperto-openmeteo';
        ev.stato = 'risolto-meteohub'; ev.risoltoIl = todayStr;
        if (tardivo) { ev.stimeSostituite = true; delete ev.stazioniCoperte; }
        cambiato = true;
        console.log(`✅ ${region} ${day}: risolto da MeteoHub${tardivo ? ' (stime sostituite dal dato reale)' : ''}`);
        continue;
      }
      if (!buco || (j && !isReal(j) && j.source === 'open-meteo-gapfill')) continue;

      // Un parziale che lascia la rete sopra SOGLIA_GRAVE è "lieve": si annota
      // (serve alla metrica frequenza) ma non si copre e non fa scattare la mail.
      const lieve = (buco === 'parziale' && nReali >= tipico * SOGLIA_GRAVE);

      // nuovo evento o aggiornamento
      if (!ev) {
        ev = { rete: region, data: day, tipo: buco, lieve, stazioniViste: nReali, stazioniAttese: tipico, rilevato: todayStr, stato: 'aperto' };
        ledger.eventi.push(ev); cambiato = true;
        console.log(`🕳️  ${region} ${day}: buco ${buco}${lieve ? ' LIEVE' : ''} (${nReali}/${tipico} stazioni)`);
      } else if (ev.stato === 'aperto' && (ev.tipo !== buco || ev.stazioniViste !== nReali || ev.lieve !== lieve)) {
        ev.tipo = buco; ev.stazioniViste = nReali; ev.lieve = lieve; cambiato = true;
      }
      if (ev.stato !== 'aperto') continue;

      if (lieve) {
        console.log(`   ${region} ${day}: calo lieve (${nReali}/${tipico}, ${Math.round(nReali / tipico * 100)}% della norma) — annotato, nessuna stima`);
        continue;
      }

      // copertura Open-Meteo dopo GRACE_DAYS
      const diff = daysDiff(todayStr, day);
      if (diff < GRACE_DAYS) { console.log(`   ${region} ${day}: aperto da ${diff}g, copro a ${GRACE_DAYS}g`); continue; }

      const mancanti = !j ? [...registry.values()]
        : [...registry.values()].filter(s => !j.stations.some(x => x.id === s.id));
      if (mancanti.length === 0) continue;
      console.log(`🌍 ${region} ${day}: copro ${mancanti.length} stazioni con Open-Meteo...`);
      const om = await fetchOpenMeteoDay(mancanti, day, Math.min(Math.max(diff + 2, 2), 92));
      const nuove = mancanti.map(s => ({ ...s, mm: om.get(s.id) ?? 0, om: true }));

      const outFile = path.join(DATA_ROOT, 'meteohub-' + region, day + '.json');
      if (!j) {
        fs.writeFileSync(outFile, JSON.stringify({
          date: day, collected: new Date().toISOString(), source: 'open-meteo-gapfill',
          network: 'dpcn-' + region, count: nuove.length, stations: nuove
        }));
      } else {
        j.stations = j.stations.concat(nuove);
        j.count = j.stations.length;
        j.gapfill = { aggiunte: nuove.length, il: todayStr };
        fs.writeFileSync(outFile, JSON.stringify(j));
      }
      ev.stato = 'coperto-openmeteo'; ev.copertoIl = todayStr; ev.stazioniCoperte = nuove.length; cambiato = true;
      console.log(`   ✅ ${region} ${day}: coperto (${nuove.length} stazioni Open-Meteo)`);
    }
  }

  if (cambiato) {
    ledger.aggiornato = new Date().toISOString();
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }

  const aperti = ledger.eventi.filter(e => e.stato === 'aperto').length;
  const risolti = ledger.eventi.filter(e => e.stato === 'risolto-meteohub').length;
  const coperti = ledger.eventi.filter(e => e.stato === 'coperto-openmeteo').length;
  console.log(`=== Registro: ${ledger.eventi.length} eventi totali — ${aperti} aperti, ${risolti} risolti da MeteoHub, ${coperti} coperti da Open-Meteo ===`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
