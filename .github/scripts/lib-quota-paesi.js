/**
 * LA QUOTA DEI PAESI, cotta nelle pagine «Previsioni meteo <zona>» (24/10/2026).
 *
 * Le pagine meteo di zona mettono i paesi dal piu' basso al piu' alto e mandano la quota all'API delle previsioni
 * (le temperature cambiano coi metri). La quota e' l'ALTEZZA DEL TERRENO nel punto del paese, come per le stazioni
 * di quote-terreno.js, e la pagina la scrive col «~» davanti. Il browser non chiede niente a nessuno: si cuoce qui.
 *
 * ⚠️ UN ARCHIVIO, NON UNA CHIAMATA A OGNI GIRO: `quote-paesi.json` accanto a questo file, chiave «lat,lon» del paese
 * (le coordinate di elenco-paesi.txt, tre decimali). Si chiede solo quello che manca, quindi rigenerare le pagine non
 * va in rete se i paesi sono gli stessi.
 *
 * LA FONTE: le tessere «terrarium» (lib-terrarium.js). Fino al 25/10/2026 prima si chiedeva a Open-Meteo Elevation e
 * le terrarium erano il ripiego; Open-Meteo e' stato tolto (il suo piano gratuito vieta i siti con pubblicita').
 * Ogni voce porta la sua fonte (`f`: om = Open-Meteo, le vecchie | ter = terrarium). `QUOTE_RIFAI=1` le richiede
 * tutte da capo.
 */
const fs = require('fs');
const path = require('path');
const { quoteTerrarium } = require('./lib-terrarium.js');

const FILE = path.join(__dirname, 'quote-paesi.json');
const chiave = (lat, lon) => (+lat).toFixed(3) + ',' + (+lon).toFixed(3);

// punti: [{lat, lon}] → restituisce { "lat,lon": quota } per tutti, chiedendo solo quelli che mancano
async function quotePaesi(punti) {
  const arch = !process.env.QUOTE_RIFAI && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const mancano = [...new Map(punti.filter(p => !arch[chiave(p.lat, p.lon)]).map(p => [chiave(p.lat, p.lon), p])).values()];
  if (mancano.length) {
    const q = await quoteTerrarium(mancano);
    mancano.forEach((p, i) => { arch[chiave(p.lat, p.lon)] = { q: Math.max(0, q[i]), f: 'ter' }; });
    const ord = {};
    Object.keys(arch).sort().forEach(k => { ord[k] = arch[k]; });
    fs.writeFileSync(FILE, JSON.stringify(ord, null, 0).replace(/},"/g, '},\n"') + '\n', 'utf8');
    console.log('  quote: ' + mancano.length + ' paesi nuovi (terrarium)');
  }
  const out = {};
  for (const p of punti) out[chiave(p.lat, p.lon)] = arch[chiave(p.lat, p.lon)].q;
  return out;
}

module.exports = { quotePaesi, chiave };
