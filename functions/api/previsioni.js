// Previsioni meteo per la sezione «Previsioni» del sito (7/10/2026).
// Pages Function su Cloudflare: il browser chiama /api/previsioni, mai MET Norway direttamente
// (le sue condizioni lo vietano: serve un proxy con User-Agent identificativo, cache, 4 decimali).
//
//   /api/previsioni?lat=46.171&lon=9.871&q=307     → un punto: 7 giorni + ore (1 h per ~2,5 giorni, poi fasce di 6 h con h6:true)
//   /api/previsioni?capoluoghi=lombardia            → i capoluoghi dell'area, solo i 7 giorni
//
// Fonti: MET Norway Locationforecast 2.0 (CC BY 4.0) per tempo, gradi, mm, vento;
// Open-Meteo solo per la probabilita' di pioggia (MET non la da' in Italia). Staccabile: PROB=false.
// Cache: Cache API di Cloudflare, per cella di ~1 km, durata dall'Expires di MET (tetto 1 ora).

const UA = 'precipitazioni.avventuremicologiche.it (avventuremicologiche@gmail.com)';
const PROB = true;
const TETTO_CACHE = 3600, MIN_CACHE = 600;
const VERSIONE = 13; // alzare quando cambia la forma della risposta: la cache vecchia non si rilegge (11: simbolo del giorno, 18/10/2026; 12: le tre correzioni del simbolo, 19/10/2026; 13: la % per istante UTC, 19/10/2026)
// tempi massimi (19/10/2026, quinto check, bug 12): prima nessuno, e una fonte appesa teneva ferma la risposta
// finche' Cloudflare non chiudeva la funzione. MET oltre 8 s = errore per quel punto; Open-Meteo oltre 4 s = niente %
const TEMPO_MET_MS = 8000, TEMPO_PROB_MS = 4000;
const ORIGINI = /^https?:\/\/(precipitazioni\.avventuremicologiche\.it|avventurepluvio(-test)?\.pages\.dev|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
const TZ = 'Europe/Rome';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const cors = intestazioni(request);
  try {
    // ?zona=garfagnana: i paesi di una zona piogge (data/paesi-zone.json, lo scrive genera-pagine-zona-piogge.js), 20/10/2026
    const zona = u.searchParams.get('zona'), area = zona || u.searchParams.get('capoluoghi');
    if (area) {
      const d = await perArea(area, env, request, zona ? '/data/paesi-zone.json' : '/data/capoluoghi.json');
      // ⚠️ (19/10/2026, quinto check, bug 5) nessuna citta' risponde = 502 e niente cache nel browser: prima era un 200
      // tenuto 10 minuti, e la mappa restava su «carico…»; qualcuna sola in errore = 200 ma per 2 minuti, poi si richiede
      const stato = d.errore ? (d.capoluoghi ? 502 : 404) : 200;
      return rispondi(d, cors, stato, (d.capoluoghi || []).some(x => x.errore) ? 120 : 1800);
    }
    // ⚠️ anche VUOTI (19/10/2026, bug 12): «?lat=&lon=» passava come 0,0 e rispondeva col Golfo di Guinea
    if (!(u.searchParams.get('lat') || '').trim() || !(u.searchParams.get('lon') || '').trim()) return rispondi({ errore: 'lat/lon mancanti' }, cors, 400);
    const lat = +u.searchParams.get('lat'), lon = +u.searchParams.get('lon'), q = u.searchParams.get('q');
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return rispondi({ errore: 'lat/lon non validi' }, cors, 400);
    const r = await perPunto(lat, lon, q == null || q === '' ? null : Math.round(+q), request, true);
    return rispondi(r.dati, cors, r.dati.errore ? 502 : 200, r.maxAge);
  } catch (e) {
    return rispondi({ errore: String(e && e.message || e) }, cors, 502);
  }
}

export async function onRequestOptions({ request }) { return new Response(null, { status: 204, headers: intestazioni(request) }); }

function intestazioni(request) {
  const o = request.headers.get('Origin') || '';
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
  if (ORIGINI.test(o)) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Methods'] = 'GET'; }
  return h;
}
function rispondi(dati, h, status = 200, maxAge = 0) {
  const hh = { ...h };
  // al browser al massimo 10 minuti: la cache lunga sta nel worker (Cache API), e dopo una pubblicazione il sito cambia `v=`
  hh['Cache-Control'] = status === 200 && maxAge > 0 ? `public, max-age=${Math.min(maxAge, 600)}` : 'no-store';
  return new Response(JSON.stringify(dati), { status, headers: hh });
}

// ── un punto: MET (tutto) + Open-Meteo (solo la %) ──
async function perPunto(lat, lon, q, request, conOre, conProb) {
  if (conProb === undefined) conProb = true;
  // cella di ~1 km: la cache vale per chiunque guardi lo stesso posto
  const la = lat.toFixed(2), lo = lon.toFixed(2), qq = q == null ? '' : String(Math.round(q / 10) * 10);
  // ⚠️ la DATA italiana nella chiave (19/10/2026, quinto check, bug 11): a mezzanotte la cache di ieri non si usa
  // piu', se no per fino a un'ora la previsione cominciava con ieri e il sito la chiamava «oggi»
  const chiave = new Request(`https://cache.previsioni/punto?v=${VERSIONE}&d=${oraLocale(new Date().toISOString()).g}&lat=${la}&lon=${lo}&q=${qq}&ore=${conOre ? 1 : 0}&pr=${conProb ? 1 : 0}`);
  const cache = caches.default;
  const c = await cache.match(chiave);
  if (c) return { dati: await c.json(), maxAge: restante(c) };

  /* ⚠️ LA % SI AGGANCIA PER ISTANTE, IN UTC (19/10/2026, quinto check, bug 12). Prima si chiedeva Open-Meteo in ora
     italiana e si agganciava per «giorno_ora» locale. Due difetti, misurati sul sito vero a Genova: la fascia di 6 ore
     delle 20 cercava le ore 24 e 25 e perdeva quelle dopo mezzanotte (23/10 20-02: 9% contro un vero 13%); e
     Open-Meteo in ora italiana il 25/10 da' 24 ore invece di 25 (non ripete le 02), quindi da li' le sue ore locali
     slittavano di una rispetto a MET (26/10: 11% e 8% contro 10% e 7%). Ora tutt'e due in UTC e si confrontano gli
     istanti: le ore di MET sono gia' UTC, e la fascia di 6 ore e' «sei ore da quell'istante». */
  const [met, prob] = await Promise.all([
    fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${(+la).toFixed(4)}&lon=${(+lo).toFixed(4)}${qq ? '&altitude=' + qq : ''}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TEMPO_MET_MS) }),
    (PROB && conProb) ? fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=precipitation_probability&timezone=GMT&forecast_days=8`, { signal: AbortSignal.timeout(TEMPO_PROB_MS) }).catch(() => null) : null,
  ]);
  if (!met.ok) return { dati: { errore: 'MET Norway ' + met.status }, maxAge: 0 };
  const d = await met.json();
  const pr = {}; // istante UTC in ms → %
  if (prob && prob.ok) { try { const o = await prob.json(); o.hourly.time.forEach((t, i) => { pr[Date.parse(t + 'Z')] = o.hourly.precipitation_probability[i]; }); } catch (e) {} }

  const giorni = {}, ore = [];
  for (const t of d.properties.timeseries) {
    const { g, h } = oraLocale(t.time), ms = Date.parse(t.time);   // ms: l'istante, per agganciare la %
    const x = t.data.instant.details, n1 = t.data.next_1_hours, n6 = t.data.next_6_hours;
    const e = giorni[g] || (giorni[g] = { g, mn: 99, mx: -99, mm: 0, righe: [], pc: null });
    e.mn = Math.min(e.mn, x.air_temperature); e.mx = Math.max(e.mx, x.air_temperature);
    const s = ((n1 || n6 || {}).summary || {}).symbol_code || null;
    if (n1) { e.mm += n1.details.precipitation_amount; if (conOre) ore.push({ g, h, t: x.air_temperature, mm: n1.details.precipitation_amount, s, v: x.wind_speed, vd: x.wind_from_direction, u: x.relative_humidity, pc: pr[ms] ?? null }); }
    else if (n6) { e.mm += n6.details.precipitation_amount; if (conOre) ore.push({ g, h, h6: true, t: x.air_temperature, mm: n6.details.precipitation_amount, s, v: x.wind_speed, vd: x.wind_from_direction, u: x.relative_humidity, pc: maxProb(pr, ms) }); }
    if (s) e.righe.push({ s, h, n6: !n1 && !!n6, mm: (n1 || n6).details.precipitation_amount || 0 });
    // la % del giorno = il massimo delle sue righe: nelle fasce di 6 h prima si guardavano solo i 4 orari d'inizio e
    // l'intestazione poteva dire meno della tabella (giro dell'8/10: Belluno 8% contro 23%)
    const p = n6 && !n1 ? maxProb(pr, ms) : pr[ms]; if (p != null) e.pc = Math.max(e.pc ?? 0, p);
  }
  const lista = Object.values(giorni).sort((a, b) => a.g < b.g ? -1 : 1).slice(0, 7).map(e => ({
    g: e.g, mn: Math.round(e.mn), mx: Math.round(e.mx), mm: Math.round(e.mm * 10) / 10, pc: e.pc,
    s: scegliSimbolo(e.righe),
  }));
  const dati = { lat: +la, lon: +lo, q: qq ? +qq : null, agg: d.properties.meta.updated_at, giorni: lista, ...(conOre ? { ore } : {}), fonte: 'MET Norway (ECMWF)' + (PROB ? ' · % Open-Meteo' : ''), ...((PROB && conProb) ? { probStato: prob ? prob.status : 'rete' } : {}) };   // probStato: cosa ha risposto Open-Meteo (8/10, per capire i buchi della %)

  // quanto tenere in cache: l'Expires di MET, fra 10 minuti e 1 ora
  let maxAge = TETTO_CACHE;
  const ex = Date.parse(met.headers.get('Expires') || ''); if (ex) maxAge = Math.round((ex - Date.now()) / 1000);
  maxAge = Math.max(MIN_CACHE, Math.min(TETTO_CACHE, maxAge));
  // ⚠️ senza la % (Open-Meteo non ha risposto) si tiene solo 2 minuti: prima restava in cache fino a un'ora e la
  // colonna «PROB.» usciva vuota per tutti (Mantova, foto della guida, 8/10)
  if (PROB && conProb && !Object.keys(pr).length) maxAge = 120;
  await cache.put(chiave, new Response(JSON.stringify(dati), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}`, 'Date': new Date().toUTCString() } }));
  return { dati, maxAge };
}

// ── i capoluoghi di un'area, in parallelo (al massimo 12 → sotto i 50 subrequest) ──
async function perArea(area, env, request, file) {
  if (!/^[a-z-]{3,40}$/.test(area)) return { errore: 'area' };   // 40: gli indirizzi delle zone arrivano a 30 lettere
  const chiave = new Request(`https://cache.previsioni/area?v=${VERSIONE}&d=${oraLocale(new Date().toISOString()).g}&f=${file.slice(6, 8)}&a=${area}`);   // data nella chiave, vedi perPunto; f: una zona e una regione con lo stesso nome non si pestano
  const cache = caches.default;
  const c = await cache.match(chiave); if (c) return c.json();
  const lista = await (await env.ASSETS.fetch(new URL(file, request.url))).json();
  const citta = lista[area]; if (!citta) return { errore: 'area sconosciuta' };
  // ⚠️ TETTO DI 50 SOTTORICHIESTE per chiamata (Cloudflare): con 12 citta' e la % di Open-Meteo erano 51 e la
  // Svizzera cadeva al primo colpo (7/10). Qui niente %, e una citta' che fallisce resta sola col suo errore.
  const ris = await Promise.all(citta.map(async p => {
    try { const r = await perPunto(p.lat, p.lon, p.q, request, false, false); return { n: p.n, lat: p.lat, lon: p.lon, q: p.q, ...(p.c ? { c: 1 } : {}), ...(p.r ? { r: p.r } : {}), ...(r.dati.errore ? { errore: r.dati.errore } : { giorni: r.dati.giorni, agg: r.dati.agg }) }; }
    catch (e) { return { n: p.n, lat: p.lat, lon: p.lon, q: p.q, errore: String(e && e.message || e) }; }
  }));
  const dati = { area, agg: (ris.find(x => x.agg) || {}).agg || null, capoluoghi: ris, fonte: 'MET Norway (ECMWF)' + (PROB ? ' · % Open-Meteo' : '') };
  if (!ris.some(x => x.giorni)) dati.errore = 'nessuna citta\' risponde';   // MET giu': errore in cima, vedi onRequestGet (bug 5)
  if (!ris.some(x => x.errore)) await cache.put(chiave, new Response(JSON.stringify(dati), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800', 'Date': new Date().toUTCString() } }));
  return dati;
}

// ⚠️ UN formattatore solo, creato una volta: crearlo a ogni ora della previsione costava decine di ms di CPU
// e la funzione cadeva col limite dei 10 ms (errore 1102, Corsica a cache fredda, 7/10/2026).
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
function oraLocale(iso) {
  const p = FMT.formatToParts(new Date(iso));
  const v = {}; for (const x of p) v[x.type] = x.value;
  return { g: `${v.year}-${v.month}-${v.day}`, h: +v.hour % 24 };
}
/* ⚠️ IL SIMBOLO DEL GIORNO (18/10/2026). Fino a oggi si contavano «a voti» le righe con ora 6-18, una
   riga un voto. Nei primi due giorni MET da' una riga ogni ora e va bene; dal terzo da' righe orarie solo
   di NOTTE (fino alle 7) e poi fasce di 6 ore alle 8, 14 e 20: i voti diurni diventavano le 6 e le 7
   (buio: clearsky_night, fair_night) e le fasce delle 8 e delle 14, un voto a testa, pareggio, vinceva la
   notte. Visto sul sito: Garfagnana 20/10, 🌙 con 44,5 mm, 28,7 dei quali nella fascia delle 20 che non
   votava. Adesso: ogni riga pesa le ORE che copre fra le 6 e le 21 (un'ora o le sue sei), i simboli
   notturni contano solo se nel giorno non c'e' niente di diurno (oggi dopo il tramonto), e quando nella
   finestra c'e' pioggia (≥ 0,5 mm) vince il simbolo piu' severo: chi guarda la scheda chiede «piove?»,
   e la fascia 14-20 con 15 mm deve battere il «variabile» delle 8-14. Senza pioggia vince il peso. */
const SEVERITA = [/thunder/, /snow|sleet/, /heavyrain/, /rain|drizzle/, /^cloudy|fog/, /partlycloudy/, /fair|clearsky/];
/* ⚠️ TRE CORREZIONI (19/10/2026, quarto check A13):
   1. senza pioggia si sommano le ore per FAMIGLIA (sole = fair+clearsky, poco nuvoloso, nuvoloso/nebbia...) e a
      parita' vince la MENO cupa: Garfagnana 19/10 usciva nebbia con 4 h di nebbia contro 7 h di sole divise fra
      fair (4) e clearsky (3);
   2. una fascia «_night» che entra nelle ore 6-21 conta come diurna: Arezzo 24/10, rovesci forti 02-08 (8,8 mm)
      scartati perche' «notte», e usciva la nuvola con 13,3 mm;
   3. se nessuna riga cade fra le 6 e le 21 (oggi dopo le 21) si usano tutte le righe rimaste, notte compresa:
      prima tornava null e la pagina metteva la nuvola anche con pioggia forte. */
function scegliSimbolo(righe) {
  const grado = s => { const i = SEVERITA.findIndex(re => re.test(s)); return i < 0 ? SEVERITA.length : i; };
  let usa = [];
  for (const r of righe) {
    const w = Math.max(0, Math.min(r.h + (r.n6 ? 6 : 1), 21) - Math.max(r.h, 6));   // ore dentro 6-21
    if (w) usa.push({ s: r.s.replace(/_night$/, '_day'), w, mm: r.mm });             // di giorno la notte e' giorno (2)
  }
  if (!usa.length) usa = righe.map(r => ({ s: r.s, w: r.n6 ? 6 : 1, mm: r.mm }));     // oggi dopo le 21 (3)
  if (!usa.length) return null;
  const peso = {}, pesoFam = {}; let mm = 0;
  for (const u of usa) { peso[u.s] = (peso[u.s] || 0) + u.w; pesoFam[grado(u.s)] = (pesoFam[grado(u.s)] || 0) + u.w; mm += u.mm; }
  let sim = Object.keys(peso);
  if (mm >= 0.5) {
    // col piu' severo comanda, ma non un'ora sola: un'ora di nevischio alle 7 non deve coprire un giorno di pioggia
    const solidi = sim.filter(s => peso[s] >= 2); if (solidi.length) sim = solidi;
    sim.sort((a, b) => grado(a) - grado(b) || peso[b] - peso[a]);
    return sim[0];
  }
  // 4. (19/10/2026, sua scelta A) di giorno asciutto ma nella giornata almeno 2 mm previsti, di notte: sole con
  //    pioggia, cosi' l'icona non dice «sole» accanto a 4,5 mm (Ceva 21/10, pioggia fra mezzanotte e le 2).
  //    Vale solo finche' quella notte e' davanti: MET manda le ore da adesso in poi, passata la notte i mm spariscono.
  const mmGiorno = righe.reduce((t, r) => t + (r.mm || 0), 0);
  if (mmGiorno >= 2) return righe.some(r => /snow|sleet/.test(r.s) && r.mm > 0) ? 'snowshowers_day' : 'rainshowers_day';
  // senza pioggia: la famiglia con piu' ore, a parita' la meno cupa (1); dentro la famiglia il simbolo piu' presente
  const fam = Object.keys(pesoFam).map(Number).sort((a, b) => pesoFam[b] - pesoFam[a] || b - a)[0];
  return sim.filter(s => grado(s) === fam).sort((a, b) => peso[b] - peso[a] || (a < b ? -1 : 1))[0];
}
export { scegliSimbolo };   // per le prove in locale (prova-simbolo.mjs nello scratchpad della scheda 86)
// la % di una fascia di 6 ore: il massimo delle sei ore da quell'istante, anche oltre mezzanotte (bug 12, 19/10/2026)
function maxProb(pr, ms) { let m = null; for (let k = 0; k < 6; k++) { const p = pr[ms + k * 3600000]; if (p != null) m = Math.max(m ?? 0, p); } return m; }
function restante(resp) {
  const m = /max-age=(\d+)/.exec(resp.headers.get('Cache-Control') || ''), d = Date.parse(resp.headers.get('Date') || '');
  if (!m) return MIN_CACHE; const r = +m[1] - (d ? Math.round((Date.now() - d) / 1000) : 0); return Math.max(60, r);
}
