// OROLOGIO DEI COLLECTOR (Cloudflare Worker) — v2, 5/10/2026
// v1 (4/10): la mattina svegliava SOLO il guardiano, che poi ri-lanciava quello
// che mancava. Ma il guardiano aspetta di vedere che GitHub ha saltato un giro
// (2h30 dopo il giro previsto), quindi interveniva in ritardo per costruzione:
// il 5/10 alle 6:30 mancavano ancora MeteoHub (11 reti) e Svizzera, e le
// chiusure serali della Toscana (22:40-23:20) erano partite fra l'1:08 e l'1:58.
//
// La regola dell'utente (5/10): «le chiusure serali devono avvenire sempre» e
// «chi si alza alle 5 o alle 6 per andare a funghi deve trovare i dati»; se manca
// per colpa della FONTE va bene, se manca per colpa di GitHub/workflow/guardiano/
// Cloudflare e' colpa nostra.
//
// Quindi questo worker NON aspetta GitHub: ai momenti che contano LANCIA LUI i
// workflow (workflow_dispatch parte subito, misurato: 1-3 minuti di lavoro).
// I cron di GitHub restano come riserva. Per non doppiare:
//  - i giri NORMALI si saltano se quel workflow e' gia' in coda/in corso o e'
//    partito da meno di `saltaSe` minuti (vuol dire che GitHub l'ha fatto);
//  - le CHIUSURE SERALI (Toscana, Alto Adige) partono SEMPRE: un giro in piu' e'
//    innocuo (vince l'ultima lettura, e dopo mezzanotte c'e' closingLate/la
//    guardia), un giro in meno non si recupera piu' (SIR e' solo «in diretta»).
//
// Orari in ORA ITALIANA, calcolati qui con Intl: il cambio d'ora di fine ottobre
// non sposta niente. Il cron del worker gira ogni 5 minuti e fa qualcosa solo
// quando l'ora italiana cade su uno degli orari della tabella.
// Segreto GH_TOKEN: chiave GitHub fine-grained, solo questo repo, Actions read/write.

const REPO = 'AvventureMicologiche/Mappa-Precipitazioni-Nord';

// I collector del «mattino»: tutto quello che serve perche' alle 5-6 ci sia ieri.
const MATTINO = ['meteohub.yml', 'svizzera.yml', 'lombardia.yml', 'piemonte.yml', 'liguria.yml',
  'veneto.yml', 'trentino.yml', 'austria.yml', 'francia.yml', 'valledaosta-cf.yml',
  'friuli-osmer.yml', 'ticino.yml', 'emilia.yml'];

// [ora italiana, workflow, minuti per «GitHub l'ha gia' fatto» (0 = parte sempre)]
const TABELLA = [
  // ── chiusure serali: SEMPRE, piu' tentativi, l'ultimo il piu' vicino a mezzanotte
  ['22:40', ['toscana.yml'], 0],
  ['23:00', ['toscana.yml'], 0],
  ['23:10', ['altoadige.yml'], 0],
  ['23:25', ['toscana.yml'], 0],
  ['23:40', ['toscana.yml', 'altoadige.yml'], 0],
  // ── il giorno appena chiuso, per chi lo pubblica subito. Solo queste quattro (5/10):
  // le altre le rifà comunque il giro delle 4:30, e un giro in più alle 0:45 era solo
  // carico in più sulle fonti (la Liguria fa ~440 richieste a giro).
  ['00:45', ['austria.yml', 'francia.yml', 'valledaosta-cf.yml', 'trentino.yml'], 30],
  // ── il giro principale del mattino, e una seconda passata
  ['04:30', MATTINO, 45],
  ['05:15', ['riepiloghi.yml'], 20],
  ['05:45', ['meteohub.yml', 'svizzera.yml', 'emilia.yml', 'friuli-osmer.yml'], 45],
  // ── il guardiano resta come rete di sicurezza (ri-lancia cio' che manca ancora)
  ['06:00', ['guardiano.yml'], 0],
  ['06:30', ['guardiano.yml'], 0],
  ['07:00', ['guardiano.yml'], 0],
  ['07:15', ['emilia.yml'], 45],        // ARPAE completa la giornata fra le 6:30 e le 11
  ['07:30', ['guardiano.yml'], 0],
  ['08:00', ['guardiano.yml'], 0],
  ['08:30', ['guardiano.yml'], 0],
  // ── l'allarme fonti (22/10/2026): il suo cron di GitHub (9:43 UTC) partiva fra le 15:30 e le 21:30.
  // 11:45 e non prima: ARPAE completa la giornata entro le 11, e i controlli guardano ieri. Il workflow salta da
  // se' il giro del cron se oggi uno e' gia' riuscito; qui si salta se GitHub l'ha fatto nelle ultime 10 ore.
  ['11:45', ['alert-fonti.yml'], 600],
];

const H = (env) => ({
  'Authorization': `Bearer ${env.GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'orologio-collector',   // GitHub rifiuta le chiamate senza
  'Content-Type': 'application/json',
});

export function oraItaliana(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' }).format(d);
}

// Gli orari della tabella che cadono in questo giro da 5 minuti.
export function daFare(quando) {
  const t = new Date(Math.floor(quando.getTime() / 300000) * 300000);   // arrotonda ai 5'
  const hhmm = oraItaliana(t);
  return TABELLA.filter(r => r[0] === hhmm);
}

// GitHub l'ha gia' fatto? (in coda, in corso, o partito da meno di `min` minuti)
async function giaFatto(env, wf, min, adesso, fetchFn) {
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?per_page=3`, { headers: H(env) });
  if (!r.ok) return null;                          // non so: meglio lanciare
  const j = await r.json();
  for (const run of j.workflow_runs || []) {
    if (run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting') return `in corso (${run.status})`;
    const fa = (adesso - new Date(run.created_at)) / 60000;
    if (fa >= 0 && fa < min) return `partito ${Math.round(fa)}' fa`;
  }
  return null;
}

async function lancia(env, wf, fetchFn) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    const r = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
      method: 'POST', headers: H(env), body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status === 204) return 'lanciato';
    const testo = await r.text();
    if (r.status === 401 || r.status === 403 || r.status === 404) return `HTTP ${r.status} ${testo.slice(0, 120)}`;  // chiave: riprovare non serve
    await new Promise(ok => setTimeout(ok, 5000));
    if (tentativo === 3) return `HTTP ${r.status} dopo 3 tentativi`;
  }
}

export async function giro(env, quando, fetchFn = fetch) {
  const righe = daFare(quando);
  const esito = [];
  for (const [hhmm, wfs, saltaSe] of righe) {
    for (const wf of wfs) {
      let perche = null;
      if (saltaSe > 0) { try { perche = await giaFatto(env, wf, saltaSe, quando, fetchFn); } catch (e) { perche = null; } }
      const r = perche ? `saltato: ${perche}` : await lancia(env, wf, fetchFn);
      esito.push(`${hhmm} ${wf}: ${r}`);
      console.log(`${hhmm} ${wf}: ${r}`);
    }
  }
  return esito;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(giro(env, new Date(event.scheduledTime)));
  },
  // aprire l'indirizzo del worker NON lancia niente: dice solo che c'e' e cosa farebbe
  async fetch() {
    const righe = TABELLA.map(r => `${r[0]}  ${r[1].join(', ')}${r[2] ? `  (salta se GitHub l'ha fatto negli ultimi ${r[2]}')` : '  (sempre)'}`);
    return new Response('orologio dei collector attivo (ora italiana)\n\n' + righe.join('\n') + '\n');
  },
};
