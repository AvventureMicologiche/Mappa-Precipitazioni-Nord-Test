#!/usr/bin/env node
/**
 * FRANCIA INTERA (13 régions) — Météo-France API Paquet Observations
 * ==================================================================
 * API `public-api.meteofrance.fr/public/DPPaquetObs/v2`, Licence Ouverte v2.0
 * Etalab («Fonte: Météo-France»). Un pacchetto orario per DIPARTIMENTO copre
 * tutte le sue stazioni: 96 richieste coprono la Francia metropolitana
 * (~1.900 stazioni orarie), raggruppate nelle 13 régions ufficiali — una
 * cartella dati e una voce in mappa ciascuna (decisione utente 9/8/2026:
 * Francia intera, non solo i 6 dipartimenti di confine del primo pilota).
 *
 * RICETTA — validata il 9/8/2026 prima del collector (v. francia-rapporto-fonti.md):
 *  1. Il RR giornaliero francese è la finestra 06-06 UTC (definizione
 *     ufficiale): si sommano le ORE (`rr1`) sul giorno solare italiano.
 *  2. `rr1` alla validity_time T copre l'ora che FINISCE a T: finestra
 *     `(start, end]` — quadratura contro il RR ufficiale consolidato:
 *     99,6% esatta entro 0,2 mm su 9.763 giorni bagnati dei 6 dipartimenti
 *     alpini, intero 2026.
 *  3. MIN_ORE=20 su 24, come per le altre fonti orarie.
 *
 * TEMPERATURA E VENTO (dall'11/8/2026 — pilota grafici stazione):
 * dagli stessi pacchetti si leggono anche `t`/`tn`/`tx` (⚠️ in KELVIN: si
 * normalizza — un valore >100 è K e si sottrae 273,15) e `ff`/`fxi` (m/s
 * ×3,6 → km/h). Campi per stazione-giorno, solo con ore ≥ MIN_ORE:
 *   t: [min, max] °C   ·   w: [media, raffica] km/h
 * Colonne lette in modo difensivo (assenti → campo assente). Il backfill dei
 * 45 giorni è di backfill-meteo-francia.js (mirror S3, colonne TN/TX/FF/FXI).
 *
 * NOTE OPERATIVE:
 *  - CHIAVE obbligatoria (env METEOFRANCE_API_KEY, secret GitHub): scade il
 *    9/8/2028 col nostro abbonamento. 401 improvvisi = chiave, si rigenera.
 *  - il pacchetto contiene ~5 GIORNI di ore (misurato, la doc dice 24h):
 *    auto-riparazione D-1..D-4 gratis.
 *  - ⚠️ `id-departement` SENZA zero davanti (5, non 05: risponde 400); la
 *    CORSICA è `20` unificato (2A/2B non esistono per l'API, e anche gli id
 *    stazione usano il prefisso 20).
 *  - limite API 100 req/min: 96 richieste con mezza pausa ci stanno in ~4-6'.
 *
 * Uso: METEOFRANCE_API_KEY=... node collect-francia-meteofrance.js
 *      DATE_OVERRIDE=2026-08-07 ... (un giorno solo, tutte le régions)
 */
const fs   = require('fs');
const path = require('path');

const DATA_ROOT   = path.join(__dirname, '../..', 'data');
const API         = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v2';
const APIKEY      = (process.env.METEOFRANCE_API_KEY || '').trim();
const MIN_ORE     = 20;
const REPAIR_DAYS = 4;
const RETENTION   = 730;

/** Le 13 régions metropolitane coi loro dipartimenti (prefisso id stazione). */
const REGIONI = [
  { key: 'francia-aura',      nome: 'Alvernia-Rodano-Alpi',      depts: ['01','03','07','15','26','38','42','43','63','69','73','74'] },
  { key: 'francia-bfc',       nome: 'Borgogna-Franca Contea',    depts: ['21','25','39','58','70','71','89','90'] },
  { key: 'francia-bretagna',  nome: 'Bretagna',                  depts: ['22','29','35','56'] },
  { key: 'francia-centro',    nome: 'Centro-Valle della Loira',  depts: ['18','28','36','37','41','45'] },
  { key: 'francia-corsica',   nome: 'Corsica',                   depts: ['20'] },
  { key: 'francia-grandest',  nome: 'Grand Est',                 depts: ['08','10','51','52','54','55','57','67','68','88'] },
  { key: 'francia-hdf',       nome: 'Hauts-de-France',           depts: ['02','59','60','62','80'] },
  { key: 'francia-idf',       nome: 'Île-de-France',             depts: ['75','77','78','91','92','93','94','95'] },
  { key: 'francia-normandia', nome: 'Normandia',                 depts: ['14','27','50','61','76'] },
  { key: 'francia-naq',       nome: 'Nuova Aquitania',           depts: ['16','17','19','23','24','33','40','47','64','79','86','87'] },
  { key: 'francia-occitania', nome: 'Occitania',                 depts: ['09','11','12','30','31','32','34','46','48','65','66','81','82'] },
  { key: 'francia-loira',     nome: 'Paesi della Loira',         depts: ['44','49','53','72','85'] },
  { key: 'francia-provenza',  nome: 'Provenza-Alpi-Costa Azzurra', depts: ['04','05','06','13','83','84'] },
];

/** Nomi dei dipartimenti (campo `p` delle stazioni, mostrato nei popup). */
const DIP_NOME = {
  '01':'Ain','02':'Aisne','03':'Allier','04':'Alpes-de-Haute-Provence','05':'Hautes-Alpes',
  '06':'Alpes-Maritimes','07':'Ardèche','08':'Ardennes','09':'Ariège','10':'Aube',
  '11':'Aude','12':'Aveyron','13':'Bouches-du-Rhône','14':'Calvados','15':'Cantal',
  '16':'Charente','17':'Charente-Maritime','18':'Cher','19':'Corrèze','20':'Corse',
  '21':"Côte-d'Or",'22':"Côtes-d'Armor",'23':'Creuse','24':'Dordogne','25':'Doubs',
  '26':'Drôme','27':'Eure','28':'Eure-et-Loir','29':'Finistère','30':'Gard',
  '31':'Haute-Garonne','32':'Gers','33':'Gironde','34':'Hérault','35':'Ille-et-Vilaine',
  '36':'Indre','37':'Indre-et-Loire','38':'Isère','39':'Jura','40':'Landes',
  '41':'Loir-et-Cher','42':'Loire','43':'Haute-Loire','44':'Loire-Atlantique','45':'Loiret',
  '46':'Lot','47':'Lot-et-Garonne','48':'Lozère','49':'Maine-et-Loire','50':'Manche',
  '51':'Marne','52':'Haute-Marne','53':'Mayenne','54':'Meurthe-et-Moselle','55':'Meuse',
  '56':'Morbihan','57':'Moselle','58':'Nièvre','59':'Nord','60':'Oise',
  '61':'Orne','62':'Pas-de-Calais','63':'Puy-de-Dôme','64':'Pyrénées-Atlantiques','65':'Hautes-Pyrénées',
  '66':'Pyrénées-Orientales','67':'Bas-Rhin','68':'Haut-Rhin','69':'Rhône','70':'Haute-Saône',
  '71':'Saône-et-Loire','72':'Sarthe','73':'Savoie','74':'Haute-Savoie','75':'Paris',
  '76':'Seine-Maritime','77':'Seine-et-Marne','78':'Yvelines','79':'Deux-Sèvres','80':'Somme',
  '81':'Tarn','82':'Tarn-et-Garonne','83':'Var','84':'Vaucluse','85':'Vendée',
  '86':'Vienne','87':'Haute-Vienne','88':'Vosges','89':'Yonne','90':'Territoire de Belfort',
  '91':'Essonne','92':'Hauts-de-Seine','93':'Seine-Saint-Denis','94':'Val-de-Marne','95':"Val-d'Oise",
};

const REGIONE_DI = {};   // prefisso dipartimento -> regione
for (const r of REGIONI) for (const d of r.depts) REGIONE_DI[d] = r;

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
function dayWindow(dateStr) {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const off  = getItalyOffset(noon) * 3600000;
  const start = Date.parse(dateStr + 'T00:00:00Z') - off;
  return { dateStr, start, end: start + 24 * 3600000 };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getCsv(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: {
        'apikey': APIKEY,
        'User-Agent': 'MappaPluviometrica/1.0 (avventuremicologiche.it)',
      } });
      if (r.status === 401 || r.status === 403)
        throw new Error(`HTTP ${r.status} — chiave API rifiutata (scade il 9/8/2028: rigenerarla dal portale)`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries) throw new Error(`${e.message} su ${url.slice(0, 100)}`);
      await sleep(3000 * i);
    }
  }
}

function parseCsv(text) {
  const righe = text.split('\n').map(r => r.trim()).filter(r => r);
  const head = righe[0].split(';');
  return righe.slice(1).map(r => {
    const c = r.split(';'), o = {};
    head.forEach((h, i) => o[h] = c[i] !== undefined ? c[i] : '');
    return o;
  });
}

function belNome(s) {
  return s.replace(/_SAPC$/i, '').replace(/_/g, ' ').toLowerCase()
          .replace(/(^|[\s\-'])\S/g, m => m.toUpperCase()).trim();
}

/** Anagrafe nazionale da /liste-stations, indicizzata per id (solo métropole). */
async function buildStationList() {
  const righe = parseCsv(await getCsv(`${API}/liste-stations`));
  const byId = {};
  let n = 0;
  for (const r of righe) {
    const id = (r.Id_station || '').trim();
    const reg = REGIONE_DI[id.slice(0, 2)];
    if (!reg) continue;   // oltremare o id anomalo
    const lat = parseFloat(r.Latitude), lon = parseFloat(r.Longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    byId[id] = {
      id,
      n:   belNome(r.Nom_usuel || id),
      lat: Math.round(lat * 100000) / 100000,
      lon: Math.round(lon * 100000) / 100000,
      q:   isFinite(parseFloat(r.Altitude)) ? Math.round(parseFloat(r.Altitude)) : 0,
      p:   DIP_NOME[id.slice(0, 2)] || '',
      reg: reg.key,
    };
    n++;
  }
  console.log(`  Anagrafe métropole: ${n} stazioni`);
  if (n < 1500) throw new Error(`Anagrafe sospetta: solo ${n} stazioni`);
  return byId;
}

function loadExisting(regKey, dateStr) {
  const f = path.join(DATA_ROOT, regKey, `${dateStr}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function writeDay(regKey, dateStr, fresh, minStaz) {
  const existing = loadExisting(regKey, dateStr);
  const byId = {};
  if (existing && Array.isArray(existing.stations)) for (const s of existing.stations) byId[s.id] = s;
  for (const s of fresh) byId[s.id] = s;
  const merged = Object.values(byId);
  if (merged.length < minStaz) {
    console.warn(`  ${regKey} ${dateStr}: solo ${merged.length} stazioni (min ${minStaz}), salto`);
    return false;
  }
  fs.writeFileSync(path.join(DATA_ROOT, regKey, `${dateStr}.json`), JSON.stringify({
    date: dateStr, collected: new Date().toISOString(),
    source: 'meteofrance-dppaquetobs', count: merged.length, stations: merged,
  }));
  return true;
}

function pulizia(regKey) {
  const dir = path.join(DATA_ROOT, regKey);
  const limite = fmtDate(new Date(Date.now() - RETENTION * 24 * 3600000));
  let tolti = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && m[1] < limite) { fs.unlinkSync(path.join(dir, f)); tolti++; }
  }
  if (tolti) console.log(`  ${regKey}: pulizia retention, ${tolti} file`);
}

async function main() {
  console.log('=== collect-francia-meteofrance (13 régions) ===');
  if (!APIKEY) throw new Error('manca METEOFRANCE_API_KEY (secret GitHub / variabile d\'ambiente)');
  for (const r of REGIONI) fs.mkdirSync(path.join(DATA_ROOT, r.key), { recursive: true });

  const byId = await buildStationList();
  const anagrafePerReg = {};
  for (const id of Object.keys(byId)) anagrafePerReg[byId[id].reg] = (anagrafePerReg[byId[id].reg] || 0) + 1;

  // ── Giorni da raccogliere (una regione qualunque fa da campione per la riparazione) ──
  const now = new Date();
  const todayNoon = Date.parse(fmtDate(new Date(now.getTime() + getItalyOffset(now) * 3600000)) + 'T12:00:00Z');
  const targets = [];
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    targets.push(process.env.DATE_OVERRIDE.trim());
  } else {
    for (let i = 1; i <= REPAIR_DAYS; i++) {
      const dateStr = fmtDate(new Date(todayNoon - i * 24 * 3600000));
      if (i <= 2) { targets.push(dateStr); continue; }
      const manca = REGIONI.some(r => {
        const ex = loadExisting(r.key, dateStr);
        return !ex || (ex.count || 0) < Math.max(15, Math.round(anagrafePerReg[r.key] * 0.4));
      });
      if (manca) targets.push(dateStr);
    }
  }
  const windows = targets.map(dayWindow);
  console.log('  Giorni: ' + targets.join(', '));

  // ── 96 pacchetti dipartimento ──
  const perRegDay = {};    // regKey -> dateStr -> [stazioni]
  for (const r of REGIONI) { perRegDay[r.key] = {}; for (const w of windows) perRegDay[r.key][w.dateStr] = []; }
  const tuttiDip = Object.keys(REGIONE_DI);
  let fatti = 0, ignote = 0;

  for (const dip of tuttiDip) {
    const reg = REGIONE_DI[dip];
    const righe = parseCsv(await getCsv(`${API}/paquet/horaire?id-departement=${parseInt(dip, 10)}&format=csv`));
    const ore = {};
    // Kelvin → °C se serve (il pacchetto pubblica t in K, il mirror in °C)
    const gradi = raw => {
      if (raw === '' || raw === undefined) return null;
      const v = parseFloat(raw);
      if (isNaN(v)) return null;
      return v > 100 ? Math.round((v - 273.15) * 10) / 10 : v;
    };
    const metri = raw => {
      if (raw === '' || raw === undefined) return null;
      const v = parseFloat(raw);
      return isNaN(v) ? null : v;
    };
    for (const r of righe) {
      if (r.rr1 === '' || r.rr1 === undefined) continue;
      const ts = Date.parse(r.validity_time);
      if (!isFinite(ts)) continue;
      const t = gradi(r.t);
      const tlo = gradi(r.tn) != null ? gradi(r.tn) : t;   // min nell'ora, ripiego sull'istantanea
      const thi = gradi(r.tx) != null ? gradi(r.tx) : t;
      const ff = metri(r.ff);
      const fx = metri(r.fxi) != null ? metri(r.fxi) : metri(r.fxy);
      (ore[r.geo_id_insee] = ore[r.geo_id_insee] || []).push([ts, parseFloat(r.rr1), tlo, thi, ff, fx]);
    }
    for (const id of Object.keys(ore)) {
      const st = byId[id];
      if (!st) { ignote++; continue; }
      for (const w of windows) {
        let sum = 0, n = 0;
        let tmin = Infinity, tmax = -Infinity, nT = 0;
        let ffSum = 0, nFF = 0, fxMax = -Infinity, nFX = 0;
        for (const [ts, v, tlo, thi, ff, fx] of ore[id]) {
          if (!(ts > w.start && ts <= w.end)) continue;
          if (isFinite(v)) { sum += v; n++; }
          // sanity come Austria/Svizzera: fuori da [-45,50] °C o medio ≥60 m/s = glitch
          if (tlo != null && tlo >= -45 && tlo <= 50) { if (tlo < tmin) tmin = tlo; nT++; }
          if (thi != null && thi >= -45 && thi <= 50) { if (thi > tmax) tmax = thi; }
          if (ff != null && ff >= 0 && ff < 60) { ffSum += ff; nFF++; }
          if (fx != null && fx >= 0 && fx < 90) { if (fx > fxMax) fxMax = fx; nFX++; }
        }
        if (n < MIN_ORE) continue;
        const mm = Math.round(sum * 10) / 10;
        if (mm < 0 || mm > 500) continue;
        const rec = { id: st.id, n: st.n, lat: st.lat, lon: st.lon, q: st.q, p: st.p, mm };
        if (nT >= MIN_ORE && tmax > -Infinity)
          rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
        if (nFF >= MIN_ORE)
          rec.w = [Math.round(ffSum / nFF * 3.6 * 10) / 10,
                   nFX > 0 ? Math.round(fxMax * 3.6 * 10) / 10 : null];
        perRegDay[reg.key][w.dateStr].push(rec);
      }
    }
    fatti++;
    if (fatti % 20 === 0) console.log(`  ...${fatti}/${tuttiDip.length} dipartimenti`);
    await sleep(400);
  }
  if (ignote) console.log(`  Ore di stazioni fuori anagrafe (ignorate): ${ignote}`);

  // ── Scrittura per régione ──
  let scritti = 0, attesi = 0;
  for (const r of REGIONI) {
    const minStaz = Math.max(15, Math.round((anagrafePerReg[r.key] || 0) * 0.4));
    let tot = 0;
    for (const w of windows) {
      attesi++;
      if (writeDay(r.key, w.dateStr, perRegDay[r.key][w.dateStr], minStaz)) { scritti++; tot = perRegDay[r.key][w.dateStr].length; }
    }
    pulizia(r.key);
    const conT = (perRegDay[r.key][windows[0].dateStr] || []).filter(s => s.t).length;
    console.log(`  ${r.nome}: ~${tot} stazioni/giorno (anagrafe ${anagrafePerReg[r.key] || 0}, con temperatura ${conT})`);
  }
  console.log(`=== fine: ${scritti}/${attesi} file scritti ===`);
  if (scritti === 0) process.exit(1);
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
