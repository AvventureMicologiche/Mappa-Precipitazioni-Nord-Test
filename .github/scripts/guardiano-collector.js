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
// ⚠️ AL MATTINO IL MARGINE E' CORTO (5/10/2026). Il margine lungo e' nato per i giri
// che GitHub fa partire IN RITARDO; ma nelle notti storte GitHub i giri li SALTA, e
// aspettare 2h30 un giro che non arrivera' voleva dire dati alle 7 o alle 9 invece che
// alle 6 (5/10: MeteoHub e Svizzera saltati alle 4:20, il guardiano delle 6:00 e delle
// 6:30 li ha lasciati stare). Dalle 5 alle 9 italiane chi si alza per andare a funghi
// deve trovare ieri: si ri-lancia dopo 30'. Doppioni non ce ne sono: dal 5/10 ogni
// collector ha `concurrency` e un secondo giro aspetta in fila che il primo finisca.
const MARGINE_MATTINO_MIN = 30;
const margineAdesso = (adesso) => (oraIT(adesso) >= 5 && oraIT(adesso) < 9) ? MARGINE_MATTINO_MIN : MARGINE_MIN;

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

// ⚠️ UNA FONTE FERMA NON SI RILANCIA ALL'INFINITO (25/10/2026). Il guardiano passa fino a nove volte al
// giorno e una fonte morta veniva rilanciata a ogni passaggio, riepiloghi compresi: il 25/10 il Ticino (OASI
// giu' dal 21/10, irraggiungibile anche dal PC) quattro volte fra le 6 e le 7:30, e i riepiloghi ogni ora.
// Regola sua: tre tentativi al mattino, uno dalle 17, poi niente fino al giorno dopo. Non si perde niente: i
// giri normali del collector restano tutti (il Ticino ne ha uno verso le 17:30), e se la fonte torna i dati
// arrivano da li'. Il conto si fa sul registro, in ora italiana. I riepiloghi hanno la loro regola, qui no.
const TENTATIVI_MATTINA = 3;
const ORA_SERA = 17;
const TENTATIVI_SERA = 1;

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
const oraIT = (d) => Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23',
}).format(d));

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

    /* ⚠️ IL BUCO DI UNA CARTELLA SOLA NON E' UN GIRO PERSO (28/10/2026).
       Un workflow che scrive piu' cartelle (MeteoHub 11, Francia 13) e' girato
       se le sue ALTRE cartelle hanno il giorno: allora quella che manca manca
       alla fonte, e ri-lanciarlo rifa' le stesse richieste per niente. Il caso:
       MeteoHub Puglia, una stazione al giorno dal 26/10 (guasto a monte), con
       meteohub.yml ri-lanciato tre volte al mattino e una la sera, e dietro
       ogni volta i riepiloghi. Servono PIU' della meta' delle sorelle: con
       meta' o piu' ferme e' la piattaforma o il giro (MeteoHub dal 17 al 21/9),
       e li' si ri-lancia come prima. Il buco resta in `visti`, quindi nel
       registro, e check-fonti.js suona lo stesso. */
    const sorelle = REGIONI.filter(s => s.wf === r.wf && s.dir !== r.dir);
    const conGiorno = sorelle.filter(s => !finti.has(s.dir) &&
                                          fs.existsSync(path.join(DATA, s.dir, `${giorno}.json`))).length;
    if (sorelle.length && conGiorno * 2 > sorelle.length) {
      base.fonte = `${conGiorno} cartelle su ${sorelle.length} di ${r.wf} hanno il ${giorno}: il giro c'e' stato, manca alla fonte`;
      spiega(base.fonte);
      continue;
    }

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
    const margine = margineAdesso(adesso);
    if (!guasto && t.daUltimo < margine) {
      spiega(`l'ultimo giro e' di ${Math.round(t.daUltimo)}' fa, sotto il margine di ${margine}'`);
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
  if (piuVecchio && piuVecchio.ore >= RIEPILOGHI_ORE) {
    const t = quandoGirava(WF_RIEPILOGHI, adesso);
    if (!(t && t.alProssimo < PROSSIMO_MIN))
      return { wf: WF_RIEPILOGHI, motivo: `vecchi di ${Math.round(piuVecchio.ore)} h (${piuVecchio.file})` };
  }

  /* ⚠️ LE 30 ORE NON BASTANO DOPO UNA NOTTE SALTATA (4/10/2026). Il 3->4/10
     GitHub non ha fatto partire niente dalle 22:13 UTC: alle 6 i riepiloghi
     del giorno prima avevano ~19 ore, «freschi» per la regola qui sopra, e
     pagine regione e temperature di ieri restavano su altroieri fino al
     pomeriggio. Da qui due regole in piu', che non aspettano il prossimo cron
     (aspettarlo e' proprio la scommessa che si perde) e non costano niente:
     un riepilogo rifatto senza novita' non riscrive nulla.
     1) Dalle 6 italiane il file delle temperature deve avere IERI: se no, si
        rilancia. E' il segnale che il giro del mattino non c'e' stato.
     2) Se il giro precedente del guardiano (entro due ore) ha ri-lanciato
        dei collector, si rilancia: i riepiloghi devono contenere anche i
        dati arrivati nel frattempo. Mai due giri di fila: se il precedente
        ha gia' rilanciato i riepiloghi si salta (la Slovenia, ri-lanciata a
        ogni giro finche' ARSO non pubblica, li rifarebbe ogni mezz'ora). */
  if (oraIT(adesso) >= 6) {
    let g = null;
    try { g = JSON.parse(fs.readFileSync(path.join(DATA, 'temperature-ieri.json'), 'utf8')).giorno; } catch (e) {}
    const ieri = giorniFa(adesso, 1);
    if (g !== ieri) return { wf: WF_RIEPILOGHI, motivo: `temperature-ieri ha ${g || 'niente'} invece di ${ieri}` };
  }
  const prec = ultimoGiro();
  const daPrec = prec ? (adesso - new Date(prec.quando)) / 60000 : -1;
  if (daPrec >= 0 && daPrec <= 120
      && !(prec.lanciati || []).includes(WF_RIEPILOGHI)
      && (prec.lanciati || []).some(wf => wf !== WF_RIEPILOGHI))
    return { wf: WF_RIEPILOGHI, motivo: `il giro delle ${prec.quando.slice(11, 16)} UTC ha ri-lanciato ${prec.lanciati.join(', ')}` };
  return null;
}

// Quante volte un workflow e' gia' stato rilanciato OGGI (giorno italiano), prima e dopo le 17. Si contano
// solo i giri fino ad `adesso`: con ORA= si prova anche un momento gia' passato.
function tentativiOggi(wf, adesso) {
  let giri = [];
  try { giri = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')).giri || []; } catch (e) { /* registro nuovo */ }
  const oggi = giornoIT(adesso);
  const conto = { mattina: 0, sera: 0 };
  for (const g of giri) {
    const q = new Date(g.quando);
    if (!(q <= adesso) || giornoIT(q) !== oggi || !(g.lanciati || []).includes(wf)) continue;
    conto[oraIT(q) >= ORA_SERA ? 'sera' : 'mattina']++;
  }
  return conto;
}

// null = si puo' lanciare; se no, il perche' da scrivere nel log.
function fermoPerOggi(wf, adesso) {
  if (wf === WF_RIEPILOGHI) return null;
  const t = tentativiOggi(wf, adesso);
  if (oraIT(adesso) < ORA_SERA)
    return t.mattina >= TENTATIVI_MATTINA ? `gia' rilanciato ${t.mattina} volte stamattina, riprovo dalle ${ORA_SERA}` : null;
  return t.sera >= TENTATIVI_SERA ? `gia' rilanciato dopo le ${ORA_SERA}, riprovo domani` : null;
}

function ultimoGiro() {
  try { const r = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); return (r.giri || []).slice(-1)[0] || null; }
  catch (e) { return null; }
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
  console.log(`margine ${margineAdesso(adesso)}'  ·  prossimo ${PROSSIMO_MIN}'  ·  tetto ${MAX_LANCI}`);
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
                  (v.fonte ? v.fonte : `ultimo giro ${v.daUltimo}' fa, prossimo fra ${v.alProssimo}'`));
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
  if (riep) console.log(`⏳ Riepiloghi: ${riep.motivo}`);

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

  // Le fonti ferme: tre tentativi al mattino, uno dalle 17, poi basta fino a domani (vedi TENTATIVI_MATTINA).
  const fermi = daLanciare.map(wf => [wf, fermoPerOggi(wf, adesso)]).filter(([, perche]) => perche);
  for (const [wf, perche] of fermi) console.log(`⏸ ${wf}: ${perche}`);
  const daProvare = daLanciare.filter(wf => !fermi.some(([f]) => f === wf));

  const lanciati = [];
  for (const wf of daProvare) {
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
