// /previsioni/: la mappa aperta sulle previsioni, con un indirizzo suo per Google (28/10/2026, suo «sì, fase A»).
// Non e' una copia di index.html (1 MB da tenere uguale a mano): si prende LO STESSO index.html del sito e qui si
// riscrivono solo titolo, descrizione, canonico e anteprima social. La mappa capisce da sola dall'indirizzo che deve
// aprire le previsioni (index.html, «LINK ALLE PREVISIONI» e il «link con ?m=prev»), come con ?m=prev.
// Perche' non un sottodominio: per Google sarebbe un sito nuovo, ripartirebbe da zero e dividerebbe i segnali.
//   /previsioni             → 301 a /previsioni/ (la query resta)
//   /previsioni/            → la vista Italia delle previsioni
//   /previsioni/?r=toscana  → le previsioni della Toscana, come ?r=toscana&m=prev

const SITO = 'https://precipitazioni.avventuremicologiche.it';
const URL_PAGINA = SITO + '/previsioni/';
const TITOLO = 'Previsioni meteo in Italia, paese per paese e ora per ora';
const DESCR = 'Le previsioni meteo dei prossimi 7 giorni su una mappa: tocca una città o una regione, o cerca il tuo '
  + 'paese, e guarda pioggia, temperature e vento ora per ora. Previsioni MET Norway (ECMWF).';

class Contenuto {
  constructor(valore) { this.valore = valore; }
  element(el) { el.setAttribute(el.tagName === 'link' ? 'href' : 'content', this.valore); }
}
class Titolo {
  element(el) { el.setInnerContent(TITOLO); }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const u = new URL(request.url);
  if (u.pathname !== '/previsioni/') return Response.redirect(u.origin + '/previsioni/' + u.search, 301);
  const pagina = await env.ASSETS.fetch(new URL('/', u.origin));
  if (!pagina.ok) return pagina;
  return new HTMLRewriter()
    .on('title', new Titolo())
    .on('link[rel="canonical"]', new Contenuto(URL_PAGINA))
    .on('meta[name="description"]', new Contenuto(DESCR))
    .on('meta[property="og:title"]', new Contenuto(TITOLO + ' | Avventure Micologiche'))
    .on('meta[property="og:description"]', new Contenuto(DESCR))
    .on('meta[property="og:url"]', new Contenuto(URL_PAGINA))
    .transform(pagina);
}
