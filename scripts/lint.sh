#!/usr/bin/env bash
set -euo pipefail

echo "[lint] Ejecutando lint + format..."
pnpm lint
pnpm format
