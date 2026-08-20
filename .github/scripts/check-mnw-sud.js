#!/usr/bin/env node
/**
 * check-mnw-sud.js — un TESTIMONE indipendente per le regioni MeteoHub (20/8/2026).
 *
 * PERCHE' ESISTE. Per le dieci regioni `dpcn-*` del centro-sud MeteoHub e' la
 * nostra UNICA fonte. Se pubblica un valore inventato finisce in mappa e non se
 * ne accorge nessuno: al Veneto un 36,4 mm fasullo e' saltato fuori solo perche'
 * avevamo ARPAV a smentirlo (bug #20, 19/8/2026). Al sud quel confronto non
 * esiste, e serve qualcuno che guardi la stessa pioggia da un'altra parte.
 *
 * IL TESTIMONE. La rete `mnw` (MeteoNetwork) ha ~930 pluviometri AMATORIALI su
 * tutta Italia, orari, sullo stesso MeteoHub. Come DATO li abbiamo scartati
 * (senza nome vero ne' quota, qualita' non garantita), ma come CONTROLLO vanno
 * benissimo: non serve che siano precisi al decimo, serve che dicano se in quella
 * zona e' piovuto oppure no. E' lo stesso metodo delle stazioni gemelle che ha
 * promosso il Friuli e bocciato la pioggia toscana.
 *
 * ⚠️ NON E' UN FILTRO E NON DEVE DIVENTARLO. Non tocca un solo dato: scrive un
 * registro e stampa un riassunto. Le piogge isolate NON sono di per se' sospette:
 * contate su 45 giorni (19/8/2026) le stazioni bagnate coi vicini asciutti sono
 * altrettanto frequenti nelle regioni a fonte diretta (Alto Adige 178 ogni
 * 10.000 stazioni-giorno, Friuli 120, Ticino 99) quanto in quelle MeteoHub
 * (Basilicata 187, Lazio 57, Sicilia 20): sono temporali estivi veri, ed e' il
 * fenomeno che la mappa deve mostrare. Scartarli sarebbe peggio del male.
 * Qui si segnala solo cio' che DUE fonti indipendenti raccontano in modo
 * incompatibile, e la decisione resta a una persona.
 *
 * COSA SEGNALA, per ogni stazione nostra con almeno MIN_TESTIMONI mnw vicine:
 *   BAGNATO_SOLO_NOI  noi >= MM_FORTE e TUTTI i testimoni sotto MM_ASCIUTTO
 *   ASCIUTTO_SOLO_NOI noi <= MM_ASCIUTTO e la MEDIANA dei testimoni >= MM_FORTE
 * e per ognuna dice CHI e' fuori dal coro, guardando anche i NOSTRI vicini:
 *   [stazione] i nostri vicini danno ragione ai testimoni, quindi e' quella
 *              stazione a sbagliare (pluviometro fermo o tarato male). E' il
 *              caso piu' comune e il piu' facile da chiudere: si esclude.
 *              Esempio vero, 12/8: Ponte S.Maria (Umbria) 0 mm mentre i nostri
 *              vicini a 5 e 6 km segnavano 10 e 21 mm.
 *   [rete]     i nostri vicini danno ragione a noi e i testimoni dicono
 *              un'altra cosa: il disaccordo riguarda l'intera zona. Piu' raro
 *              e piu' serio, perche' e' la forma che avrebbe un errore di
 *              MeteoHub, cioe' proprio cio' che al sud nessun altro vedrebbe.
 * piu' due indicatori d'insieme per regione: quante coppie concordano sul
 * bagnato/asciutto e il rapporto mediano fra i nostri mm e quelli dei testimoni
 * (un rapporto stabilmente lontano da 1 e' il sintomo di una sottostima
 * sistematica, cioe' proprio la forma che aveva il bug #20).
 *
 * USO:
 *   node .github/scripts/check-mnw-sud.js [DA A]
 *   senza date: gli ultimi 8 giorni (finestra pubblica, non serve l'account).
 *   con MH_USER/MH_PASS si va piu' indietro.
 *   DATA_ROOT=<cartella data> per leggere i dati di un altro repo.
 */
const fs = require('fs'), path = require('path');

const BASE = 'https://meteohub.agenziaitaliameteo.it';
// DATA_ROOT: i dati del centro-sud vivono nel repo di PRODUZIONE (i cron del
// test sono spenti da agosto e le sue cartelle meteohub-* sono ferme al 31/7).
// Per il collaudo si punta la' senza spostare niente.
const DATA = process.env.DATA_ROOT || path.join(__dirname, '..', '..', 'data');
// Il registro sta SEMPRE nel repo che ospita il controllore, anche quando i
// dati arrivano da un'altra cartella: con DATA_ROOT puntato altrove, scriverlo
// accanto ai dati significherebbe lasciare un file estraneo in quel repo.
const REGISTRO = path.join(__dirname, '..', '..', 'data', 'mnw-check.json');

const RAGGIO_KM      = 10;   // quanto lontano puo' stare un testimone
const MIN_TESTIMONI  = 2;    // sotto questo numero non si giudica
const MM_FORTE       = 5;    // "qui ha piovuto sul serio"
const MM_ASCIUTTO    = 0.5;  // "qui non e' caduto niente"
const MIN_ORE        = 20;   // completezza della giornata del testimone
const GIORNI_DEFAULT = 8;
const RETENTION      = 120;  // giorni di storia tenuti nel registro

const REGIONI = [
  ['meteohub-marche', 'Marche'], ['meteohub-umbria', 'Umbria'],
  ['meteohub-lazio', 'Lazio'], ['meteohub-campania', 'Campania'],
  ['meteohub-puglia', 'Puglia'], ['meteohub-calabria', 'Calabria'],
  ['meteohub-sicilia', 'Sicilia'], ['meteohub-sardegna', 'Sardegna'],
  ['meteohub-basilicata', 'Basilicata'], ['meteohub-molise', 'Molise'],
];

let MH_TOKEN = null;
async function login() {
  const u = (process.env.MH_USER || '').trim(), p = process.env.MH_PASS || '';
  if (!u || !p) return null;
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const t = await r.text();
  if (!r.ok) throw new Error('login HTTP ' + r.status);
  let tok = t.trim();
  try { const j = JSON.parse(t); tok = j.token || j.access_token || j.accessToken || tok; } catch (e) {}
  return tok.replace(/^"|"$/g, '') || null;
}

function offsetIT(d) {
  const y = d.getUTCFullYear();
  const u = m => { const x = new Date(Date.UTC(y, m + 1, 0)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(1, 0, 0, 0); return x; };
  return (d >= u(2) && d < u(9)) ? 2 : 1;
}
function finestra(g) {
  const off = offsetIT(new Date(g + 'T12:00:00Z'));
  const s = new Date(new Date(g + 'T00:00:00Z').getTime() - off * 3600000), e = new Date(s.getTime() + 86400000);
  const q = d => d.toISOString().slice(0, 16).replace('T', ' '), r = d => d.toISOString().slice(0, 19);
  return { qFrom: q(s), qTo: q(e), refFrom: r(s), refTo: r(e) };
}
const km = (a, b) => {
  const R = 6371, dl = (b.lat - a.lat) * Math.PI / 180;
  const dn = (b.lon - a.lon) * Math.PI / 180 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return R * Math.sqrt(dl * dl + dn * dn);
};
const mediana = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Giornate MeteoNetwork: somma oraria per stazione, completezza >= MIN_ORE. */
async function testimoniDelGiorno(g) {
  const w = finestra(g);
  const q = `reftime: >=${w.qFrom},<=${w.qTo};product:B13011;license:CCBY_COMPLIANT`;
  const url = `${BASE}/api/observations?networks=mnw&q=${encodeURIComponent(q)}`;
  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
  if (MH_TOKEN) headers['Authorization'] = 'Bearer ' + MH_TOKEN;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (r.ok) {
      const j = await r.json(); const out = [];
      for (const e of (j.data || [])) {
        const st = e.stat || {};
        if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
        let best = null;
        for (const p of (e.prod || [])) if (p.var === 'B13011' && Array.isArray(p.val) && (!best || p.val.length > best.val.length)) best = p;
        if (!best) continue;
        const vals = best.val.filter(v => v.ref > w.refFrom && v.ref <= w.refTo && typeof v.val === 'number');
        const ore = new Set(vals.map(v => v.ref.slice(11, 13))).size;
        if (ore < MIN_ORE) continue;                       // giornata bucata: non fa da testimone
        const mm = Math.round(vals.reduce((a, v) => a + v.val, 0) * 10) / 10;
        if (mm < 0 || mm > 400) continue;
        const nome = ((st.details || []).find(x => x.var === 'B01019') || {}).val || '—';
        out.push({ id: nome, lat: st.lat, lon: st.lon, mm });
      }
      return out;
    }
    if (r.status === 401) return null;                     // fuori dalla finestra pubblica
    await new Promise(x => setTimeout(x, 5000 * (i + 1)));
  }
  return null;
}

function leggiNostro(dir, g) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, dir, g + '.json'), 'utf8'));
    return (j.stations || []).filter(s => !s.om && typeof s.mm === 'number');  // le stime non si giudicano
  } catch (e) { return null; }
}

async function main() {
  const date = process.argv.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const giorni = [];
  if (date.length === 2) {
    for (let t = new Date(date[0] + 'T12:00:00Z').getTime(); t <= new Date(date[1] + 'T12:00:00Z').getTime(); t += 86400000)
      giorni.push(new Date(t).toISOString().slice(0, 10));
  } else {
    for (let i = GIORNI_DEFAULT; i >= 1; i--) giorni.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }

  try { MH_TOKEN = await login(); } catch (e) { console.warn('Warn login: ' + e.message); }
  console.log(`=== controllo MeteoNetwork ${giorni[0]} → ${giorni[giorni.length - 1]} ` +
              `(${MH_TOKEN ? 'con account' : 'anonimo'}) ===\n`);

  const segnalazioni = [];
  const perRegione = {};   // nome → {coppie, concordi, rapporti[]}

  for (const g of giorni) {
    const mnw = await testimoniDelGiorno(g);
    if (!mnw) { console.log(`${g}  testimoni non disponibili, salto`); continue; }
    let coppieG = 0, segnG = 0;

    for (const [dir, nome] of REGIONI) {
      const nostre = leggiNostro(dir, g);
      if (!nostre || nostre.length < 10) continue;
      const R = perRegione[nome] = perRegione[nome] || { coppie: 0, concordiBagnato: 0, concordiAsciutto: 0, rapporti: [] };

      for (const s of nostre) {
        const vicini = mnw.filter(m => km(s, m) <= RAGGIO_KM);
        if (vicini.length < MIN_TESTIMONI) continue;
        coppieG++; R.coppie++;
        const v = vicini.map(m => m.mm);
        const med = mediana(v), max = Math.max(...v);

        // indicatori d'insieme: solo dove almeno una delle due parti dice pioggia
        if (s.mm >= MM_FORTE && med >= MM_FORTE) { R.concordiBagnato++; R.rapporti.push(s.mm / med); }
        else if (s.mm <= MM_ASCIUTTO && med <= MM_ASCIUTTO) R.concordiAsciutto++;

        // contraddizioni forti
        const bagnatoSoloNoi  = s.mm >= MM_FORTE   && max < MM_ASCIUTTO;
        const asciuttoSoloNoi = s.mm <= MM_ASCIUTTO && med >= MM_FORTE;
        if (bagnatoSoloNoi || asciuttoSoloNoi) {
          // Da che parte stanno i NOSTRI vicini? Distingue la stazione rotta
          // (tutti gli altri nostri sono d'accordo coi testimoni) dal caso in
          // cui e' l'intera zona a raccontare un'altra storia.
          const nostriVic = nostre.filter(o => o !== s && km(s, o) <= RAGGIO_KM).map(o => o.mm);
          const nostroMed = nostriVic.length >= 2 ? mediana(nostriVic) : null;
          let chi = 'incerto';
          if (nostroMed !== null) {
            const noiConcordi = bagnatoSoloNoi ? nostroMed >= MM_FORTE : nostroMed <= MM_ASCIUTTO;
            chi = noiConcordi ? 'rete' : 'stazione';
          }
          segnalazioni.push({ g, regione: nome, chi, staz: s.n, mm: s.mm,
                              tipo: bagnatoSoloNoi ? 'BAGNATO_SOLO_NOI' : 'ASCIUTTO_SOLO_NOI',
                              testimoni: vicini.length, mnwMax: max, mnwMed: med,
                              nostriVicini: nostroMed });
          segnG++;
        }
      }
    }
    console.log(`${g}  testimoni ${String(mnw.length).padStart(3)}  coppie ${String(coppieG).padStart(4)}  segnalazioni ${segnG}`);
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\n── quadro per regione ──');
  console.log('regione       coppie  concordi(bagn/asc)  rapporto mediano nostro/testimoni');
  for (const [nome, R] of Object.entries(perRegione)) {
    const rap = mediana(R.rapporti);
    console.log(nome.padEnd(13), String(R.coppie).padStart(6),
                `   ${String(R.concordiBagnato).padStart(4)} / ${String(R.concordiAsciutto).padStart(5)}`,
                '        ', rap ? rap.toFixed(2) + (R.rapporti.length < 15 ? ' (solo ' + R.rapporti.length + ' casi, non fidarsi)' : '') : '—');
  }

  console.log(`\n── contraddizioni forti: ${segnalazioni.length} ──`);
  console.log('  giorno      regione     chi sbaglia   noi     testimoni  nostri vicini  stazione');
  for (const s of segnalazioni.slice(0, 40))
    console.log('  ' + s.g + '  ' + s.regione.padEnd(11) + ' [' + s.chi.padEnd(8) + '] ' +
                (s.tipo === 'BAGNATO_SOLO_NOI' ? 'noi bagnati ' : 'noi asciutti') + ' ' +
                String(s.mm).padStart(6) + ' | ' + String(s.mnwMed).padStart(6) + ' | ' +
                (s.nostriVicini === null ? '     —' : String(s.nostriVicini).padStart(6)) + '  ' + s.staz);
  if (segnalazioni.length > 40) console.log('  … e altre ' + (segnalazioni.length - 40));
  const perChi = {};
  segnalazioni.forEach(x => { perChi[x.chi] = (perChi[x.chi] || 0) + 1; });
  console.log('  ripartizione: ' + (Object.entries(perChi).map(([k, v]) => k + ' ' + v).join(', ') || '—'));

  // Una stazione che torna piu' volte non e' sfortuna: e' un sensore da guardare.
  const conta = {};
  segnalazioni.forEach(x => { const k = x.regione + ' · ' + x.staz; (conta[k] = conta[k] || []).push(x.g); });
  const ricorrenti = Object.entries(conta).filter(e => e[1].length >= 2).sort((a, b) => b[1].length - a[1].length);
  if (ricorrenti.length) {
    console.log('\n── segnalate piu\' volte (da guardare per prime) ──');
    for (const e of ricorrenti) console.log('  ' + e[1].length + '×  ' + e[0] + '   (' + e[1].join(', ') + ')');
  }

  // registro: si accumula, non si sovrascrive
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch (e) {}
  reg.aggiornato = new Date().toISOString();
  reg.parametri = { RAGGIO_KM, MIN_TESTIMONI, MM_FORTE, MM_ASCIUTTO, MIN_ORE };
  reg.giorni = reg.giorni || {};
  for (const g of giorni) reg.giorni[g] = segnalazioni.filter(s => s.g === g);
  const limite = new Date(Date.now() - RETENTION * 86400000).toISOString().slice(0, 10);
  for (const g of Object.keys(reg.giorni)) if (g < limite) delete reg.giorni[g];
  fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 1));
  console.log(`\nregistro aggiornato: ${path.relative(process.cwd(), REGISTRO)}`);
}

main().catch(e => { console.error('ERRORE', e.message); process.exit(1); });
