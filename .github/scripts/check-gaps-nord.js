/**
 * check-gaps-nord.js — GitHub Actions (1 run/giorno)
 *
 * Rete di sicurezza per le regioni del Nord: trova i giorni INTERAMENTE
 * mancanti e, passata la grazia, li copre con stime Open-Meteo sulle
 * coordinate delle stazioni vere, marcandole.
 *
 * Perché serve (31/7/2026). Le regioni MeteoHub avevano già la loro copertura,
 * il Nord no: se un giorno si perdeva, restava un buco per sempre. E un buco
 * non è neutro — il sito somma i giorni che trova e scrive "✅ 30 giorni" con
 * un totale più basso del vero, senza dire niente. Fra una stima dichiarata e
 * un buco silenzioso che falsa i totali, la stima è meglio. Oggi i buchi sono
 * 5 su ~4.000 giorni-regione (0,12%), tutti su giornate quasi asciutte: il
 * valore di questo controllo non è recuperare quelli, è essere pronti al
 * prossimo, che potrebbe capitare su una giornata da 50 mm.
 *
 * Perché i buchi sono così rari: i collector si auto-riparano da soli, quindi
 * un run fallito si recupera. Restano solo quando la fonte non permette di
 * chiedere il passato — la Toscana (SIR leggibile solo "adesso") ha infatti 3
 * dei 5 buchi.
 *
 * SCELTA DELLA GRAZIA, misurata il 31/7/2026 su 45 giorni di cronologia git:
 *  - il file di un giorno viene scritto entro D+1 in TUTTE le regioni, mai
 *    oltre (mediana 0-1, massimo 1). Se al terzo giorno non c'è, non arriverà;
 *  - i collector scrivono al massimo su D-2 (ieri, qualcuno altroieri), quindi
 *    a D-3 nessuno sta più lavorando quel giorno e non c'è rischio che una
 *    stima finisca dentro un merge (il Piemonte fa merge MAX: scriverci sopra
 *    darebbe max(stima, reale), un pasticcio).
 *  → 3 giorni per tutti. Fino al 26/10/2026 Ticino aspettava 8 giorni e la
 *    Svizzera 11, per non mettere una stima prima che il loro collector si
 *    riprendesse il giorno vero dall'archivio. Dal 26/10 (sua decisione, dopo
 *    OASI giu' dal 21/10) anche loro 3: i due collector trattano un file di
 *    stima come un giorno MANCANTE e lo riscrivono col dato vero appena la
 *    fonte risponde, fino a 30 giorni indietro. La stima diventa un
 *    tappabuchi temporaneo, e il registro segna `sostituito-dal-reale`.
 *
 * Rileva SOLO i giorni interamente mancanti, non quelli "corti": nel Nord il
 * numero di stazioni oscilla da sé (sensori offline, reti che cambiano) e una
 * soglia sulle stazioni darebbe falsi allarmi a raffica.
 *
 * Uso a mano per tappare buchi vecchi:  SCAN_DAYS=400 node check-gaps-nord.js
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const LEDGER = path.join(DATA_ROOT, 'gaps-nord.json');

const GRACE_DEFAULT = 3;
// Grazia per regione. Fino al 26/10/2026 Ticino 8 e Svizzera 11, piu' lunghe
// della loro auto-riparazione, perche' una stima messa prima restava per sempre
// (il collector riparava solo i file MANCANTI). Ora i due collector riscrivono
// anche i file di stima (fino a D-30): la stima si mette al terzo giorno come
// altrove e se ne va da sola quando la fonte torna. Il guasto lungo che l'ha
// fatto vedere: OASI giu' dal 21/10, la stima sarebbe arrivata il 29/10, lo
// stesso giorno in cui il 21/10 usciva dalla finestra di recupero.
const GRACE_PER_REGIONE = {};
const SCAN_DAYS = parseInt(process.env.SCAN_DAYS || '15', 10);
const RETENTION_DAYS = 730;   // inutile creare file che la pulizia cancellerebbe
const MIN_STAZIONI = 10;      // sotto questa soglia l'anagrafe non è affidabile
// Massimo di giorni coperti per run: se si accumula un arretrato lo si smaltisce
// nei giorni successivi invece di martellare l'API pubblica in un colpo solo.
// Una regione grande (Emilia, 323 stazioni) costa 7 chiamate per giorno.
const MAX_COPERTURE = parseInt(process.env.MAX_COPERTURE || '5', 10);

// Cartelle dati del Nord + Svizzera (v6.0, 3/8/2026). Escluse `valledaosta` e
// `friuli`: dismesse il 26/7/2026, sostituite da valledaosta-cf e friuli-osmer.
const REGIONI = ['altoadige','emilia','friuli-osmer','liguria','lombardia','piemonte',
                 'svizzera','ticino','toscana','trentino','valledaosta-cf','veneto'];

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
const fmtDate = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
};
const daysDiff = (a, b) =>
  Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);

function leggi(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
/** File nato da stime nostre (copertura o backfill), non dato di stazione. */
const eStima = j => !!j && typeof j.source === 'string' && /open-meteo/.test(j.source);

/**
 * Anagrafe per il giorno bucato: unione delle stazioni dei file REALI più
 * vicini (fino a 5 prima e 5 dopo, entro ±20 giorni). Si guardano i vicini e
 * non l'intero storico perché su un buco vecchio la rete era diversa da oggi.
 */
function anagrafeVicina(dir, giorni, buco) {
  const vicini = giorni
    .filter(g => g !== buco && Math.abs(daysDiff(g, buco)) <= 20)
    .sort((a, b) => Math.abs(daysDiff(a, buco)) - Math.abs(daysDiff(b, buco)))
    .slice(0, 10);
  const raccogli = accettaStime => {
    const reg = new Map();
    for (const g of vicini) {
      const j = leggi(path.join(dir, g + '.json'));
      if (!j) continue;
      if (eStima(j) && !accettaStime) continue;
      for (const s of (j.stations || [])) {
        if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
        const k = s.id ?? s.n;
        if (!reg.has(k)) reg.set(k, { id: s.id ?? s.n, n: s.n, lat: s.lat, lon: s.lon, q: s.q || 0, p: s.p || '' });
      }
    }
    return [...reg.values()];
  };
  // Prima si prova con i soli giorni REALI: è l'anagrafe che vogliamo.
  const reali = raccogli(false);
  if (reali.length >= MIN_STAZIONI) return reali;
  // Ripiego per i buchi che cadono in un'epoca già tutta stimata (i primi mesi
  // di Liguria e Toscana sono `open-meteo-archive`, 51 pseudo-stazioni su
  // griglia): lì attorno non esiste nessun file reale da cui prendere le
  // coordinate, e coprire con le stesse pseudo-stazioni dei giorni vicini è
  // coerente con quel pezzo di archivio. Senza questo ripiego quei giorni
  // resterebbero per sempre "aperti" e riprovati a ogni run.
  return raccogli(true);
}

/**
 * Pioggia giornaliera stimata. Per i giorni recenti si usa l'API forecast con
 * past_days (che arriva fino a ieri); per quelli più vecchi di 90 giorni serve
 * l'archivio, che ha qualche giorno di ritardo ma copre anni indietro.
 */
async function chiediConAttese(url) {
  // Open-Meteo risponde 429 se lo si interroga troppo in fretta (successo in
  // prova con una regione da 323 stazioni = 7 chiamate di fila). Si riprova
  // con attese crescenti invece di far fallire l'intero run.
  const attese = [5000, 15000, 45000];
  for (let tentativo = 0; ; tentativo++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    const recuperabile = res.status === 429 || res.status >= 500;
    if (!recuperabile || tentativo >= attese.length) throw new Error(`Open-Meteo HTTP ${res.status}`);
    console.log(`   ⏳ HTTP ${res.status}, riprovo fra ${attese[tentativo] / 1000}s`);
    await new Promise(r => setTimeout(r, attese[tentativo]));
  }
}

async function stimaOpenMeteo(stazioni, giorno, distanza) {
  const out = new Map();
  const archivio = distanza > 90;
  for (let i = 0; i < stazioni.length; i += 50) {
    const batch = stazioni.slice(i, i + 50);
    const lat = batch.map(s => s.lat).join(',');
    const lon = batch.map(s => s.lon).join(',');
    const url = archivio
      ? `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${giorno}&end_date=${giorno}&daily=precipitation_sum&timezone=Europe%2FRome`
      : `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=precipitation_sum&past_days=${Math.min(Math.max(distanza + 2, 2), 92)}` +
        `&forecast_days=1&timezone=Europe%2FRome`;
    let j = await chiediConAttese(url);
    if (!Array.isArray(j)) j = [j];
    j.forEach((loc, k) => {
      const idx = loc.daily.time.indexOf(giorno);
      const v = idx >= 0 ? loc.daily.precipitation_sum[idx] : null;
      out.set(batch[k].id, (typeof v === 'number') ? Math.round(v * 10) / 10 : 0);
    });
    await new Promise(r => setTimeout(r, 1500)); // gentili con l'API pubblica
  }
  return out;
}

async function main() {
  console.log(`=== check-gaps-nord avviato (finestra ${SCAN_DAYS} giorni) ===`);
  const now = new Date();
  const oggi = fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000));
  const noon = new Date(oggi + 'T12:00:00Z').getTime();

  const ledger = fs.existsSync(LEDGER)
    ? leggi(LEDGER)
    : { nota: 'Registro giorni mancanti nelle regioni del Nord e loro copertura con stime Open-Meteo.', eventi: [] };
  let cambiato = false;
  let coperture = 0;

  for (const reg of REGIONI) {
    const dir = path.join(DATA_ROOT, reg);
    if (!fs.existsSync(dir)) { console.log(`-- ${reg}: cartella assente, salto`); continue; }
    const grazia = GRACE_PER_REGIONE[reg] ?? GRACE_DEFAULT;
    const giorni = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map(f => f.slice(0, 10)).sort();
    if (giorni.length < 5) { console.log(`-- ${reg}: storico troppo corto, salto`); continue; }
    const presenti = new Set(giorni);
    const primo = giorni[0];

    // Stime gia' sostituite dal dato vero (26/10/2026): Ticino e Svizzera riscrivono i giorni stimati quando la
    // fonte torna. Il registro lo segna, cosi' resta la misura di quante stime sono state solo un tappabuchi.
    for (const ev of ledger.eventi) {
      if (ev.regione !== reg || ev.stato !== 'coperto-openmeteo' || !presenti.has(ev.data)) continue;
      const j = leggi(path.join(dir, ev.data + '.json'));
      if (j && !eStima(j)) {
        ev.stato = 'sostituito-dal-reale'; ev.sostituitoIl = oggi; cambiato = true;
        console.log(`♻️  ${reg} ${ev.data}: la stima e' stata sostituita dal dato vero (${j.source || 'senza source'})`);
      }
    }

    // giorni da esaminare: dentro la finestra, dopo l'inizio dello storico,
    // entro la retention, e già oltre la grazia
    const daVedere = [];
    for (let i = grazia; i <= SCAN_DAYS; i++) {
      const g = fmtDate(new Date(noon - i * 86400000));
      if (g < primo) break;
      if (daysDiff(oggi, g) > RETENTION_DAYS) break;
      if (!presenti.has(g)) daVedere.push(g);
    }
    if (!daVedere.length) { console.log(`-- ${reg}: nessun buco (grazia ${grazia}g)`); continue; }

    for (const buco of daVedere) {
      const distanza = daysDiff(oggi, buco);
      let ev = ledger.eventi.find(e => e.regione === reg && e.data === buco);
      if (!ev) {
        ev = { regione: reg, data: buco, rilevato: oggi, stato: 'aperto' };
        ledger.eventi.push(ev); cambiato = true;
        console.log(`🕳️  ${reg} ${buco}: giorno mancante (${distanza}g fa)`);
      }
      if (ev.stato !== 'aperto') continue;

      if (coperture >= MAX_COPERTURE) {
        console.log(`   ${reg} ${buco}: raggiunto il tetto di ${MAX_COPERTURE} coperture per run, al prossimo giro`);
        continue;
      }
      const anagrafe = anagrafeVicina(dir, giorni, buco);
      if (anagrafe.length < MIN_STAZIONI) {
        console.log(`   ${reg} ${buco}: solo ${anagrafe.length} stazioni nei giorni vicini, rimando`);
        continue;
      }
      // Un errore su un giorno (API giù, limite di richieste) non deve far
      // saltare gli altri né perdere il registro: si annota e si va avanti.
      try {
        console.log(`🌍 ${reg} ${buco}: copro ${anagrafe.length} stazioni con Open-Meteo...`);
        const om = await stimaOpenMeteo(anagrafe, buco, distanza);
        const stations = anagrafe.map(s => ({ ...s, mm: om.get(s.id) ?? 0, om: true }));
        const somma = stations.reduce((a, s) => a + s.mm, 0);

        fs.writeFileSync(path.join(dir, buco + '.json'), JSON.stringify({
          date: buco,
          collected: new Date().toISOString(),
          source: 'open-meteo-gapfill',
          count: stations.length,
          stations
        }));
        ev.stato = 'coperto-openmeteo';
        ev.copertoIl = oggi;
        ev.stazioniCoperte = stations.length;
        ev.mmTotali = Math.round(somma * 10) / 10;
        cambiato = true; coperture++;
        console.log(`   ✅ ${reg} ${buco}: coperto (${stations.length} stazioni, ${ev.mmTotali} mm totali)`);
      } catch (e) {
        console.warn(`   ⚠️  ${reg} ${buco}: copertura fallita (${e.message}), riprovo al prossimo run`);
      }
    }
  }

  if (cambiato) {
    ledger.aggiornato = new Date().toISOString();
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }
  const aperti = ledger.eventi.filter(e => e.stato === 'aperto').length;
  const coperti = ledger.eventi.filter(e => e.stato === 'coperto-openmeteo').length;
  const sostituiti = ledger.eventi.filter(e => e.stato === 'sostituito-dal-reale').length;
  console.log(`=== Registro: ${ledger.eventi.length} eventi — ${aperti} aperti, ${coperti} coperti, ${sostituiti} sostituiti dal reale ===`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
