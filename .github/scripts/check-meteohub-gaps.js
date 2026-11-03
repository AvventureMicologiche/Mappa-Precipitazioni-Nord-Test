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
 *  5. un buco del giorno G ancora aperto viene COPERTO con le stime del modello
 *     ICON-2I quando oggi >= G + GRACE_DAYS: file interi con source
 *     "icon-2i-gapfill", giorni parziali integrati SOLO sulle stazioni mancanti
 *     (marcate om:true e src:'icon-2i'), i dati reali non si toccano.
 *     ⚠️ Fino al 2/11/2026 le stime erano di Open-Meteo ("open-meteo-gapfill",
 *     registro "coperto-openmeteo"): restano nei file e nel registro come sono.
 *     Open-Meteo e' stato tolto perche' il suo piano gratuito vieta i siti con
 *     pubblicita' o abbonamenti; come si legge ICON e perche' basta, in
 *     lib-icon2i.js. I file ICON restano ~8 giorni: con la grazia di 2 giorni
 *     c'e' margine, un buco scoperto piu' tardi resta aperto.
 *
 * Il collector non riscrive mai un file esistente con >=10 stazioni fuori da
 * ieri/altroieri, quindi le coperture (che avvengono a G+GRACE_DAYS) sono
 * stabili: nessun ping-pong.
 */

const fs = require('fs');
const path = require('path');
const { corseIcon, stimaIcon } = require('./lib-icon2i.js');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const LEDGER = path.join(DATA_ROOT, 'meteohub-gaps.json');
// Evento coperto con le stime: 'coperto-icon' dal 2/11/2026, 'coperto-openmeteo' prima.
const COPERTO = /^coperto-/;

// Giorni di attesa prima di coprire un buco con le stime del modello.
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
// Le chiusure si guardano piu' indietro: collect-meteohub ripara i giorni coperti fino a 20 giorni (RIPARA_FINO con
// l'account, dal 2/11/2026). Vedi «LE CHIUSURE FINO A 20 GIORNI» in main().
const CHIUDI_FINO = 20;
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
/** La voce di anagrafe di una stazione reale, quella che si copia nelle stime. */
function registroStazione(s) {
  const r = { id: s.id, n: s.n, lat: s.lat, lon: s.lon, q: s.q, p: s.p };
  if (s.qt) r.qt = s.qt;   // quota dal terreno: il sito ci mette il «~»
  return r;
}

// L'elenco delle corse ICON si chiede una volta sola, e solo se c'e' davvero un buco da coprire.
let corse = null;
async function leCorse() { return corse || (corse = await corseIcon()); }

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
      // qt si copia (20/10/2026, sesto check, bug 20): senza, la stazione stimata mostrava la quota del terreno senza «~»
      for (const s of j.stations) if (!s.om) registry.set(s.id, registroStazione(s));
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
      if (ev && (ev.stato === 'aperto' || COPERTO.test(ev.stato)) && !buco && isReal(j)) {
        const tardivo = COPERTO.test(ev.stato);
        ev.stato = 'risolto-meteohub'; ev.risoltoIl = todayStr;
        if (tardivo) { ev.stimeSostituite = true; delete ev.stazioniCoperte; }
        cambiato = true;
        console.log(`✅ ${region} ${day}: risolto da MeteoHub${tardivo ? ' (stime sostituite dal dato reale)' : ''}`);
        continue;
      }
      if (!buco || (j && !isReal(j) && /-gapfill$/.test(j.source || ''))) continue;

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

      // copertura con le stime ICON-2I dopo GRACE_DAYS
      const diff = daysDiff(todayStr, day);
      if (diff < GRACE_DAYS) { console.log(`   ${region} ${day}: aperto da ${diff}g, copro a ${GRACE_DAYS}g`); continue; }

      const mancanti = !j ? [...registry.values()]
        : [...registry.values()].filter(s => !j.stations.some(x => x.id === s.id));
      if (mancanti.length === 0) continue;
      console.log(`🌍 ${region} ${day}: copro ${mancanti.length} stazioni con ICON-2I...`);
      // Un errore su un giorno (MeteoHub giu', file ICON illeggibile) non deve far saltare gli altri ne'
      // perdere il registro: si annota, si va avanti, l'evento resta aperto e lo riprova il giro dopo.
      // ⚠️ IL GIRO NON FINISCE IN ERRORE PER ICON (2/11/2026, check-10, scheda 114). Prima qui il giro usciva con 1: il
      // workflow ritentava e, se falliva anche il ritentativo, saltava il commit, perdendo le coperture riuscite, i buchi
      // nuovi e il registro (ogni giorno, se l'errore si ripete). Come check-gaps-nord: solo l'avviso, giallo nel giro.
      let icon;
      try { icon = await stimaIcon(mancanti, day, await leCorse()); }
      catch (e) { console.log(`::warning::${region} ${day}: ICON-2I non letto (${e.message}), riprovo al prossimo giro`); continue; }
      if (!icon) { console.log(`   ⚠️ ${region} ${day}: ICON-2I non ha piu' tutte le ore di quel giorno sui server, resta aperto`); continue; }
      // ⚠️ ASSENTE NON E' ZERO (20/10/2026, sesto check): senza valore la stazione non si scrive, niente 0 mm
      // inventati (con ICON succede solo fuori dalla sua griglia, 33,7-48,9 N e 3-22 E: in Italia non capita).
      const nuove = mancanti.filter(s => icon.mm.has(s.id)).map(s => ({ ...s, mm: icon.mm.get(s.id), om: true, src: 'icon-2i' }));
      if (nuove.length < mancanti.length) console.log(`   ${region} ${day}: ${mancanti.length - nuove.length} stazioni fuori dalla griglia ICON, lasciate fuori`);
      // nessun valore: niente file e niente copertura, l'evento resta aperto e si riprova al giro dopo
      if (nuove.length === 0) continue;

      const outFile = path.join(DATA_ROOT, 'meteohub-' + region, day + '.json');
      if (!j) {
        fs.writeFileSync(outFile, JSON.stringify({
          date: day, collected: new Date().toISOString(), source: 'icon-2i-gapfill', icon_corse: icon.corse,
          network: 'dpcn-' + region, count: nuove.length, stations: nuove
        }));
      } else {
        j.stations = j.stations.concat(nuove);
        j.count = j.stations.length;
        j.gapfill = { aggiunte: nuove.length, il: todayStr, fonte: 'icon-2i' };
        fs.writeFileSync(outFile, JSON.stringify(j));
      }
      ev.stato = 'coperto-icon'; ev.copertoIl = todayStr; ev.stazioniCoperte = nuove.length; cambiato = true;
      console.log(`   ✅ ${region} ${day}: coperto (${nuove.length} stazioni ICON-2I, corse ${icon.corse.join(', ')})`);
    }

    // ⚠️ LE CHIUSURE FINO A 20 GIORNI (2/11/2026, scheda 114, check-10 B3). Dal 2/11 (ae6d822b37) collect-meteohub ripara
    // i giorni coperti fino a 20 giorni indietro, ma qui la scansione e' di 10: un giorno fra l'11° e il 20° tornato vero
    // restava «coperto» nel registro per sempre (giusti i dati, sbagliato il conto dei giorni a stime). Per CHIUDERE si
    // guarda fino a CHIUDI_FINO, con la stessa regola di sopra (file vero, stazioni vere almeno alla soglia); i buchi
    // NUOVI si cercano sempre e solo nei WINDOW_DAYS.
    for (const ev of ledger.eventi) {
      if (ev.rete !== region || days.includes(ev.data) || !(ev.stato === 'aperto' || COPERTO.test(ev.stato))) continue;
      if (daysDiff(todayStr, ev.data) > CHIUDI_FINO) continue;
      const j = loadDay(region, ev.data);
      if (!isReal(j) || j.stations.filter(s => !s.om).length < soglia) continue;
      const tardivo = COPERTO.test(ev.stato);
      ev.stato = 'risolto-meteohub'; ev.risoltoIl = todayStr;
      if (tardivo) { ev.stimeSostituite = true; delete ev.stazioniCoperte; }
      cambiato = true;
      console.log(`✅ ${region} ${ev.data}: risolto da MeteoHub oltre i ${WINDOW_DAYS} giorni${tardivo ? ' (stime sostituite dal dato reale)' : ''}`);
    }
  }

  if (cambiato) {
    ledger.aggiornato = new Date().toISOString();
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }

  const aperti = ledger.eventi.filter(e => e.stato === 'aperto').length;
  const risolti = ledger.eventi.filter(e => e.stato === 'risolto-meteohub').length;
  const coperti = ledger.eventi.filter(e => COPERTO.test(e.stato)).length;
  console.log(`=== Registro: ${ledger.eventi.length} eventi totali — ${aperti} aperti, ${risolti} risolti da MeteoHub, ${coperti} coperti con stime ===`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
