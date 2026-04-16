#!/bin/bash
# ============================================================
#  FUCK ZWIFT — Installer (macOS)
#
#  Esegui una sola volta:   bash install.sh
#
#  Lo script:
#    1. Installa Python 3.12 (se manca) via Homebrew
#    2. Crea un virtual environment (.venv)
#    3. Installa le dipendenze Python
#    4. Crea il config.toml di base (se non esiste)
#    5. Crea il launcher start.command per doppio clic
# ============================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'  # Reset

echo ""
echo -e "${GREEN}${BOLD}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}  ║   FUCK ZWIFT — Installer              ║${NC}"
echo -e "${GREEN}${BOLD}  ║   Your ride. Your rules.               ║${NC}"
echo -e "${GREEN}${BOLD}  ╚═══════════════════════════════════════╝${NC}"
echo ""

# Switch to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}[1/5]${NC} Verifica Python..."

# Find Python ≥ 3.11 (needed for tomllib)
PYTHON_CMD=""

# Try common Python commands
for cmd in python3.12 python3.13 python3.11 python3; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
        major=$(echo "$ver" | cut -d. -f1)
        minor=$(echo "$ver" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
            PYTHON_CMD="$cmd"
            echo -e "  ${GREEN}✓${NC} Trovato: $cmd ($ver)"
            break
        fi
    fi
done

# If not found, install via Homebrew
if [ -z "$PYTHON_CMD" ]; then
    echo -e "  ${YELLOW}⚠${NC} Python ≥ 3.11 non trovato. Installazione in corso..."
    
    # Install Homebrew if missing
    if ! command -v brew &>/dev/null; then
        echo -e "  ${YELLOW}→${NC} Installazione Homebrew (gestore di pacchetti macOS)..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add brew to PATH for Apple Silicon Macs
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
    
    echo -e "  ${YELLOW}→${NC} Installazione Python 3.12..."
    brew install python@3.12
    PYTHON_CMD="python3.12"
    
    if ! command -v "$PYTHON_CMD" &>/dev/null; then
        PYTHON_CMD="$(brew --prefix python@3.12)/bin/python3.12"
    fi
    
    echo -e "  ${GREEN}✓${NC} Python 3.12 installato"
fi

# Verify
"$PYTHON_CMD" -c "import sys; assert sys.version_info >= (3,11), 'Python >= 3.11 required'" 2>/dev/null || {
    echo -e "  ${RED}✗ Errore: Python >= 3.11 è necessario. Installa manualmente da python.org${NC}"
    exit 1
}


echo -e "${CYAN}[2/5]${NC} Creazione ambiente virtuale..."

if [ -d ".venv" ]; then
    echo -e "  ${GREEN}✓${NC} .venv esiste già"
else
    "$PYTHON_CMD" -m venv .venv
    echo -e "  ${GREEN}✓${NC} .venv creato"
fi

# Activate venv
source .venv/bin/activate


echo -e "${CYAN}[3/5]${NC} Installazione dipendenze..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo -e "  ${GREEN}✓${NC} Dipendenze installate"


echo -e "${CYAN}[4/5]${NC} Configurazione..."

if [ ! -f "config.toml" ]; then
    # Create minimal config — the setup wizard will fill in the rest
    cat > config.toml << 'TOML'
# FUCK ZWIFT — Configurazione
# Le credenziali Strava possono essere configurate dal browser
# al primo avvio (pagina Setup).

[strava]
client_id = ""
client_secret = ""
TOML
    echo -e "  ${GREEN}✓${NC} config.toml creato (configurabile dal browser)"
else
    echo -e "  ${GREEN}✓${NC} config.toml già presente"
fi

# Ensure data directory structure exists
mkdir -p data/routes data/activities data/exports
echo -e "  ${GREEN}✓${NC} Directory dati pronte"


echo -e "${CYAN}[5/5]${NC} Creazione launcher..."

cat > start.command << 'LAUNCHER'
#!/bin/bash
# ============================================
#  FUCK ZWIFT — Launcher
#  Fai doppio clic per avviare l'app
# ============================================

# Vai alla directory dell'app
cd "$(dirname "$0")"

# Attiva l'ambiente Python
source .venv/bin/activate

# Porta
PORT=5050

# Controlla se la porta è già in uso
if lsof -i :$PORT &>/dev/null; then
    echo ""
    echo "⚠  La porta $PORT è già in uso."
    echo "   L'app potrebbe essere già in esecuzione."
    echo "   Apri: http://localhost:$PORT"
    echo ""
    open "http://localhost:$PORT"
    read -p "Premi Invio per chiudere questa finestra..."
    exit 0
fi

echo ""
echo "  🚴  FUCK ZWIFT — Avvio in corso..."
echo ""

# Apri il browser dopo 2 secondi (in background)
(sleep 2 && open "http://localhost:$PORT") &

# Avvia l'app
python run.py --port $PORT

# Se l'app si chiude, chiedi prima di chiudere il terminale
echo ""
echo "  L'app si è chiusa."
read -p "  Premi Invio per chiudere questa finestra..."
LAUNCHER

chmod +x start.command
echo -e "  ${GREEN}✓${NC} start.command creato"


echo ""
echo -e "${GREEN}${BOLD}  ══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅  Installazione completata!${NC}"
echo -e "${GREEN}${BOLD}  ══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Per avviare l'app:${NC}"
echo -e "    Fai doppio clic su ${CYAN}start.command${NC}"
echo ""
echo -e "  ${BOLD}Oppure da terminale:${NC}"
echo -e "    source .venv/bin/activate"
echo -e "    python run.py --port 5050"
echo ""
echo -e "  Al primo avvio, l'app ti guiderà nella"
echo -e "  configurazione di Strava dal browser."
echo ""
