/**
 * I commenti fuori dalle pagine generate (2/11/2026, scheda 112 quater).
 *
 * PERCHE' ESISTE. Il CSS e il JavaScript che i generatori mettono nelle pagine
 * portavano con se' tutti i loro commenti: circa 6 KB nel CSS e 14 KB nel
 * JavaScript per pagina, compressi 7-11 KB su 25-46, cioe' circa un quarto del
 * peso di una pagina di paese. Chi la apre non li vede, ma li scarica. I
 * commenti restano qui nei generatori, dove servono; nelle pagine no.
 *
 * ⚠️ SOLO NELLE PAGINE CHE NESSUNO USA COME MODELLO. Alcuni generatori copiano
 * lo <style> di una pagina gia' fatta e lo tagliano su un commento
 * ('/* ── IL METEO NELLE PAGINE REGIONE', in stileDelModello di
 * lib-pagina-funghi.js e in tre generatori) o ne tolgono dei blocchi cercandone
 * il testo identico, commenti compresi (RILIEVO, YT_BTN, QUIZ_CSS,
 * STRISCIA_CSS). Le pagine modello (le regioni, le funghi regione e la zona
 * funghi della Garfagnana, da cui parte la mappa forestale) restano quindi coi
 * loro commenti: si chiama senzaCommenti() solo scrivendo le altre.
 *
 * Cosa toglie: i commenti del CSS dentro <style> e quelli del JavaScript
 * dentro <script> (a blocco e di riga). Non tocca i commenti HTML (<!-- -->:
 * alcuni sono segnaposto, come PAGINE:INIZIO), quelli a blocco che cominciano
 * col punto esclamativo (licenze), gli script con src o di altro
 * tipo (il JSON-LD) e il testo dentro stringhe ed espressioni regolari. Se in
 * uno script trova qualcosa che non sa leggere (un apice inverso, una stringa
 * che non si chiude) lo lascia com'era, intero.
 * Provato su tutte le 1.441 pagine non modello: JavaScript con lo stesso albero
 * sintattico (acorn) e CSS con le stesse regole lette dal browser, prima e dopo.
 *
 * Non fa niente da solo: e' un modulo, si richiede.
 */

const vm = require('vm');
const PAROLE_PRIMA_DI_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await']);
const SPAZIO = /[ \t]/;

// Toglie s[a..b) (un commento) e sistema la riga: se sulla riga resta solo spazio, via la riga intera col suo a capo;
// se dopo il commento la riga finisce, via anche gli spazi prima; se il commento stava fra due caratteri, al suo posto
// uno spazio (o un a capo, se nel JavaScript ne conteneva uno: conta per l'inserimento automatico dei punti e virgola).
function taglia(s, a, b, pezzi, da, js) {
  let i = a; while (i > da && SPAZIO.test(s[i - 1])) i--;
  let j = b; while (j < s.length && SPAZIO.test(s[j])) j++;
  const inizioRiga = i === 0 || s[i - 1] === '\n';
  const fineRiga = j >= s.length || s[j] === '\n' || s[j] === '\r';
  if (inizioRiga && fineRiga) {
    if (s[j] === '\r') j++;
    if (s[j] === '\n') j++;
    pezzi.push(s.slice(da, i)); return j;
  }
  if (fineRiga) { pezzi.push(s.slice(da, i)); return j; }
  if (inizioRiga) { pezzi.push(s.slice(da, i)); return j; }
  const dentro = s.slice(a, b);
  pezzi.push(s.slice(da, i), js && /[\r\n]/.test(dentro) ? '\n' : ' ');
  return j;
}

function cssSenza(s) {
  const pezzi = []; let da = 0, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      i = j + 1; continue;
    }
    if (c === '/' && s[i + 1] === '*' && s[i + 2] !== '!') {
      const f = s.indexOf('*/', i + 2); if (f < 0) return s;
      da = i = taglia(s, i, f + 2, pezzi, da, false); continue;
    }
    i++;
  }
  pezzi.push(s.slice(da));
  return pezzi.join('');
}

function jsSenza(s) {
  const pezzi = []; let da = 0, i = 0, ultimo = '', parola = '';
  const regexQui = () => ultimo === '' || '(,=:[!&|?{};+-*%<>~^'.includes(ultimo) || PAROLE_PRIMA_DI_REGEX.has(parola);
  while (i < s.length) {
    const c = s[i];
    if (c === '`') return s;   // le pagine sono ES5: un apice inverso qui non si sa leggere, lo script resta com'e'
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === '\n') return s; j += s[j] === '\\' ? 2 : 1; }
      if (j >= s.length) return s;
      i = j + 1; ultimo = c; parola = ''; continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      if (s[i + 2] === '!') { const f = s.indexOf('*/', i + 2); if (f < 0) return s; i = f + 2; continue; }
      const f = s.indexOf('*/', i + 2); if (f < 0) return s;
      da = i = taglia(s, i, f + 2, pezzi, da, true); continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      let f = i; while (f < s.length && s[f] !== '\n' && s[f] !== '\r') f++;
      da = i = taglia(s, i, f, pezzi, da, true); continue;
    }
    if (c === '/' && regexQui()) {
      let j = i + 1, classe = false;
      while (j < s.length) {
        const d = s[j];
        if (d === '\n') return s;
        if (d === '\\') { j += 2; continue; }
        if (d === '[') classe = true; else if (d === ']') classe = false; else if (d === '/' && !classe) break;
        j++;
      }
      if (j >= s.length) return s;
      j++; while (j < s.length && /[a-z]/i.test(s[j])) j++;
      i = j; ultimo = '/'; parola = 'regex'; continue;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z_$0-9]/.test(s[j])) j++;
      parola = s.slice(i, j); ultimo = parola[parola.length - 1]; i = j; continue;
    }
    if (!/\s/.test(c)) { ultimo = c; parola = ''; }
    i++;
  }
  pezzi.push(s.slice(da));
  return pezzi.join('');
}

// ⚠️ LO SCRIPT DEVE ANCORA LEGGERSI (2/11/2026, scheda 114, check-10 B7). jsSenza tratta sempre «/» dopo una «)» come
// divisione: un'espressione regolare scritta li' («if (u) /\/\//.test(u)») con dentro «//» verrebbe presa per un commento
// e il resto della riga tagliato, pagina rotta senza avviso. Oggi nessun generatore lo scrive. Lo script senza commenti si
// compila (non si esegue): se non si legge piu' e l'originale si', resta l'originale coi commenti, e lo si dice nel log.
function senzaRotture(corpo, nuovo) {
  if (nuovo === corpo) return nuovo;
  try { new vm.Script(nuovo); return nuovo; } catch (e) {}
  try { new vm.Script(corpo); } catch (e) { return nuovo; }   // gia' illeggibile prima: come prima
  console.warn('senza-commenti: uno script lasciato coi commenti (togliendoli non si leggeva piu\'): ' + corpo.trim().slice(0, 80).replace(/\s+/g, ' '));
  return corpo;
}

// Una pagina intera: si scorre l'HTML e si puliscono solo i <style> e gli <script> di JavaScript in linea.
function senzaCommenti(html) {
  const pezzi = []; let da = 0;
  const apre = /<!--|<(style|script)\b([^>]*)>/gi;
  let m;
  while ((m = apre.exec(html))) {
    if (m[0] === '<!--') { const f = html.indexOf('-->', m.index + 4); if (f < 0) break; apre.lastIndex = f + 3; continue; }
    const tag = m[1].toLowerCase(), attr = m[2], inizio = m.index + m[0].length;
    const chiude = html.toLowerCase().indexOf('</' + tag, inizio);
    if (chiude < 0) break;
    const corpo = html.slice(inizio, chiude);
    let nuovo = corpo;
    if (tag === 'style') nuovo = cssSenza(corpo);
    else if (!/\bsrc\s*=/i.test(attr) && !/\btype\s*=\s*["']?(?!text\/javascript|application\/javascript|module)/i.test(attr)) nuovo = senzaRotture(corpo, jsSenza(corpo));
    if (nuovo !== corpo) { pezzi.push(html.slice(da, inizio), nuovo); da = chiude; }
    apre.lastIndex = chiude;
  }
  pezzi.push(html.slice(da));
  return pezzi.join('');
}

module.exports = { senzaCommenti, cssSenza, jsSenza };
