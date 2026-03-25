#!/bin/bash
set -e

echo "============================================"
echo "  Local Whisper - Setup Script"
echo "============================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found: $(command -v $1)"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

# 1. Check Node.js
echo "--- Checking prerequisites ---"
check_command node || {
    echo -e "${RED}Please install Node.js first: https://nodejs.org${NC}"
    exit 1
}

# 2. Check Rust
if ! check_command rustc; then
    echo -e "${YELLOW}Installing Rust...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 3. Check Python
check_command python3 || {
    echo -e "${RED}Please install Python 3.10+: https://www.python.org${NC}"
    exit 1
}

# 4. Check pnpm
if ! check_command pnpm; then
    echo -e "${YELLOW}Installing pnpm...${NC}"
    npm install -g pnpm
fi

echo ""
echo "--- Installing frontend dependencies ---"
pnpm install

echo ""
echo "--- Setting up Python virtual environment ---"
cd python-sidecar

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "--- Downloading default models ---"
python3 -c "
import asyncio
import sys
sys.path.insert(0, '.')
from model_manager import ModelManager
from pathlib import Path
import os

app_data = Path.home() / 'Library' / 'Application Support' / 'local-whisper' / 'models'
if sys.platform != 'darwin':
    app_data = Path.home() / '.local' / 'share' / 'local-whisper' / 'models'
app_data.mkdir(parents=True, exist_ok=True)

async def download():
    mm = ModelManager(app_data)
    print('Downloading SenseVoice-Small ASR model...')
    await mm.download_model('asr', 'sensevoice-small')
    print('Downloading Qwen2.5-0.5B LLM model...')
    await mm.download_model('llm', 'qwen2.5-0.5b')
    print('Done!')

asyncio.run(download())
"

cd ..

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "To start the app in development mode:"
echo "  source python-sidecar/venv/bin/activate"
echo "  cd python-sidecar && python server.py &"
echo "  cd .. && pnpm tauri dev"
echo ""
