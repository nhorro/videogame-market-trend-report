#!/usr/bin/env bash
# Run the check and, if it passes, serve the site locally. index.html does not work as a file.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Hace falta Node 18 o más nuevo para el control." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Hace falta python3 para servir el sitio." >&2
  exit 1
fi

if [[ ! -d node_modules/@duckdb/duckdb-wasm ]]; then
  echo "Instalando DuckDB-Wasm para el control. El sitio publicado no lo usa."
  npm install
fi

node test/control.mjs

echo
echo "Control ok. Sirviendo en http://127.0.0.1:8080"
echo "Panorama: 114.172 títulos. En Explorar, el preset Point & click narrativo."
echo "Ctrl+C para cortar."
echo
exec python3 -m http.server 8080 --bind 127.0.0.1
