/**
 * analizza-buchi-meteohub.js — quanto è affidabile MeteoHub, in numeri.
 *
 * DA LANCIARE A MANO (non è in nessun workflow):
 *     node .github/scripts/analizza-buchi-meteohub.js
 *     GIORNI=45 node .github/scripts/analizza-buchi-meteohub.js
 *
 * PERCHÉ ESISTE (4 agosto 2026). La decisione su MeteoHub — tenerlo per il
 * centro-sud, e quando far uscire quelle regioni dal beta — è appesa a UNA
 * metrica: la FREQUENZA degli eventi-buco, non la percentuale di giorni persi
 * (con un solo blackout su dieci giorni la percentuale dice "20% perso" e non
 * distingue il caso raro dal cronico). Fino a oggi quella frequenza è stata
 * valutata leggendo il registro a occhio e contando a mente: va bene per
 * accorgersi che qualcosa non torna, non per decidere su dieci regioni.
 *
 * Legge `data/meteohub-gaps.json`, che è la memoria buona: registra i giorni
 * rotti PRIMA che la copertura Open-Meteo li renda invisibili.
 *
 * Cosa guardare nell'output:
 *  - "eventi per settimana" in crescita = la piattaforma sta peggiorando;
 *  - "distanza fra eventi" che si accorcia = stessa cosa, vista da vicino;
 *  - "% giorni finiti a stime" per rete = quanto quella regione è davvero
 *    coperta da dati reali. È il numero da guardare prima di togliere il beta;
 *  - reti con eventi recenti e ravvicinati = candidate a una fonte diretta di
 *    riserva (come si è fatto per Valle d'Aosta e Friuli).
 */

const fs = require('fs');
const path = require('path');

const REGISTRO = path.join(__dirname, '..', '..', 'data', 'meteohub-gaps.json');
const GIORNI = parseInt(process.env.GIORNI || '30', 10);

// Il sorvegliante è entrato in funzione il 29/7/2026, e al primo giro ha
// scansionato all'indietro la sua finestra di 10 giorni: la copertura vera
// parte quindi dal 19/7. PRIMA di quella data il registro è vuoto non perché
// andasse tutto bene, ma perché nessuno guardava — il blackout del 16-17
// luglio, per dire, non c'è. Senza questo promemoria le settimane a zero si
// leggono come un miglioramento che non è mai avvenuto.
const SORVEGLIANZA_DA = '2026-07-19';
const SORVEGLIANTE_ACCESO = '2026-07-29';   // data di attivazione, per il messaggio

const oggi = new Date();
const iso = d => d.toISOString().slice(0, 10);
const giorniFra = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

function main() {
  if (!fs.existsSync(REGISTRO)) { console.error('Registro non trovato: ' + REGISTRO); process.exit(1); }
  const reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));
  const tutti = (reg.eventi || []).slice().sort((a, b) => a.data < b.data ? -1 : 1);
  if (!tutti.length) { console.log('Nessun evento registrato.'); return; }

  const daData = iso(new Date(oggi.getTime() - GIORNI * 86400000));
  const ev = tutti.filter(e => e.data >= daData);

  const inizioUtile = daData < SORVEGLIANZA_DA ? SORVEGLIANZA_DA : daData;
  const giorniUtili = giorniFra(inizioUtile, iso(oggi));
  console.log('=== Buchi MeteoHub — ultimi ' + GIORNI + ' giorni (dal ' + daData + ') ===');
  console.log('Registro: ' + tutti.length + ' eventi in tutto, ' + ev.length + ' nella finestra.');
  console.log('Primo evento mai registrato: ' + tutti[0].data);
  if (daData < SORVEGLIANZA_DA) {
    console.log('\n⚠️  ATTENZIONE ALLA LETTURA: il sorvegliante è stato acceso il ' + SORVEGLIANTE_ACCESO +
      ' e ha\n    guardato indietro 10 giorni, quindi il registro copre dal ' + SORVEGLIANZA_DA + '. Prima\n' +
      '    è vuoto perché nessuno guardava, NON perché non ci fossero buchi: il blackout\n' +
      '    del 16-17 luglio, per esempio, non è registrato.\n' +
      '    Giorni di osservazione veri: ' + giorniUtili + ', non ' + GIORNI + '.');
  }
  console.log('');

  // ── 1. andamento settimanale (tutte le reti insieme) ──
  console.log('ANDAMENTO (la piattaforma nel suo insieme)');
  const settimane = {};
  ev.forEach(e => {
    const s = Math.floor(giorniFra(e.data, iso(oggi)) / 7);   // 0 = ultimi 7 giorni
    settimane[s] = settimane[s] || { n: 0, reti: new Set() };
    settimane[s].n++;
    settimane[s].reti.add(e.rete);
  });
  const maxSet = Math.floor(GIORNI / 7);
  for (let s = maxSet; s >= 0; s--) {
    const d = settimane[s] || { n: 0, reti: new Set() };
    const et = s === 0 ? 'ultimi 7 giorni' : (s + 1) + '^ settimana fa';
    // settimane precedenti all'accensione del sorvegliante: cieche, non pulite
    const finestraFine = iso(new Date(oggi.getTime() - s * 7 * 86400000));
    const cieca = finestraFine < SORVEGLIANZA_DA && d.n === 0;
    console.log('  ' + et.padEnd(20) + String(d.n).padStart(3) + ' eventi  ' +
      (cieca ? '(nessuna sorveglianza)' : '█'.repeat(Math.min(d.n, 40)) +
      (d.reti.size ? '  (' + d.reti.size + ' reti)' : '')));
  }

  // ── 2. distanza fra un evento e l'altro (giorni distinti con almeno un evento) ──
  const giorniConEventi = [...new Set(ev.map(e => e.data))].sort();
  if (giorniConEventi.length > 1) {
    const dist = [];
    for (let i = 1; i < giorniConEventi.length; i++) dist.push(giorniFra(giorniConEventi[i - 1], giorniConEventi[i]));
    const media = dist.reduce((a, b) => a + b, 0) / dist.length;
    console.log('\n  giorni distinti con eventi: ' + giorniConEventi.length + ' su ' + GIORNI);
    console.log('  distanza media fra un evento e l\'altro: ' + media.toFixed(1) + ' giorni' +
      (media < 2 ? '  ⚠️ quasi quotidiano' : media < 4 ? '  ⚠️ ravvicinati' : ''));
    console.log('  ultimo evento: ' + giorniConEventi[giorniConEventi.length - 1] +
      ' (' + giorniFra(giorniConEventi[giorniConEventi.length - 1], iso(oggi)) + ' giorni fa)');
  }

  // ── 3. rete per rete ──
  console.log('\nRETE PER RETE (nella finestra)');
  console.log('  rete            eventi  mancanti  parziali  a stime  risolti  aperti  ultimo');
  const reti = {};
  ev.forEach(e => {
    const r = reti[e.rete] = reti[e.rete] || { n: 0, mancanti: 0, parziali: 0, stime: 0, risolti: 0, aperti: 0, ultimo: '' };
    r.n++;
    if (e.tipo === 'mancante') r.mancanti++; else r.parziali++;
    if (String(e.stato).indexOf('coperto') === 0) r.stime++;
    else if (String(e.stato).indexOf('risolto') === 0) r.risolti++;
    else r.aperti++;
    if (e.data > r.ultimo) r.ultimo = e.data;
  });
  const ordinate = Object.entries(reti).sort((a, b) => b[1].n - a[1].n);
  ordinate.forEach(([nome, r]) => {
    console.log('  ' + nome.padEnd(16) + String(r.n).padStart(5) + String(r.mancanti).padStart(9) +
      String(r.parziali).padStart(10) + String(r.stime).padStart(9) + String(r.risolti).padStart(9) +
      String(r.aperti).padStart(8) + '  ' + r.ultimo);
  });

  // ── 4. giudizio sintetico ──
  console.log('\nGIUDIZIO (soglie: >=4 eventi = problematica, 2-3 = da sorvegliare)');
  const problematiche = [], sorvegliare = [], ok = [];
  ordinate.forEach(([nome, r]) => {
    if (r.n >= 4) problematiche.push(nome + ' (' + r.n + ')');
    else if (r.n >= 2) sorvegliare.push(nome + ' (' + r.n + ')');
    else ok.push(nome);
  });
  console.log('  problematiche:  ' + (problematiche.join(', ') || '—'));
  console.log('  da sorvegliare: ' + (sorvegliare.join(', ') || '—'));
  console.log('  un solo evento: ' + (ok.join(', ') || '—'));
  const senzaEventi = ['marche','umbria','lazio','molise','campania','puglia','basilicata','calabria','sicilia','sardegna']
    .filter(r => !reti[r]);
  console.log('  mai un evento:  ' + (senzaEventi.join(', ') || '—'));
  console.log('\n  Nota: "a stime" = giorni in cui la mappa mostra Open-Meteo al posto del dato reale.');
}

main();
