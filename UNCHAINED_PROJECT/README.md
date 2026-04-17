# 🚴 UNCHAINED PROJECT — Your Ride. Your Rules.

Un'app di ciclismo indoor open-source che si connette al tuo smart trainer via Bluetooth e simula percorsi GPX reali.

## Funzionalità

- 🔗 **Connessione BLE** a smart trainer FTMS (Tacx, Wahoo, Elite, Van Rysel, ecc.)
- 🎮 **Supporto controller** Zwift Click v2 e Zwift Play (con crittografia X25519)
- 🗺️ **Percorsi GPX** — carica qualsiasi traccia GPX e pedalala in simulazione
- ⚙️ **Simulazione fisica** — pendenza, resistenza, velocità, potenza
- 🏔️ **Cambio virtuale** — 21 marce con offset di pendenza regolabile
- 📊 **Storico attività** — salvataggio locale automatico con stats dettagliate
- 🔶 **Upload Strava** — sincronizza le pedalate con il tuo account Strava
- 👤 **Profilo ciclista** — calcolo calorie personalizzato

---

## 🚀 Installazione (macOS)

### Primo avvio — una sola volta

1. **Apri Terminale** (cerca "Terminale" con Spotlight, o vai in Applicazioni → Utility)

2. **Trascina la cartella** `UNCHAINED_PROJECT` dentro la finestra del Terminale, così:
   ```
   cd [trascina la cartella qui e premi Invio]
   ```

3. **Esegui l'installer**:
   ```bash
   bash install.sh
   ```
   Lo script installerà tutto automaticamente (~2 minuti):
   - Python 3.12 (se non presente)
   - Ambiente virtuale Python
   - Tutte le dipendenze

4. **Chiudi il Terminale** — hai finito!

### Ogni volta che vuoi usare l'app

1. Apri la cartella `UNCHAINED_PROJECT`
2. **Fai doppio clic su `start.command`**
3. Il browser si aprirà automaticamente su `http://localhost:5050` 🎉
4. Per chiudere l'app: chiudi la finestra del Terminale

> **Nota macOS**: al primo avvio, macOS potrebbe chiedere il permesso di aprire il file. In quel caso: tasto destro → "Apri" → conferma.

---

## ⚙️ Configurazione

### Primo avvio

Al primo avvio l'app ti guiderà nella configurazione tramite un **wizard nel browser**:
- **Profilo ciclista** — nome, peso, età (per il calcolo calorie)
- **Strava** — collegamento opzionale al tuo account

### Strava (opzionale)

Per collegare Strava, servono le credenziali della tua app Strava:

1. Vai su [strava.com/settings/api](https://www.strava.com/settings/api)
2. Clicca "Create an App" e compila il form
3. Nel campo **"Authorization Callback Domain"** scrivi: `localhost`
4. Copia **Client ID** e **Client Secret** nel wizard di setup

### Configurazione avanzata

Il file `config.toml` contiene impostazioni avanzate (numero marce, parametri fisici, keyword BLE). Vedi `config.example.toml` per tutti i parametri disponibili.

---

## 🗺️ Aggiungere Percorsi GPX

Metti i tuoi file `.gpx` nella cartella:
```
UNCHAINED_PROJECT/data/routes/
```

L'app li caricherà automaticamente nella sezione **Routes**.

---

## 🛠 Avvio da Terminale (avanzato)

Se preferisci avviare da terminale:

```bash
cd /percorso/a/UNCHAINED_PROJECT
source .venv/bin/activate
python run.py --port 5050
```

Opzioni disponibili:
- `--port 5050` — porta del server (default: 5050)
- `--host 0.0.0.0` — host di ascolto
- `--debug` — modalità debug (non richiede trainer connesso)

---

## 📁 Struttura dati

```
UNCHAINED_PROJECT/
├── data/
│   ├── routes/          ← I tuoi file GPX
│   ├── activities/      ← Attività salvate (auto)
│   ├── exports/         ← File GPX esportati
│   ├── profile.json     ← Profilo ciclista
│   └── strava_tokens.json ← Token Strava (auto)
├── config.toml          ← Configurazione personale
├── install.sh           ← Installer (una sola volta)
└── start.command        ← Launcher (doppio clic)
```

---

## ❓ Problemi comuni

| Problema | Soluzione |
|---|---|
| **macOS blocca start.command** | Tasto destro → "Apri" → Conferma |
| **"Porta già in uso"** | L'app è già in esecuzione, apri `http://localhost:5050` |
| **Trainer non trovato** | Assicurati che il trainer sia acceso e non connesso ad altre app (Zwift, ecc.) |
| **Bluetooth non funziona** | Vai in Preferenze di Sistema → Privacy → Bluetooth → consenti Terminal |
| **Python non trovato** | Riesegui `bash install.sh` |

---

## 📜 Licenza

Uso personale. Your ride, your rules.
