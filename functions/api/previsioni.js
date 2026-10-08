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
const VERSIONE = 10; // alzare quando cambia la forma della risposta: la cache vecchia non si rilegge
const ORIGINI = /^https?:\/\/(precipitazioni\.avventuremicologiche\.it|avventurepluvio(-test)?\.pages\.dev|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
const TZ = 'Europe/Rome';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const cors = intestazioni(request);
  try {
    const area = u.searchParams.get('capoluoghi');
    if (area) { const d = await perArea(area, env, request); return rispondi(d, cors, d.errore ? 404 : 200, 1800); }
    if (!u.searchParams.has('lat') || !u.searchParams.has('lon')) return rispondi({ errore: 'lat/lon mancanti' }, cors, 400);
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
  const chiave = new Request(`https://cache.previsioni/punto?v=${VERSIONE}&lat=${la}&lon=${lo}&q=${qq}&ore=${conOre ? 1 : 0}&pr=${conProb ? 1 : 0}`);
  const cache = caches.default;
  const c = await cache.match(chiave);
  if (c) return { dati: await c.json(), maxAge: restante(c) };

  const [met, prob] = await Promise.all([
    fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${(+la).toFixed(4)}&lon=${(+lo).toFixed(4)}${qq ? '&altitude=' + qq : ''}`, { headers: { 'User-Agent': UA } }),
    (PROB && conProb) ? fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=precipitation_probability&timezone=${encodeURIComponent(TZ)}&forecast_days=8`).catch(() => null) : null,
  ]);
  if (!met.ok) return { dati: { errore: 'MET Norway ' + met.status }, maxAge: 0 };
  const d = await met.json();
  const pr = {}; // 'YYYY-MM-DD_h' → %
  if (prob && prob.ok) { try { const o = await prob.json(); o.hourly.time.forEach((t, i) => { pr[t.slice(0, 10) + '_' + +t.slice(11, 13)] = o.hourly.precipitation_probability[i]; }); } catch (e) {} }

  const giorni = {}, ore = [];
  for (const t of d.properties.timeseries) {
    const { g, h } = oraLocale(t.time);
    const x = t.data.instant.details, n1 = t.data.next_1_hours, n6 = t.data.next_6_hours;
    const e = giorni[g] || (giorni[g] = { g, mn: 99, mx: -99, mm: 0, sym: {}, pc: null });
    e.mn = Math.min(e.mn, x.air_temperature); e.mx = Math.max(e.mx, x.air_temperature);
    const s = ((n1 || n6 || {}).summary || {}).symbol_code || null;
    if (n1) { e.mm += n1.details.precipitation_amount; if (conOre) ore.push({ g, h, t: x.air_temperature, mm: n1.details.precipitation_amount, s, v: x.wind_speed, vd: x.wind_from_direction, u: x.relative_humidity, pc: pr[g + '_' + h] ?? null }); }
    else if (n6) { e.mm += n6.details.precipitation_amount; if (conOre) ore.push({ g, h, h6: true, t: x.air_temperature, mm: n6.details.precipitation_amount, s, v: x.wind_speed, vd: x.wind_from_direction, u: x.relative_humidity, pc: maxProb(pr, g, h) }); }
    if (s && h >= 6 && h <= 18) e.sym[s] = (e.sym[s] || 0) + 1;
    // la % del giorno = il massimo delle sue righe: nelle fasce di 6 h prima si guardavano solo i 4 orari d'inizio e
    // l'intestazione poteva dire meno della tabella (giro dell'8/10: Belluno 8% contro 23%)
    const p = n1 ? pr[g + '_' + h] : n6 ? maxProb(pr, g, h) : pr[g + '_' + h]; if (p != null) e.pc = Math.max(e.pc ?? 0, p);
  }
  const lista = Object.values(giorni).sort((a, b) => a.g < b.g ? -1 : 1).slice(0, 7).map(e => ({
    g: e.g, mn: Math.round(e.mn), mx: Math.round(e.mx), mm: Math.round(e.mm * 10) / 10, pc: e.pc,
    s: Object.keys(e.sym).sort((a, b) => e.sym[b] - e.sym[a])[0] || null,
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
async function perArea(area, env, request) {
  if (!/^[a-z-]{3,24}$/.test(area)) return { errore: 'area' };
  const chiave = new Request(`https://cache.previsioni/area?v=${VERSIONE}&a=${area}`);
  const cache = caches.default;
  const c = await cache.match(chiave); if (c) return c.json();
  const lista = await (await env.ASSETS.fetch(new URL('/data/capoluoghi.json', request.url))).json();
  const citta = lista[area]; if (!citta) return { errore: 'area sconosciuta' };
  // ⚠️ TETTO DI 50 SOTTORICHIESTE per chiamata (Cloudflare): con 12 citta' e la % di Open-Meteo erano 51 e la
  // Svizzera cadeva al primo colpo (7/10). Qui niente %, e una citta' che fallisce resta sola col suo errore.
  const ris = await Promise.all(citta.map(async p => {
    try { const r = await perPunto(p.lat, p.lon, p.q, request, false, false); return { n: p.n, lat: p.lat, lon: p.lon, q: p.q, ...(p.c ? { c: 1 } : {}), ...(r.dati.errore ? { errore: r.dati.errore } : { giorni: r.dati.giorni, agg: r.dati.agg }) }; }
    catch (e) { return { n: p.n, lat: p.lat, lon: p.lon, q: p.q, errore: String(e && e.message || e) }; }
  }));
  const dati = { area, agg: (ris.find(x => x.agg) || {}).agg || null, capoluoghi: ris, fonte: 'MET Norway (ECMWF)' + (PROB ? ' · % Open-Meteo' : '') };
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
function maxProb(pr, g, h) { let m = null; for (let k = 0; k < 6; k++) { const p = pr[g + '_' + (h + k)]; if (p != null) m = Math.max(m ?? 0, p); } return m; }
function restante(resp) {
  const m = /max-age=(\d+)/.exec(resp.headers.get('Cache-Control') || ''), d = Date.parse(resp.headers.get('Date') || '');
  if (!m) return MIN_CACHE; const r = +m[1] - (d ? Math.round((Date.now() - d) / 1000) : 0); return Math.max(60, r);
}
