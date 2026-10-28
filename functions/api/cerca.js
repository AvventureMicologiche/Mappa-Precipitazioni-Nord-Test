// La ricerca dei posti che non sono fra i comuni del sito: frazioni, passi, e tutta Svizzera, Austria, Francia e
// Slovenia (25/10/2026). Pages Function su Cloudflare, al posto di Open-Meteo Geocoding: il piano gratuito di
// Open-Meteo vieta i siti con pubblicita' o abbonamenti. I nomi sono gli stessi che usava Open-Meteo, cioe' GeoNames
// (CC BY 4.0), messi nei file luoghi/*.tsv da .github/scripts/genera-luoghi.js.
//
//   /api/cerca?name=viozene&count=10[&countryCode=IT]
//
// Risponde nella STESSA FORMA di Open-Meteo ({results:[{name, latitude, longitude, country_code, admin1, admin1_id,
// admin2, population, feature_code}]}), cosi' le quattro caselle di ricerca del sito restano com'erano. Come Open-Meteo:
// sotto le 2 lettere niente, con 2 lettere solo i nomi uguali, da 3 l'inizio del nome (anche dei nomi alternativi:
// «ginevra» trova Genève). In cima chi ha il nome uguale, poi i piu' abitati.
// In piu' di Open-Meteo (28/10/2026): «S.» e «S» valgono San, Sant', Santo, Santa, come nella ricerca dei comuni della
// mappa (locVarianti in index.html). «s. stefano d» trova Santo Stefano d'Aveto anche fra le frazioni.

const ORIGINI = /^https?:\/\/(precipitazioni\.avventuremicologiche\.it|avventurepluvio(-test)?\.pages\.dev|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
let DIVISI = null;
const FILE = new Map();   // nome del file -> righe, per tutta la vita dell'isolato (al massimo 40 file da 200 KB)

// la stessa di locNormalizza in index.html e di genera-luoghi.js
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’\-.]/g, ' ').replace(/\s+/g, ' ').trim();
// come in genera-luoghi.js, con la «~» davanti ai nomi riservati di Windows («con», «aux», «nul», «prn»…)
const nomeFile = p => {
  const n = [...p].map(c => /[a-z0-9]/.test(c) ? c : c === ' ' ? '_' : 'u' + c.codePointAt(0).toString(16)).join('');
  return (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(n) ? '~' + n : n) + '.tsv';
};
// la stessa di locVarianti in index.html: GeoNames scrive il santo per esteso, e' la DOMANDA che va allargata, e solo
// quando uno scrive l'abbreviazione (chi scrive «san» trova quello che trovava prima)
const SANTI = ['san', 'sant', 'santo', 'santa', 'santi', 'sante'];
const varianti = q => { const m = q.match(/^ss? (.+)$/); return m ? [q, ...SANTI.map(x => x + ' ' + m[1])] : [q]; };

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), cors = intestazioni(request);
  try {
    const q = norm(u.searchParams.get('name') || '');
    const quanti = Math.max(1, Math.min(20, +u.searchParams.get('count') || 10));
    const paese = (u.searchParams.get('countryCode') || '').toUpperCase();
    if (q.length < 2) return rispondi({ results: [] }, cors);
    if (!DIVISI) DIVISI = new Set(await (await env.ASSETS.fetch(new URL('/luoghi/divisi.json', request.url))).json());
    const esatto = q.length === 2, trovati = new Map();
    for (const v of varianti(q)) {
      // si scende nei gruppi divisi finche' la domanda e' piu' lunga del gruppo; se finisce prima, la «cima» del gruppo
      let p = v.slice(0, 2), cima = false;
      while (DIVISI.has(p)) { if (v.length > p.length) p = v.slice(0, p.length + 1); else { cima = true; break; } }
      const righe = await leggi(env, request, nomeFile(p).replace('.tsv', cima ? '-cima.tsv' : '.tsv'));
      for (const r of righe) {
        const k = r.slice(0, r.indexOf('\t'));
        if (esatto ? k !== v : !k.startsWith(v)) continue;
        // colonne: chiave, principale, id, nome, lat, lon, paese, regione, id-regione, provincia, abitanti, tipo, quota
        const f = r.split('\t');
        if (paese && f[6] !== paese) continue;
        const uguale = k === v ? 1 : 0, vero = +f[1], prima = trovati.get(f[2]);
        if (!prima || uguale > prima.uguale || (uguale === prima.uguale && vero > prima.vero)) trovati.set(f[2], { f, uguale, vero });
      }
    }
    // prima il nome uguale, poi chi lo ha come nome vero (non alternativo), poi i piu' abitati
    const results = [...trovati.values()]
      .sort((a, b) => (b.uguale - a.uguale) || (b.vero - a.vero) || (+b.f[10] - +a.f[10]) || a.f[3].length - b.f[3].length)
      .slice(0, quanti)
      .map(({ f }) => ({ id: +f[2], name: f[3], latitude: +f[4], longitude: +f[5], country_code: f[6], admin1: f[7],
        ...(f[8] ? { admin1_id: +f[8] } : {}), ...(f[9] ? { admin2: f[9] } : {}), population: +f[10], feature_code: f[11],
        ...(f[12] !== undefined && f[12] !== '' ? { elevation: +f[12] } : {}) }));
    return rispondi({ results }, cors, 200, 86400);
  } catch (e) {
    return rispondi({ errore: String(e && e.message || e) }, cors, 502);
  }
}

export async function onRequestOptions({ request }) { return new Response(null, { status: 204, headers: intestazioni(request) }); }

async function leggi(env, request, nome) {
  if (FILE.has(nome)) return FILE.get(nome);
  const r = await env.ASSETS.fetch(new URL('/luoghi/' + nome, request.url));
  const righe = r.ok ? (await r.text()).split('\n').filter(Boolean) : [];   // un gruppo che non c'e' = nessun posto
  if (FILE.size >= 40) FILE.delete(FILE.keys().next().value);
  FILE.set(nome, righe);
  return righe;
}
function intestazioni(request) {
  const o = request.headers.get('Origin') || '';
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
  if (ORIGINI.test(o)) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Methods'] = 'GET'; }
  return h;
}
function rispondi(dati, h, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(dati), { status, headers: { ...h, 'Cache-Control': status === 200 && maxAge ? `public, max-age=${maxAge}` : 'no-store' } });
}
