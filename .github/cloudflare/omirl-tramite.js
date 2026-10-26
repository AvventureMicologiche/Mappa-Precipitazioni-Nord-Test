// omirl-tramite (23/10/2026): alcune fonti italiane rispondono SOLO dall'Italia. Misurato il 23/10 su OMIRL (ARPA
// Liguria): Cloudflare Roma (FCO) e Milano (MXP) si', Marsiglia (MRS) e Minneapolis (MSP) no, e i runner di GitHub
// (Stati Uniti) no. Dal 23/10 sera lo stesso con ARPA Piemonte (utility.arpa.piemonte.it): dal PC 0,2 s, da GitHub
// «fetch failed». Il wrangler.toml FISSA il worker vicino a Milano ([placement] region = "aws:eu-south-1"), da
// chiunque arrivi la richiesta. Passa SOLO le GET dei percorsi in FONTI e solo con l'intestazione X-Chiave uguale
// al segreto CHIAVE: non e' un passaggio aperto per chiunque. /dove (con la chiave) dice da che centro dati esce.
// Copia in repo: .github/cloudflare/omirl-tramite.js (+ omirl-tramite.wrangler.toml)
const FONTI = [
  ['/Omirl/rest/', 'https://omirl.regione.liguria.it'],          // ARPA Liguria
  ['/api_realtime/', 'https://utility.arpa.piemonte.it'],        // ARPA Piemonte, realtime
  ['/meteoidro/', 'https://utility.arpa.piemonte.it'],           // ARPA Piemonte, archivio ufficiale
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const fonte = FONTI.find(f => url.pathname.startsWith(f[0]));
    if (req.method !== 'GET' || !(fonte || url.pathname === '/dove')) return new Response('no', { status: 404 });
    if (!env.CHIAVE || req.headers.get('X-Chiave') !== env.CHIAVE) return new Response('no', { status: 403 });
    if (url.pathname === '/dove') {
      const t = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
      return new Response(t, { headers: { 'content-type': 'text/plain' } });
    }
    try {
      const r = await fetch(fonte[1] + url.pathname + url.search, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (mappa-precipitazioni)' },
        signal: AbortSignal.timeout(25000),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
    } catch (e) {
      // 504 = la fonte non ha risposto nemmeno da Cloudflare: il collector lo tratta come un guasto
      return new Response('la fonte non risponde: ' + e, { status: 504 });
    }
  }
};
