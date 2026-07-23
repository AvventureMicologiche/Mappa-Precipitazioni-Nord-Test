# Mappa Precipitazioni Nord Italia — CLAUDE.md (REPO DI TEST)

> **Questo è il repo di TEST.** Ambiente di sperimentazione, sito `avventurepluvio-test.netlify.app`. Deploya da GitHub in automatico dal 22 luglio 2026 (build saltata sui commit di soli `data/`). L'`index.html` è tenuto allineato a produzione (stesso file), e i crediti/GA si comportano come lì grazie al controllo sull'hostname. Il resto di questo CLAUDE.md è una copia della documentazione di produzione, tenuta qui per contesto; la sezione **PILOTA MeteoHub** qui sotto è invece specifica del test.

## Progetto
Mappa interattiva delle precipitazioni del Nord Italia per il canale YouTube "Avventure Micologiche". Mostra dati pluviometrici reali da stazioni ARPA regionali su heatmap Leaflet.

- **Sito test:** avventurepluvio-test.netlify.app
- **Prod:** precipitazioni.avventuremicologiche.it
- **Repo test:** github.com/AvventureMicologiche/Mappa-Precipitazioni-Nord-Test
- **Repo prod:** github.com/AvventureMicologiche/Mappa-Precipitazioni-Nord
- **Stack:** Leaflet 1.9.4, OpenStreetMap, Netlify (hosting + Functions), GitHub Actions (data collection)

---

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
- **Ticino disattivato in questo repo** (22 luglio 2026): `ticino.yml` ha i cron commentati e l'`index.html` legge il Ticino dal repo di produzione (in prod dal 17 luglio). Resta lanciabile a mano da `workflow_dispatch`

---

## Regole fondamentali

1. **Lo storico precipitazioni deve essere SEMPRE accurato e completo.** Mai accettare dati parziali o sbagliati come "non catastrofici". Ogni problema va risolto completamente.
1b. **Retention: max 365 giorni di storico per regione.** Finestra scorrevole: ogni nuovo giorno raccolto elimina il più vecchio oltre i 365. Ogni collector DEVE avere il blocco "Pulizia retention" a fine main() (uniformato a tutti i collector il 16 luglio 2026 — prima lo avevano solo Piemonte, Emilia, Veneto e Liguria, le altre regioni erano arrivate a 417-420 giorni).
2. **Verifica prima di procedere:** spiega le modifiche proposte e aspetta l'approvazione esplicita prima di toccare qualsiasi file.
3. **La mappa mostra solo "ieri" e periodi passati.** I dati della giornata odierna sono esclusi dalla visualizzazione.
4. **Open-Meteo si usa SOLO per Valle d'Aosta e Friuli.** Tutte le altre regioni usano dati di stazione reali (ARPA regionali, SIR Toscana, OASI Ticino).
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
- **PIEMONTE_STATIONS:** 170 stazioni curate (filtrate da 275) nell'index.html. Ceppo Morelli esclusa (sensore offline). MONTE MALANOTTE (id 106, Cuneo) NON è in lista e non va aggiunta: pluviometro guasto dal 16 luglio 2026 — pioggia fantasma per giorni consecutivi (fino a 136mm/giorno) con Open-Meteo a 0.0, vicini asciutti e sensori temperatura/umidità null. I valori errati restano nei file grezzi `data/piemonte/` (16-20 luglio+) ma non arrivano mai in mappa (filtro applicato prima dell'accumulo). Ricontrollare ai check periodici se il sensore torna sano.
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
- **Fonte:** Open-Meteo `precipitation_sum`
- **Collect:** `collect-valledaosta-gh.js`
- **~45 stazioni**
- **Dati corretti da:** 4 giugno 2026

### Friuli Venezia Giulia
- **Fonte:** Open-Meteo `precipitation_sum`
- **Collect:** `collect-friuli-gh.js`
- **~30 stazioni**
- **Dati corretti da:** 4 giugno 2026

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
- "Piogge per funghi" (range 18-25 gg fa)
- Date personalizzate
- Nota "I dati escludono la giornata odierna"
- IDW_RAD: 0.15 per ≤24h, 0.35 per periodi più lunghi
- CACHE_VER: arpa5v7_
- Eventi Google Analytics (18 luglio 2026): `analisi_regione` con parametro `regione` in loadData (dimensione personalizzata "Regioni" in GA4), `click_home` e `click_youtube` sui link header/canale
- **Crediti fonte dati dinamici** (22 luglio 2026): il piè di pagina (`#fonte-dati`) e l'attribuzione Leaflet dicevano "ARPA Lombardia" fisso qualunque regione fosse selezionata — scorretto verso le altre agenzie, ed era finito anche nell'anteprima social. Ora `aggiornaCrediti()` li aggiorna dal campo `fonte` delle regioni attive, usando i nomi canonici (`ARPAE Emilia-Romagna`, `SIR Toscana`, `OASI Ticino`…). Nella stessa occasione sono state allineate anche le etichette runtime della chip sulla mappa: cinque regioni dicevano genericamente "🟢 ARPA live" mentre Toscana e Ticino nominavano l'agenzia, ora tutte nominano l'agenzia e l'emoji resta a indicare lo stato (🟢 dati di stazione, 🌍 ripiego Open-Meteo). La chip parte da "Fonte: —" invece che da un nome fisso, perché prima della prima selezione non c'è nessun dato in mappa. L'attribuzione Leaflet si gestisce con `attributionControl.removeAttribution/addAttribution`, non riscrivendo quella del tile layer. Nota: la mappa è **single-region** — l'handler dei checkbox alla riga ~3710 deseleziona esplicitamente le altre ad ogni cambio, anche se `getActiveRegions()` restituisce un array (residuo di un disegno multi-regione mai completato); i crediti uniscono comunque più fonti con ` · ` se un giorno viene riabilitato
- **Anteprima social `preview.jpg`** (rifatta il 22 luglio 2026): 1200×630, Emilia Romagna a 30 giorni con i pannelli visibili, generata con Chrome headless via puppeteer-core (lo script sta in `grafiche-social/node_modules`, non nel repo). L'inquadratura si ottiene misurando l'ingombro dei path `.leaflet-interactive` e calcolando zoom e trascinamento: attenzione che nel contenitore mappa c'è anche la bandierina ucraina dell'attribuzione Leaflet, tre path che se non filtrati falsano la misura. Nei meta il file è referenziato con `?v=20260722` perché i social tengono l'anteprima in cache per URL
- **GA attivo solo sul dominio di produzione** (22 luglio 2026): `gtag('config', ...)` è dentro un controllo `/(^|\.)avventuremicologiche\.it$/` sull'hostname, così l'`index.html` può essere copiato tal quale sul repo di test senza che il sito di test (`avventurepluvio-test.netlify.app`) sporchi le statistiche. Senza `config`, gtag.js non invia nulla e le chiamate `gtag('event',...)` sparse nella pagina restano innocue. La regex copre anche dominio nudo e `www.`, per non perdere il tracking se il sito venisse servito da lì

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
