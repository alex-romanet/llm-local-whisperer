#!/usr/bin/env bash

CONTAINER_NAME="llm-whisper"

GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${DIM}  Stopping Whisper server...${RESET}"
  docker stop "${CONTAINER_NAME}" &>/dev/null
  docker rm "${CONTAINER_NAME}" &>/dev/null
  echo -e "  ${GREEN}✓ Whisper server stopped${RESET}"
else
  echo -e "  Whisper server is not running."
fi
