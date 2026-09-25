#!/usr/bin/env node
/**
 * Vento Toscana: campionatore ORARIO della pagina anemometri del CFR (19/8/2026).
 *
 * PERCHE' ESISTE. Il SIR (fonte della pioggia, t e u toscane) non pubblica il
 * vento: le sue pagine di monitoraggio sono solo pluvio/termo/igro/idro/nivo.
 * Il CFR invece ha `cfr.toscana.it/monitoraggio/stazioni.php?type=anemo`: una
 * pagina LIVE con ~140 anemometri (stessi codici TOSxxxxxxxx dei pluviometri
 * SIR, quindi l'aggancio e' per codice, senza cercare vicini). Come le pagine
 * SIR, pero', e' solo l'istante attuale: velocita' e raffica di adesso, piu' i
 * massimi di oggi e di ieri. NON c'e' una serie temporale, e il grafico del
 * pannello disegna la MEDIA giornaliera. Quindi la media ce la costruiamo noi
 * campionando la pagina ogni ora: 24 letture istantanee al giorno (letture, non
 * medie orarie: un po' piu' rumorose delle altre reti, ed e' dichiarato qui).
 *
 * COSA SCRIVE. Solo in `data/toscana-vento/YYYY-MM-DD.json` (giorno solare
 * italiano):
 *   { date, collected, campioni: { TOS…: [["HH:MM", vel_ms, raff_ms], …] },
 *     raffMaxIeri: { TOS…: raff_ms }  (dalla colonna «Raff. Max ieri» della pagina,
 *                                      letta il giorno dopo: e' il massimo ufficiale)
 *     w: { TOS…: [media_kmh, raffica_kmh] }   (calcolato quando i campioni sono >= MIN_CAMPIONI)
 *   }
 * Il file di IERI riceve `w` a ogni run di oggi (idempotente: stesso risultato,
 * nessun commit se non cambia). NON tocca mai `data/toscana/`: quei file li scrive
 * solo il collector SIR, che al suo passo t/u di ieri legge `w` da qui e lo attacca
 * (un solo scrittore per cartella = niente conflitti di push fra i due workflow).
 *
 * UNITA': la pagina e' in m/s (il dettaglio stazione dice `speed_label: "m-s"`) →
 * ×3,6 come Emilia, Veneto, VdA. Sanity: vel < 60 m/s, raffica < 90.
 * Soglia: MIN_CAMPIONI = 20 letture distinte (le «20 ore valide» delle altre reti).
 *
 * ⚠️ La pagina ha array JS con nomi offuscati; il record completo e' quello a 19
 * campi: [0]=codice [1]=nome [2]=prov [3]=area [4]=zona [5]=quota
 * [6]=vel attuale [7]=raff attuale [8]=dir [9]=ora  [10]=vel max oggi [11]=raff
 * max oggi [12]=dir [13]=ora  [14]=vel max ieri [15]=raff max ieri [16]=dir
 * [17]=ora  [18]=flag. Gli altri array hanno lo stesso codice e campi vuoti.
 */
const fs = require('fs');
const path = require('path');

const URL_ANEMO = 'https://cfr.toscana.it/monitoraggio/stazioni.php?type=anemo';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'toscana-vento');
const MIN_CAMPIONI = 20;
const RETENTION = 45;   // file di campioni: bastano poche settimane, il prodotto sta in data/toscana

function offsetItalia(d) {
  const y = d.getUTCFullYear();
  const ultimaDom = (mese) => { const x = new Date(Date.UTC(y, mese + 1, 0)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(1, 0, 0, 0); return x; };
  return (d >= ultimaDom(2) && d < ultimaDom(9)) ? 2 : 1;
}
const p2 = n => String(n).padStart(2, '0');
function adessoItalia() {
  const now = new Date();
  const loc = new Date(now.getTime() + offsetItalia(now) * 3600000);
  return { giorno: `${loc.getUTCFullYear()}-${p2(loc.getUTCMonth() + 1)}-${p2(loc.getUTCDate())}`,
           ora: `${p2(loc.getUTCHours())}:${p2(loc.getUTCMinutes())}`, loc };
}
function giornoPrima(g) { const d = new Date(g + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

function num(v) { if (v == null || v === '' || v === '-') return null; const f = parseFloat(String(v).replace(',', '.')); return isNaN(f) ? null : f; }

function parseAnemo(html) {
  const out = {};
  const re = /new Array\(("TOS\d+"(?:,"[^"]*"){18})\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = [...m[1].matchAll(/"([^"]*)"/g)].map(x => x[1]);
    const id = v[0];
    if (out[id]) continue;                    // prima occorrenza = array completo
    const vel = num(v[6]), raff = num(v[7]), ora = (v[9] || '').replace('.', ':');
    const raffMaxIeri = num(v[15]), velMaxIeri = num(v[14]);
    out[id] = { n: v[1], vel, raff, ora, raffMaxIeri, velMaxIeri };
  }
  return out;
}

function leggi(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }

function calcolaW(doc) {
  const w = {};
  for (const [id, camp] of Object.entries(doc.campioni || {})) {
    const vel = camp.map(c => c[1]).filter(x => x != null && x >= 0 && x < 60);
    if (vel.length < MIN_CAMPIONI) continue;
    const media = vel.reduce((a, b) => a + b, 0) / vel.length;
    let raff = Math.max(...camp.map(c => c[2]).filter(x => x != null && x >= 0 && x < 90), -1);
    const rmi = doc.raffMaxIeri && doc.raffMaxIeri[id];
    if (rmi != null && rmi >= 0 && rmi < 90) raff = Math.max(raff, rmi);
    // ⚠️ UNA RAFFICA NON PUO' STARE SOTTO LA MEDIA DELLA GIORNATA (29/8/2026).
    //    Se ci sta, non e' una misura: e' un dato mancante scritto come numero.
    //    La colonna «Raff. Max ieri» del CFR restituisce 0 quando il valore non
    //    c'e', e quello 0 arrivava in mappa come «raffica 0 km/h» accanto a 7,3
    //    km/h di media — 22 stazioni-giorno ad agosto, il 2,7%. E' la lezione di
    //    Alpe Gorreto: assente non e' zero. Meglio ammettere di non sapere.
    if (raff >= 0 && raff < media) raff = -1;
    w[id] = [Math.round(media * 3.6 * 10) / 10, raff >= 0 ? Math.round(raff * 3.6 * 10) / 10 : null];
  }
  return w;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { giorno, ora } = adessoItalia();
  const r = await fetch(URL_ANEMO, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MappaPluvio/1.0)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const staz = parseAnemo(await r.text());
  const ids = Object.keys(staz);
  if (ids.length < 50) throw new Error(`pagina anemometri con ${ids.length} record: forma cambiata?`);

  // 1) campioni di OGGI (dedup per ora di lettura della pagina, non per ora del run)
  const fOggi = path.join(DATA_DIR, `${giorno}.json`);
  const doc = leggi(fOggi) || { date: giorno, campioni: {}, raffMaxIeri: {} };
  let nuovi = 0, conVel = 0;
  for (const id of ids) {
    const s = staz[id];
    if (s.vel == null) continue;
    conVel++;
    const arr = doc.campioni[id] = doc.campioni[id] || [];
    const chiave = s.ora || ora;
    if (arr.some(c => c[0] === chiave)) continue;    // stessa lettura gia' presa
    arr.push([chiave, s.vel, s.raff]);
    nuovi++;
  }
  doc.collected = new Date().toISOString();
  doc.w = calcolaW(doc);
  fs.writeFileSync(fOggi, JSON.stringify(doc));
  console.log(`  ${giorno} ${ora}: ${conVel} anemometri con velocita', ${nuovi} campioni nuovi; stazioni con w gia' calcolabile: ${Object.keys(doc.w).length}`);

  // 2) IERI: massimi ufficiali della pagina ("raff max ieri") + ricalcolo di w
  const ieri = giornoPrima(giorno);
  const fIeri = path.join(DATA_DIR, `${ieri}.json`);
  const dIeri = leggi(fIeri);
  if (dIeri) {
    dIeri.raffMaxIeri = dIeri.raffMaxIeri || {};
    for (const id of ids) if (staz[id].raffMaxIeri != null) dIeri.raffMaxIeri[id] = staz[id].raffMaxIeri;
    const prima = JSON.stringify(dIeri.w || {});
    dIeri.w = calcolaW(dIeri);
    if (JSON.stringify(dIeri.w) !== prima || !dIeri.chiuso) { dIeri.chiuso = true; fs.writeFileSync(fIeri, JSON.stringify(dIeri)); }
    console.log(`  ${ieri}: w su ${Object.keys(dIeri.w).length} stazioni (campioni >= ${MIN_CAMPIONI})`);
  }

  // 3) retention dei file di campioni
  const limite = new Date(); limite.setUTCDate(limite.getUTCDate() - RETENTION);
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && new Date(m[1] + 'T00:00:00Z') < limite) fs.unlinkSync(path.join(DATA_DIR, f));
  }
}

main().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
