/* ═══════════════════════════════════════════════════════════════
   GUARDIANO DEI COLLECTOR IN RITARDO — 28 agosto 2026
   ═══════════════════════════════════════════════════════════════

   PERCHE' ESISTE. Lo scheduler di GitHub su questo repo non e' puntuale e
   ogni tanto salta i giri del tutto. Misurato su 1.650 giri reali:
   ritardo mediano 38 minuti, solo l'1% parte entro 5 minuti, il 24% sfora
   l'ora. E nelle notti storte si perde molto di piu':
       26->27 agosto   78 giri programmati, 23 partiti   (71% saltati)
       27->28 agosto   78 giri programmati, 48 partiti   (38% saltati)

   ⚠️ IN TUTTE E DUE LE NOTTI, ZERO RUN FALLITI. Quelli che partono
   riescono; gli altri non nascono proprio. Quindi **guardare gli esiti dei
   workflow non serve a niente**: l'unico segnale onesto sono i FILE dei dati.
   Questo script guarda quelli.

   COSA FA. La mattina controlla che ogni cartella di data/ abbia il giorno
   che dovrebbe avere. Se manca a qualcuno E il suo ultimo giro programmato
   e' passato da un pezzo, ri-lancia il workflow che la produce.

   COSA NON FA. Non tocca un dato, non scrive in data/ se non il proprio
   registro, e non zittisce nessuno: se una fonte e' morta davvero,
   check-fonti.js suona lo stesso dopo tre giorni. Questo rimedia ai giri
   persi, non ai guasti.

   ⚠️ IL LIMITE, DETTO SUBITO: il guardiano e' anche lui un cron, e nella
   notte del 71% sarebbe stato saltato pure lui. Per questo ha TRE orari
   invece di uno. Copre il caso «GitHub ha saltato la notte ed e' tornato in
   se' la mattina», che e' il piu' frequente, non «GitHub e' giu' da dodici
   ore» — li' non c'e' guardiano che tenga, e quando torna ripartono da soli
   anche i collector.

   USO
     node .github/scripts/guardiano-collector.js          guarda e basta
     LANCIA=1 node .github/scripts/guardiano-collector.js  ri-lancia davvero
     GIORNO=2026-08-27 ...                                finge un altro giorno
   ═══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RADICE = path.join(__dirname, '..', '..');
const DATA = path.join(RADICE, 'data');
const WF_DIR = path.join(RADICE, '.github', 'workflows');
const REGISTRO = path.join(DATA, 'guardiano.json');

// ⚠️ L'anagrafica cartella -> workflow sta in UN posto solo, in check-fonti.js.
// Due elenchi che divergono direbbero due verita' diverse sulla stessa cosa.
const { REGIONI } = require('./check-fonti.js');

const LANCIA = process.env.LANCIA === '1';

/* ── Le tarature, con il perche' accanto ────────────────────────── */

// Quanto deve essere passato dall'ultimo giro programmato prima di dire
// «questo e' in ritardo». Il ritardo mediano e' 38 minuti e il 6% sfora le
// due ore: sotto le 2h30 si ri-lancerebbero workflow che stanno solo
// arrivando tardi, cioe' si farebbe rumore invece che riparazione.
const MARGINE_MIN = 150;

// Se il prossimo giro programmato e' dietro l'angolo si lascia stare: fra
// poco ci pensa lui. Finestra STRETTA apposta — con un giro su tre che salta,
// aspettare il prossimo e' una scommessa, non una certezza.
const PROSSIMO_MIN = 20;

// Tetto per giro. Se ne mancano piu' di cosi' non e' un giro perso, e'
// GitHub giu': ri-lanciarne venti insieme non aiuta nessuno.
// Regolabile da fuori perche' altrimenti non si prova: nella pratica le due
// tarature qui sopra trattengono quasi tutto e a questo ramo non ci si arriva
// mai — cioe' resterebbe codice mai visto girare.
const MAX_LANCI = Number(process.env.MAX_LANCI || 8);

// Le fonti che dichiarano un ritardo loro: per queste «ieri» non esiste mai.
// ⚠️ ARSO pubblica con ~34 ore di scarto (vedi CLAUDE.md, scheda Slovenia):
// senza questa riga il guardiano la troverebbe in ritardo TUTTE le mattine.
const RITARDO_DICHIARATO = { slovenia: 2 };

// I riepiloghi delle pagine regione: il sito cade sul ripiego (20-40
// richieste invece di una) quando superano le 36 ore. Si interviene prima.
const RIEPILOGHI_ORE = 30;
const WF_RIEPILOGHI = 'riepiloghi.yml';

/* ── Date, in ora italiana ──────────────────────────────────────── */

// ⚠️ I runner girano in UTC e il progetto ragiona sul giorno solare
// ITALIANO. Si usa Intl invece di sommare a mano le ore dell'ora legale:
// non ha casi limite a fine marzo e fine ottobre.
const FMT_IT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
});
const giornoIT = (d) => FMT_IT.format(d);

// ⚠️ IL GIORNO SI CONTA DA `adesso`, NON DA `Date.now()` (raddrizzato il
// 22/9/2026). Prima l'ora finta di `ORA=` spostava il conto dei cron ma NON il
// giorno atteso: simulando il 20 settembre il guardiano cercava comunque il
// file del 21, cioe' la simulazione rispondeva su un'altra giornata. In
// produzione non cambiava niente — li' `adesso` e' adesso — ma rendeva
// inservibile proprio l'attrezzo con cui si provano le tarature.
function giorniFa(adesso, n) {
  const d = new Date(adesso.getTime() - n * 24 * 3600 * 1000);
  return giornoIT(d);
}

/* ── I cron, letti dai .yml ─────────────────────────────────────── */

// Restituisce gli orari programmati (ora, minuto) in UTC di un workflow.
// ⚠️ Si saltano le righe commentate: nei .yml del progetto ci sono cron
// spenti lasciati li' per memoria (ticino.yml, i piloti nel repo di test).
function cronDi(wf) {
  const p = path.join(WF_DIR, wf);
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const riga of fs.readFileSync(p, 'utf8').split('\n')) {
    if (riga.trim().startsWith('#')) continue;
    const m = riga.match(/^\s*-\s*cron:\s*['"]([^'"]+)/);
    if (!m) continue;
    const [mi, hh] = m[1].split(/\s+/);
    const ore = hh === '*' ? [...Array(24).keys()] : hh.split(',').map(Number);
    for (const h of ore) out.push({ h, mi: Number(mi) });
  }
  return out;
}

// Da quanti minuti e' passato l'ultimo giro programmato, e fra quanti arriva
// il prossimo. Null se il workflow non ha cron (solo a mano).
function quandoGirava(wf, adesso) {
  const cron = cronDi(wf);
  if (!cron.length) return null;
  let ultimo = Infinity, prossimo = Infinity;
  for (const c of cron) {
    for (const g of [-1, 0, 1]) {
      const t = new Date(adesso);
      t.setUTCDate(t.getUTCDate() + g);
      t.setUTCHours(c.h, c.mi, 0, 0);
      const dm = (adesso - t) / 60000;
      if (dm >= 0 && dm < ultimo) ultimo = dm;
      if (dm < 0 && -dm < prossimo) prossimo = -dm;
    }
  }
  return { daUltimo: ultimo, alProssimo: prossimo };
}

/* ── Il controllo ───────────────────────────────────────────────── */

// Quanti giorni di fila mancano, contando all'indietro da `giorno`. 0 = c'e'.
// ⚠️ Serve a distinguere le due cose che il guardiano confondeva: un giro
// ARRIVATO TARDI (buco di 1, e fra poco il file compare) da un GUASTO (buco di
// 2 o piu', e aspettare non serve a niente). Il tetto di 5 e' li' perche' una
// cartella nuova, o appena ripulita dalla retention, non deve far sembrare
// eterno un buco che non c'e' mai stato.
const BUCO_MAX = 5;
function quantiMancano(dir, giorno) {
  const cartella = path.join(DATA, dir);
  if (!fs.existsSync(cartella)) return 0;   // non e' una cartella di giorni: non e' compito mio
  let n = 0;
  const d = new Date(giorno + 'T12:00:00Z');
  while (n < BUCO_MAX) {
    const g = d.toISOString().slice(0, 10);
    if (fs.existsSync(path.join(cartella, `${g}.json`))) break;
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

function controllaCartelle(adesso) {
  const atteso = process.env.GIORNO || null;
  // SIMULA=liguria,emilia finge che a quelle cartelle manchi il giorno, senza
  // toccare un file. Serve a provare il ramo che scatta: un guardiano che non
  // si e' mai visto agire non si sa se agisce. Stessa idea del SIMULA di
  // check-fonti.js.
  const finti = new Set((process.env.SIMULA || '').split(',').map(s => s.trim()).filter(Boolean));
  // SIMULA_BUCO=3 finge che il buco sia di tre giorni e non di uno: serve a
  // provare il ramo del GUASTO, quello che il margine non deve piu' zittire.
  const bucoFinto = Number(process.env.SIMULA_BUCO || 1);
  if (finti.size) console.log(`SIMULA: fingo che manchi il giorno a ${[...finti].join(', ')}` +
                              (bucoFinto > 1 ? ` (buco di ${bucoFinto} giorni)` : '') + '\n');

  const inRitardo = [];
  // ⚠️ TUTTO QUELLO CHE MANCA, anche se poi si decide di non fare niente.
  // Prima le tarature spegnevano insieme l'azione E l'osservazione, e il
  // registro scriveva `inRitardo: []` mentre undici cartelle erano ferme da due
  // giorni (MeteoHub, 19-20/9/2026: buco visto solo il giorno dopo, e per caso).
  // Un registro che dice «nessuno in ritardo» quando qualcuno lo e' non e' una
  // misura mancata: e' una misura che mente.
  const visti = [];
  for (const r of REGIONI) {
    // Di norma si aspetta IERI; per chi dichiara un ritardo suo, il giorno
    // che quel ritardo consente (Slovenia: 2 = l'altro ieri).
    const giorno = atteso || giorniFa(adesso, RITARDO_DICHIARATO[r.dir] || 1);
    const file = path.join(DATA, r.dir, `${giorno}.json`);
    if (!finti.has(r.dir) && fs.existsSync(file)) continue;

    const t = quandoGirava(r.wf, adesso);
    // ⚠️ Quando si simula, si DICE perche' si e' deciso di non fare niente:
    // un «tutto a posto» in risposta a una simulazione sembra un difetto del
    // guardiano e invece e' quasi sempre una taratura che lavora.
    const spiega = (perche) => {
      if (finti.has(r.dir)) console.log(`   ${r.dir}: non lo lancio — ${perche}`);
    };
    const buco = finti.has(r.dir) ? bucoFinto : quantiMancano(r.dir, giorno);
    if (!t) { spiega(`${r.wf} non ha cron, non e' compito mio`); continue; }

    const base = {
      dir: r.dir, nome: r.nome, wf: r.wf, giorno, buco,
      daUltimo: Math.round(t.daUltimo), alProssimo: Math.round(t.alProssimo),
    };
    visti.push(base);

    /* ⚠️ LE TARATURE VALGONO SOLO SUL BUCO DI UN GIORNO (22/9/2026).
       Margine e «ci pensa il prossimo» servono a non ri-lanciare chi sta solo
       arrivando tardi: e' un'ipotesi ragionevole quando manca IERI e basta.
       Quando mancano due giorni o piu' quell'ipotesi e' gia' stata smentita
       dai fatti — il giro dopo c'e' stato e non ha portato niente — e
       aspettarne un altro e' solo tempo perso.
       Il caso che l'ha insegnato: MeteoHub fermo al 17/9, con i file del 18,
       19 e 20 comparsi tutti insieme il 21 alle 10:07. Undici regioni, cinque
       run verdi al giorno, e il guardiano zitto perche' i suoi tre giri
       cadevano tutti entro 150' dal cron MeteoHub delle 11:50 UTC. Rifatto il
       conto sugli ultimi venti giri: lo saltava 14 volte su 20. Il 20/9 il
       terzo giro ha mancato la soglia per SETTE MINUTI. */
    const guasto = buco >= 2;
    if (!guasto && t.daUltimo < MARGINE_MIN) {
      spiega(`l'ultimo giro e' di ${Math.round(t.daUltimo)}' fa, sotto il margine di ${MARGINE_MIN}'`);
      continue;
    }
    if (!guasto && t.alProssimo < PROSSIMO_MIN) {
      spiega(`il prossimo giro e' fra ${Math.round(t.alProssimo)}', ci pensa lui`);
      continue;
    }

    inRitardo.push(base);
  }
  return { inRitardo, visti };
}

// I riepiloghi non sono una cartella di dati come le altre: si guarda il
// campo `generato`, non l'esistenza di un file. ⚠️ La freschezza si misura su
// QUELLO e non sull'ultimo giorno contenuto: Slovenia e Puglia possono essere
// legittimamente indietro e un riepilogo sanissimo sembrerebbe vecchio.
function controllaRiepiloghi(adesso) {
  const d = path.join(DATA, 'riepiloghi');
  if (!fs.existsSync(d)) return null;
  let piuVecchio = null;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { continue; }
    if (!j.generato) continue;
    const ore = (adesso - new Date(j.generato)) / 3600000;
    if (piuVecchio === null || ore > piuVecchio.ore) piuVecchio = { file: f, ore };
  }
  if (!piuVecchio || piuVecchio.ore < RIEPILOGHI_ORE) return null;
  const t = quandoGirava(WF_RIEPILOGHI, adesso);
  if (t && t.alProssimo < PROSSIMO_MIN) return null;
  return { wf: WF_RIEPILOGHI, ore: Math.round(piuVecchio.ore), file: piuVecchio.file };
}

/* ── Il lancio ──────────────────────────────────────────────────── */

function lancia(wf) {
  // `gh` c'e' sempre sui runner; serve permissions: actions: write e GH_TOKEN.
  // ⚠️ workflow_dispatch e' l'ECCEZIONE documentata alla regola «gli eventi
  // innescati dal GITHUB_TOKEN non creano nuovi run»: qui il run nasce.
  execFileSync('gh', ['workflow', 'run', wf], { stdio: 'pipe', cwd: RADICE });
}

function main() {
  // ORA=2026-08-28T09:00:00Z finge un altro momento: serve a provare le
  // tarature (margine, tetto) senza aspettare l'ora giusta del giorno.
  const adesso = process.env.ORA ? new Date(process.env.ORA) : new Date();
  console.log(`Guardiano — ${adesso.toISOString()}  (giorno italiano ${giornoIT(adesso)})`);
  console.log(`margine ${MARGINE_MIN}'  ·  prossimo ${PROSSIMO_MIN}'  ·  tetto ${MAX_LANCI}`);
  console.log(LANCIA ? 'modo: LANCIA' : 'modo: guardo e basta (LANCIA=1 per agire)');
  console.log('');

  const { inRitardo: ritardo, visti } = controllaCartelle(adesso);
  const riep = controllaRiepiloghi(adesso);

  // Si DICE sempre cosa manca, anche quello su cui non si agisce: e' la riga
  // che sarebbe servita il 19 e il 20 settembre.
  const zitti = visti.filter(v => !ritardo.some(r => r.dir === v.dir));
  if (zitti.length) {
    console.log('cartelle senza il giorno, su cui NON agisco:');
    for (const v of zitti) {
      console.log(`   ${v.dir}: manca ${v.giorno} (buco ${v.buco} g), ` +
                  `ultimo giro ${v.daUltimo}' fa, prossimo fra ${v.alProssimo}'`);
    }
    console.log('');
  }

  if (!ritardo.length && !riep) {
    console.log(visti.length
      ? '✅ Niente da ri-lanciare: quello che manca sta dentro le tarature.'
      : '✅ Tutte le cartelle hanno il giorno che devono avere.');
    aggiornaRegistro(adesso, [], [], visti);
    return;
  }

  for (const r of ritardo) {
    console.log(`⏳ ${r.nome} (${r.dir}): manca ${r.giorno}` +
                (r.buco >= 2 ? ` e i ${r.buco - 1} giorni prima — GUASTO, non ritardo` : '') +
                `. ${r.wf}, ultimo giro ${r.daUltimo}' fa, prossimo fra ${r.alProssimo}'`);
  }
  if (riep) console.log(`⏳ Riepiloghi vecchi di ${riep.ore} h (${riep.file})`);

  // Dedup per workflow: le 13 cartelle francesi e le 11 di MeteoHub sono un
  // lancio solo. Senza questo, una piattaforma giu' produrrebbe 13 dispatch.
  const daLanciare = [...new Set(ritardo.map(r => r.wf).concat(riep ? [riep.wf] : []))];

  console.log('');
  if (daLanciare.length > MAX_LANCI) {
    console.log(`⚠️ ${daLanciare.length} workflow in ritardo: sopra il tetto di ${MAX_LANCI}. ` +
                `Non e' un giro perso, e' GitHub giu': non lancio niente.`);
    aggiornaRegistro(adesso, ritardo, [], visti);
    return;
  }

  const lanciati = [];
  for (const wf of daLanciare) {
    if (!LANCIA) { console.log(`   (lancerei ${wf})`); continue; }
    try { lancia(wf); lanciati.push(wf); console.log(`🚀 lanciato ${wf}`); }
    catch (e) { console.log(`❌ ${wf}: ${String(e.message).split('\n')[0]}`); }
  }
  aggiornaRegistro(adesso, ritardo, lanciati, visti);
}

// Il registro serve a due cose: non ripetersi all'infinito su una fonte morta,
// e soprattutto MISURARE quanto spesso capita, che era la domanda di partenza.
// Nessuna chiamata di rete: il conto si fa sui nostri stessi dati.
function aggiornaRegistro(adesso, ritardo, lanciati, visti = []) {
  // ⚠️ UNA SIMULAZIONE NON TOCCA IL REGISTRO. Stessa regola del SIMULA di
  // check-fonti.js, e non e' pignoleria: il registro serve a misurare quanto
  // spesso capita davvero, e una prova che ci scrive dentro gonfia proprio il
  // numero per cui esiste. Successo alla prima prova sul serio, il 28/8: il
  // giro di collaudo aveva registrato la Liguria «in ritardo».
  // ⚠️ ANCHE `ORA=` E' UNA SIMULAZIONE (22/9/2026). Un giro a un'ora finta non
  // e' un giro accaduto, e il registro serve a misurare quanto spesso le cose
  // accadono DAVVERO: scriverci dentro gonfia proprio il numero per cui esiste.
  // Stessa ragione del SIMULA qui sotto, e me ne sono accorto sporcando
  // `data/guardiano.json` con una prova in locale.
  // ⚠️ Resta un caso scoperto: un giro in locale SENZA `ORA` ne' `SIMULA`
  // scrive, ed e' giusto cosi' (sul runner e' esattamente quel caso). In
  // locale, dopo, si rimette il file com'era.
  if (process.env.SIMULA || process.env.ORA) {
    console.log('\nregistro: non toccato (e\' una simulazione)');
    return;
  }
  let reg = { giri: [] };
  if (fs.existsSync(REGISTRO)) {
    try { reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch (e) {}
  }
  if (!Array.isArray(reg.giri)) reg.giri = [];
  reg.giri.push({
    quando: adesso.toISOString(),
    inRitardo: ritardo.map(r => r.dir),
    lanciati,
    // ⚠️ `mancanti` E' LA MISURA VERA, `inRitardo` e' solo quello su cui si e'
    // agito. Tenerle separate e' il punto di tutta la modifica del 22/9/2026:
    // finche' c'era solo la seconda, un buco che le tarature lasciavano stare
    // era indistinguibile dal non avere buchi.
    mancanti: visti.map(v => ({ dir: v.dir, giorno: v.giorno, buco: v.buco })),
  });
  reg.giri = reg.giri.slice(-120);          // ~40 giorni con tre giri al giorno
  reg.aggiornato = adesso.toISOString();

  const conMancanze = reg.giri.filter(g => g.inRitardo.length).length;
  const conBuchi = reg.giri.filter(g => (g.mancanti || []).length).length;
  const guasti = reg.giri.filter(g => (g.mancanti || []).some(m => m.buco >= 2)).length;
  reg.riassunto = `${conMancanze} giri con qualcosa ri-lanciato su ${reg.giri.length}` +
                  ` · ${conBuchi} con qualche giorno mancante · ${guasti} con un buco di 2+ giorni`;
  fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 2));
  console.log(`\nregistro: ${reg.riassunto}`);
}

if (require.main === module) main();
