# Migrazione Italia v5.0 — test → produzione

Checklist operativa scritta il **31 luglio 2026**, quando la migrazione era vicina ma non ancora fatta.
Da seguire in ordine. Le trappole del punto 1 sono cose viste guardando i due repo, non ipotesi.

- **Da:** `Mappa-Precipitazioni-Nord-Test` → `avventurepluvio-test.netlify.app` (v5.0, tutta Italia)
- **A:** `Mappa-Precipitazioni-Nord` → `precipitazioni.avventuremicologiche.it` (v4.0, solo Nord)
- **Vincolo aperto:** il bollettino pluviometrico di luglio della Puglia decide il futuro di MeteoHub. Se dice che la pioggia del 27/7 la Regione ce l'ha, la perdita è a valle e un domani ha senso bypassare MeteoHub; se non ce l'ha, i collector diretti erediterebbero lo stesso buco. La migrazione si può fare comunque — cambia solo cosa faremo dopo.

---

## 0. Prima di toccare qualsiasi cosa

- [ ] Backup di **prod** e **test** con data + slug (rotazione: 4 prod, 2 test)
- [ ] Entrambi i repo puliti e sincronizzati (`git status` vuoto, niente da pushare)
- [ ] Nessun workflow in corso (i collector committano su `data/`: una migrazione a metà di un run si scontra sul push)

---

## 1. Le tre trappole — leggere PRIMA di copiare

### ⛔ Non copiare `data/` in blocco

Le cartelle del Nord nel repo di test sono **ferme a metà luglio**, perché il sito di test legge i dati del Nord direttamente dal raw di produzione e nessuno le aggiorna. Fotografia del 31/7/2026:

| cartella | nel test | in produzione |
|---|---|---|
| altoadige | 418 file, ultimo **16/07** | 366 file, ultimo 31/07 |
| emilia | 365 file, ultimo **16/07** | 366 file, ultimo 31/07 |
| toscana | 419 file, ultimo **16/07** | 366 file, ultimo 31/07 |
| trentino | 420 file, ultimo **16/07** | 365 file, ultimo 30/07 |
| veneto, piemonte, liguria | idem, fermi al 15-16/07 | aggiornati |

Una copia integrale **cancellerebbe due settimane di dati reali** e rimetterebbe dentro le cartelle da 418-420 file, cioè quelle di prima della retention a 365 giorni. Si copiano **solo le cartelle `meteohub-*`**.

Fresche anche nel test (perché lì i loro workflow girano davvero): `friuli-osmer`, `valledaosta-cf`, `lombardia`, `ticino`. Non serve copiarle: in produzione sono già uguali o più avanti.

### ⛔ `meteohub-lombardia` non si copia e non si sorveglia

**Deciso il 31/7/2026: non va in produzione.** Era la rete di controllo per il confronto con la verità ARPA, non ha mai alimentato la mappa (in Lombardia i dati sono e restano ARPA Socrata) ed è ferma dal 26/7. La cartella `data/meteohub-lombardia` resta nel repo di test come storico del confronto già fatto.

Non deve finire né in `data/` di produzione né nelle liste dei controlli: una regione ferma per scelta, se sorvegliata, manda una mail il primo giorno e un promemoria ogni tre, per sempre.

### ⛔ I `.js` nella cartella principale non c'entrano

In tutte e due i repo, alla radice, ci sono vecchie copie dei collector (`collect-emilia.js`, `populate-history-*.js`, `diagnose-toscana.js`…). La pipeline usa **solo** `.github/scripts/`. Non toccarli e non farsi ingannare quando si confrontano i due repo.

---

## 2. Cosa copiare, esattamente

**Sito**
- [ ] `index.html` — porta con sé header `(v5.0)`, titolo «Mappa Pluviometrica Italia», le 22 regioni, il tasto Screen rifatto e le etichette dei tasti per dispositivo
- [ ] `preview.jpg` — anteprima Italia intera a 30 giorni, 2606 stazioni

**Pipeline MeteoHub**
- [ ] `.github/scripts/collect-meteohub.js`
- [ ] `.github/scripts/check-meteohub-gaps.js`
- [ ] `.github/workflows/meteohub.yml` (5 run: 02:20, 04:20, 07:20, 11:50, 17:50 UTC)
- [ ] `.github/workflows/meteohub-gaps.yml` (08:40 UTC)

**Dati**
- [ ] `data/meteohub-{marche,umbria,lazio,molise,campania,puglia,basilicata,calabria,sicilia,sardegna}/` — dieci cartelle, **senza** `meteohub-lombardia`
- [ ] `data/meteohub-gaps.json` — il registro degli eventi. **Serve**: è la fonte della verità della metrica "frequenza dei buchi" e senza di lui il gapfill ripartirebbe da zero riaprendo eventi già chiusi

---

## 3. Modifiche dopo la copia

- [ ] `sed 's/Nord-Test/Nord/g' index.html` — due punti: `PILOT_DATA_BASE` (~riga 2000) e l'URL raw della Lombardia (~riga 2897). `HIST_RAW` e quello del Piemonte puntano già a prod
- [ ] **og:image e twitter:image** (~righe 37 e 45): da `https://avventurepluvio-test.netlify.app/preview.jpg?v=...` a `https://precipitazioni.avventuremicologiche.it/preview.jpg?v=...`. Il `?v=` va **cambiato** (es. `?v=20260801`), altrimenti i social continuano a servire l'anteprima vecchia dalla cache
- [ ] Niente da fare su Google Analytics: il `gtag('config')` è già condizionato all'hostname `avventuremicologiche.it`, quindi si accende da solo passando in prod e resta spento sul test
- [ ] Decidere che fare di `index-5.html` nel test (160 KB, non referenziato): non copiarlo

---

## 4. I controlli automatici — il punto che si dimentica

Dopo la migrazione la produzione avrà **tre** sorveglianze. Due funzionano da sole, la terza no.

### ✅ Buchi Nord — `check-gaps-nord.js` + `gaps-nord.yml` (09:10 UTC)
Nessuna modifica. Ha la sua lista di 11 cartelle del Nord, non tocca il Sud e non deve farlo.

### ✅ Buchi MeteoHub — `check-meteohub-gaps.js` + `meteohub-gaps.yml` (08:40 UTC)
Funziona così com'è una volta copiato con il suo registro. Ha già dentro le 10 reti attive, grazia 2 giorni, rileva buchi totali **e parziali** (sotto il 90% della mediana della finestra).

### ⚠️ Allarme via mail — `check-fonti.js` + `alert-fonti.yml` (09:30 UTC)
**Va esteso, altrimenti il Sud resta muto.** Due cose, non una:

**(a) Aggiungere le 10 regioni MeteoHub alla lista `REGIONI`** — meccanico. Nome cartella `meteohub-<regione>`, workflow `meteohub.yml`, sito `https://meteohub.agenziaitaliameteo.it/`. Soglia 3 giorni va bene anche per loro: la grazia del gapfill MeteoHub è 2, quindi la mail arriva un giorno dopo l'inizio della copertura.

**(b) Il controllo sulle stazioni ridotte, da solo, NON basta per MeteoHub.** Dal 31/7/2026 `check-fonti.js` sorveglia anche i giorni sotto il 50% delle stazioni — ma su MeteoHub quel conteggio è ingannevole: `check-meteohub-gaps.js` **integra** le stazioni mancanti dentro il file marcandole `om:true`, quindi dopo la copertura il file torna pieno e il giorno sembra sano. Il 27/7 la Puglia aveva 0 stazioni buone su 128, la Basilicata 50 su 61, il Molise 23 su 28: guasti gravissimi che, guardati a copertura avvenuta, non si vedono più.

**Come farlo senza duplicare logica:** far leggere a `check-fonti.js` il registro `data/meteohub-gaps.json`, che quei giorni parziali li ha già misurati **prima** della copertura e li ha datati. Regola: se una rete MeteoHub ha **3 giorni consecutivi** con eventi (`mancante` o `parziale`) che finiscono a ieri, parte la mail. Nessuna soglia nuova da tarare e si sfrutta una misura già validata sul campo.

### Nessun controllo per l'Abruzzo, ed è corretto
È `dataSource: 'open_meteo'`, calcolato al volo dal browser: non ha cartella dati né collector, non c'è niente che possa "smettere di arrivare". Se Open-Meteo è giù la mappa non mostra nulla per quel momento e basta.

---

## 5. Verifiche dopo la migrazione

- [ ] Il sito di produzione carica tutte le regioni e la selezione multipla (max 3) funziona
- [ ] **Una regione del Nord a 30 giorni dà lo stesso totale di prima** della migrazione — è il controllo che smaschera un `data/` sovrascritto
- [ ] Lanciare a mano `meteohub.yml` e verificare che scriva in `data/meteohub-*` del repo di **produzione**
- [ ] Lanciare `alert-fonti.yml` con `simula: puglia:4` e verificare che la mail nomini la Puglia (prova che il punto 4a è stato fatto)
- [ ] Aprire il sito e controllare i crediti fonte in fondo: devono dire MeteoHub quando si seleziona una regione del Sud
- [ ] Passare l'URL di produzione in un validatore di anteprime social e vedere che `preview.jpg` sia quello nuovo
- [ ] Il giorno dopo: controllare che i workflow MeteoHub abbiano girato in prod e che quelli sul repo di test siano stati **spenti** (cron commentati), altrimenti due repo scrivono gli stessi dati

---

## 6. Dopo, da aggiornare

- [ ] `CLAUDE.md` di produzione: regioni, fonti, versione da v4.0 a v5.0, e la voce sull'allarme fonti esteso
- [ ] Backup di produzione con lo slug della migrazione
