/**
 * I LUOGHI PER LA RICERCA DELLE FRAZIONI  (25/10/2026)
 * ====================================================
 *
 * Al posto di Open-Meteo Geocoding (il piano gratuito di Open-Meteo vieta i siti con pubblicita' o abbonamenti:
 * deciso il 25/10/2026 di toglierlo dal sito, un pezzo alla volta). Open-Meteo quei nomi li prendeva da GeoNames:
 * li prendiamo da li' direttamente. GeoNames e' CC BY 4.0, uso commerciale permesso con la citazione.
 *
 * Legge i file per paese di GeoNames (IT, CH, AT, FR, SI: i paesi che la mappa disegna) e scrive `luoghi/<xx>.tsv`,
 * un file per le prime due lettere del nome normalizzato. Li legge la Function /api/cerca, che risponde nella stessa
 * forma di Open-Meteo, cosi' le caselle di ricerca restano com'erano.
 *
 * Si tengono i posti abitati (classe P) e i passi (T.PASS): sono quello che Open-Meteo restituiva (Viozene,
 * Prato Nevoso, Passo del Tonale, Monesi, Zermatt). I nomi alternativi (Ginevra, Bozen, Lubiana) solo per i posti
 * sopra i 1.000 abitanti e solo in lettere latine: per i paesini sono quasi tutti traslitterazioni, e gonfierebbero i file.
 *
 * Una riga per ogni nome (principale o alternativo) che porta al posto:
 *   chiave  principale(1/0)  id  nome  lat  lon  paese  regione  id-regione  provincia  abitanti  tipo  quota
 * ordinate per chiave. La chiave e' il nome normalizzato come fa il sito (locNormalizza in index.html).
 *
 * Si rifa' un paio di volte l'anno, scaricando i file nuovi da https://download.geonames.org/export/dump/:
 *   node .github/scripts/genera-luoghi.js <cartella con IT.txt CH.txt AT.txt FR.txt SI.txt admin1CodesASCII.txt admin2Codes.txt>
 */
const fs = require('fs');
const path = require('path');

const DENTRO = process.argv[2];
if (!DENTRO) { console.error('uso: node genera-luoghi.js <cartella dei file GeoNames>'); process.exit(1); }
const FUORI = path.join(__dirname, '..', '..', 'luoghi');
const PAESI = ['IT', 'CH', 'AT', 'FR', 'SI'];

// le regioni italiane coi nomi che si aspettano le caselle del sito (GEO_REGIONI): GeoNames le ha in inglese
const REGIONI_IT = {
  '01': 'Abruzzo', '02': 'Basilicata', '03': 'Calabria', '04': 'Campania', '05': 'Emilia-Romagna',
  '06': 'Friuli Venezia Giulia', '07': 'Lazio', '08': 'Liguria', '09': 'Lombardia', '10': 'Marche', '11': 'Molise',
  '12': 'Piemonte', '13': 'Puglia', '14': 'Sardegna', '15': 'Sicilia', '16': 'Toscana', '17': 'Trentino-Alto Adige',
  '18': 'Umbria', '19': "Valle d'Aosta", '20': 'Veneto',
};

// la stessa di locNormalizza in index.html: accenti via, apostrofi trattini e punti come spazi
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’\-.]/g, ' ').replace(/\s+/g, ' ').trim();
const LATINO = /^[\p{Script=Latin}\s'’.\-]+$/u;
// la provincia corta, come la scrivono le caselle dopo aver tolto «Provincia di» ecc.; quattro province GeoNames le
// ha in inglese («Province of Florence»)
const INGLESE = { Florence: 'Firenze', 'Roma Capitale': 'Roma' };
const corta = s => {
  const c = s.replace(/^(Provincia|Libero consorzio comunale|Citt[aà] metropolitana|Province of)( autonoma)? ?(di |dell'|della |del )?/i, '')
    .replace(/ - .*$/, '').trim();
  return INGLESE[c] || c;
};
const pulito = s => String(s).replace(/[\t\r\n]/g, ' ');

function leggi(f, riga) {
  for (const l of fs.readFileSync(path.join(DENTRO, f), 'utf8').split('\n')) if (l) riga(l.split('\t'));
}

/* ⚠️ I NOMI IN ITALIANO (25/10/2026, suo: «con ginevra si legge Geneva»). Open-Meteo rispondeva con language=it:
   Ginevra, Nizza, Lubiana, «Cantone di Ginevra», «Alta Savoia». Il nome principale di GeoNames e' quello locale o
   inglese; quelli per lingua stanno in alternatenames/<paese>.txt (stesso sito, stessa licenza). Si prende il nome
   «it» preferito, se no il primo «it», mai storici o colloquiali; vale per i posti e, fuori Italia, per le regioni e le
   province (in Italia le regioni restano quelle di REGIONI_IT, che le caselle riconoscono per nome). */
const IT = {};
for (const cc of PAESI) {
  const f = path.join(DENTRO, 'alternatenames', cc + '.txt');
  if (!fs.existsSync(f)) { console.warn('manca ' + f + ': nomi solo come in GeoNames'); continue; }
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const [, id, lingua, nome, preferito, , colloquiale, storico] = l.split('\t');
    if (lingua !== 'it' || !nome || colloquiale === '1' || storico === '1') continue;
    if (!IT[id] || (preferito === '1' && !IT[id].p)) IT[id] = { n: nome, p: preferito === '1' };
  }
}
const inItaliano = (id, nome) => (IT[id] && IT[id].n) || nome;

const a1 = {}, a2 = {};
leggi('admin1CodesASCII.txt', ([k, nome, , id]) => { a1[k] = { nome: inItaliano(id, nome), id: +id }; });
leggi('admin2Codes.txt', ([k, nome, , id]) => { a2[k] = inItaliano(id, nome); });

const per = {};   // prefisso -> righe
let posti = 0, chiavi = 0;
for (const cc of PAESI) {
  leggi(cc + '.txt', f => {
    const [id, nome, , alt, lat, lon, cls, fc, paese, , c1, c2, , , pop, elev, dem] = f;
    if (paese !== cc || !(cls === 'P' || fc === 'PASS')) return;
    const reg = cc === 'IT' ? REGIONI_IT[c1] || '' : (a1[cc + '.' + c1] || {}).nome || '';
    const regId = (a1[cc + '.' + c1] || {}).id || '';
    const prov = a2[cc + '.' + c1 + '.' + c2] ? corta(a2[cc + '.' + c1 + '.' + c2]) : '';
    const abitanti = +pop || 0;
    // la quota: quella dichiarata se c'e', se no il terreno (SRTM, colonna «dem»); le pagine meteo la passano alle previsioni
    const quota = elev !== '' && isFinite(+elev) ? Math.round(+elev) : dem !== '' && +dem > -9000 ? Math.round(+dem) : '';
    const mostra = inItaliano(id, nome);   // il nome che si legge: italiano se c'e' (Ginevra), se no quello di GeoNames
    const dati = [id, pulito(mostra), (+lat).toFixed(4), (+lon).toFixed(4), cc, pulito(reg), regId, pulito(prov), abitanti, fc, quota].join('\t');
    // ⚠️ i nomi alternativi NON in ordine di lingua: per Ginevra «Ginevra» e' il 17° in lettere latine. Con un tetto di 8
    // (prima prova del 25/10) Ginevra, Lubiana e Nizza non si trovavano piu'. Tetto 60, solo sopra i 1.000 abitanti.
    // Il nome italiano e quello di GeoNames contano tutti e due come «veri»: si trova Ginevra scrivendo anche «genev».
    const principale = norm(mostra), nomi = new Set([principale, norm(nome)]);
    if (abitanti >= 1000 && alt) {
      for (const a of alt.split(',')) {
        if (nomi.size > 60) break;
        if (a.length < 3 || a.length > 40 || !LATINO.test(a) || /^[A-Z]{2,4}$/.test(a)) continue;
        nomi.add(norm(a));
      }
    }
    posti++;
    for (const k of nomi) {
      if (k.length < 2) continue;
      const p = k.slice(0, 2);
      // la colonna dopo la chiave: 1 se e' il nome vero, 0 se alternativo (cosi' «san» da' prima San Remo che Saint-Denis)
      (per[p] = per[p] || []).push(k + '\t' + (k === principale || k === norm(nome) ? 1 : 0) + '\t' + dati);
      chiavi++;
    }
  });
}

/* ⚠️ I FILE GRANDI SI SPEZZANO (25/10/2026). Con le sole due lettere «sa» (San…, Saint-…), «le», «la», «ca» pesavano
   fra 1 e 1,5 MB, troppo per la Function a ogni lettera scritta. Un gruppo sopra LIMITE si divide sulla lettera dopo,
   e cosi' via; il gruppo diviso tiene un file «-cima» coi 30 posti piu' abitati, per chi ha scritto ancora poco (le
   prime righe che Open-Meteo mostrava erano comunque quelle, in ordine di abitanti). L'elenco dei gruppi divisi sta in
   luoghi/divisi.json: la Function scende finche' trova il file giusto. */
const LIMITE = 200 * 1024, CIMA = 30;
fs.rmSync(FUORI, { recursive: true, force: true });
fs.mkdirSync(FUORI, { recursive: true });
const divisi = [];
let byte = 0, file = 0, max = ['', 0];
function scrivi(nome, righe) {
  const testo = righe.join('\n') + '\n';
  fs.writeFileSync(path.join(FUORI, nome), testo, 'utf8');
  byte += Buffer.byteLength(testo); file++;
  if (testo.length > max[1]) max = [nome, testo.length];
}
function gruppo(p, righe) {
  const peso = righe.reduce((t, r) => t + r.length + 1, 0);
  if (peso <= LIMITE || p.length >= 12) { righe.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); return scrivi(nomeFile(p), righe); }
  divisi.push(p);
  // la cima: un posto una volta sola (col suo nome principale se c'e'), i piu' abitati prima
  const visti = new Set();
  const cima = righe.slice().sort((a, b) => +b.split('\t')[10] - +a.split('\t')[10]).filter(r => {
    const id = r.split('\t')[2]; if (visti.has(id)) return false; visti.add(id); return true; }).slice(0, CIMA);
  const figli = {};
  for (const r of righe) {
    const k = r.slice(0, r.indexOf('\t'));
    // i nomi lunghi esattamente quanto il prefisso («sa») restano nella cima, se no si perderebbero
    if (k.length <= p.length) { if (!cima.includes(r)) cima.push(r); }
    else (figli[k.slice(0, p.length + 1)] = figli[k.slice(0, p.length + 1)] || []).push(r);
  }
  scrivi(nomeFile(p).replace('.tsv', '-cima.tsv'), cima);
  for (const [f, rr] of Object.entries(figli)) gruppo(f, rr);
}
for (const [p, righe] of Object.entries(per)) gruppo(p, righe);
fs.writeFileSync(path.join(FUORI, 'divisi.json'), JSON.stringify(divisi.sort()) + '\n', 'utf8');
console.log(`${posti} posti, ${chiavi} nomi, ${file} file in luoghi/ (${divisi.length} gruppi divisi), ${(byte / 1048576).toFixed(1)} MB; il piu' grande ${max[0]} ${(max[1] / 1024).toFixed(0)} KB`);

// le prime lettere nel nome del file: lo spazio diventa «_», il resto che non e' lettera o cifra il suo codice.
// ⚠️ «con», «aux», «nul», «prn», «com1»… sono nomi RISERVATI di Windows (25/10/2026): `con.tsv` non si crea, e lo
// script scriveva il gruppo sulla console senza errori. Prendono una «~» davanti (la «_» e' gia' lo spazio); la Function fa lo stesso.
function nomeFile(p) {
  const n = [...p].map(c => /[a-z0-9]/.test(c) ? c : c === ' ' ? '_' : 'u' + c.codePointAt(0).toString(16)).join('');
  return (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(n) ? '~' + n : n) + '.tsv';
}
