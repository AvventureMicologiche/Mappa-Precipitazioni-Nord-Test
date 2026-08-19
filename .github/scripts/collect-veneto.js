/**
 * collect-veneto.js - Versione corretta
 * Fonte: meteo.arpa.veneto.it (stazioni METEO con sensore PREC)
 * Struttura: stazioni.xml → lista stazioni METEO → per ogni stazione NNNN.xml → sensore PREC
 */
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data', 'veneto');
const MAX_DAYS  = 730;
const BASE_URL  = 'https://meteo.arpa.veneto.it/meteo/dati_meteo/xml';

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

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  const now = new Date();
  const italy = new Date(now.getTime() + getItalyOffset(now) * 3600000);
  return italy.toISOString().substring(0, 10);
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Accept-Encoding': 'gzip, deflate', 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        const decompress = (e, d) => e ?
          // se gunzip fallisce prova come testo diretto
          resolve(buf.toString('latin1')) :
          resolve(d.toString('latin1'));
        if (enc === 'gzip') zlib.gunzip(buf, decompress);
        else if (enc === 'deflate') zlib.inflate(buf, decompress);
        else zlib.gunzip(buf, decompress);
      });
    }).on('error', reject);
  });
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

function getCDATA(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]></${tag}>`));
  return m ? m[1].trim() : null;
}

// ── BUG #20 (19/8/2026): il PREC di ARPAV è INCREMENTALE, non cumulato ──
// Fino a oggi il totale del giorno era `Math.max(...vals)`, con il commento
// «valori cumulativi, più robusto al reset del sensore». I valori NON sono
// cumulativi: la serie del 17/8 a Lusiana fa 0…0, 7,8, 2,8, 0,2, 0…0 — una
// cumulata non può scendere. Quindi scrivevamo la MEZZ'ORA PIÙ PIOVOSA al
// posto del totale della giornata, e l'errore era tanto più grosso quanto
// più pioveva (Solagna 17/8: 22 invece di 34,5; Rosà 2,4 invece di 12).
// Verificato su 185 stazioni del 17/8: 171 con serie NON monotona, ZERO
// cumulative. Controprova contro la stessa rete ARPAV ripubblicata dal DPC
// su MeteoHub, 25 stazioni del giorno di pioggia: il max coincide 0 volte,
// la somma 18 (le altre sono giornate parziali nella finestra XML).
//
// `attese` viene dal tag FREQ del sensore (minuti), come fanno gli altri
// collector: una giornata troppo bucata è una SOTTOSTIMA travestita da dato
// buono, e su una mappa per funghi è peggio di un buco.
function totalePrecGiorno(sens, prefix) {
  const dReg = /<DATI ISTANTE="(\d{12})"><VM>([\d.]*)<\/VM>/g;
  let dm; const vals = [];
  while ((dm = dReg.exec(sens)) !== null) {
    if (!dm[1].startsWith(prefix)) continue;
    const v = parseFloat(dm[2]);
    if (!isNaN(v) && v >= 0) vals.push(v);
  }
  const freq = parseInt(getTag(sens, 'FREQ'), 10);
  const attese = (freq > 0) ? Math.round(1440 / freq) : 48;
  const mm = Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10;
  return { mm, letture: vals.length, attese };
}

// Temperatura e vento (11/8/2026 — grafici stazione): gli STESSI XML di
// stazione portano sensori TEMP (°C, letture ogni 30'), UMID (%, ogni 30',
// dal 18/8/2026 → u:[min,max]) e VVENTO (m/s → ×3,6;
// nessuna raffica → w[1] = null) — zero richieste extra. Ore coperte ≥ 20
// come le altre reti; sanity t in [-45,50], vento medio <60 m/s.
// ⚠️ la regex dei DATI qui ammette il segno meno: le temperature possono
// essere negative (quella della pioggia no, e resta con [\d.]+).
const MIN_ORE_METEO = 20;
function estraiMeteoVen(xml, prefix) {
  const out = {};
  const sReg = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
  let sm;
  while ((sm = sReg.exec(xml)) !== null) {
    const sens = sm[1];
    const type = getTag(sens, 'TYPE');
    if (type !== 'TEMP' && type !== 'VVENTO' && type !== 'UMID') continue;   // UMID: umidita' relativa a 2m, % (dal 18/8/2026)
    const dReg = /<DATI ISTANTE="(\d{12})"><VM>(-?[\d.]+)<\/VM><\/DATI>/g;
    let dm;
    const vals = [], ore = new Set();
    while ((dm = dReg.exec(sens)) !== null) {
      if (!dm[1].startsWith(prefix)) continue;
      const v = parseFloat(dm[2]);
      if (isNaN(v)) continue;
      if (type === 'TEMP' && (v < -45 || v > 50)) continue;
      if (type === 'VVENTO' && (v < 0 || v >= 60)) continue;
      if (type === 'UMID' && (v < 0 || v > 100)) continue;
      vals.push(v);
      ore.add(dm[1].slice(8, 10));
    }
    if (ore.size < MIN_ORE_METEO) continue;
    if (type === 'TEMP')
      out.t = [Math.round(Math.min(...vals) * 10) / 10, Math.round(Math.max(...vals) * 10) / 10];
    else if (type === 'UMID')
      out.u = [Math.round(Math.min(...vals)), Math.round(Math.max(...vals))];
    else
      out.w = [Math.round(vals.reduce((a, v) => a + v, 0) / vals.length * 3.6 * 10) / 10, null];
  }
  return out;
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Veneto per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: scarica elenco stazioni ────────────────────────────
  console.log('Scarico stazioni.xml...');
  const stazXml = await fetchURL(`${BASE_URL}/stazioni.xml`);

  // Estrae solo stazioni METEO (non idrometriche)
  const stazioni = [];
  const stazRegex = /<STAZIONE>([\s\S]*?)<\/STAZIONE>/g;
  let m;
  while ((m = stazRegex.exec(stazXml)) !== null) {
    const s = m[1];
    const tipo = getTag(s, 'TIPOSTAZ') || '';
    // Includi METEO e AGROMETEO, escludi idrometriche
    if (!tipo.match(/METEO|AGRO/i)) continue;
    const id    = getTag(s, 'IDSTAZ');
    const nome  = getCDATA(s, 'NOME') || getTag(s, 'NOME') || '—';
    const lon   = parseFloat(getTag(s, 'X'));
    const lat   = parseFloat(getTag(s, 'Y'));
    const quota = parseInt(getTag(s, 'QUOTA')) || 0;
    const prov  = getTag(s, 'PROVINCIA') || '—';
    const link  = getTag(s, 'LINKSTAZ');
    if (!id || isNaN(lat) || isNaN(lon) || !link) continue;
    if (lat < 44.7 || lat > 46.8 || lon < 10.5 || lon > 13.2) continue;
    stazioni.push({ id, nome, lat, lon, quota, prov, link });
  }
  console.log(`  Stazioni METEO trovate: ${stazioni.length}`);

  // ── Step 2: scarica dati di ogni stazione ──────────────────────
  const targetPrefix = targetDate.replace(/-/g, ''); // es. 20260505
  const output = [];
  let ok = 0, skip = 0;

  // Processa in batch di 10 per non sovraccaricare il server
  const BATCH = 10;
  for (let i = 0; i < stazioni.length; i += BATCH) {
    const batch = stazioni.slice(i, i + BATCH);
    await Promise.all(batch.map(async (s) => {
      try {
        const xml = await fetchURL(`${BASE_URL}/${s.link}`);
        // Cerca sensore PREC
        const sensoreRegex = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
        let sm;
        while ((sm = sensoreRegex.exec(xml)) !== null) {
          const sens = sm[1];
          const type = getTag(sens, 'TYPE');
          if (type !== 'PREC') continue;
          // Totale del giorno = SOMMA degli incrementi (vedi bug #20).
          // Qui si scrive il file di OGGI, che la mappa non mostra mai (regola #3)
          // ed è per forza parziale: nessun filtro completezza, il valore vero
          // lo scrive il ramo «aggiorna ieri» del run successivo.
          const tot = totalePrecGiorno(sens, targetPrefix);
          let mm = tot.mm;
          // Oltre i 300 mm la stazione si SCARTA, non si azzera: un 320 diventato
          // 0 sarebbe una macchia secca falsa proprio nel giorno dell'alluvione.
          if (mm > 300) continue;
          const rec = {
            id:  s.id,
            n:   s.nome,
            lat: Math.round(s.lat * 10000) / 10000,
            lon: Math.round(s.lon * 10000) / 10000,
            q:   s.quota,
            p:   s.prov,
            mm:  Math.round(mm * 10) / 10
          };
          try { Object.assign(rec, estraiMeteoVen(xml, targetPrefix)); } catch(e) {}
          output.push(rec);
          ok++;
          break;
        }
      } catch(e) {
        skip++;
      }
    }));
    process.stdout.write(`  Processate ${Math.min(i+BATCH, stazioni.length)}/${stazioni.length} stazioni...\r`);
    // Piccola pausa tra batch
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n  Stazioni con dati PREC: ${ok} | Errori: ${skip}`);

  if (output.length < 5) {
    console.warn('Poche stazioni oggi (' + output.length + '), salto salvataggio oggi ma aggiorno ieri.');
  } else {

  // ── Step 3: salva ────────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date: targetDate,
    collected: new Date().toISOString(),
    count: output.length,
    stations: output
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${output.length} stazioni)`);
  } // fine if output.length >= 5
  // ── Step 3b: aggiorna sempre anche ieri ──────────────────────
  if (!process.env.DATE_OVERRIDE) {
    const _yd = new Date(new Date().getTime() + getItalyOffset(new Date()) * 3600000 - 24 * 3600000);
    const _p = n => String(n).padStart(2, '0');
    const _yDate = _yd.getUTCFullYear() + '-' + _p(_yd.getUTCMonth()+1) + '-' + _p(_yd.getUTCDate());
    const _yPrefix = _yDate.replace(/-/g,'');
    console.log('Aggiorno anche ieri: ' + _yDate);
    try {
      const _out = [];
      for (let i = 0; i < stazioni.length; i += BATCH) {
        const batch = stazioni.slice(i, i + BATCH);
        await Promise.all(batch.map(async (s) => {
          try {
            const xml = await fetchURL(`${BASE_URL}/${s.link}`);
            const sReg = /<SENSORE>([\s\S]*?)<\/SENSORE>/g; let sm;
            while ((sm = sReg.exec(xml)) !== null) {
              const sens=sm[1]; if(getTag(sens,'TYPE')!=='PREC') continue;
              // Qui si scrive IERI, cioè il giorno che va in mappa: totale =
              // somma degli incrementi (bug #20) e completezza >= 85% delle
              // letture attese, se no si scarta la stazione invece di scrivere
              // una sottostima. La finestra XML di ARPAV copre ~48 ore, quindi
              // al primo run del mattino ieri è sempre completo.
              const tot=totalePrecGiorno(sens,_yPrefix);
              if(tot.letture < tot.attese*0.85) break;
              const mm=tot.mm;
              if(mm>300) break;
              const _rec={id:s.id,n:s.nome,lat:Math.round(s.lat*10000)/10000,lon:Math.round(s.lon*10000)/10000,q:s.quota,p:s.prov,mm:Math.round(mm*10)/10};
              try { Object.assign(_rec, estraiMeteoVen(xml, _yPrefix)); } catch(e) {}
              _out.push(_rec);
              break;
            }
          } catch(e) {}
        }));
        await new Promise(r => setTimeout(r, 200));
      }
      if (_out.length >= 5) {
        fs.writeFileSync(path.join(DATA_DIR,_yDate+'.json'), JSON.stringify({date:_yDate,collected:new Date().toISOString(),count:_out.length,stations:_out}),'utf8');
        console.log('Aggiornato ieri: ' + _yDate + ' (' + _out.length + ' stazioni)');
      }
    } catch(e) { console.warn('Warn aggiornamento ieri: ' + e.message); }
  }


  // ── Step 4: pulizia ──────────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json','') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
