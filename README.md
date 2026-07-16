# 🍄 Mappa Precipitazioni Nord Italia

Mappa interattiva delle precipitazioni cumulate in Nord Italia e Toscana, con dati storici fino a 12 mesi.

**Sito:** [precipitazioni-nord-italia.netlify.app](https://precipitazioni-nord-italia.netlify.app)  
**Autore:** [Avventure Micologiche](https://www.youtube.com/@avventuremicologiche)

---

## Regioni disponibili

| Regione | Fonte dati | Aggiornamento |
|---------|-----------|---------------|
| Lombardia | ARPA Lombardia (Socrata live) | Giornaliero |
| Piemonte | ARPA Piemonte (live) | Giornaliero |
| Veneto | ARPAV (XML live) | Giornaliero |
| Liguria | ARPA Liguria (OMIRL) | Giornaliero |
| Emilia-Romagna | ARPAE Emilia-Romagna | Giornaliero |
| Toscana | CFR Toscana | Giornaliero |

---

## Stack tecnico

- **Mappa:** [Leaflet.js](https://leafletjs.com) + OpenStreetMap
- **Backend:** Netlify Functions
- **Automazione:** GitHub Actions (raccolta dati giornaliera)
- **Dati storici:** File JSON in `data/<regione>/YYYY-MM-DD.json`
- **Fallback:** Open-Meteo Archive per dati storici > 15 giorni

---

## Struttura repository

```
├── netlify/functions/     # Funzioni serverless raccolta dati live
├── scripts/               # Script GitHub Actions raccolta giornaliera
├── data/
│   ├── liguria/           # JSON giornalieri precipitazioni Liguria
│   ├── piemonte/          # JSON giornalieri precipitazioni Piemonte
│   ├── veneto/            # JSON giornalieri precipitazioni Veneto
│   ├── emilia/            # JSON giornalieri precipitazioni Emilia-Romagna
│   └── toscana/           # JSON giornalieri precipitazioni Toscana
├── .github/workflows/     # Workflow automazione GitHub Actions
└── index.html             # Frontend single-page
```

---

## Licenza

© 2024-2026 Avventure Micologiche — All Rights Reserved.  
Vedere il file [LICENSE](./LICENSE) per i dettagli.
