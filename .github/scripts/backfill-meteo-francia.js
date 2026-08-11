#!/usr/bin/env node
/**
 * BACKFILL una-tantum: aggiunge temperatura e vento (campi t/w) ai file
 * data/francia-* ESISTENTI, senza toccare la pioggia (mm resta quello validato).
 * ==========================================================================
 * Fonte: CSV orari BASE/HOR dal mirror S3 OVH (stessa banca dati dell'API,
 * nessuna chiave; verificato l'11/8/2026: il mirror è aggiornato a STANOTTE,
 * altro che ritardo — copre fino a ieri compreso). Colonne usate:
 *   TN/TX (min/max °C dentro l'ora; se vuote si ripiega su T)
 *   FF (vento medio m/s ×3,6) · FXI (raffica istantanea m/s ×3,6)
 * Etichetta AAAAMMJJHH = UTC di FINE intervallo, finestra (start,end] sul
 * giorno solare italiano, MIN_ORE=20 — identica a collector e backfill pioggia.
 * Le stazioni si accoppiano per id (NUM_POSTE = geo_id_insee del pacchetto).
 *
 * Uso: node backfill-meteo-francia.js                        → ultimi 45 giorni
 *      GIORNI=90 SOLO_REGIONE=francia-corsica node ...       → prove mirate
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_ROOT = path.join(__dirname, '../..', 'data');
const OVH       = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR';
const MIN_ORE   = 20;
const GIORNI    = parseInt(process.env.GIORNI || '45', 10);

const REGIONI = [
  { key: 'francia-aura',      depts: ['01','03','07','15','26','38','42','43','63','69','73','74'] },
  { key: 'francia-bfc',       depts: ['21','25','39','58','70','71','89','90'] },
  { key: 'francia-bretagna',  depts: ['22','29','35','56'] },
  { key: 'francia-centro',    depts: ['18','28','36','37','41','45'] },
  { key: 'francia-corsica',   depts: ['20'] },
  { key: 'francia-grandest',  depts: ['08','10','51','52','54','55','57','67','68','88'] },
  { key: 'francia-hdf',       depts: ['02','59','60','62','80'] },
  { key: 'francia-idf',       depts: ['75','77','78','91','92','93','94','95'] },
  { key: 'francia-normandia', depts: ['14','27','50','61','76'] },
  { key: 'francia-naq',       depts: ['16','17','19','23','24','33','40','47','64','79','86','87'] },
  { key: 'francia-occitania', depts: ['09','11','12','30','31','32','34','46','48','65','66','81','82'] },
  { key: 'francia-loira',     depts: ['44','49','53','72','85'] },
  { key: 'francia-provenza',  depts: ['04','05','06','13','83','84'] },
];

function getItalyOffset(date) {
  const year = date.getUTCFullYear();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31));
  lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
  const lastSunOct = new Date(Date.UTC(year, 9, 31));
  lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
  return (date >= lastSunMarch && date < lastSunOct) ? 2 : 1;
}
const p2 = n => String(n).padStart(2, '0');
function fmtDate(d) { return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; }

async function scarica(dip) {
  const url = `${OVH}/H_${dip}_latest-2025-2026.csv.gz`;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
    } catch (e) {
      if (i === 3) throw new Error(`${e.message} su ${url}`);
      await new Promise(x => setTimeout(x, 5000 * i));
    }
  }
}

async function main() {
  console.log('=== backfill-meteo-francia (t/w sui file esistenti) ===');
  const soloReg = (process.env.SOLO_REGIONE || '').trim();
  const regioni = REGIONI.filter(r => !soloReg || r.key === soloReg);

  // ── Finestre: gli ultimi GIORNI giorni fino a ieri ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const giorni = [];
  for (let i = GIORNI; i >= 1; i--) {
    const dateStr = fmtDate(new Date(todayNoon - i * 86400000));
    const off = getItalyOffset(new Date(todayNoon - i * 86400000)) * 3600000;
    const start = Date.parse(dateStr + 'T00:00:00Z') - off;
    giorni.push({ dateStr, start, end: start + 86400000 });
  }
  const inWindow = Object.fromEntries(giorni.map(g => [g.dateStr, g]));
  console.log(`  Giorni: ${giorni.length} (${giorni[0].dateStr} → ${giorni[giorni.length - 1].dateStr})`);

  let totFile = 0, totConT = 0;
  for (const reg of regioni) {
    const perDay = {};   // dateStr -> id -> {tmin,tmax,nT,ffSum,nFF,fxMax,nFX}
    for (const g of giorni) perDay[g.dateStr] = {};

    for (const dip of reg.depts) {
      const testo = await scarica(dip);
      const righe = testo.split('\n');
      const head = righe[0].trim().split(';');
      const iN = head.indexOf('NUM_POSTE'), iD = head.indexOf('AAAAMMJJHH'),
            iT = head.indexOf('T'), iTN = head.indexOf('TN'), iTX = head.indexOf('TX'),
            iFF = head.indexOf('FF'), iFXI = head.indexOf('FXI');
      const num = (c, i) => {
        if (i < 0) return null;
        const raw = (c[i] || '').trim();
        if (raw === '') return null;
        const v = parseFloat(raw.replace(',', '.'));
        return isNaN(v) ? null : v;
      };
      for (let k = 1; k < righe.length; k++) {
        const c = righe[k].split(';');
        const et = c[iD];
        if (!et || et.length !== 10) continue;
        const ts = Date.UTC(+et.slice(0, 4), +et.slice(4, 6) - 1, +et.slice(6, 8), +et.slice(8, 10));
        const dCivile = fmtDate(new Date(ts - 1));
        const dPrima  = fmtDate(new Date(ts - 1 + 86400000));
        let g = null;
        if (inWindow[dCivile] && ts > inWindow[dCivile].start && ts <= inWindow[dCivile].end) g = inWindow[dCivile];
        else if (inWindow[dPrima] && ts > inWindow[dPrima].start && ts <= inWindow[dPrima].end) g = inWindow[dPrima];
        if (!g) continue;
        const id = c[iN].trim();
        const t  = num(c, iT);
        const tn = num(c, iTN), tx = num(c, iTX);
        const ff = num(c, iFF), fx = num(c, iFXI);
        const lo = (tn != null) ? tn : t, hi = (tx != null) ? tx : t;
        const slot = perDay[g.dateStr][id] ||
          (perDay[g.dateStr][id] = { tmin: Infinity, tmax: -Infinity, nT: 0, ffSum: 0, nFF: 0, fxMax: -Infinity, nFX: 0 });
        if (lo != null && lo >= -45 && lo <= 50) { if (lo < slot.tmin) slot.tmin = lo; slot.nT++; }
        if (hi != null && hi >= -45 && hi <= 50) { if (hi > slot.tmax) slot.tmax = hi; }
        if (ff != null && ff >= 0 && ff < 60) { slot.ffSum += ff; slot.nFF++; }
        if (fx != null && fx >= 0 && fx < 90) { if (fx > slot.fxMax) slot.fxMax = fx; slot.nFX++; }
      }
    }

    // ── Merge nei file esistenti: solo t/w, mm intatto ──
    let fileToccati = 0, conT = 0;
    for (const g of giorni) {
      const fp = path.join(DATA_ROOT, reg.key, g.dateStr + '.json');
      if (!fs.existsSync(fp)) continue;
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      let cambiato = false;
      for (const s of (j.stations || [])) {
        const slot = perDay[g.dateStr][String(s.id)];
        if (!slot) continue;
        if (slot.nT >= MIN_ORE && slot.tmax > -Infinity) {
          s.t = [Math.round(slot.tmin * 10) / 10, Math.round(slot.tmax * 10) / 10];
          conT++; cambiato = true;
        }
        if (slot.nFF >= MIN_ORE) {
          s.w = [Math.round(slot.ffSum / slot.nFF * 3.6 * 10) / 10,
                 slot.nFX > 0 ? Math.round(slot.fxMax * 3.6 * 10) / 10 : null];
          cambiato = true;
        }
      }
      if (cambiato) {
        j.meteo_backfill = '2026-08-11';
        fs.writeFileSync(fp, JSON.stringify(j));
        fileToccati++;
      }
    }
    totFile += fileToccati; totConT += conT;
    console.log(`  ${reg.key}: ${fileToccati} file, ${conT} stazioni-giorno con t`);
  }
  console.log(`Fatto: ${totFile} file aggiornati, ${totConT} stazioni-giorno con temperatura`);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
