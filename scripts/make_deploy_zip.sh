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

# 2/3. Production de l'artefact selon le mode
#
#   MODE=bare    (défaut) → l'artefact .zip EST le PE brut renommé.
#                 C'est ce qu'attend `control_center.ps1 -update electron` :
#                 la fonction copie le fichier téléchargé DIRECTEMENT comme
#                 electron-launcher.exe, SANS décompresser. Un vrai zip
#                 produirait « application 16 bits / incompatible 64 bits ».
#   MODE=archive          → vraie archive avec arborescence Electron-Launcher/
#                 (cfg/launch/portable). Format du provisioning autodeploy,
#                 PAS de `update electron`.
# Défaut = archive (arborescence Electron-Launcher/cfg|launch|portable) :
# c'est le format consommé par le canal de déploiement réel. MODE=bare (PE
# brut renommé) reste dispo pour l'ancien `update electron` qui copie le
# fichier tel quel sans décompresser.
MODE="${MODE:-archive}"
mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

if [[ "$MODE" == "bare" ]]; then
  echo "[deploy] mode=bare → PE brut renommé (compatible 'update electron')"
  cp "$BUILT_EXE" "$ZIP_PATH"
elif [[ "$MODE" == "archive" ]]; then
  echo "[deploy] mode=archive → arborescence Electron-Launcher/ (provisioning autodeploy)"
  rm -rf "$STAGE"
  mkdir -p "$STAGE/portable"
  cp -R "$SCAFFOLD/." "$STAGE/"
  rm -f "$STAGE/portable/.gitkeep"
  cp "$BUILT_EXE" "$STAGE/portable/${PORTABLE_NAME}"
  ( cd "deploy/out/stage" && zip -r -q "$ROOT/$ZIP_PATH" "Electron-Launcher" )
else
  echo "[deploy] ERREUR : MODE inconnu '$MODE' (attendu: bare|archive)" >&2
  exit 1
fi

# 4. Manifest (intégrité)
# Portables macOS (BSD) ET Linux (CI) : stat -f%z vs -c%s, shasum vs sha256sum,
# xxd peut manquer sur l'image CI.
SHA="$( (shasum -a 256 "$ZIP_PATH" 2>/dev/null || sha256sum "$ZIP_PATH") | awk '{print $1}')"
SIZE="$(stat -f%z "$ZIP_PATH" 2>/dev/null || stat -c%s "$ZIP_PATH")"
MAGIC="$(command -v xxd >/dev/null 2>&1 && xxd -l 2 -p "$ZIP_PATH" || head -c2 "$ZIP_PATH" | od -An -tx1 | tr -d ' \n')"   # 4d5a=MZ (PE)  504b=PK (zip)
echo "[deploy] OK (mode=$MODE)"
echo "         fichier : $ZIP_PATH"
echo "         taille  : $SIZE octets"
echo "         sha256  : $SHA"
echo "         magic   : $MAGIC $([[ "$MAGIC" == 4d5a ]] && echo '(MZ = PE Windows ✓ pour update electron)' || echo '(PK = archive zip)')"
echo
if [[ "$MODE" == "archive" ]]; then
  echo "         contenu :"
  unzip -l "$ZIP_PATH" | sed 's/^/         /'
  echo
fi
echo "         → upload Nexus : product/electron_zip/Electron-Launcher_${VERSION}.zip"
echo "         → BO .env       : ELECTRONLAUNCHER_VERSION=${VERSION}"
