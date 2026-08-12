# Mappa Precipitazioni Nord Italia — CLAUDE.md (REPO DI TEST)

> **Questo è il repo di TEST.** Ambiente di sperimentazione, sito `avventurepluvio-test.netlify.app`. Deploya da GitHub in automatico dal 22 luglio 2026 (build saltata sui commit di soli `data/`). L'`index.html` è tenuto allineato a produzione (stesso file), e i crediti/GA si comportano come lì grazie al controllo sull'hostname. Il resto di questo CLAUDE.md è una copia della documentazione di produzione, tenuta qui per contesto; la sezione **PILOTA MeteoHub** qui sotto è invece specifica del test.

## Progetto
Mappa interattiva delle precipitazioni del Nord Italia per il canale YouTube "Avventure Micologiche". Mostra dati pluviometrici reali da stazioni ARPA regionali su heatmap Leaflet.

- **Sito test:** avventurepluvio-test.netlify.app
- **Prod:** precipitazioni.avventuremicologiche.it
- **Repo test:** github.com/AvventureMicologiche/Mappa-Precipitazioni-Nord-Test
- **Repo prod:** github.com/AvventureMicologiche/Mappa-Precipitazioni-Nord
- **Stack:** Leaflet 1.9.4, OpenStreetMap, Netlify (hosting + Functions), GitHub Actions (data collection)

> ⚠️ **SUL SITO DI TEST IL CENTRO-SUD È FERMO AL 31 LUGLIO 2026, ED È VOLUTO.**
> Alla migrazione Italia v5.0 (1/8) il centro-sud è passato in produzione e i cron
> di `meteohub.yml` **qui** sono stati commentati (resta il solo `workflow_dispatch`).
> Ma il sito di test legge i dati dal PROPRIO repo (`PILOT_DATA_BASE` → Nord-Test),
> quindi per lui tutte e dieci le regioni MeteoHub si sono fermate quel giorno. In
> produzione i cron girano e i dati ci sono: verificato il 6/8/2026, Molise/Sicilia/
> Puglia all'ultimo file `2026-07-31` qui contro `2026-08-05` in prod.
> **Non è un guasto e non c'è niente da riparare** — i dati veri stanno in produzione.
> Se un giorno servisse provare il centro-sud da qui, la strada è una **seconda base
> dati puntata alla prod per le sole regioni MeteoHub** (`PILOT_DATA_BASE` non basta:
> la usano anche VdA, Friuli e Austria, che devono restare sul test). **NON riaccendere
> i cron**: duplicherebbero quelli di produzione e ogni push è un deploy Netlify da
> ~15 crediti, la voce che stiamo riducendo.

---

> **Migrazione a produzione: la checklist è in [`MIGRAZIONE-v5.md`](MIGRAZIONE-v5.md).** Leggerla PRIMA di copiare qualsiasi cosa — contiene le trappole viste sul campo (le cartelle `data/` del Nord qui sono ferme a metà luglio: una copia in blocco cancellerebbe due settimane di dati veri in produzione) e il pezzo di lavoro che si dimentica, cioè estendere l'allarme via mail alle regioni MeteoHub.

## PILOTA MeteoHub (dal 20 luglio 2026 — solo repo di test)

Valutazione di MeteoHub (meteohub.agenziaitaliameteo.it, Agenzia ItaliaMeteo, ex Mistral)
per espandere la mappa a tutta Italia.

### Inquadratura della decisione (23 luglio 2026)

**La domanda NON è sostituire i collector del Nord** — quelli funzionano e restano. È: **per fare il resto d'Italia (centro-sud), collector diretti regione-per-regione o MeteoHub?**

- **Regione-per-regione**: massima qualità/robustezza, ma il Nord è costato ~2 mesi e i bug #1-#19, uno per collector. Rifarlo per ~10 regioni = stesso identico sforzo.
- **MeteoHub**: una sola API per tutte le regioni nuove. Valori provati fedeli. Un solo punto di rottura.

**Cosa è già accertato:**
- **Valori fedeli alla verità a terra.** MeteoHub `dpcn-lombardia` vs ARPA Lombardia (Socrata) su 15/21/22 luglio: medie regionali entro **1-3%**, max identici (45.8 il 15/7). La rete dpcn è in larga parte la stessa rete ARPA → il guadagno di qualità del collector diretto è appunto 1-3%, sproporzionato allo sforzo di farne 10.
- **Copertura** (sondata sulle reti `dpcn-<regione>` il 23/7):
  - **PRESENTI** — Lombardia (198 staz.), Piemonte (280), Veneto (124), Liguria (148), Marche (116), Umbria (79), **Lazio (208), Campania (178), Puglia (133), Calabria (140), Sicilia (438), Sardegna (93), Basilicata (61), Molise (28)**
  - **ASSENTI (404)** — Toscana, Emilia-Romagna, Trentino, Alto Adige, Friuli, Valle d'Aosta, **Abruzzo**
  - Nota la simmetria: le assenti sono quasi tutte già coperte da noi (Toscana SIR, Emilia ARPAE, Trentino, Alto Adige) o via Open-Meteo (Friuli, VdA). L'unico buco nuovo vero è **l'Abruzzo** (da fare a parte). Le presenti sono esattamente tutto il centro-sud che ci manca.

**Il nodo aperto = FREQUENZA dei buchi di ingestione.** MeteoHub ha perso 16-17 luglio: **1 solo evento, 2 giorni consecutivi, su tutte e 3 le reti insieme** = blackout di piattaforma, non guasti sparsi per regione. Su una finestra di 10 giorni fa "20% perso", ma è un numero ingannevole: con un solo evento non si distingue "caso raro" (~3% reale, trascurabile) da "cronico". **Serve osservare ~4 settimane.** Metrica da seguire: numero di eventi-buco distinti e giorni tra un evento e l'altro, NON la % di giorni persi.

**Perché la frequenza è decisiva:** i buchi MeteoHub non hanno una toppa "reale". Riempirli con Open-Meteo Archive userebbe STIME — diverso dal backfill Toscana una-tantum (che era solo per lo storico rotto pre-SIR; la Toscana oggi ha dati reali SIR). Usare Open-Meteo in pianta stabile sui buchi violerebbe la regola #1 "storico sempre accurato". Quindi se MeteoHub buca spesso, per rispettare la regola servirebbe comunque una fonte diretta di riserva → il vantaggio "una sola API" si assottiglia. **Decisione rimandata finché la frequenza non si stabilizza.**

### Dettagli tecnici

- **Collect:** `collect-meteohub.js` + workflow `meteohub.yml` (4 run/giorno, orari sfalsati da Ticino)
- **Reti in pilota:** `dpcn-lombardia` (CONTROLLO, verità a terra via ARPA Socrata), `dpcn-marche`, `dpcn-umbria`
- **API:** `meteohub.agenziaitaliameteo.it/api/observations?networks=<rete>&q=reftime:...;product:B13011;license:CCBY_COMPLIANT`. JSON senza login (finestra pubblica ~10 giorni), CC-BY con citazione. Reftime in UTC (verificato), accumuli che terminano al reftime; granularità VARIA per rete (Lombardia 10 min, Marche 15 min, Umbria 1 min) — il collector sceglie la serie più fitta e la somma, soglia completezza ≥85%
- **Dati in:** `data/meteohub-lombardia|marche|umbria/` — NON collegati alla mappa, solo per il confronto
- **Checkpoint frequenza buchi:** 24-25 luglio (primo), poi settimanale. Mappa buchi: contare i giorni mancanti per rete nella finestra
- **Evento-buco n°2 (27 luglio 2026, rilevato il 29):** ingestione parziale del sud per quel giorno — Puglia persa quasi del tutto (1/133 stazioni, verificato con l'API in diretta anche il 29/7: dato perso), Basilicata parziale (50/61), Campania leggermente corta (168/176). Natura diversa dal blackout 16-17/7 (una regione quasi azzerata vs piattaforma intera). Distanza tra eventi: ~9 giorni.
- **Sorveglianza automatica buchi (dal 29 luglio 2026):** `.github/scripts/check-meteohub-gaps.js` + workflow `meteohub-gaps.yml` (1 run/giorno, 08:40 UTC). Scansiona gli ultimi 10 giorni: buchi TOTALI (file mancante) e PARZIALI (stazioni < 90% della mediana della finestra); registro eventi permanente in **`data/meteohub-gaps.json`** (fonte della verità per la metrica frequenza — coprire non nasconde più gli eventi); se MeteoHub ingerisce in ritardo l'evento si chiude come `risolto-meteohub`; un buco del giorno G ancora aperto viene coperto con Open-Meteo quando oggi ≥ G+`GRACE_DAYS` (**2 giorni**: la valutazione "scendere da 3 a 2, tanto il 3° giorno non recupera mai" è stata applicata; verificato nel codice il 4/8/2026). Coperture marcate: file interi `source: open-meteo-gapfill`, integrazioni parziali solo sulle stazioni mancanti con `om: true` (le reali restano intatte) + campo `gapfill`. Il collector non riscrive i file esistenti con ≥10 stazioni fuori da ieri/altroieri → nessun conflitto. Testato in sandbox il 29/7 sui buchi reali del 27/7 (rilevamento senza falsi positivi, copertura, idempotenza).
- **Ticino disattivato in questo repo** (22 luglio 2026): `ticino.yml` ha i cron commentati e l'`index.html` legge il Ticino dal repo di produzione (in prod dal 17 luglio). Resta lanciabile a mano da `workflow_dispatch`

---

## PILOTA SVIZZERA INTERA (dal 3 agosto 2026 — solo repo di test)

Espansione all'intera Svizzera con **MeteoSwiss OGD** (open data della Confederazione,
CC BY 4.0, attribuzione «Fonte: MeteoSvizzera»). In mappa un solo bottone **"Svizzera
(CH)"** al posto di "Ticino (CH)": sotto, DUE fonti unite — il Ticino resta OASI
(data/ticino, repo prod), il resto del paese è MeteoSwiss (`data/svizzera`, qui).

- **Collect:** `collect-svizzera-meteoswiss.js` + `svizzera.yml` (5 run/giorno).
  **261 stazioni** dalle collezioni STAC `ch.meteoschweiz.ogd-smn` (SwissMetNet)
  e `ogd-smn-precip` (rete pluvio): CSV per stazione su data.geo.admin.ch, coordinate
  già WGS84 nell'anagrafe, filtro su inventario `rre150h0` attivo. **Escluse: canton
  TI** (coperto da OASI) **e `SBE` S. Bernardino** — OASI copre anche il Moesano GR
  e SBE è la stessa stazione fisica (unico doppione su 260×47 coppie, 0,01 km).
- **RICETTA (validata 3/8 su 639 giorni-stazione, match al centesimo):** i giornalieri
  ufficiali NON coincidono col giorno solare italiano — `rre150d0` = finestra 06-06 UTC,
  `rka150d0` = giorno di calendario UTC. Quindi si sommano le ORE `rre150h0` (timestamp
  = FINE intervallo) sul giorno solare italiano, ricetta OSMER, MIN_ORE=20. File
  `_h_recent` (anno corrente) già completo di ieri al mattino presto (verificato 06:17
  UTC); `_h_now` (10 min) come integrazione dell'ultima ora.
- **Auto-riparazione GRATIS D-3..D-10**: `recent` copre l'intero anno, i giorni mancanti
  si ricostruiscono senza richieste extra. Come OASI, un run fallito non perde mai dati.
- **Backfill 365 giorni REALI** (`backfill-svizzera-meteoswiss.js`, una tantum, girato
  in LOCALE il 3/8 — scarica ~1 GB dai file `_h_historical_2020-2029`): 354 giorni
  dal 4/8/2025, 252-262 stazioni stabili anche d'inverno (pluviometri riscaldati).
  Niente stime, niente fase beta. Campo `backfill: true` nei file.
- **Confine:** `svizzera-confine.geojson` — layer Landesgebiet swissBOUNDARIES3D via
  `api3.geo.admin.ch` (find su `bez=Schweiz`, sr=4326), semplificato Douglas-Peucker
  52k→5k vertici (~40 m), CON i buchi di Campione d'Italia e Büsingen.
- **index.html:** regione `svizzera` (dataSource `svizzera`), `loadSvizzeraRegion`
  somma i file di ENTRAMBE le fonti con chiavi prefissate `ti:`/`ch:` → 307 stazioni;
  fonte/chip/crediti "OASI Ticino + MeteoSvizzera". Grafico storico a doppia cartella
  col tag per-stazione `_src` (`oasi`→data/ticino prod, `ms`→data/svizzera qui, vedi
  `histRegion` e `HIST_RAW_BY_REGION`). **Vista iniziale INVARIATA** (la chiave
  `svizzera` è esclusa dal `fitVistaIniziale`: il confine entra dal bordo alto).
  **Alias link**: `?r=ticino` apre la Svizzera (link vecchi in circolazione).
  `REGION_ADJ`: svizzera ↔ valledaosta/piemonte/lombardia/altoadige.
- **Rosso TOLTO il 3/8 (decisione utente, dopo due riduzioni provate):** la Svizzera
  veste il blu delle regioni italiane e si distingue solo col bordo TRATTEGGIATO
  (confine di stato); header → "Mappa Pluviometrica Italia + Svizzera (v6.0)"
  (anche <title> e og:title). Respiro unico `confPulse` per tutti, ciclo 1,6s,
  sincronia esatta via `startTime=0` in `aggiornaConfPulse` (senza, la fase
  dipendeva da quando ogni confine riceveva la classe; la controfase è stata
  provata e scartata).
- **Confronti ai confini (3/8):** SBE identica in OASI/MeteoSwiss (16,4 = 16,4 il 26/7);
  Binn↔Alpe Devero, Ulrichen↔Formazza (Piemonte), Gran San Bernardo↔Crévacol e altre
  4 coppie VdA, Soglio↔Villa di Chiavenna (Lombardia): stessi giorni di pioggia,
  differenze coerenti con quota/microclima.
- **Per la promozione a prod restano:** nome sito (v6 "Italia + Svizzera"?), anteprima
  social, descrizione YouTube, estensione allarme fonti/gapfill alla voce svizzera,
  spostare `data/svizzera` + collector nel repo prod (e `PILOT_DATA_BASE` di
  conseguenza), decidere gli orari definitivi dei cron.

---

## FRANCIA — PROMOSSA IN PRODUZIONE IL 10 AGOSTO 2026

> **Non è più un pilota.** Dati, collector, workflow, confini e secret stanno anche
> nel repo prod (v7.0, header «Italia · Svizzera · Austria · Francia»); la scheda di
> riferimento è nel CLAUDE.md di produzione. **Il collector di questo repo resta
> attivo**, come Svizzera e Austria: il sito di test legge dalle proprie cartelle.
> Sotto, la cronaca dello sviluppo (9/8/2026), tenuta per contesto.

### Come nacque (9 agosto 2026 — pilota di un giorno)

**Tutta la Francia metropolitana nelle 13 régions ufficiali** (decisione utente del
9/8 sera: «un peccato fare solo una porzione» — il primo pilota copriva i soli 6
dipartimenti di confine). Fonte: **Météo-France, API Paquet Observations**
(`public-api.meteofrance.fr/public/DPPaquetObs/v2`), Licence Ouverte 2.0 Etalab.
Studio fonti e alternative scartate in `francia-rapporto-fonti.md` (cartella claudio).

- **Collect:** `collect-francia-meteofrance.js` + `francia.yml` (4 run/giorno,
  chiusura 22:50 UTC). **95 pacchetti dipartimento** per giro (~5-6 minuti, dentro i
  100 req/min), **1.818 stazioni in anagrafe, ~1.700 con `rr1`**, una cartella
  `data/francia-<régione>` e una voce in mappa ciascuna. Le 13: aura (Alvernia-
  Rodano-Alpi, 344 staz.), provenza (149), occitania (247), naq (211), grandest
  (179), bfc (139), centro (99), normandia (81), loira (82), bretagna (77), hdf
  (68), idf (45), corsica (53). Nessuna supera l'Austria come area: griglia
  heatmap e inquadratura telefono reggono senza ritocchi.
- ⚠️ **Chiave**: secret `METEOFRANCE_API_KEY` (account utente sul portale, **scade
  il 9/8/2028**). 401 improvvisi = chiave. ⚠️ `id-departement` SENZA zero (5, non
  05); la **Corsica è `20` unico** (2A/2B non esistono, nemmeno negli id stazione).
- **RICETTA (validata PRIMA del collector):** RR giornaliero francese = finestra
  06-06 UTC ufficiale → somma ore `rr1` sul giorno solare italiano, timestamp di
  FINE intervallo, `(start, end]`, MIN_ORE=20 — identica a Svizzera/Austria/OSMER.
  Quadratura contro il RR ufficiale: **99,6% esatta entro 0,2 mm su 9.763 giorni
  bagnati** (6 dip. alpini, intero 2026); convenzione confermata 99,8% vs 73,9%.
  Il pacchetto contiene **~5 giorni** di ore (doc dice 24h): riparazione D-1..D-4.
- **Storico: 369 giorni REALI** (1/8/2025→4/8/2026) — `backfill-francia-meteofrance.js`
  (una tantum, ~1 GB dai CSV orari `BASE/HOR`): ~4.790 file, 18 giorni-régione
  saltati per poche stazioni (tutti nelle régions piccole). ⚠️ **SOLO il mirror S3
  OVH**: `object.files.data.gouv.fr` è fermo a giugno e `last_modified` mente.
- **In mappa:** 13 voci «… (FR)», `dataSource:'francia'` condiviso + `dataDir`
  per cartella; loader e anagrafe parametrizzati per régione (cache per chiave);
  bordo tratteggiato e esclusione dalla vista di apertura **a prefisso**
  (`rk.indexOf('francia')===0`); `REGION_ADJ` completa fra régions e verso
  valledaosta/piemonte/liguria/svizzera, più **Corsica↔Sardegna** (si selezionano
  insieme). Confini: 13 file `francia-<x>-confine.geojson` (IGN via france-geojson,
  ~70 m, 30-143 KB) — ⚠️ ogni feature DEVE avere `properties.reg_name`.
- **Collaudo (9/8):** provenza/aura/corsica mobile a 0 vertici fuori; vista
  apertura invariata; Corsica+Sardegna ok (la Sardegna qui è vuota SOLO perché il
  centro-sud del test è congelato al 31/7 — in prod avrà i dati). **Residuo noto:
  Bretagna 104% di larghezza** (~7px per lato oltre i bordi, dentro la banda morta
  della centratura): accettato, è la régione più lontana dal pubblico.
- **Per la promozione a prod:** cartelle dati + collector + workflow + 13 confini
  + secret nel repo prod, `PILOT_DATA_BASE`, voce `fonti.html` prod, allarme fonti
  esteso, header da decidere.

---

## AUSTRIA — PROMOSSA IN PRODUZIONE IL 7 AGOSTO 2026

> **Non e' piu' un pilota.** Dal 7/8/2026 l'Austria e' in produzione: dati, collector,
> workflow e confine stanno anche nel repo prod, e la scheda di riferimento e' quella
> nel CLAUDE.md di produzione. **Il collector di questo repo resta attivo**, come per la
> Svizzera, perche' il sito di test legge l'Austria dal proprio `data/austria`.
> Quello che segue e' la cronaca dello sviluppo, tenuta per contesto.

### Come nacque (dal 5 agosto 2026)

Espansione all'Austria con **GeoSphere Austria Data Hub** (ex ZAMG), `dataset.api.hub.geosphere.at`,
dataset `klima-v2-1h`, parametro `rr`. **Licenza CC BY 4.0** verificata sulla pagina del
dataset — attribuzione «Fonte: GeoSphere Austria», voce in `fonti.html`.
**IN MAPPA sul sito di test dal 5/8/2026**, bottone "Austria (AT)" accanto alla Svizzera.

- **Collect:** `collect-austria-geosphere.js` + `austria.yml` (5 run/giorno, orari sfalsati
  dalla Svizzera per non accavallare i push). **~269 stazioni** con ore sufficienti su 280
  in anagrafe.
- **Storico: 365 giorni di dati REALI dal primo giorno** — `backfill-austria-geosphere.js`,
  girato in locale il 5/8 (355 giorni, dal 5/8/2025). **Niente stime, niente fase beta.**
  Molto più leggero del backfill svizzero: una richiesta copre un mese intero per un gruppo
  di stazioni, quindi ~70 richieste JSON invece di ~1 GB di CSV. Copertura stabile anche
  d'inverno (261-269 stazioni a dicembre); massimo storico 148,2 mm (Dornbirn, 21/8/2025).
- **RICETTA (validata il 5/8 PRIMA di scrivere il collector):** il giornaliero ufficiale
  `klima-v2-1d` **non si usa** — è la finestra 06-06 UTC, cioè il *Klimatag* 07-07 in ora
  solare mitteleuropea, stessa trappola di `rre150d0` per MeteoSvizzera. Si sommano le ORE
  `rr` sul giorno solare italiano, finestra `(start, end]` su timestamp di **FINE
  intervallo**, MIN_ORE=20 — identica a Svizzera e OSMER Friuli.
  - **Due misure indipendenti, entrambe necessarie.** (1) Somma oraria contro giornaliero
    ufficiale: lo sfasamento che li allinea è di **7 ore** = 6 (finestra Klimatag) + 1 (fine
    intervallo), con **379 giorni bagnati esatti su 380** e scarto medio 0,050 mm su 15
    stazioni. ⚠️ Sui giorni *tutti* l'accordo scende al 52%, perché gli asciutti fanno
    punteggio gratis: **il numero che decide è quello sui giorni bagnati.** (2) La misura (1)
    fissa solo il TOTALE di 7 ore, non la scomposizione — per quella serve un'ancora già
    validata: **correlazione oraria con MeteoSvizzera** sulla coppia **Rohrspitz (AT) ↔
    Altenrhein (CH), 5,0 km**, r=**0,822 a sfasamento 0** contro 0,32 a ±1 ora.
- **⚠️ DOPPIONI — il filtro senza cui tutto sballa:** GeoSphere pubblica quasi ogni sito
  **due volte**, come stazione `COMBINED` (serie storica unita, id basso) e `INDIVIDUAL`
  (strumento fisico, id alto), con nome e quota identici e gli **stessi identici valori**.
  Al primo run erano **189 doppioni su 469**. Senza il filtro la mappa disegnerebbe ogni
  pluviometro austriaco due volte e l'IDW lo peserebbe il doppio — è il caso di S. Bernardino
  in Svizzera, ma su scala industriale. Il collector deduplica per **distanza (<500 m)**,
  **non per nome**: i doppioni si scrivono anche in modo diverso ("St.Jakob" / "St. Jakob").
  A parità di posizione si tiene la COMBINED, che ha la storia più lunga.
- **Vantaggi rispetto a tutte le altre fonti del progetto:** una sola richiesta copre TUTTE
  le stazioni (niente 199 chiamate come in Liguria); le query storiche rispondono su qualsiasi
  data → auto-riparazione D-3..D-10 gratis, un run fallito non perde mai dati; e **l'anagrafe
  pubblica la QUOTA**, cosa che Piemonte, OSMER e le reti MeteoHub non fanno → il filtro
  dislivello di `check-confini.js` funzionerebbe davvero sul confine **Alto Adige↔Tirolo**,
  il confronto più pulito che avremmo mai avuto.
- **Ha già ripagato prima di andare in mappa:** al primo run ha trovato la terza recidiva del
  bug #18 in produzione (Alto Adige 30/7/2026, coda cumulata del 29), dando le stazioni di
  confine a 0 e l'Austria intera a 41 mm su 269. **È la prima volta che una rete estera fa da
  controllo a una nostra regione.**
- **Slovenia — bocciata il 5/8/2026, VERDETTO RIBALTATO il 12/8** (vedi sezione dedicata in fondo). Quel giorno si guardò solo `rr_val` e si concluse così: ARSO pubblica 105 stazioni automatiche
  con coordinate, ma `rr_val` è la pioggia degli **ultimi 10 minuti** (`rrHh`=0,1666) e solo
  l'ultima lettura: per un giorno servirebbero 144 run. È il bug #11 della Liguria. L'archivio
  non è raggiungibile (endpoint statici 404, l'app `webmet` ha URL offuscati) e il dataset del
  portale open data è fermo al **febbraio 2022**, senza risorse scaricabili e su letture
  **manuali** delle 7.
- **In mappa (5/8/2026):** regione `austria` in `REGIONS`/`REGION_BOUNDS`/`REGION_ADJ` (confina
  con svizzera, altoadige, veneto, friuli), `loadAustriaRegion` su `PILOT_DATA_BASE+austria`,
  anagrafe da file recente (`loadAustriaStations`, come MeteoHub e Svizzera), dispatcher e
  `HIST_RAW_BY_REGION` per il grafico storico. Come la Svizzera: **bordo TRATTEGGIATO** ed
  **esclusione dalla vista di apertura** — per l'Austria conta ancora di più, si spinge a
  17,2°E e includerla trascinerebbe l'inquadratura fino all'Ungheria.
  **NIENTE tag beta**, a differenza del centro-sud: quel beta nasce dai buchi di ingestione di
  MeteoHub, che qui non esistono. Verificato dal vivo sul sito di test: Austria sola (269 staz.,
  30 gg) e Austria + Trentino-A.A. insieme (432 staz., finestra funghi), con la heatmap che
  passa il confine senza gradini.
- **Confine nazionale:** `austria-confine.geojson`, BEV via data.gv.at, semplificato
  Douglas-Peucker 249.277→4.661 vertici (~70 m), 90 KB, coordinate a 5 decimali.
  ⚠️ **Licenza CC BY-SA 2.0 AT** — diversa da quella dei dati di pioggia (CC BY 4.0): essendo
  il nostro file una semplificazione, resta CC BY-SA, e la cosa è dichiarata in `fonti.html`.
- **Confine Alto Adige↔Tirolo in `check-confini.js` (preset `altoadige-tirolo`)**, con la
  variabile **`DATA_ALT`** che punta alla cartella `data` del repo di test — senza, il confine
  non si potrebbe misurare finché l'Austria non è promossa, cioè proprio quando la misura serve
  per decidere se promuoverla. **Primo esito (60 giorni, 16 coppie, 416 confronti): Austria più
  alta nel 54%, scarto +0,69 mm, 5 stazioni su e 4 giù → equilibrato.**
- **Da fare per la promozione:** spostare `data/austria` + collector + workflow nel repo prod,
  `PILOT_DATA_BASE`, voce in `fonti.html` di produzione, allarme fonti/`check-fonti.js` esteso
  all'Austria, e decidere se l'header diventa "Italia + Svizzera + Austria".

---

## Regole fondamentali

1. **Lo storico precipitazioni deve essere SEMPRE accurato e completo.** Mai accettare dati parziali o sbagliati come "non catastrofici". Ogni problema va risolto completamente.
1b. **Retention: max 730 giorni (2 anni) di storico per regione — allungata da 365 il 7 agosto 2026**, perché Austria e Svizzera erano arrivate esattamente al muro dei 365 e da lì avrebbero perso un giorno di dato REALE al giorno. Non recupera il passato: si smette solo di cancellare. Finestra scorrevole: ogni nuovo giorno raccolto elimina il più vecchio oltre i 730. Ogni collector DEVE avere il blocco "Pulizia retention" a fine main() (uniformato a tutti i collector il 16 luglio 2026 — prima lo avevano solo Piemonte, Emilia, Veneto e Liguria, le altre regioni erano arrivate a 417-420 giorni).
2. **Verifica prima di procedere:** spiega le modifiche proposte e aspetta l'approvazione esplicita prima di toccare qualsiasi file.
3. **La mappa mostra solo "ieri" e periodi passati.** I dati della giornata odierna sono esclusi dalla visualizzazione.
4. **Tutte le regioni usano dati di stazione reali** (ARPA regionali, SIR Toscana, OASI Ticino, Centro Funzionale VdA, ARPA OSMER Friuli). VdA e Friuli sono passate ai dati reali il **26 luglio 2026** (prima erano Open-Meteo). Open-Meteo resta solo come: (a) **backfill storico** dei due piloti — stime per i giorni prima dell'inizio del dato reale, `source: open-meteo-backfill-*`; (b) fallback dei loader se i file mancano.
5. **Direzione geografica:** per spostare il centro mappa visivamente verso il basso, la latitudine deve AUMENTARE, non diminuire.

---

## Architettura dati per regione

### Lombardia
- **Fonte:** ARPA Lombardia Socrata API (live dal frontend, no collect script)
- **Formula:** `sum(valore)` nella query API
- **File su GitHub:** NO (dati caricati live dal browser)
- **Stato:** ✅ sempre corretto

### Piemonte
- **Fonte:** ARPA Piemonte `utility.arpa.piemonte.it/api_realtime`
- **Collect:** `collect-piemonte.js`
- **Formula:** `sum(cum_rain_1h)` per totale giornaliero + merge MAX protezione
- **Merge MAX:** se "aggiorna ieri" riceve <1000 record, salta l'aggiornamento
- **PIEMONTE_STATIONS:** 170 stazioni curate (filtrate da 275) nell'index.html. Ceppo Morelli esclusa (sensore offline). MONTE MALANOTTE (id 106, Cuneo) NON è in lista e non va aggiunta: pluviometro guasto dal 16 luglio 2026 — pioggia fantasma per giorni consecutivi (fino a 136mm/giorno) con Open-Meteo a 0.0, vicini asciutti e sensori temperatura/umidità null. I valori errati restano nei file grezzi `data/piemonte/` (16-20 luglio+) ma non arrivano mai in mappa (filtro applicato prima dell'accumulo). **Ricontrollata il 25 luglio 2026:** tornata online dal 22/7, ma temperatura/umidità ancora al 100% `null` (la firma del guasto persiste) e nessun evento di pioggia per testare il pluviometro → **esclusa in via definitiva, non riaggiungere e non serve più ricontrollarla ai check periodici.**
- **Orari:** 6 run/giorno
- **Dati corretti da:** ~12 giugno 2026
- **Bug noto:** API manutenzione alle 04:00 UTC → run delle 06:00 CEST spesso fallisce
- **ATTENZIONE:** `cum_rain_24h` è una finestra mobile, NON un totale giornaliero. MAI usare `max(cum_rain_24h)` perché trascina pioggia nel giorno dopo. L'API conserva solo ~1 record per stazione per i giorni vecchi, quindi `sum(cum_rain_1h)` funziona solo quando ci sono i record completi (24/giorno).

### Emilia Romagna
- **Fonte:** ARPAE REST `apps.arpae.it/REST/meteo_giornalieri`
- **Collect:** `collect-emilia.js`
- **Formula:** `precipitazione_cumulata_giornaliera` con `dateKeyPlusOne()` — l'API ARPAE ha offset +1 giorno (chiave 20260606 = dati meteo del 5 giugno)
- **Orari:** 6 run/giorno + aggiorna ieri
- **Dati corretti da:** 5 giugno 2026
- **ATTENZIONE:** l'ARPAE copre 12 stazioni fisicamente in territorio toscano (provincia FI/PT/LU/MS), quasi tutte lungo il crinale appenninico. Nomi non sempre corrispondono a SIR/CFR (es. "Passo delle Radici" vs "Passo Radici"). Queste 9 duplicavano stazioni Toscana rimaste bloccate a 0mm ed erano state rimosse da `TOSCANA_STATIONS` (bug #14) prima ancora di scoprire e risolvere il problema alla radice passando a SIR.

### Veneto
- **Fonte:** ARPA Veneto XML
- **Collect:** `collect-veneto.js`
- **Formula:** `max(vals)` su cumulativi giornalieri con reset a mezzanotte
- **Orari:** 6 run/giorno + aggiorna ieri
- **Dati corretti da:** 4 giugno 2026

### Trentino
- **Fonte:** Meteotrentino API
- **Collect:** `collect-trentino-gh.js`
- **Formula:** `PrecTotale` diretto dall'API
- **Orari:** 7 run/giorno + aggiorna ieri (il cron `30 22 UTC`, aggiunto il 22 luglio 2026, mira le 00:30 locali per raccogliere il giorno appena chiuso senza aspettare il primo run del mattino)
- **Dati corretti da:** 6 giugno 2026
- **ATTENZIONE:** `getValoriAggregatiGiornoJson` pubblica l'aggregato di un giorno **solo a giornata conclusa** — durante il giorno i record per la data odierna non esistono proprio (verificato il 22 luglio 2026 alle 15:15: l'API si fermava al 21). Il file di un giorno viene quindi creato dal ramo "aggiorna ieri" del primo run dopo mezzanotte, non durante il giorno stesso. Il collector NON deve ripiegare sul "giorno più recente disponibile" per riempire il file di oggi: era il bug #19.

### Alto Adige
- **Fonte:** Meteo BZ API (solo dati odierni)
- **Collect:** `collect-altoadige-gh.js`
- **Formula:** `sensorValue` (cumulato dalla mezzanotte) con merge MAX
- **Orari:** 7 run/giorno — il run di chiusura è stato anticipato dalle 21:55 alle **21:05 UTC** il 22 luglio 2026 (bug #18): i cron di GitHub slittano di 40-70 minuti e quello serale atterrava sistematicamente dopo mezzanotte CEST
- **Dati corretti da:** 4 giugno 2026
- **ATTENZIONE:** il cumulato dell'API riparte da zero a mezzanotte, ma il reset non è istantaneo. Un run che scivola oltre mezzanotte può leggere ancora i totali di ieri e scriverli nel file di oggi, dove il merge MAX li congela per sempre. Dal 22 luglio 2026 il collector ha una **guardia**: se il file del giorno non esiste ancora e il payload è identico stazione per stazione a quello del giorno precedente (con somma > 0), salta la scrittura. Vedi bug #18.

### Toscana
- **Fonte:** SIR Toscana (Servizio Idrologico Regionale) `sir.toscana.it/monitoraggio/stazioni.php?type=pluvio` — coordinate/quota da CFR Toscana `cfr.toscana.it/monitoraggio/actions.php` (action=PLUVIO, affidabile solo per i metadati)
- **Collect:** `collect-toscana-sir.js` (sostituisce `collect-toscana-gh.js`, dismesso il 12 luglio 2026 — vedi bug #14)
- **Formula:** Δ24h (finestra mobile) da SIR. Merge: vince SEMPRE la lettura più recente dello stesso giorno (mai `max()` tra run diversi — trascinerebbe pioggia del giorno precedente in avanti, stesso bug di Piemonte `cum_rain_24h`), con eccezione: se la lettura più recente è 0 ma la precedente era >0, si preserva la precedente (protezione glitch). **La protezione glitch NON si applica nei 3 run di chiusura serali** (`CLOSING=1` dal workflow, o ora locale ≥22): a fine giornata la finestra Δ24h copre quasi esattamente il giorno di calendario e uno 0 è un dato reale — tenerla attiva congelava la pioggia di ieri trascinata dai run del mattino (bug #17).
- **TOSCANA_STATIONS:** 165 stazioni curate (filtrate da 379) nell'index.html
- **Orari:** 9 run/giorno — i 6 regolari (00:15-20:15 UTC) + 3 run di chiusura ravvicinati (20:40, 21:00, 21:20 UTC = 22:40/23:00/23:20 CEST in estate). Essendo SIR consultabile solo per l'istante attuale (nessuna query storica), un run che scivola dopo mezzanotte per ritardi di GitHub Actions scrive sul giorno SBAGLIATO invece di chiudere quello giusto — successo il 15 luglio 2026: i 2 run di chiusura originari (21:35/21:50 UTC) sono partiti in ritardo di ~55 minuti, finendo entrambi dopo mezzanotte CEST. Anticipati a 20:40-21:20 UTC per lasciare più margine, e portati a 3 tentativi invece di 2 per aumentare le probabilità che almeno uno arrivi in tempo. Nota: come per Alto Adige, l'orario fisso UTC non è consapevole del cambio ora legale/solare — in inverno questi run cadranno un'ora prima in orario locale (21:40/22:00/22:20 CET), stesso compromesso già accettato nel progetto. Il passo "Commit e push" ora riprova fino a 5 volte (10s tra un tentativo e l'altro) anche in caso di conflitto push con altri workflow concorrenti (causa del fallimento del run delle 22:42 UTC del 15 luglio — la raccolta dati era riuscita, solo il push era stato rifiutato).
- **Dati corretti da:** 12 luglio 2026 (switch a SIR)
- **ATTENZIONE:** SIR non ha lat/lon nella tabella pubblica — si usano quelli del base-call CFR (stesso IDStazione tra le due fonti). Se CFR cambia ID o smette di rispondere, il collector si rompe anche se SIR funziona.

### Liguria
- **Fonte:** OMIRL `omirl.regione.liguria.it/Omirl/rest/charts/{shortCode}/Pluvio`
- **Collect:** `collect-liguria.js`
- **Formula:** somma `dataSeries[0]` (incrementi orari) per le ore di ieri (mezzanotte-mezzanotte ora italiana)
- **Orari:** 6 run/giorno
- **Dati corretti da:** 19 giugno 2026
- **ATTENZIONE CRITICA:** l'endpoint `/stations/Pluvio` restituisce solo l'ultimo valore 15-min. NON usarlo per totali giornalieri — cattura solo ~25% della pioggia. Usare SEMPRE `/charts/{shortCode}/Pluvio` che dà 69 ore di serie temporale oraria.
- Il collect fa ~199 chiamate API (una per stazione), processate in batch di 10 con retry.

### Ticino (Svizzera)
- **Fonte:** OASI (Osservatorio Ambientale della Svizzera Italiana) `oasi.ti.ch/web/rest` — API REST pubblica, licenza libera con citazione fonte
- **Collect:** `collect-ticino-gh.js`
- **Formula:** `resolution=d&parameter=Prec` — valore giornaliero GIÀ aggregato dall'API, nessuna formula. L'ultima lettura vince sempre (il dato giornaliero OASI è autoritativo).
- **~50 stazioni** utilizzabili (59 nel dominio meteo, escluse le 8-9 ARPA Lombardia/Piemonte già coperte dai nostri collector — filtro sul campo `owner`)
- **Coordinate:** l'API usa il sistema svizzero LV95 → conversione a WGS84 nel collector (formule approssimate swisstopo, ~1m di precisione)
- **Orari:** 4 run/giorno (00:30, 04:30, 10:30, 16:30 UTC) — ogni run raccoglie IERI + ALTROIERI (consolidamento dei valori marcati "provvisorio"). Il giorno corrente non esiste lato API, e tanto la mappa lo esclude comunque (regola #3).
- **ATTENZIONE — pubblicazione tardiva del giornaliero:** OASI pubblica il totale giornaliero di ieri solo a metà mattina (~07:00-08:30 CEST, a rotazione per stazione; prima la riga esiste ma col valore VUOTO). Scoperto il 18 luglio 2026: al mattino presto la mappa mostrava "nessun dato per ieri" sul Ticino. Fix: se il giornaliero non è ancora pubblicato, il collector somma le letture da 10 minuti (`resolution=h`, disponibili in tempo quasi reale; scarto validato ~3% dal giornaliero ufficiale, accettate solo giornate con ≥120/144 letture) e i run successivi sovrascrivono col valore ufficiale.
- **QUERY STORICHE FUNZIONANTI** (unica fonte del progetto ad averle): qualsiasi giorno passato è interrogabile e i dati sono recuperabili retroattivamente — un run fallito non perde mai dati. Archivio: Airolo dal 2017, Lugano dal 2005 (varia per stazione).
- **Dati corretti da:** 18 marzo 2026 (backfill 120 giorni con dati reali di stazione, script `backfill-ticino.js` una tantum)
- **Confine cantone:** `ticino-confine.geojson` nel repo (da swissBOUNDARIES3D), caricato via `geojsonUrl` (meccanismo dedicato per confini non italiani in `setRegionBorder`)
- **Validazione (16-17 luglio 2026):** allineamento calendario confermato con analisi di lag vs Open-Meteo (corr. 0.73-0.82 stesso giorno, ~0.1 a ±1g); coerenza interna verificata (somma 10-min vs giornaliero: scarto 3%); confronti di confine con Piemonte coerenti col microclima (la sponda ovest del Verbano è genuinamente più piovosa).
- Sviluppato e validato nel repo di test `Mappa-Precipitazioni-Nord-Test` (+ sito avventurepluvio-test.netlify.app), promosso in produzione il 17 luglio 2026.

### Valle d'Aosta
- **Fonte:** Centro Funzionale Regione VdA (`presidi2.regione.vda.it`), dati reali di stazione — **dal 26 luglio 2026, al posto di Open-Meteo** (sviluppato qui nel test, promosso in prod lo stesso giorno)
- **Collect:** `.github/scripts/collect-valledaosta-cf.js` + `valledaosta-cf.yml` (2 run/giorno). Il vecchio `collect-valledaosta-gh.js` (Open-Meteo) resta nel repo ma senza workflow attivo
- **~70 stazioni** (66 Centro Funzionale + 6 Arpa)
- **Dati reali da:** 16 luglio 2026. Prima (17/5→15/7): **backfill Open-Meteo** sulle stesse coordinate (`source: open-meteo-backfill-vda`, script `backfill-openmeteo-pilota.js`). Si legge sempre dai file, nessuno switch runtime; la parte reale cresce di 1 giorno/giorno fino a 365
- **In mappa:** `dataSource: 'cf_valledaosta'`, `loadCFValdostaRegion`, URL dati da `PILOT_DATA_BASE` (nel test → Nord-Test)

### Friuli Venezia Giulia
- **Fonte:** ARPA OSMER (`www.meteo.fvg.it`), dati reali di stazione — **dal 26 luglio 2026, al posto di Open-Meteo** — + 5 stazioni ARPA Veneto di confine (Cadore/Comelico) per l'alta Carnia NW
- **Collect:** `.github/scripts/collect-friuli-osmer.js` + `friuli-osmer.yml` (2 run/giorno). Il vecchio `collect-friuli-gh.js` (Open-Meteo) resta nel repo ma senza workflow attivo
- **~41 stazioni OSMER + 5 Veneto.** Dati reali da 18 luglio 2026; prima (19/5→17/7): backfill Open-Meteo (`source: open-meteo-backfill-friuli`). L'anagrafe del backfill è l'**UNIONE di tutti i file reali** (il feed OSMER pubblica un set variabile, 39-41 staz.)
- **Ricetta OSMER:** ore UTC dal CSV di `getStationData.php` (t=H_2) sommate sul giorno solare italiano; `MIN_ORE=20`; merge a copertura-crescente; cookie di consenso `meteofvg_cookie=1` obbligatorio
- **Due protezioni qualità nel loader `loadOSMERFriuliRegion`:** (1) **filtro copertura** — una stazione OSMER è mostrata solo se presente in ≥80% dei giorni REALI del periodo (nasconde le stazioni a serie oraria bucata, es. Forni di Sopra, San Pietro al Natisone, che davano una macchia secca falsa; l'IDW dei vicini copre); (2) **5 stazioni ARPA Veneto** (Sella Ciampigotto, Santo Stefano di Cadore, Costalta, Domegge, Casamazzagno) lette da `data/veneto` (repo prod), non filtrate, caricate solo se il Veneto non è già selezionato (no doppioni). Fonte → 'ARPA OSMER FVG + ARPA Veneto'. Limite noto: grafico storico vuoto cliccando una delle 5 Veneto
- **In mappa:** `dataSource: 'osmer_fvg'`, URL dati da `PILOT_DATA_BASE` (nel test → Nord-Test)

---

## Bug risolti (cronologico)

### Giugno 2026
1. **Bug DST** — `getTimezoneOffset()` = 0 su GitHub Actions (UTC). Fix: `getItalyOffset()` basata su calendario.
2. **Latenza API notturna** — "aggiorna sempre ieri" ad ogni run per Piemonte, Emilia, Veneto, Trentino, Liguria.
3. **Glitch API Toscana/Alto Adige** — merge MAX per proteggere da 0mm errati.
4. **Lombardia formula** — da `max-min` a `sum(valore)` nella query API.
5. **Veneto formula** — da `max-min` a `max()` su cumulativi.
6. **exit(1) crash** — 5 collect crashavano prima di "aggiorna ieri". Fix: skip salvataggio oggi ma continua con ieri.
7. **Trentino getItalyOffset** — funzione mancante, aggiunta.
8. **Emilia offset +1g** — API ARPAE usa chiave giorno+1. Fix: `dateKeyPlusOne()`. Storico corretto (363 file rinominati).
9. **Piemonte cum_rain_24h** — finestra mobile, non totale giornaliero. Fix: `sum(cum_rain_1h)` + merge MAX.
10. **Toscana sum(Valore)** — Valore è cumulativo, non incremento. Fix: `max(Valore)`.
11. **Liguria undersampling** — `/stations/Pluvio` dava solo ultimo 15min. Fix: endpoint `/charts/{code}/Pluvio` con serie temporale oraria.
12. **Toscana 170 stazioni** — filtro `TOSCANA_STATIONS` per evitare 379 stazioni che sforavano in Emilia.
13. **Piemonte 170 stazioni** — filtro `PIEMONTE_STATIONS`, Ceppo Morelli esclusa.

### Luglio 2026
14. **CFR Toscana inaffidabile — switch a SIR.** Check periodico del 12 luglio ha trovato 234/380 stazioni Toscana (61%) ferme a 0mm per tutti i 21 giorni del periodo "corretto" (22 giugno–12 luglio), incluse stazioni con storico di pioggia reale (Marradi max 59.1mm, Firenzuola max 36.8mm). Confermato con fonte esterna indipendente (Open-Meteo reanalysis su coordinate Marradi: pioggia reale multipli giorni nello stesso periodo). Causa isolata confrontando in tempo reale `cfr.toscana.it/actions.php` (Valore=0) contro `sir.toscana.it/monitoraggio/stazioni.php?type=pluvio` (dati corretti) sulla STESSA stazione, STESSO istante: il feed CFR usato dal collector è rotto per la maggioranza delle stazioni, non i sensori. Fix: nuovo collector `collect-toscana-sir.js` che legge i valori (Δ24h) da SIR e le coordinate dal base-call CFR (affidabile solo per i metadati, stesso IDStazione condiviso tra le due fonti). Rimosse anche 5 stazioni duplicate con Emilia-Romagna rimaste morte su CFR (Pracchia, Bibbiana, Lago Paduli, Firenzuola, Marradi) da `TOSCANA_STATIONS`, ora coperte solo dal punto ARPAE Emilia già presente in mappa. Storico Toscana pre-12 luglio 2026 da considerarsi inaffidabile per larga parte delle stazioni. **Backfill completato il 13 luglio 2026:** dato che né CFR né SIR permettono query storiche (ignorano qualsiasi parametro data, restituiscono sempre l'istante attuale) e l'archivio ufficiale (`sir.toscana.it/rilievi-storici`) richiede un login a cui non abbiamo accesso, i 52 giorni rotti (21 maggio – 11 luglio 2026) sono stati ricostruiti con stime Open-Meteo Archive sulle stesse coordinate stazione (script `backfill-toscana-broken-period.js`, una tantum, non nella pipeline). Questi file hanno `source: "open-meteo-backfill-toscana"` per restare distinguibili dai dati di stazione reali — non sono ARPA/SIR reali, sono la miglior stima disponibile per quel buco.
15. **Toscana: aggiunti 2 run di chiusura a mezzanotte.** L'ultimo run regolare (20:15 UTC) lasciava ~1h45 scoperte prima di mezzanotte; essendo Δ24h una finestra mobile leggibile solo "adesso" (nessun recupero storico possibile), pioggia caduta in quella finestra rischiava di non essere mai contata. Aggiunti due cron aggiuntivi a 21:35 e 21:50 UTC (23:35/23:50 CEST in estate) in `toscana.yml`, che si fanno da backup a vicenda oltre ai 3 tentativi già previsti per ogni run.
16. **Toscana: run di chiusura arrivavano dopo mezzanotte.** Check del 16 luglio ha trovato che i 2 run di chiusura del 15 luglio (bug #15) erano partiti con ~55 minuti di ritardo per congestione di GitHub Actions, atterrando entrambi dopo mezzanotte CEST — scrivendo quindi sul giorno SBAGLIATO (16 luglio) invece di chiudere il 15. Il dato del 15 luglio è rimasto comunque valido (scritto dal run regolare delle 20:15 UTC, non catastrofico ma non ottimale), e uno dei due run di chiusura è anche fallito per una race condition sul push Git con un altro workflow concorrente (raccolta dati riuscita, solo il push rifiutato). Fix: run di chiusura anticipati a 20:40/21:00/21:20 UTC (più margine contro i ritardi) e portati da 2 a 3 tentativi; passo "Commit e push" ora riprova fino a 5 volte in caso di conflitto push.
17. **Toscana: pioggia duplicata sul giorno successivo (Δ24h trascinata + protezione glitch-0).** Verificato il 19 luglio al primo test reale della logica Δ24h (pioggia vera del 15 luglio, ~278mm complessivi): il file del 16 luglio aveva 107 stazioni >0 di cui 74 con valori IDENTICI al 15 (Pontremoli 12.8, Rocca Sigillina 10.4…) — pioggia fantasma, il 16 era asciutto (confermato con Open-Meteo orario: a Pontremoli i 24mm sono caduti il 15 sera, 21:00–23:00). Meccanismo: i run del mattino leggono la finestra Δ24h che contiene ancora la pioggia di ieri sera e la scrivono sul file di oggi (previsto, i run successivi correggono al ribasso); ma in giornata asciutta le letture successive sono 0 e la protezione glitch-0 ("se la nuova lettura è 0 e la precedente >0, preserva la precedente") congelava per sempre il valore trascinato. Effetto a catena: il 17 ereditava i residui del 16, il 19 i 4×0.2 del 18. Fix: nei 3 run di chiusura serali la protezione glitch-0 è disattivata (env `CLOSING=1` impostato in `toscana.yml` sui cron 20:40/21:00/21:20 UTC, con fallback ora locale ≥22 nel collector) — lì "ultima lettura vince" vale anche per lo 0, e il file converge al vero totale del giorno. Rischio residuo accettato: un glitch-0 di SIR esattamente all'ultimo run di chiusura cancellerebbe il dato del giorno. Storico riparato a mano (script una tantum, non in pipeline): azzerate sul 16/7 le 75 stazioni con valore identico al 15/7 più 17 con residuo decaduto (valore >0 ma ≤ a quello del 15/7), tutte le 17 del 17/7 e le 4 del 19/7; i file riparati hanno il campo `repaired`. Restano sul 16/7 sedici stazioni 0.2–1.0mm (Casentino/Mugello, 15/7=0: pioviggine plausibilmente genuina).

18. **Alto Adige: pioggia fantasma da cumulato non azzerato.** Trovato al check periodico del 22 luglio 2026: `data/altoadige/2026-07-22.json` era una copia esatta del 21 (58/58 stazioni con valori identici, 85.1mm totali, max 15.1), mentre l'API interrogata in diretta dava 0.0mm su tutte le stazioni — giornata asciutta. Meccanismo: il cron di chiusura `55 21 UTC` (pensato per le 23:55 CEST) parte in ritardo di 40-70 minuti e atterra alle ~00:40 CEST del giorno dopo — non un caso isolato, succedeva tutti i giorni; in quel momento l'API BZ non aveva ancora azzerato il cumulato di mezzanotte, quindi i totali di ieri sono finiti nel file di oggi, e il **merge MAX** li ha congelati (`max(0, 85.1) = 85.1` ad ogni run successivo, il file non si autoripara mai). Stessa famiglia del bug #17. Fix: (a) guardia nel collector — se il file del giorno non esiste ancora e il payload è identico stazione per stazione al giorno precedente con somma > 0, non scrivere; una coincidenza vera su 58 stazioni è impossibile; (b) cron di chiusura anticipato a `05 21 UTC`. Il file del 22 luglio è stato riscritto a mano con i valori reali dell'API (campo `repaired: true`). Testato in sandbox su 4 scenari: reset mancato → salta; giornata asciutta vera (tutti 0) → scrive; una sola stazione diversa da ieri → scrive; giorno già esistente → merge MAX invariato.

19. **Trentino: il file di oggi era sempre una copia di ieri.** Trovato allo stesso check. L'API `getValoriAggregatiGiornoJson` pubblica l'aggregato di un giorno solo a giornata conclusa, quindi i record per la data odierna non esistono mai durante il giorno; il collector ripiegava sul *"giorno più recente disponibile"* e scriveva quei valori nel file di OGGI. Il file veniva poi corretto dal ramo "aggiorna ieri" del primo run del mattino successivo (03:5x UTC = 05:5x locali). Effetto in mappa: tra mezzanotte e le ~05:50 locali "ieri" mostrava i dati dell'altro ieri — il 21 luglio, per esempio, 417mm di pioggia attribuiti al giorno sbagliato. Lo storico multi-giorno era invece integro, perché ogni file veniva corretto entro il mattino dopo. Fix: rimosso il fallback — se non ci sono record per la data richiesta si salta il salvataggio di oggi e si procede col solo aggiornamento di ieri. Effetto collaterale accettato: nella finestra 00:00-05:50 il Trentino risulta assente da "ieri" invece che sbagliato; per accorciarla è stato aggiunto il cron `30 22 UTC` (00:30 locali). Il file del 22 luglio, copia del 21, è stato cancellato e ricreato dal run successivo.

---

## UI Features
- Spinner di caricamento (overlay CSS, z-index 800)
- YouTube "ISCRIVITI" button nel box canale (nascosto su mobile ≤600px)
- Home icon nell'header
- Pulsanti periodo: Ieri/7gg/10gg/15gg/20gg/30gg
- "Piogge per funghi" (range **15-21 gg fa** dal 7 agosto 2026; 16-23 dal 24 luglio, prima ancora 18-25)
- Date personalizzate
- Nota "I dati escludono la giornata odierna"
- IDW_RAD: 0.15 per ≤24h, 0.35 per periodi più lunghi
- CACHE_VER: arpa5v7_
- Eventi Google Analytics (18 luglio 2026): `analisi_regione` con parametro `regione` in loadData (dimensione personalizzata "Regioni" in GA4), `click_home` e `click_youtube` sui link header/canale
- **Crediti fonte dati dinamici** (22 luglio 2026): il piè di pagina (`#fonte-dati`) e l'attribuzione Leaflet dicevano "ARPA Lombardia" fisso qualunque regione fosse selezionata — scorretto verso le altre agenzie, ed era finito anche nell'anteprima social. Ora `aggiornaCrediti()` li aggiorna dal campo `fonte` delle regioni attive, usando i nomi canonici (`ARPAE Emilia-Romagna`, `SIR Toscana`, `OASI Ticino`…). Nella stessa occasione sono state allineate anche le etichette runtime della chip sulla mappa: cinque regioni dicevano genericamente "🟢 ARPA live" mentre Toscana e Ticino nominavano l'agenzia, ora tutte nominano l'agenzia e l'emoji resta a indicare lo stato (🟢 dati di stazione, 🌍 ripiego Open-Meteo). La chip parte da "Fonte: —" invece che da un nome fisso, perché prima della prima selezione non c'è nessun dato in mappa. L'attribuzione Leaflet si gestisce con `attributionControl.removeAttribution/addAttribution`, non riscrivendo quella del tile layer. Nota: da desktop la mappa è ora **multi-regione** (fino a 3 regioni insieme, dal 25 luglio 2026 — vedi voce dedicata); i crediti uniscono più fonti con ` · `. Su mobile resta single-region (tendina).
- **Anteprima social `preview.jpg`** (rifatta il 22 luglio 2026): 1200×630, Emilia Romagna a 30 giorni con i pannelli visibili, generata con Chrome headless via puppeteer-core (lo script sta in `grafiche-social/node_modules`, non nel repo). L'inquadratura si ottiene misurando l'ingombro dei path `.leaflet-interactive` e calcolando zoom e trascinamento: attenzione che nel contenitore mappa c'è anche la bandierina ucraina dell'attribuzione Leaflet, tre path che se non filtrati falsano la misura. Nei meta il file è referenziato con `?v=20260722` perché i social tengono l'anteprima in cache per URL
- **GA attivo solo sul dominio di produzione** (22 luglio 2026): `gtag('config', ...)` è dentro un controllo `/(^|\.)avventuremicologiche\.it$/` sull'hostname, così l'`index.html` può essere copiato tal quale sul repo di test senza che il sito di test (`avventurepluvio-test.netlify.app`) sporchi le statistiche. Senza `config`, gtag.js non invia nulla e le chiamate `gtag('event',...)` sparse nella pagina restano innocue. La regex copre anche dominio nudo e `www.`, per non perdere il tracking se il sito venisse servito da lì
- **Multiregione desktop** (sviluppata qui nel test, **promossa in produzione il 25 luglio 2026**): su desktop si selezionano fino a **3 regioni** insieme (checkbox; scritta "(MAX 3)" accanto al titolo "Seleziona regione", messaggio "Massimo 3 regioni per volta" in rosso — classe `error`; debounce 550ms sui toggle). Su mobile resta single-region (tendina). `getActiveRegions()` legge le caselle spuntate, l'handler NON deseleziona più le altre; `loadData`→`onRegionDone`→`renderMulti` unisce i dati di tutte le regioni attive e ogni stazione è taggata con `s._region`.
  - **Inquadratura** (`fitMapToRegions`): orizzontale centrata sulla **regione di mezzo** (confina con entrambe le altre, via `REGION_ADJ`+`middleRegion`; ripiego = più vicina al centroide), verticale sul **contenuto reale**. Zoom con **`ZOOM_STEP`** (mezzi/quarti di livello sopra il "tutto visibile" `_fit`, cap a `_fill`) e **`VSHIFT`** (spostamento verticale; >0 abbassa il contenuto — regola #5). `zoomSnap` a **0.25** per il controllo fine (zoomDelta resta 0.5, zoom manuale invariato).
  - **`REGION_BOUNDS`** completa per tutte e **11 le regioni** (senza, la bbox unificata resta invertita e Leaflet zooma sul mondo intero — bug Toscana+Emilia; rete di sicurezza dalla bbox stazioni se una manca).
  - **Performance**: `buildGrid` con pre-check **AABB** + **griglia adattiva** (`activeGridRes` ×1.5/×1.7/×2.4) + campionamento stazioni IDW a 320 → 3 regioni × 30gg da **~16s a ~1s**.
  - **Grafico storico**: usa `s._region` (la regione della stazione cliccata).
- **Condivisione: tasto 📷 Screen (cattura fedele) — SOLO TEST, andrà in prod con la v5.0.** Introdotto il 30/7/2026 insieme al tasto 🔗 Link: `captureMapBlob(scala)` ricompone l'immagine STRATO PER STRATO (tile → confini → heat → marker → pannelli html2canvas) alle posizioni reali a schermo — html2canvas da solo sbaglia gli SVG Leaflet (viewBox negativo + transform contati due volte). Validato contro lo screenshot vero del browser: 0,9% pixel diversi. Tre evoluzioni nello stesso giorno, su segnalazioni dell'utente:
  - **Scatto completo, mai tagliato**: prima fotografava solo la porzione visibile — su finestre basse o contenuto zoomato l'immagine usciva monca (successo con l'Italia intera: Alto Adige fuori). Ora, se le regioni attive non sono tutte in vista, `fitBounds` sull'unione dei `REGION_BOUNDS` attivi prima dello scatto e **ripristino della vista** dell'utente dopo (successo o errore). Padding asimmetrico `paddingTopLeft(440,24)` su desktop: i pannelli di sinistra sono SOVRAPPOSTI alla mappa e un fit centrato nasconde il bordo ovest del contenuto dietro di loro (verificato col Piemonte). Attesa tile della nuova inquadratura con tetto 2,5s + 300ms per il ridisegno di heat/confini.
  - **Header incluso**: il canvas si allunga dell'altezza dell'`<header>` e l'offset sta dentro `rel()` — l'header (a schermo SOPRA `#map`) atterra così esattamente a y=0, reso da html2canvas come gli altri pannelli. Lo scatto è "l'intera finestra", com'è nell'aspettativa dell'utente.
  - **Minimo 2×**: `S=scala||Math.max(2,devicePixelRatio||1)`. Heat, confini, marker e pannelli sono ridisegnati alla scala di scatto → nitidi il doppio; solo i tile OSM (unica risoluzione esistente) vengono riscalati e restano morbidi. Sui telefoni (dpr 2-3) invariato. Peso ~3,5→~12 MB su finestra 1920, tempo di scatto invariato. La stessa funzione serve anche la condivisione immagine da telefono.
  - **Pannelli in UNA passata html2canvas** (refactor, stesso 30/7): prima una chiamata PER pannello (~10) e ognuna ri-clona e ri-analizza l'intera pagina → 8,2s dei 9,2s totali (misurati con cronometro per fase). Ora una sola chiamata su `document.body` con, nel clone, i livelli Leaflet nascosti (già composti a mano) e gli sfondi di body/#map-wrap/#map resi trasparenti (coprirebbero la mappa già disegnata). Vetro come prima; ombre ridisegnate col trucco del **clip evenodd** (si dipinge il rettangolo arrotondato con l'ombra attiva escludendo l'interno: resta solo l'alone). **Scatto: da 9,2 a ~2,0s.** Rivalidato contro lo screenshot vero: 1,51% pixel diversi / scarto medio 0,97 su 255 (il residuo è l'antialiasing dei testi html2canvas, identico a prima).
  - ⚠️ **Trappola di misura**: lo screenshot **con `clip`** di Chrome headless PERDE il canvas della heatmap (bug di composizione GPU: stessa sessione, screenshot intero perfetto, ritagliato senza heat — costata mezz'ora di falsa pista sul refactor). Per le validazioni: screenshot a pagina intera e ritaglio via software.
- **Lo zoom scelto dall'utente ora sopravvive a scatto e link** (7 agosto 2026, SOLO TEST — segnalato dall'utente: «se faccio lo screen non prende lo zoom»). Erano **due difetti distinti**, tutti e due nati da scelte fatte apposta:
  - **L'immagine ignorava lo zoom.** Dal 30/7 `captureMapBlob` allarga la vista se non contiene tutte le regioni attive (rimedio all'immagine tagliata sull'Italia intera). La condizione però non distingue *«il fit automatico non ci sta»* da *«l'utente ha zoomato apposta»*: appena zoomi, la vista non contiene più la regione e lo scatto si riallarga. Misurato: zoom 11,25 → durante la cattura 9. E siccome **la vista viene ripristinata subito dopo**, a schermo non si vedeva nulla: sembrava stregoneria. **Rimedio:** flag `_vistaUtente`, acceso solo da gesti UMANI (`dragstart` — che non scatta sui `panBy` programmatici — più rotellina, pinch a due dita, doppio clic e i bottoni +/−) e spento a ogni nuova analisi e a ogni cambio regione. Lo scatto si allarga solo se il flag è spento.
  - **Il link perdeva lo zoom su TELEFONO.** L'URL conteneva già `z` e `c`, ma chi lo apriva li applicava solo sopra i 900px: sotto, la mappa si riadattava alla regione. Cioè **il 69% di chi riceve un link vedeva un'inquadratura diversa** da quella condivisa. **Rimedio:** zoom e centro si applicano **tali e quali su qualunque schermo**. ⚠️ **Provata e SCARTATA la compensazione sulla larghezza** (parametro `w` + `z − log2(w_mittente/w_suo)`, per mostrare la stessa *porzione di territorio*): messa online e provata dall'utente fra PC e telefono, allargava di due livelli in un verso e stringeva di due nell'altro — «da PC a telefono non zoomava come sul pc, dal telefono al PC zoomava molto di più». Chi condivide si aspetta la stessa **scala**, non la stessa area: il rapporto fra le larghezze è proprio la cosa da NON compensare. Serve anche `_vistaDaLink`, se no su telefono `centraRegioneInStriscia` riporta la vista sulla regione 350 ms dopo.
  - ⚠️ **Trappola del collaudo**: simulare lo zoom con `map.setZoom()` NON prova niente — non è un gesto umano, il flag resta spento e il test dice "rotto" anche quando funziona. Serve la rotellina vera (`page.mouse.wheel`). Verificate **entrambe le facce**: vista stretta programmatica → si allarga ancora (12,25→9, rimedio 30/7 intatto); vista stretta dell'utente → rispettata (15,25→15,25). Link: desktop z=15,25 identico, telefono z=13,25 con lo stesso centro, che è esattamente 15,25 − log2(1440/390).
- **Niente più salti della pagina all'apertura** (30 luglio 2026, corretti insieme in prod e test): il sito, aperto, si assestava con due scatti visibili. Segnalato dall'utente sul primo, il secondo è saltato fuori misurando.
  - **Loader iniziale.** Il `<div id="loader">` (spinner + "Caricamento mappa…") **non aveva nessuna regola CSS** — c'erano solo quelle dei figli (`.spinner`, `#lmsg`, `#lsub`), la sua era andata persa in qualche modifica passata. Restava quindi un blocco statico, primo figlio del `body` (flex column alto `100dvh`), e per tutta la durata del caricamento si prendeva **66px in cima** schiacciando header e mappa; a fine caricamento andava a `display:none` e tutto risaliva di colpo. CLS misurato **0,045 sul test** (0,089 in prod), a scatti perché il riquadro cresceva a gradini man mano che cambiavano i messaggi. Fix: `position:fixed` in basso al centro (`top:40%` sotto i 600px, altrimenti finisce dietro al pannello periodo aperto), `z-index:2500` (a 1200 restava coperto: i pannelli mobile stanno a 2100), `width:max-content` (con `left:50%` la larghezza a contenuto di un `fixed` viene tagliata a metà viewport e il testo andava a capo). **Comparsa ritardata di 2,5s** via `animation-delay`: il caricamento normale dura 1,4s (test) / 1,9s (prod), quindi la pillola non si vede mai — appare solo su rete lenta, così l'utente non pensa che il sito sia bloccato. Ripulito anche `#lsub` quando i confini sono pronti (altrimenti la pillola annunciava una fase già conclusa).
  - **Pannello periodo.** `positionPanels()` (che riaggancia `#time-panel` sotto `#region-panel`) era chiamato **solo** da `setTimeout(..., 100)`: la pagina veniva disegnata col pannello alla posizione del CSS (`top:182px`) e subito dopo spostato a quella vera. **Qui sul test il salto non si vede**, perché il pannello regioni è nascosto (c'è la barra "Clicca sulla mappa…") e il calcolo dà 161px, vicino al valore CSS; in prod invece il pannello regioni è alto 287px e il pannello periodo finisce a 397px, **215px di salto**. Corretto comunque anche qui per parità di codice: chiamata **diretta** oltre al `setTimeout` (che resta come rete di sicurezza e ricalcola lo stesso valore); a quel punto del file il pannello regioni è già stato letto dal parser, quindi la misura è valida. ⚠️ Alla migrazione Italia v5.0 → prod questo torna a contare: se il pannello regioni riappare visibile, il valore `top:182px` del CSS è di nuovo scollegato dalla realtà.
  - **Come misurare** (se si tocca ancora il caricamento): Chrome headless via puppeteer-core in `grafiche-social\node_modules`, `PerformanceObserver` su `layout-shift` (con `sources` per sapere CHI si muove) più campionamento diretto di `getBoundingClientRect()` a intervalli. **Il CLS da solo inganna**: sul sito live resta un residuo di ~0,027 con rettangoli scalati di ~1,08 rispetto a quelli reali — è il ridimensionamento della finestra headless durante il caricamento, non un movimento vero. Fidarsi del campionamento delle posizioni, non del numero.
- **Divergenza test↔prod** (dal 26/7): l'`index.html` è di nuovo sostanzialmente **allineato** — multiregione, VdA (Centro Funzionale) e Friuli (OSMER + backfill + filtro copertura + Veneto) sono ora in ENTRAMBI. L'**unica differenza** sono i RAW URL dei dati: nel test `PILOT_DATA_BASE` (righe ~1772) e il RAW Lombardia (`loadARPALombardiaRegion`) puntano a `Mappa-Precipitazioni-Nord-Test`, in prod a `Mappa-Precipitazioni-Nord`. **Copiando l'index test→prod: `sed 's/Nord-Test/Nord/g'`** (il `VENETO_RAW` del loader Friuli punta già a `Nord` in entrambi — non toccarlo).

---

## Promozione a non-BETA
**Completata il 18 luglio 2026**: header da "(BETA V3.0)" a "(v4.0)", su decisione dell'utente, anticipando il target originale dell'11 agosto 2026 (30 giorni di dati corretti per tutte le regioni; il vincolo più recente era lo switch Toscana a SIR del 12 luglio 2026).

---

## Check periodico dati
Ogni ~5 giorni verificare:
1. Confronto stazioni al confine tra regioni confinanti (stessa pioggia?)
2. Nessun valore anomalo (>150mm/giorno)
3. Nessun calo improvviso nel numero di stazioni
4. Workflow tutti verdi
5. Confronto puntuale con fonti ufficiali (cfr.toscana.it, omirl.regione.liguria.it, apps.arpae.it)
6. **Nessun file giornaliero identico a quello del giorno precedente** (confronto stazione per stazione, non solo del totale): è la firma comune dei bug #17, #18 e #19 — pioggia di ieri trascinata sul giorno dopo. Quando salta fuori, confrontare sempre con l'API interrogata in diretta prima di concludere.


---

## PILOTA SLOVENIA (dal 12 agosto 2026 — solo repo di test)

**ARSO** (Agencija Republike Slovenije za okolje), archivio mezz'orario ufficiale
delle stazioni automatiche. Licenza: riuso libero con **citazione obbligatoria
«Vir: ARSO»** (art. 14 della legge sul servizio meteorologico statale, UL RS
60/17) — voce già in `fonti.html`.

> ⚠️ **La bocciatura del 5/8 era sbagliata, ma per un motivo istruttivo.** Quel
> giorno si guardò il solo campo `rr_val` del feed live (pioggia degli ultimi 10
> minuti, il bug #11 della Liguria) e si concluse che l'archivio era
> irraggiungibile. Due errori: nello stesso XML ci sono anche `tp_1h/12h/24h`, e
> soprattutto **l'endpoint principale in HTTP risponde vuoto, in HTTPS risponde**.
> Regola generale: prima di dichiarare morta una fonte, provare l'HTTPS.

### Come si entra (gli endpoint, che non sono documentati)
- **Anagrafe**: `webmet/archive/locations.xml?lang=si&vars=26&group=halfhourlyData0&type=4&d1=&d2=`
  → **124 stazioni automatiche con id, nome, lat/lon e QUOTA**. Il parametro che
  sblocca tutto è **`type=4`** (stazioni automatiche): senza, risponde
  `points:{}` e sembra un vicolo cieco.
- **Dati**: `webmet/archive/data.xml?vars=26,16,17,21,24&group=halfhourlyData0&type=halfhourly&id=A,B&d1=&d2=`
  → pioggia (26), T min/max (16/17), vento medio e raffica (21/24) in **una sola
  richiesta**. **Massimo 2 stazioni per chiamata** (`max:2` nei settings), ma
  **intervalli di giorni illimitati**: 62 chiamate coprono il paese per quanti
  giorni si vuole.
- ⚠️ Gli **errori 500 di Cocoon sono la documentazione**: dicono in chiaro quale
  parametro manca («parameter id (id postaj)», «column halfhourly does not
  exist»). È così che si è trovata la combinazione giusta.

### La ricetta, e la trappola che l'ha decisa
Le marche temporali sono in **CET FISSO (UTC+1), senza ora legale, e indicano la
FINE della mezz'ora**. Dandole per «ora locale» si sbaglierebbe di un'ora tutta
l'estate. Misurato con la **correlazione oraria transfrontaliera contro
l'Austria**, di cui la convenzione è già accertata, su tre coppie:

| coppia | distanza | dislivello |
|---|---|---|
| Mežica ↔ Feistritz ob Bleiburg | 8,1 km | 54 m |
| Sotinski breg ↔ Bad Gleichenberg | 10,5 km | 146 m |
| Logarska Dolina ↔ Bad Eisenkappel | 11,2 km | 153 m |

D'estate vince **−60 min** (r 0,786 / 0,726 / 0,547) ma **−90 è a un soffio**, e le
due letture coerenti sono «CET fisso + fine» e «ora locale + inizio». ⚠️ **Il test
che scioglie il dubbio è rifare la misura d'INVERNO**, quando l'ora legale non
c'è: con «ora locale» lo sfasamento sarebbe dovuto passare a −30, invece **resta
−60** (r 0,914 e 0,916). Due stagioni, stessa risposta.

Conseguenza: il «giorno» dell'archivio (00:00→23:30) è il giorno CET e **d'estate
non è il giorno solare italiano** — servono sempre **due giornate d'archivio per
un giorno italiano**, come per l'OSMER Friuli. `MIN_MEZZORE=40` su 48.

**Validazione del prodotto finito**: correlazione GIORNALIERA con l'Austria sulle
tre coppie, 29 giorni — **lag 0 = 0,975 / 0,852 / 0,887**, lag ±1 fra −0,11 e
+0,04. I giorni cadono esattamente dove devono.

### Ritardo di pubblicazione ~34 ore — il limite vero
Misurato il 12/8 su 12 stazioni: **D-2 e più vecchi completi (48/48 su tutte),
IERI fermo a 15 mezz'ore (07:00 CET), OGGI vuoto**, uguale per tutte insieme.
Non è un guasto: è il ritmo della piattaforma. Il collector **parte da D-2 e non
scrive mai un giorno incompleto** — un parziale in mappa sembrerebbe una giornata
asciutta, che è peggio di un buco.
**In mappa la Slovenia quindi non ha «Ieri»**: verificato, mostra «⚠️ Nessun dato
per questo periodo» senza errori. Per la finestra funghi (15-21 giorni fa) e per
7/10/15/20/30 giorni non cambia nulla. Se un giorno servisse anche «Ieri», la
strada è il **modello Ticino** (valore provvisorio dal feed live
`observationAms_si_latest.xml`, poi sovrascritto dall'archivio) — ma è la
famiglia di meccanismi dei bug #17/#18/#19: non appenderlo a un run a orario
critico.

### Impianto
- **Collect**: `collect-slovenia-arso.js` + `slovenia.yml` (2 run/giorno, 06:25 e
  14:25 UTC; niente cron di chiusura, non servirebbe a nulla col ritardo di 34h).
  Ogni run ricostruisce D-2..D-9: le query storiche rispondono su qualsiasi data,
  quindi **auto-riparazione gratuita** come Svizzera, Austria e OASI.
- **Backfill**: `backfill-slovenia-arso.js` (una tantum, in locale). Lancia il
  collector vero a blocchi, così la ricetta sta in un posto solo.
  ⚠️ **`SOLO_PIOGGIA=1` per il backfill lungo**: chiedendo anche la temperatura la
  serie passa da 30 a 10 minuti e la stessa chiamata costa **12 secondi invece di
  1,4** (misurato su 60 giorni). Quindi **pioggia un anno indietro, t/w solo sulle
  ultime settimane** — come tutte le altre reti (`METEO_HIST_FROM`).
- **In mappa**: `dataSource:'slovenia'`, `loadSloveniaRegion` (gemello di quello
  austriaco), `loadSloveniaStations` per i pallini di default — ⚠️ **e il ramo in
  `addDefaultMarkersForRegion`, che è esattamente quello dimenticato all'Austria
  il 7/8**. Bordo tratteggiato ed esclusione dalla vista di apertura come gli
  altri esteri. `REGION_ADJ`: slovenia ↔ austria/friuli.
- **Confine**: `slovenia-confine.geojson`, da OpenStreetMap via Nominatim,
  semplificato Douglas-Peucker 56.648→2.660 vertici (~70 m), 52 KB.
  ⚠️ **ODbL**, diversa dalla licenza dei dati: il nostro file è una
  semplificazione e resta ODbL, dichiarato in `fonti.html` (stesso caso del
  confine austriaco CC BY-SA).
  ⚠️ **Trappola del Douglas-Peucker su anelli CHIUSI**: primo e ultimo punto
  coincidono, la retta di riferimento degenera e sopravvivono **due punti**. Va
  spezzato in due catene aperte usando come secondo estremo il punto più lontano
  dal primo.

### Collaudo (12/8, sito servito in locale)
Slovenia sola: 114 stazioni, max 87,3 mm, heatmap disegnata, chip e crediti
«ARSO Slovenia», zero errori. Slovenia + Friuli: **160 stazioni**, crediti uniti,
e la heatmap **attraversa il confine senza gradini**. «Ieri»: vuoto pulito.
⚠️ **Il sito va servito via HTTP anche solo per provarlo**: aperto da `file://`
Chrome blocca il fetch dei GeoJSON, tutti i confini falliscono e la heatmap non
compare — sembra un difetto del codice e non lo è (`python -m http.server`).

### Da fare per la promozione a prod
Spostare `data/slovenia` + collector + workflow + confine nel repo prod,
`PILOT_DATA_BASE`, voce in `fonti.html` di produzione, `check-fonti.js` esteso
(soglia generosa: col ritardo di 34h il file di ieri non esiste MAI, quindi la
soglia va almeno a 4 giorni), e decidere se l'header diventa «… e Slovenia».
