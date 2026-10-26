/**
 * check-orologio.js — GitHub Actions (1 run al giorno, dentro alert-fonti.yml)
 *
 * L'OROLOGIO SU CLOUDFLARE STA LAVORANDO? (5/10/2026)
 * Dal 5/10 il worker «sveglia-guardiano» su Cloudflare lancia lui le chiusure serali
 * (Toscana 22:40-23:40, Alto Adige 23:10 e 23:40) e il giro del mattino, senza
 * aspettare i cron di GitHub, che nelle notti storte saltano. Se il worker si ferma
 * (account, chiave revocata, un errore nel codice) i cron di GitHub tengono in piedi
 * i dati, ma IN SILENZIO si torna alle mattine senza dati: questo controllo serve a
 * saperlo il giorno stesso.
 *
 * COME LO RICONOSCE. I lanci del worker sono `workflow_dispatch` fatti con la chiave
 * dell'account; quelli del guardiano sono `workflow_dispatch` di github-actions[bot].
 * Il guardiano non lancia mai se stesso, quindi:
 *  - CHIUSURE: almeno un toscana.yml lanciato a mano (non dal bot) ieri fra le 22:35
 *    e le 23:59 italiane;
 *  - MATTINO: almeno un guardiano.yml lanciato a mano (non dal bot) oggi fra le 5:55
 *    e le 6:15 italiane.
 * Se manca una delle due, mail.
 *
 * NON CHIAMA NESSUNA FONTE DI DATI e non tocca niente: legge l'elenco dei run.
 * Serve GH_TOKEN con permissions actions: read.
 * Prova in locale:  GH_TOKEN=$(gh auth token) node .github/scripts/check-orologio.js
 *   ORA=2026-10-06T09:43:00Z finge un altro momento.
 */
const fs = require('fs');

const REPO = 'AvventureMicologiche/Mappa-Precipitazioni-Nord';
// Prima di questo momento il worker v2 non c'era: i lanci di prima non contano.
const DAL = new Date('2026-10-05T05:15:00Z');
// ⚠️ I lanci dell'orologio risultano fatti da «AvventureMicologiche» (la chiave del
// worker e' di quell'account), come quelli a mano dal PC: un lancio a mano negli
// stessi minuti conterebbe come orologio. Caso raro, accettato.
const adesso = process.env.ORA ? new Date(process.env.ORA) : new Date();

const out = process.env.GITHUB_OUTPUT;
const scrivi = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// "2026-10-05, 23:40" -> { giorno, hhmm }
function it(d) { const [g, h] = fmt.format(d).split(', '); return { giorno: g, hhmm: h }; }
const oggiIT = it(adesso).giorno;
const ieriIT = it(new Date(adesso.getTime() - 86400000)).giorno;

async function runs(wf) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?event=workflow_dispatch&per_page=50`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
               'User-Agent': 'check-orologio' },
  });
  if (!r.ok) throw new Error(`${wf}: HTTP ${r.status}`);
  return (await r.json()).workflow_runs || [];
}
const diOrologio = (run) => !/github-actions/.test((run.triggering_actor || run.actor || {}).login || '');

function cerca(lista, giorno, da, a) {
  return lista.filter(run => {
    const t = new Date(run.created_at);
    if (t < DAL || t > adesso) return false;
    const x = it(t);
    return diOrologio(run) && x.giorno === giorno && x.hhmm >= da && x.hhmm <= a;
  });
}

(async () => {
  const problemi = [];
  // chiusure di ieri sera: si giudicano solo se ieri sera il worker c'era gia'
  // ⚠️ Si giudica a partire dalle chiusure del 5/10 sera e dal mattino del 6/10: prima
  // c'era il worker v1, che lanciava solo il guardiano (falso allarme provato il 5/10).
  if (ieriIT >= '2026-10-05') {
    const t = cerca(await runs('toscana.yml'), ieriIT, '22:35', '23:59');
    console.log(`chiusure del ${ieriIT}: ${t.length} lanci dell'orologio (${t.map(r => it(new Date(r.created_at)).hhmm).join(', ') || 'nessuno'})`);
    if (!t.length) problemi.push(`ieri sera (${ieriIT}) nessuna chiusura della Toscana lanciata dall'orologio fra le 22:35 e le 23:59`);
  }
  // mattino di oggi: il guardiano delle 6:00
  if (oggiIT >= '2026-10-06' && it(adesso).hhmm >= '06:20') {
    const g = cerca(await runs('guardiano.yml'), oggiIT, '05:55', '06:15');
    console.log(`mattino del ${oggiIT}: ${g.length} lanci del guardiano dall'orologio (${g.map(r => it(new Date(r.created_at)).hhmm).join(', ') || 'nessuno'})`);
    if (!g.length) problemi.push(`stamattina (${oggiIT}) il guardiano delle 6:00 non e' stato lanciato dall'orologio`);
  }

  if (!problemi.length) {
    console.log("\nL'orologio su Cloudflare ha lavorato: nessuna mail.");
    scrivi('mail', 'false');
    return;
  }

  const corpo =
`L'orologio dei collector su Cloudflare (worker «sveglia-guardiano») non ha fatto
il suo lavoro:

${problemi.map(p => '• ' + p).join('\n')}

I dati non sono persi: i cron di GitHub sono rimasti al loro posto e fanno da
riserva. Ma senza l'orologio si torna alle mattine in cui, se GitHub salta i giri
di notte, i dati arrivano tardi, e le chiusure serali della Toscana partono dopo
mezzanotte.

Cosa guardare, in quest'ordine:
1. Cloudflare -> Workers -> sveglia-guardiano -> Observability (log): un HTTP 401
   vuol dire chiave GitHub revocata o scaduta (GH_TOKEN, secret del worker).
2. Settings -> Trigger events: deve esserci il cron «Every 5 minutes».
3. Aprire https://sveglia-guardiano.avventuremicologiche.workers.dev/ : deve
   rispondere «orologio dei collector attivo» con la tabella degli orari.

Questo controllo non tocca niente: legge solo l'elenco dei run su GitHub.`;

  const oggetto = `Orologio Cloudflare fermo? ${problemi.length === 2 ? 'Niente chiusure ne\' giro del mattino' : problemi[0].slice(0, 60)}`;
  const mail =
`From: ${process.env.MAIL_USER || 'bot'}\r\n` +
`To: ${process.env.MAIL_TO || 'bot'}\r\n` +
`Subject: ${oggetto}\r\n` +
`Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
corpo.replace(/\n/g, '\r\n') + '\r\n';
  if (out) fs.writeFileSync('orologio-mail.eml', mail);
  console.log('\nALLARME:\n' + corpo);
  scrivi('mail', 'true');
})().catch(e => {
  // un guasto di questo controllo non deve far tacere gli altri: si dice e basta
  console.log(`controllo dell'orologio non riuscito: ${e.message}`);
  scrivi('mail', 'false');
});
