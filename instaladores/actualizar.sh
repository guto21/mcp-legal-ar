#!/usr/bin/env bash
# ============================================================
#  Actualizar mcp-legal-ar - Mac y Linux (con git)
#
#  Un solo paso: baja los cambios, reinstala dependencias y te
#  recuerda reiniciar Claude Desktop. Para consumidores que
#  clonaron el repo con git.
#
#  Uso:  bash instaladores/actualizar.sh
# ============================================================
set -euo pipefail

# Raiz del repo = carpeta padre de /instaladores. Se autodetecta.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO"

if [[ ! -d .git ]]; then
  echo "No encuentro un repo git en $REPO."
  echo "Si bajaste el ZIP sin git, usa actualizar-sin-git.sh"
  exit 1
fi

echo "[1/3] Bajando cambios del repositorio..."
git pull

echo "[2/3] Reinstalando dependencias..."
npm install
npm install --prefix servers/legal-mcp

echo "[3/3] Listo."
echo
echo "IMPORTANTE: para que Claude tome la version nueva tenes que"
echo "reiniciar Claude Desktop. Cerralo del todo (en Mac, boton derecho"
echo "en el icono del Dock y Salir) y volve a abrirlo."
