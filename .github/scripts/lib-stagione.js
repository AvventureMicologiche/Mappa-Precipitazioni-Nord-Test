/**
 * LA RIGA DI STAGIONE, in un posto solo (13/9/2026).
 *
 * PERCHE' ESISTE. I titoli delle pagine funghi di regione e di zona dicono
 * «Dove andare a funghi in Toscana oggi»: e' la ricerca in cui vogliamo
 * entrare, e il titolo sta fermo tutto l'anno. A gennaio pero' quella frase,
 * da sola, promette una cosa che non c'e'. Questa riga e' la TUTELA: la scrive
 * il browser guardando il SUO mese, quindi e' giusta ogni giorno dell'anno
 * senza rigenerare niente e senza deploy.
 *
 * ⚠️ Sta SUBITO SOTTO IL TITOLO. Prima era sulle sole pagine di regione, dopo
 * il riquadro del patto («A cosa serve» dal 22/9/2026), cioe' a mezza pagina: chi arrivava da
 * Google con «dove andare a funghi oggi» a gennaio leggeva prima tre riquadri.
 *
 * ⚠️ UN SOLO TESTO per regioni e zone: due copie della stessa frase divergono.
 * Il calendario e' quello di sempre: dicembre-febbraio fuori stagione,
 * novembre e marzo ai margini.
 *
 * ⚠️ Il testo esce dentro un <script> come stringa JSON: niente apostrofi dritti
 * da gestire a mano (quello tipografico si usa lo stesso, per l'occhio). Il
 * 2/9/2026 un apostrofo nudo in un template literal aveva rotto tutta la pagina.
 */

const TESTI = {
  fuori: '<b>Siamo fuori stagione.</b> Da dicembre a febbraio i funghi sono pochi quasi '
    + 'ovunque, e la finestra dei 13-20 giorni conta poco. I millimetri qui sotto restano '
    + 'veri e misurati, ma per usarli davvero aspetta le piogge di fine estate.',
  margine: '<b>Siamo ai margini della stagione.</b> A quest’epoca la buttata dipende molto '
    + 'dalla quota e dal freddo: i millimetri qui sotto sono veri, ma valgono meno che in '
    + 'autunno pieno.',
};

function rigaStagione() {
  return '<div id="stagione"></div>\n<script>(function(){'
    + 'var m=new Date().getMonth()+1,t=null;'
    + 'if(m===12||m===1||m===2)t=' + JSON.stringify(TESTI.fuori) + ';'
    + 'else if(m===11||m===3)t=' + JSON.stringify(TESTI.margine) + ';'
    + 'if(t){var s=document.getElementById("stagione");s.innerHTML=t;s.style.display="block";}'
    + '})();</script>';
}

module.exports = { rigaStagione, TESTI };
