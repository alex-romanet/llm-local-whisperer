#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${CYAN}  llm-local-whisperer — setup${RESET}"
echo -e "${DIM}  ──────────────────────────────────────────${RESET}"
echo ""

# ── 1. sox ────────────────────────────────────────────────────────────
echo -e "  ${YELLOW}[1/4]${RESET} Checking sox..."

if command -v sox &>/dev/null; then
  echo -e "        ${GREEN}✓ sox already installed${RESET}"
else
  if command -v brew &>/dev/null; then
    echo -e "        Installing sox via Homebrew..."
    brew install sox
    echo -e "        ${GREEN}✓ sox installed${RESET}"
  elif command -v apt-get &>/dev/null; then
    echo -e "        Installing sox via apt..."
    sudo apt-get install -y sox
    echo -e "        ${GREEN}✓ sox installed${RESET}"
  else
    echo -e "        ${RED}✗ Could not install sox automatically.${RESET}"
    echo -e "          Install manually: https://sox.sourceforge.net"
    exit 1
  fi
fi

# ── 2. Docker ─────────────────────────────────────────────────────────
echo ""
echo -e "  ${YELLOW}[2/4]${RESET} Checking Docker..."

if ! command -v docker &>/dev/null; then
  echo -e "        ${RED}✗ Docker is not installed.${RESET}"
  echo -e "          Install from: https://docker.com"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo -e "        ${RED}✗ Docker is not running. Start Docker Desktop and try again.${RESET}"
  exit 1
fi

echo -e "        ${GREEN}✓ Docker is running${RESET}"

# ── 3. Whisper server ─────────────────────────────────────────────────
echo ""
echo -e "  ${YELLOW}[3/4]${RESET} Starting Whisper STT server..."
bash "${SCRIPT_DIR}/whisper-start.sh"

# ── 4. Build ──────────────────────────────────────────────────────────
echo ""
echo -e "  ${YELLOW}[4/4]${RESET} Building..."

cd "${SCRIPT_DIR}/.."
npm run build --silent
echo -e "        ${GREEN}✓ Build complete${RESET}"

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}  ──────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}Setup complete.${RESET} What to do next:"
echo ""
echo -e "    ${CYAN}npm run config${RESET}   set your LLM endpoint + model"
echo -e "    ${CYAN}npm start${RESET}        start talking"
echo ""
