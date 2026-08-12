#!/usr/bin/env node
/**
 * SLOVENIA — ARSO, Agencija Republike Slovenije za okolje
 * =======================================================
 * Archivio ufficiale `meteo.arso.gov.si/webmet/archive`, dati mezz'orari delle
 * stazioni automatiche. Licenza: informazioni liberamente riutilizzabili con
 * CITAZIONE OBBLIGATORIA della fonte — «Vir: ARSO» (art. 14 della legge sul
 * servizio meteorologico statale, Uradni list RS 60/17). Voce in fonti.html.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RICETTA — validata il 12/8/2026 PRIMA di scrivere una riga di collector.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. NON esiste un giornaliero ufficiale per le stazioni automatiche: il
 *    parametro «24-urna kolicina padavin ob 7 h» (pid 85) vale solo per le
 *    stazioni climatologiche/manuali (tipo 1,2,3) ed e per giunta la finestra
 *    07-07, la stessa trappola del Klimatag austriaco. Quindi si sommano le
 *    MEZZ'ORE del parametro 26 (tipo 4, automatiche).
 *
 * 2. LE MARCHE TEMPORALI SONO IN CET FISSO (UTC+1), SENZA ORA LEGALE, E
 *    INDICANO LA FINE DELL'INTERVALLO. E il punto su cui era facilissimo
 *    sbagliare: la app mostra orari «locali» e verrebbe da assumere CEST.
 *    Misurato con la correlazione oraria transfrontaliera contro l'Austria
 *    (di cui la convenzione e gia accertata), su tre coppie di stazioni:
 *
 *      Mezica <-> Feistritz ob Bleiburg    8,1 km, dislivello  54 m
 *      Sotinski breg <-> Bad Gleichenberg 10,5 km, dislivello 146 m
 *      Logarska Dolina <-> Bad Eisenkappel 11,2 km, dislivello 153 m
 *
 *    ESTATE (1/7-10/8): lo sfasamento migliore e -60 min su tutte e tre
 *    (r = 0,786 / 0,726 / 0,547), contro 0,34 / 0,21 / 0,35 a -120 min e
 *    0,09 / 0,07 / 0,21 a sfasamento zero.
 *    INVERNO (1/1-20/2), che e il test che scioglie il dubbio residuo fra
 *    «CET fisso + fine» (-60 in ogni stagione) e «ora locale + inizio»
 *    (-90 d'estate ma -30 d'inverno): resta -60 (r = 0,914 e 0,916, contro
 *    0,876 e 0,887 a -30). Due stagioni, stessa risposta -> CET fisso.
 *
 *    Conseguenza pratica: il «giorno» dell'archivio (00:00->23:30) e il giorno
 *    CET, che d'estate NON e il giorno solare italiano. Per un giorno italiano
 *    servono SEMPRE due giornate d'archivio, come per l'OSMER Friuli.
 *
 * 3. MIN_MEZZORE = 40 su 48, la stessa soglia di completezza delle altre reti
 *    (che a ore sono 20 su 24).
 *
 * TEMPERATURA E VENTO: arrivano nella STESSA richiesta (parametri 16/17 =
 * min/max T, 21 = vento medio m/s, 24 = raffica m/s) — zero chiamate in piu.
 *   t: [min, max]        gradi C sul giorno solare italiano
 *   w: [media, raffica]  km/h (x3,6 dal m/s della fonte)
 *
 * TRAPPOLA DEL PARSING: il server RIORDINA i parametri, quindi p0/p1/p2...
 * NON seguono l'ordine in cui li chiedi. La corrispondenza va letta dal blocco
 * `params:{p0:{pid:"26"...}}` della risposta, mai data per scontata.
 *
 * RITARDO DI PUBBLICAZIONE ~34 ORE, misurato il 12/8 su 12 stazioni: i giorni
 * D-2 e piu vecchi sono completi (48/48 su tutte), IERI ha esattamente 15
 * mezz'ore (fino alle 07:00 CET) e OGGI e vuoto. Non e un guasto ed e uguale
 * per tutte le stazioni insieme. Per questo il collector NON scrive mai un
 * giorno incompleto: un totale parziale sarebbe peggio di un buco, perche in
 * mappa sembrerebbe una giornata asciutta. In pratica il giorno piu recente
 * disponibile e D-2. Stessa famiglia del ritardo OSMER Friuli (24-48h).
 *
 * Il tetto e di DUE stazioni per chiamata (`max:2` nei settings dell'app):
 * 124 stazioni = 62 chiamate, ma ognuna copre un intervallo di giorni intero,
 * quindi un run che ricostruisce dieci giorni costa comunque 62 richieste.
 *
 * Alcune stazioni sono in anagrafe ma non hanno dati nell'archivio (es.
 * Ljubljana Klece, id 1872: zero mezz'ore su tutti i giorni provati). Non e un
 * errore: semplicemente non entrano nei file.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://meteo.arso.gov.si/webmet/archive';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'slovenia');
const RETENTION = 730;          // regola 1b del CLAUDE.md
const MIN_MEZZORE = 40;         // su 48
const GIORNI_INDIETRO = Number(process.env.GIORNI_INDIETRO || 8);
const DATA_OVERRIDE = process.env.DATA_OVERRIDE || '';
const PAUSA_MS = Number(process.env.PAUSA_MS || 250);
// SOLO_PIOGGIA=1 chiede il solo parametro 26. Serve al backfill lungo: chiedendo
// anche la temperatura la serie passa da 30 a 10 minuti e la stessa chiamata
// costa 12 secondi invece di 1,4 (misurato il 12/8 su 60 giorni). La pioggia va
// quindi indietro un anno, temperatura e vento solo sulle ultime settimane —
// come per tutte le altre reti (vedi METEO_HIST_FROM in index.html).
const SOLO_PIOGGIA = process.env.SOLO_PIOGGIA === "1";

// ora italiana: +2 fra l'ultima domenica di marzo e l'ultima di ottobre
function offsetItalia(d) {
  const y = d.getUTCFullYear();
  const ultimaDom = (mese) => {
    const x = new Date(Date.UTC(y, mese + 1, 0));
    x.setUTCDate(x.getUTCDate() - x.getUTCDay());
    x.setUTCHours(1, 0, 0, 0);
    return x;
  };
  return (d >= ultimaDom(2) && d < ultimaDom(9)) ? 2 : 1;
}
const E1800 = Date.UTC(1800, 0, 1);
const iso = (d) => d.toISOString().slice(0, 10);

async function chiedi(url, tentativi = 3) {
  for (let i = 1; i <= tentativi; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tentativi) throw e;
      await new Promise(res => setTimeout(res, 1500 * i));
    }
  }
}

// anagrafe: id, nome, coordinate e QUOTA (MeteoHub e OSMER la quota non ce l'hanno)
async function anagrafe() {
  const oggi = iso(new Date());
  const txt = await chiedi(`${BASE}/locations.xml?lang=si&vars=26&group=halfhourlyData0&type=4&d1=${oggi}&d2=${oggi}`);
  const st = [];
  const re = /_(\d+):\{\s*name:"([^"]*)",\s*lon:([\d.]+),\s*lat:([\d.]+),\s*alt:(-?\d+)/g;
  let m;
  while ((m = re.exec(txt))) {
    st.push({ id: +m[1], n: m[2], lon: +(+m[3]).toFixed(5), lat: +(+m[4]).toFixed(5), q: +m[5] });
  }
  if (!st.length) throw new Error('anagrafe vuota: la forma di locations.xml e cambiata');
  return st;
}

/**
 * Scarica una coppia di stazioni su un intervallo di giorni d'archivio (CET).
 * Ritorna { idStazione: { minutiDal1800: {mm,tmin,tmax,ff,fx} } }.
 */
async function scaricaCoppia(ids, d1, d2) {
  const vars = SOLO_PIOGGIA ? '26' : '26,16,17,21,24';
  const url = `${BASE}/data.xml?lang=si&vars=${vars}&group=halfhourlyData0`
            + `&type=halfhourly&id=${ids.join(',')}&d1=${d1}&d2=${d2}`;
  const txt = await chiedi(url);

  // il server riordina i parametri: la mappa pN -> pid si legge dalla risposta
  const perPid = {};
  for (const m of txt.matchAll(/(p\d+):\{\s*pid:"(\d+)"/g)) perPid[m[2]] = m[1];
  const campo = { mm: perPid['26'], tmin: perPid['16'], tmax: perPid['17'], ff: perPid['21'], fx: perPid['24'] };

  // ogni stazione e un blocco `_<id>:{ _<minuti>:{...}, ... }`: si taglia il
  // testo sugli inizi di blocco, cosi non serve una regex ricorsiva
  const out = {};
  const tagli = [...txt.matchAll(/_(\d{3,5}):\{(?=\s*_\d{9,}:)/g)];
  for (let i = 0; i < tagli.length; i++) {
    const id = +tagli[i][1];
    const da = tagli[i].index;
    const a = i + 1 < tagli.length ? tagli[i + 1].index : txt.length;
    const seg = txt.slice(da, a);
    if (!out[id]) out[id] = {};
    for (const p of seg.matchAll(/_(\d{9,}):\{([^}]*)\}/g)) {
      const k = +p[1], corpo = p[2], rec = {};
      for (const [nome, pn] of Object.entries(campo)) {
        if (!pn) continue;
        const mm = corpo.match(new RegExp(pn + ':"([^"]*)"'));
        if (mm) { const v = parseFloat(mm[1]); if (!isNaN(v)) rec[nome] = v; }
      }
      if (Object.keys(rec).length) out[id][k] = rec;
    }
  }
  return out;
}

/**
 * Somma le mezz'ore sul GIORNO SOLARE ITALIANO.
 * Una mezz'ora con etichetta K (minuti dal 1800, CET, FINE intervallo) ha fine
 * reale in UTC = K - 60 minuti. Appartiene al giorno D se cade in (inizio, fine].
 */
function giornoItaliano(serie, giorno) {
  const [Y, M, G] = giorno.split('-').map(Number);
  const d0 = new Date(Date.UTC(Y, M - 1, G));
  const d1 = new Date(Date.UTC(Y, M - 1, G + 1));
  const inizio = d0.getTime() - offsetItalia(d0) * 3600e3;
  const fine = d1.getTime() - offsetItalia(d1) * 3600e3;

  let mm = 0, nMm = 0, tmin = null, tmax = null, ff = 0, nFf = 0, fx = null;
  for (const [k, r] of Object.entries(serie)) {
    const eUTC = E1800 + (+k - 60) * 60000;
    if (eUTC <= inizio || eUTC > fine) continue;
    if (r.mm != null) { mm += r.mm; nMm++; }
    if (r.tmin != null) tmin = tmin == null ? r.tmin : Math.min(tmin, r.tmin);
    if (r.tmax != null) tmax = tmax == null ? r.tmax : Math.max(tmax, r.tmax);
    if (r.ff != null) { ff += r.ff; nFf++; }
    if (r.fx != null) fx = fx == null ? r.fx : Math.max(fx, r.fx);
  }
  if (nMm < MIN_MEZZORE) return null;          // giorno incompleto: non si scrive
  const rec = { mm: Math.round(mm * 10) / 10 };
  if (tmin != null && tmax != null) rec.t = [Math.round(tmin * 10) / 10, Math.round(tmax * 10) / 10];
  if (nFf >= MIN_MEZZORE) rec.w = [Math.round(ff / nFf * 3.6 * 10) / 10, fx == null ? null : Math.round(fx * 3.6 * 10) / 10];
  return rec;
}

function pulisciRetention() {
  const limite = new Date(); limite.setUTCDate(limite.getUTCDate() - RETENTION);
  let tolti = 0;
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && new Date(m[1] + 'T00:00:00Z') < limite) { fs.unlinkSync(path.join(DATA_DIR, f)); tolti++; }
  }
  if (tolti) console.log(`Pulizia retention: ${tolti} file oltre i ${RETENTION} giorni`);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const staz = await anagrafe();
  console.log(`Anagrafe ARSO: ${staz.length} stazioni automatiche`);

  const giorni = [];
  if (DATA_OVERRIDE) {
    giorni.push(...DATA_OVERRIDE.split(',').map(s => s.trim()).filter(Boolean));
  } else {
    const oggi = new Date();
    for (let i = 2; i <= GIORNI_INDIETRO; i++) {     // si parte da D-2: D-1 non e mai completo
      const d = new Date(oggi); d.setUTCDate(d.getUTCDate() - i); giorni.push(iso(d));
    }
  }
  giorni.sort();
  console.log(`Giorni richiesti: ${giorni[0]} -> ${giorni[giorni.length - 1]} (${giorni.length})`);

  // finestra d'archivio: un giorno CET in piu da entrambi i lati per i bordi
  const d1 = iso(new Date(Date.parse(giorni[0]) - 86400e3));
  const d2 = iso(new Date(Date.parse(giorni[giorni.length - 1]) + 86400e3));

  const serie = {};
  for (let i = 0; i < staz.length; i += 2) {
    const coppia = staz.slice(i, i + 2);
    try {
      const res = await scaricaCoppia(coppia.map(s => s.id), d1, d2);
      for (const [id, s] of Object.entries(res)) serie[id] = s;
    } catch (e) {
      console.log(`  coppia ${coppia.map(s => s.id).join(',')}: ${e.message}`);
    }
    if (PAUSA_MS) await new Promise(r => setTimeout(r, PAUSA_MS));
  }
  console.log(`Serie scaricate per ${Object.keys(serie).length} stazioni`);

  for (const g of giorni) {
    const righe = [];
    for (const s of staz) {
      const ser = serie[s.id];
      if (!ser) continue;
      const rec = giornoItaliano(ser, g);
      if (!rec) continue;
      righe.push({ id: String(s.id), n: s.n, lat: s.lat, lon: s.lon, q: s.q, ...rec });
    }
    if (righe.length < 20) { console.log(`  ${g}: solo ${righe.length} stazioni complete -> NON scritto`); continue; }
    const conT = righe.filter(r => r.t).length, conW = righe.filter(r => r.w).length;
    fs.writeFileSync(path.join(DATA_DIR, `${g}.json`), JSON.stringify({
      date: g, collected: new Date().toISOString(), source: 'arso-slovenia',
      count: righe.length, stations: righe,
    }));
    console.log(`  ${g}: ${righe.length} stazioni (t su ${conT}, vento su ${conW}), max ${Math.max(...righe.map(r => r.mm)).toFixed(1)} mm`);
  }

  pulisciRetention();
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
