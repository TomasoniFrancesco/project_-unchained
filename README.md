# FUCK ZWIFT — Web Edition 🚴

**Piattaforma di ciclismo indoor gratuita e open-source.**  
Funziona interamente nel browser — zero installazione, zero backend.

🌐 **Live:** [tomasonifrancesco.github.io/project_-unchained/](https://tomasonifrancesco.github.io/project_-unchained/)

## 🚀 Come usarlo

### Opzione 1: Locale
```bash
# Serve i file con qualsiasi server HTTP (necessario per ES modules)
npx -y serve .
# Apri http://localhost:3000 in Chrome/Edge
```

### Opzione 2: GitHub Pages
1. Fork/push questa repo su GitHub
2. Settings → Pages → Source: `main` branch, root `/`
3. Apri `https://tuousername.github.io/FUCK_ZWIFT_WEB/`

## 🔧 Requisiti

| Piattaforma | Browser | Supporto |
|---|---|---|
| **macOS** | Chrome, Edge | ✅ Pieno |
| **Windows** | Chrome, Edge | ✅ Pieno |
| **Linux** | Chrome, Edge | ✅ Pieno |
| **Android** | Chrome | ✅ Pieno |
| **iOS** | Safari, Chrome | ❌ Web Bluetooth non supportato |

> **Nota**: Web Bluetooth richiede Chrome o Edge. Firefox e Safari non lo supportano.

## 📁 Struttura

```
FUCK_ZWIFT_WEB/
├── index.html          ← Home page
├── connect.html        ← Connessione trainer BLE
├── routes.html         ← Selezione percorso GPX
├── ride.html           ← HUD pedalata (canvas 3D)
├── history.html        ← Storico attività
├── profile.html        ← Profilo ciclista & Strava
├── setup.html          ← Wizard primo avvio
├── strava-callback.html← OAuth callback Strava
├── css/
│   └── style.css       ← Design system
└── js/
    ├── state.js        ← Stato reattivo (EventTarget)
    ├── ble/
    │   ├── ftms.js     ← Protocollo FTMS (Indoor Bike Data)
    │   └── manager.js  ← Web Bluetooth scan/connect
    ├── engine/
    │   ├── physics.js  ← Modello fisico (pendenza, velocità)
    │   ├── gear.js     ← Sistema marce virtuali
    │   └── ride.js     ← Loop principale della pedalata
    ├── gpx/
    │   ├── parser.js   ← Parser GPX (DOMParser + Haversine)
    │   └── export.js   ← Esportazione GPX + download
    ├── storage/
    │   ├── profile.js  ← Profilo (localStorage)
    │   ├── config.js   ← Configurazione (localStorage)
    │   ├── routes.js   ← Percorsi GPX (IndexedDB)
    │   └── activities.js ← Attività (IndexedDB)
    ├── integrations/
    │   └── strava.js   ← OAuth + upload Strava
    └── data/
        └── default-routes.js ← Percorsi pre-inclusi
```

## ⚡ Funzionalità

- **Web Bluetooth** — Connessione diretta al trainer FTMS
- **Percorsi GPX** — Importa qualsiasi file GPX via drag & drop
- **Canvas 3D** — Visualizzazione strada in tempo reale
- **Sistema marce** — Marce virtuali con offset di resistenza
- **Fisica realistica** — Smoothing pendenza, modello aerodinamico
- **Strava** — Upload automatico delle attività
- **Storico** — Salvato in IndexedDB (persiste nel browser)
- **2 percorsi inclusi** — Col du Galibier e Richmond Flat Loop

## 🔗 Strava Setup

1. Vai su [strava.com/settings/api](https://www.strava.com/settings/api)
2. Crea una nuova app (o modifica quella esistente)
3. Compila i campi così:

| Campo Strava | Valore |
|---|---|
| **Sito Web** | `https://tomasonifrancesco.github.io` |
| **Dominio di callback di autorizzazione** | `tomasonifrancesco.github.io` |

4. Copia **Client ID** e **Client Secret** nella pagina Profile dell'app
5. Clicca **Connetti Strava** — verrai reindirizzato e autorizzato automaticamente

## 📜 Licenza

Open source. Usa come vuoi.
