/**
 * collect-emilia.js
 * Fonte: apps.arpae.it/REST/meteo_giornalieri
 * 347 stazioni con precipitazione_cumulata_giornaliera
 * Aggiornamento: ogni 4 ore via GitHub Actions
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'emilia');
const MAX_DAYS = 730;
const API_URL  = 'https://apps.arpae.it/REST/meteo_giornalieri?max_results=1000';

function getItalyOffset(date) {
  // Calcola offset italiano basato sul calendario (non getTimezoneOffset che è 0 su server UTC)
  // CEST (UTC+2): ultima domenica marzo → ultima domenica ottobre
  // CET  (UTC+1): resto dell'anno
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}

// ── Zeri falsi riparati: non si rimangiano ──────────────────────────────────
// Se una stazione di questo giorno era stata corretta con la misura della sua
// gemella di un'altra agenzia (campo `zf`, vedi ripara-zero-falso.js) e il feed
// continua a mandare 0, la riparazione resta. Senza, il collector se la
// mangerebbe al primo run: ogni giorno viene riscritto per altre 48 ore dopo
// che e' stato chiuso, e la riparazione del 20/8/2026 sarebbe durata due ore.
// Se invece ARPAE pubblica finalmente un valore vero, vince lui e il marchio
// sparisce: quella e' una correzione della fonte, e la fonte ha sempre ragione
// quando parla. Il nostro rattoppo vale solo finche' lei tace.
function tieniRiparazione(vecchia, nuova) {
  return !!(vecchia && vecchia.zf && vecchia.mm > 0 && (nuova.mm === 0 || nuova.mm == null));
}
function riparata(vecchia, nuova) {
  return Object.assign({}, nuova, { mm: vecchia.mm, zf: vecchia.zf });
}

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  const now = new Date();
  // GitHub Actions gira in UTC — calcola ora italiana con DST
  // Italia: UTC+1 (inverno CET), UTC+2 (estate CEST, ultima dom marzo → ultima dom ottobre)
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  return italy.toISOString().substring(0, 10);
}

// Temperatura e vento (11/8/2026 — grafici stazione): aggregati giornalieri
// GIÀ pronti nella stessa risposta ARPAE, zero richieste extra.
// t: [min,max] °C · w: [media,raffica] km/h (l'API dà m/s → ×3,6; raffica
// null se la stazione non ha il sensore). Sanity come Svizzera/Austria:
// t in [-45,50] °C, vento medio <60 m/s, raffica <90 m/s.
function estraiMeteo(day) {
  const num = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };
  const tn = num(day.temperatura_minima_giornaliera_2m);
  const tx = num(day.temperatura_massima_giornaliera_2m);
  const ff = num(day.velocita_vento_media_giornaliera_10m);
  const fx = num(day.massima_raffica_vento_giornaliera_10m);
  // Umidità relativa (18/8/2026): u:[min,max] % dagli aggregati ARPAE, stessa chiamata.
  const un = num(day.umidita_minima_giornaliera_2m);
  const ux = num(day.umidita_massima_giornaliera_2m);
  const out = {};
  if (tn != null && tx != null && tn >= -45 && tx <= 50 && tn <= tx)
    out.t = [Math.round(tn * 10) / 10, Math.round(tx * 10) / 10];
  if (ff != null && ff >= 0 && ff < 60)
    out.w = [Math.round(ff * 3.6 * 10) / 10,
             (fx != null && fx >= 0 && fx < 90) ? Math.round(fx * 3.6 * 10) / 10 : null];
  if (un != null && ux != null && un >= 0 && ux <= 100 && un <= ux)
    out.u = [Math.round(un), Math.round(ux)];
  return out;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Emilia Romagna per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Step 1: scarica dati ARPAE ─────────────────────────────
  console.log('Scarico dati da ARPAE...');
  let raw;
  try {
    raw = await fetchJSON(API_URL);
  } catch(e) {
    console.error('Errore fetch ARPAE:', e.message);
    process.exit(1);
  }

  const items = raw._items || [];
  console.log(`  Stazioni ricevute: ${items.length}`);

  // ── Step 2: converti data target in formato ARPAE (YYYYMMDD) ─
  // ARPAE API ha offset +1 giorno: la chiave 20260606 contiene i dati meteo del 5 giugno
  // Per ottenere i dati del giorno X, servono dalla chiave X+1
  function dateKeyPlusOne(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().substring(0, 10).replace(/-/g, '');
  }
  const dateKey = dateKeyPlusOne(targetDate);
  console.log(`  Chiave API per ${targetDate}: ${dateKey} (offset ARPAE +1g)`);

  // ── Step 3: estrai dati del giorno target ───────────────────
  const output = [];
  const nulliOggi = [];   // stazioni che ARPAE oggi da' a null per il giorno target
  let ok = 0, skip = 0;
  // `attese` = quante stazioni ARPAE ELENCA in anagrafe per l'Emilia con il
  // pluviometro, a prescindere dal fatto che abbiano gia' pubblicato il giorno.
  // Serve al sito per distinguere «giornata a meta'» da «giornata completa»
  // senza soglie inventate: il numero lo dice la fonte, e cambia da solo se la
  // rete cresce o cala. Vedi RITARDO_NOTO in index.html.
  let attese = 0;

  items.forEach(s => {
    try {
      const ana = s.anagrafica;
      if (!ana || !ana.geometry || !ana.geometry.coordinates) { skip++; return; }

      const lon = ana.geometry.coordinates[0];
      const lat = ana.geometry.coordinates[1];

      // Bounding box Emilia Romagna
      if (lat < 43.7 || lat > 45.2 || lon < 9.1 || lon > 12.8) { skip++; return; }

      // Solo stazioni con precipitazione
      if (!ana.variabili || !ana.variabili.includes('precipitazione_cumulata_giornaliera')) { skip++; return; }
      attese++;

      // Cerca il dato del giorno target
      const dati = s.dati || {};
      const dayData = dati[dateKey];

      // ⚠️ DATO ASSENTE NON E' ZERO (corretto il 21/8/2026, dopo l'evento del 20).
      // Prima qui c'era `let mm = 0` e la stazione veniva scritta comunque: una che
      // non aveva ancora pubblicato finiva in mappa con 0 mm, indistinguibile da
      // "non e' piovuto". ARPAE pubblica l'aggregato del giorno il giorno DOPO e non
      // tutte le stazioni insieme: il run delle 3:45 del 21/8 ha scritto 0 su 169
      // stazioni su 326 mentre il crinale prendeva fino a 121 mm (Torriglia), e la
      // mappa ha mostrato asciutto il giorno del diluvio finche' non l'abbiamo
      // ricaricato a mano. Ora la stazione si SALTA: il merge tiene il valore che
      // c'era gia', e se non c'era il pallino manca per qualche ora e l'IDW dei
      // vicini copre. Meglio un pallino in meno che una macchia asciutta falsa.
      // ⚠️ E NON BASTA SALTARLA: se quella stazione era gia' nel file di quel
      // giorno, il merge qui sotto la conserverebbe com'era. Il 24/8/2026 abbiamo
      // verificato che i null di ARPAE NON tornano numeri: 91 coppie
      // stazione-giorno rimaste null a due giorni di distanza, zero rivalidate.
      // Sono invalidazioni definitive, quindi quei valori vanno TOLTI, non tenuti.
      // Se ne tiene la lista e si cancellano dal merge (vedi «Step 4»).
      const cella = dayData && dayData['0000'];
      const grezzo = cella ? cella.precipitazione_cumulata_giornaliera : undefined;
      if (grezzo === undefined || grezzo === null) { nulliOggi.push(s._id); skip++; return; }
      const val = parseFloat(grezzo);
      if (isNaN(val) || val < 0 || val >= 500) { nulliOggi.push(s._id); skip++; return; }
      const mm = Math.round(val * 10) / 10;

      const rec = {
        id:  s._id,
        n:   ana.nome || '—',
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        q:   ana.altitudine || 0,
        p:   ana.provincia || '—',
        mm
      };
      if (dayData && dayData['0000']) Object.assign(rec, estraiMeteo(dayData['0000']));
      output.push(rec);
      ok++;
    } catch(e) {
      skip++;
    }
  });

  console.log(`  Stazioni Emilia: ${ok} | Saltate: ${skip}`);

  // ── Step 4: merge con file esistente ────────────────────────
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);
  let existingMap = {};

  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.stations) {
        existing.stations.forEach(s => { existingMap[s.id] = s; });
        console.log(`  File esistente: ${existing.stations.length} stazioni`);
      }
    } catch(e) {
      console.log('  Nessun file esistente, creo nuovo.');
    }
  }

  // Sovrascrittura diretta — i nuovi dati sostituiscono sempre i vecchi
  // (evita di preservare valori anomali da run precedenti)
  const merged = Object.assign({}, existingMap);
  output.forEach(s => {
    if (tieniRiparazione(existingMap[s.id], s)) { merged[s.id] = riparata(existingMap[s.id], s); return; }
    merged[s.id] = s;
  });

  // ⚠️ Le stazioni che ARPAE ha rimesso a NULL escono dal file (24/8/2026).
  // Prima restavano dentro col valore vecchio: 87 zeri e 4 valori veri su 15
  // giorni, cioe' pallini che dicevano «qui non e' piovuto» dove la fonte ha
  // ritirato la misura. Vale solo per i giorni che il feed copre ancora (~15):
  // le invalidazioni piu' vecchie non le vediamo, ed e' un limite dichiarato.
  let tolteNull = 0;
  nulliOggi.forEach(id => { if (merged[id] !== undefined) { delete merged[id]; tolteNull++; } });
  if (tolteNull) console.log('  Tolte, ARPAE le ha rimesse a null: ' + tolteNull);
  if (process.env.PROVA) {
    console.log('  PROVA: non scrivo niente. Restavano ' + Object.keys(merged).length + ' stazioni.');
    return;
  }
  const finalOutput = Object.values(merged);
  console.log(`  Stazioni finali: ${finalOutput.length}`);

  if (finalOutput.length < 10) {
    console.warn('Poche stazioni oggi (' + finalOutput.length + '), salto salvataggio oggi ma aggiorno ieri.');
  } else {

  // ── Step 5: salva ────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date:      targetDate,
    collected: new Date().toISOString(),
    source:    'arpa-emilia-arpae',
    count:     finalOutput.length,
    attese,
    stations:  finalOutput
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${finalOutput.length} stazioni)`);
  } // fine if finalOutput.length >= 10
  // ── Step 5b: aggiorna sempre anche ieri ──────────────────────
  if (!process.env.DATE_OVERRIDE) {
    const _yd = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000 - 24 * 3600000);
    const _p = n => String(n).padStart(2, '0');
    const _yDate = _yd.getUTCFullYear() + '-' + _p(_yd.getUTCMonth()+1) + '-' + _p(_yd.getUTCDate());
    const _yKey = dateKeyPlusOne(_yDate);
    console.log('Aggiorno anche ieri: ' + _yDate);
    try {
      const _out = [];
      let _attese = 0;
      items.forEach(s => {
        try {
          const ana=s.anagrafica; if(!ana||!ana.geometry||!ana.geometry.coordinates) return;
          const lon=ana.geometry.coordinates[0]; const lat=ana.geometry.coordinates[1];
          if(lat<43.7||lat>45.2||lon<9.1||lon>12.8) return;
          if(!ana.variabili||!ana.variabili.includes('precipitazione_cumulata_giornaliera')) return;
          _attese++;
          const dd=(s.dati||{})[_yKey];
          // Stessa regola del ramo di sopra: assente non e' zero, si salta.
          const _cella=dd&&dd['0000'];
          const _grezzo=_cella?_cella.precipitazione_cumulata_giornaliera:undefined;
          if(_grezzo===undefined||_grezzo===null) return;
          const v=parseFloat(_grezzo);
          if(isNaN(v)||v<0||v>=500) return;
          const mm=Math.round(v*10)/10;
          const _rec={id:s._id,n:ana.nome||'—',lat:Math.round(lat*10000)/10000,lon:Math.round(lon*10000)/10000,q:ana.altitudine||0,p:ana.provincia||'—',mm};
          if(dd&&dd['0000']) Object.assign(_rec,estraiMeteo(dd['0000']));
          _out.push(_rec);
        } catch(e) {}
      });
      if (_out.length >= 10) {
        // ⚠️ MERGE, non riscrittura (21/8/2026). Questo ramo rifaceva il file da capo
        // con le sole stazioni che il feed dava in quel momento: unito alla regola
        // "assente si salta", una stazione che ARPAE smette di pubblicare sparirebbe
        // da un file gia' buono. Ora i valori nuovi coprono i vecchi e il resto resta.
        const _file = path.join(DATA_DIR, _yDate + '.json');
        const _map = {};
        try {
          const _pre = JSON.parse(fs.readFileSync(_file, 'utf8'));
          (_pre.stations || []).forEach(x => { _map[x.id] = x; });
        } catch (e) {}
        _out.forEach(x => {
          if (tieniRiparazione(_map[x.id], x)) { _map[x.id] = riparata(_map[x.id], x); return; }
          _map[x.id] = x;
        });
        const _fin = Object.values(_map);
        fs.writeFileSync(_file, JSON.stringify({date:_yDate,collected:new Date().toISOString(),source:'arpa-emilia-arpae',count:_fin.length,attese:_attese,stations:_fin}),'utf8');
        console.log('Aggiornato ieri: ' + _yDate + ' (' + _out.length + ' dal feed, ' + _fin.length + ' in tutto)');
      }
    } catch(e) { console.warn('Warn aggiornamento ieri: ' + e.message); }
  }


  // ── Step 6: pulizia ──────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json', '') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
