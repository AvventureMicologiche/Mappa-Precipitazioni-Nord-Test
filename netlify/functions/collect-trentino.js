/**
 * collect-trentino.js  —  Netlify Function
 * Dati live Trentino per periodi brevi (1h, 3h, 6h, 12h, 24h)
 * Usa Open-Meteo per i periodi orari (Meteotrentino non ha API oraria pubblica)
 */

const https = require('https');

const OM_STATIONS = [
  {n:"Trento",              lat:46.067, lon:11.121, q:194},
  {n:"Rovereto",            lat:45.890, lon:11.043, q:203},
  {n:"Riva del Garda",      lat:45.886, lon:10.843, q:70},
  {n:"Arco",                lat:45.917, lon:10.880, q:91},
  {n:"Pergine Valsugana",   lat:46.063, lon:11.236, q:498},
  {n:"Levico Terme",        lat:46.010, lon:11.305, q:502},
  {n:"Borgo Valsugana",     lat:46.053, lon:11.454, q:385},
  {n:"Cavalese",            lat:46.284, lon:11.451, q:958},
  {n:"Predazzo",            lat:46.298, lon:11.598, q:1000},
  {n:"Moena",               lat:46.376, lon:11.662, q:1175},
  {n:"Canazei",             lat:46.478, lon:11.767, q:1465},
  {n:"San Martino di Castrozza", lat:46.261, lon:11.796, q:1450},
  {n:"Passo Rolle",         lat:46.298, lon:11.787, q:2012},
  {n:"Passo Tonale",        lat:46.263, lon:10.597, q:1875},
  {n:"Madonna di Campiglio",lat:46.230, lon:10.827, q:1510},
  {n:"Pinzolo",             lat:46.157, lon:10.757, q:760},
  {n:"Tione",               lat:46.041, lon:10.731, q:533},
  {n:"Malè",                lat:46.352, lon:10.918, q:720},
  {n:"Mezzolombardo",       lat:46.187, lon:11.104, q:204},
  {n:"Cles",                lat:46.361, lon:11.040, q:655},
  {n:"Fondo",               lat:46.438, lon:11.130, q:910},
  {n:"Passo Mendola",       lat:46.419, lon:11.189, q:1315},
  {n:"Lavarone",            lat:45.940, lon:11.253, q:1155},
  {n:"Folgaria",            lat:45.915, lon:11.164, q:1121},
  {n:"Monte Bondone",       lat:46.014, lon:11.054, q:1490},
  {n:"Molveno",             lat:46.142, lon:10.958, q:835},
  {n:"Storo",               lat:45.847, lon:10.562, q:385},
  {n:"Canal San Bovo",      lat:46.150, lon:11.735, q:750},
  {n:"Castello Tesino",     lat:46.057, lon:11.630, q:801},
  {n:"Peio",                lat:46.364, lon:10.678, q:1585}
];

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const hours = parseInt(event.queryStringParameters?.hours || '24', 10);
  const lats  = OM_STATIONS.map(s => s.lat).join(',');
  const lons  = OM_STATIONS.map(s => s.lon).join(',');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation&timezone=Europe%2FRome&forecast_days=2`;

  try {
    const raw  = await fetchURL(url);
    const data = JSON.parse(raw);
    const arr  = Array.isArray(data) ? data : [data];
    const now  = new Date();

    const stations = arr.map((loc, i) => {
      const s = OM_STATIONS[i];
      if (!s) return null;
      const times = loc.hourly?.time || [];
      const prec  = loc.hourly?.precipitation || [];

      let mm = 0;
      for (let j = 0; j < times.length; j++) {
        const t = new Date(times[j]);
        const diffH = (now - t) / 3600000;
        if (diffH >= 0 && diffH <= hours) mm += prec[j] || 0;
      }

      return {
        id:  `om_tn_${i}`,
        n:   s.n,
        lat: s.lat,
        lon: s.lon,
        q:   s.q,
        p:   'TN',
        mm:  Math.round(mm * 10) / 10
      };
    }).filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ source: 'Open-Meteo', hours, count: stations.length, stations })
    };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
