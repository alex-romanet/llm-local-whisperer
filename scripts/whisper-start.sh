#!/usr/bin/env bash

CONTAINER_NAME="llm-whisper"
IMAGE="onerahmet/openai-whisper-asr-webservice:latest"
MODEL="${WHISPER_MODEL:-tiny}"
PORT="${WHISPER_PORT:-9000}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

# Already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "        ${GREEN}✓ Whisper already running on http://localhost:${PORT}${RESET}"
  exit 0
fi

# Remove any stopped container with the same name
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker rm "${CONTAINER_NAME}" &>/dev/null
fi

echo -e "        Starting Whisper (model: ${MODEL})..."

# Capture docker run output so errors are visible
DOCKER_OUTPUT=$(docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${PORT}:9000" \
  -e ASR_MODEL="${MODEL}" \
  "${IMAGE}" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "        ${RED}✗ Failed to start container:${RESET}"
  echo -e "          ${DOCKER_OUTPUT}"
  exit 1
fi

echo -e "        Waiting for Whisper to be ready..."

for i in $(seq 1 30); do
  if docker logs "${CONTAINER_NAME}" 2>&1 | grep -qE "Application startup complete|Uvicorn running|Started server"; then
    echo -e "        ${GREEN}✓ Whisper server running on http://localhost:${PORT}${RESET}"
    exit 0
  fi
  sleep 2
done

echo -e "        ${YELLOW}⚠ Still loading. Check: npm run whisper:logs${RESET}"
