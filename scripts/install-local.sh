#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${1:-}"
if [[ -z "${DATA_DIR}" ]]; then
  echo "usage: ./scripts/install-local.sh /path/to/napgram/data"
  echo "example: ./scripts/install-local.sh ../NapGram/main/data"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_JSON="${ROOT}/package.json"
META_JSON="${ROOT}/napgram-plugin.json"

ID="$(node -p "JSON.parse(require('fs').readFileSync('${META_JSON}','utf8')).id")"
VER="$(node -p "require('${PKG_JSON}').version")"

echo "[1/3] build..."
(cd "${ROOT}" && pnpm build)

DEST_DIR="${DATA_DIR}/plugins/local"
DEST_FILE="${DEST_DIR}/${ID}.mjs"
echo "[2/3] copy to ${DEST_FILE} ..."
mkdir -p "${DEST_DIR}"
if [[ -f "${ROOT}/dist/index.mjs" ]]; then
  cp -f "${ROOT}/dist/index.mjs" "${DEST_FILE}"
else
  cp -f "${ROOT}/dist/index.js" "${DEST_FILE}"
fi

echo "[3/3] next steps:"
echo "  - Restart NapGram, or call: POST /api/admin/plugins/reload"
echo "  - Or reload only this plugin: POST /api/admin/plugins/${ID}/reload"
