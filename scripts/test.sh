#!/usr/bin/env bash
set -euo pipefail

echo "[test] Ejecutando suite reproducible dentro del contenedor api-test..."
docker compose run --rm api-test
