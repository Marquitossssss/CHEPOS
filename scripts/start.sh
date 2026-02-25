#!/usr/bin/env bash
set -euo pipefail

echo "[start] Levantando stack completo con Docker Compose..."
docker compose up --build
