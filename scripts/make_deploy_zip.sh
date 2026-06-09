#!/usr/bin/env bash
#
# make_deploy_zip.sh — produit l'artefact de déploiement Nexus pour le
# control-center (commande `update electron`).
#
# Structure de l'archive (identique au format historique 1.19.0) :
#
#   Electron-Launcher/
#   ├── cfg/config.ini                       (scaffold, versionné)
#   ├── launch/anycommerce.bat               (scaffold, versionné)
#   ├── launch/logo.ico                      (scaffold, versionné)
#   └── portable/
#       ├── cacert.pem                       (scaffold, versionné)
#       └── electron-launcher-<version>.exe  (build, injecté)
#
# Sortie : deploy/out/electron_zip/Electron-Launcher_<version>.zip
#          → à uploader sur Nexus sous :
#            product/electron_zip/Electron-Launcher_<version>.zip
#            (ou projects/<project>/electron_zip/… pour un déploiement projet)
#
# Usage :
#   scripts/make_deploy_zip.sh            # version = celle de package.json
#   scripts/make_deploy_zip.sh 2.0.0      # version explicite
#   SKIP_BUILD=1 scripts/make_deploy_zip.sh   # réutilise le .exe déjà packagé
#
# Prérequis pour le packaging Windows depuis macOS : wine dans le PATH
# (/opt/homebrew/bin) + electron-builder.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
PORTABLE_NAME="electron-launcher-${VERSION}.exe"
BUILT_EXE="dist/electron-launcher-${VERSION}-x64-portable.exe"

SCAFFOLD="deploy/scaffold/Electron-Launcher"
STAGE="deploy/out/stage/Electron-Launcher"
OUT_DIR="deploy/out/electron_zip"
ZIP_PATH="${OUT_DIR}/Electron-Launcher_${VERSION}.zip"

echo "[deploy] version : ${VERSION}"

# 1. Build (sauf si SKIP_BUILD=1)
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[deploy] stamp build_info…"
  node scripts/stamp_build.js
  echo "[deploy] packaging portable x64 (electron-builder + wine)…"
  PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/electron-builder --win portable --x64
fi

if [[ ! -f "$BUILT_EXE" ]]; then
  echo "[deploy] ERREUR : portable introuvable : $BUILT_EXE" >&2
  echo "         (lance sans SKIP_BUILD, ou vérifie artifactName dans package.json)" >&2
  exit 1
fi

# 2. Assemblage du stage à partir du scaffold versionné
echo "[deploy] assemblage de l'arborescence…"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$SCAFFOLD/." "$STAGE/"
mkdir -p "$STAGE/portable"
cp "$BUILT_EXE" "$STAGE/portable/${PORTABLE_NAME}"

# 3. Zip (root = Electron-Launcher/)
echo "[deploy] création du zip…"
mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"
( cd "deploy/out/stage" && zip -r -q "$ROOT/$ZIP_PATH" "Electron-Launcher" )

# 4. Manifest (intégrité)
SHA="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
SIZE="$(stat -f%z "$ZIP_PATH")"
echo "[deploy] OK"
echo "         fichier : $ZIP_PATH"
echo "         taille  : $SIZE octets"
echo "         sha256  : $SHA"
echo
echo "         contenu :"
unzip -l "$ZIP_PATH" | sed 's/^/         /'
echo
echo "         → upload Nexus : product/electron_zip/Electron-Launcher_${VERSION}.zip"
echo "         → BO .env       : ELECTRONLAUNCHER_VERSION=${VERSION}"
