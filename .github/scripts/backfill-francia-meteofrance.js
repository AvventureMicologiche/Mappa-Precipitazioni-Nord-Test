#!/usr/bin/env node
/**
 * FRANCIA INTERA — Backfill 365+ giorni di dati REALI (una tantum, 9/8/2026)
 * ==========================================================================
 * Semina lo storico 2025-08-01 → 2026-08-04 per TUTTE le 13 régions dai CSV
 * orari ufficiali `BASE/HOR/H_<dip>` di meteo.data.gouv.fr (95 dipartimenti,
 * la Corsica è `20` unico). Stessa banca dati dell'API, Licence Ouverte 2.0.
 * Niente stime, niente fase beta: come Svizzera e Austria.
 *
 * ⚠️ SOLO il mirror S3 OVH: `object.files.data.gouv.fr` è fermo a giugno 2026
 * e il `last_modified` dell'API data.gouv mente (misurato il 9/8/2026).
 *
 * RICETTA (misurata prima di scrivere lo script): etichetta AAAAMMJJHH = UTC
 * di FINE intervallo — 99,6% di quadrature esatte entro 0,2 mm contro il RR
 * ufficiale 06-06 su 9.763 giorni bagnati (6 dipartimenti alpini, 2026).
 * Somma sul giorno solare italiano, MIN_ORE=20, identica al collector.
 *
 * ~1 GB di download totale (95 file da 3-15 MB), un dipartimento alla volta.
 * NON tocca i file esistenti (i giorni del collector restano suoi).
 *
 * Uso: node backfill-francia-meteofrance.js
 *      SOLO_REGIONE=francia-corsica node ...   (una régione sola, per prove)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_ROOT = path.join(__dirname, '../..', 'data');
const OVH       = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR';
const DA        = '2025-08-01';
const A         = '2026-08-04';
const MIN_ORE   = 20;

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

function belNome(s) {
  return s.replace(/_SAPC$/i, '').replace(/_/g, ' ').toLowerCase()
          .replace(/(^|[\s\-'])\S/g, m => m.toUpperCase()).trim();
}

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
  console.log('=== backfill-francia-meteofrance (13 régions) ===');
  const soloReg = (process.env.SOLO_REGIONE || '').trim();
  const regioni = REGIONI.filter(r => !soloReg || r.key === soloReg);

  // finestre dei giorni della semina
  const giorni = [];
  for (let t = Date.parse(DA + 'T12:00:00Z'); t <= Date.parse(A + 'T12:00:00Z'); t += 86400000) {
    const dateStr = fmtDate(new Date(t));
    const off = getItalyOffset(new Date(t)) * 3600000;
    const start = Date.parse(dateStr + 'T00:00:00Z') - off;
    giorni.push({ dateStr, start, end: start + 86400000 });
  }
  const inWindow = Object.fromEntries(giorni.map(g => [g.dateStr, g]));
  console.log(`  Giorni della semina: ${giorni.length} (${DA} → ${A})`);

  for (const reg of regioni) {
    fs.mkdirSync(path.join(DATA_ROOT, reg.key), { recursive: true });
    const perDay = {};                      // dateStr -> id -> {sum,n}
    for (const g of giorni) perDay[g.dateStr] = {};
    const ana = {};
    for (const dip of reg.depts) {
      const testo = await scarica(dip);
      const righe = testo.split('\n');
      const head = righe[0].trim().split(';');
      const iN = head.indexOf('NUM_POSTE'), iNom = head.indexOf('NOM_USUEL'),
            iLat = head.indexOf('LAT'), iLon = head.indexOf('LON'), iAlt = head.indexOf('ALTI'),
            iD = head.indexOf('AAAAMMJJHH'), iRR = head.indexOf('RR1');
      for (let k = 1; k < righe.length; k++) {
        const c = righe[k].split(';');
        const rr = c[iRR];
        if (rr === '' || rr === undefined) continue;
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
        if (!ana[id]) ana[id] = {
          n: belNome(c[iNom] || id),
          lat: Math.round(parseFloat(c[iLat]) * 100000) / 100000,
          lon: Math.round(parseFloat(c[iLon]) * 100000) / 100000,
          q: isFinite(parseFloat(c[iAlt])) ? Math.round(parseFloat(c[iAlt])) : 0,
          p: DIP_NOME[dip] || '',
        };
        const slot = perDay[g.dateStr][id] || (perDay[g.dateStr][id] = { sum: 0, n: 0 });
        slot.sum += parseFloat(rr); slot.n++;
      }
    }
    const minStaz = Math.max(15, Math.round(Object.keys(ana).length * 0.4));
    let scritti = 0, corti = 0, saltati = 0;
    for (const g of giorni) {
      const f = path.join(DATA_ROOT, reg.key, g.dateStr + '.json');
      if (fs.existsSync(f)) { saltati++; continue; }   // giorno del collector
      const stations = [];
      for (const id of Object.keys(perDay[g.dateStr])) {
        const { sum, n } = perDay[g.dateStr][id];
        if (n < MIN_ORE) continue;
        const mm = Math.round(sum * 10) / 10;
        if (mm < 0 || mm > 500) continue;
        const a = ana[id];
        stations.push({ id, n: a.n, lat: a.lat, lon: a.lon, q: a.q, p: a.p, mm });
      }
      if (stations.length < minStaz) { corti++; continue; }
      fs.writeFileSync(f, JSON.stringify({
        date: g.dateStr, collected: new Date().toISOString(),
        source: 'meteofrance-dppaquetobs', backfill: true,
        count: stations.length, stations,
      }));
      scritti++;
    }
    console.log(`  ${reg.nome}: ${scritti} giorni scritti, ${corti} corti, ${saltati} del collector (anagrafe ${Object.keys(ana).length})`);
  }
  console.log('=== fine ===');
}

main().catch(e => { console.error('ERRORE FATALE:', e.message); process.exit(1); });
