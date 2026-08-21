# meteohub-lombardia — non è una regione della mappa

Questi 12 giorni (13-26 luglio 2026) non finiscono in mappa e non si aggiornano
più. Sono la **prova a terra** con cui è stato validato MeteoHub: la Lombardia
ha un suo collector che legge ARPA direttamente, e la stessa rete letta via
MeteoHub (`dpcn-lombardia`) serviva a confrontare i due numeri sulle stesse
stazioni e negli stessi giorni. Il confronto è finito, la cartella resta come
riferimento se un giorno lo si rifà.

Non esiste in produzione: questa è l'unica copia. Il motivo per cui è nata è
scritto in `.github/scripts/collect-meteohub.js`, in cima.

Le altre `data/meteohub-*` sono state cancellate da qui il 21/8/2026: erano
copie ferme al 31 luglio di dati che stanno, completi e aggiornati, nel repo di
produzione, ed è da lì che il sito di test li legge (vedi `MH_DATA_BASE`
nell'index).
