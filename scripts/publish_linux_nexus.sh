#!/usr/bin/env bash
# Publie les paquets Linux du launcher sur Nexus, pour le provisionnement des
# caisses Rocky depuis le dashboard :
#   product/electron_linux/<version>/electron-launcher-<version>.rpm
#   product/electron_linux/<version>/electron-launcher-<version>.deb
#   product/electron_linux/<version>/SHA256SUMS            (envoyé EN DERNIER)
#
# <version> est lue dans le nom du .rpm (artifactName electron-builder) : c'est
# celle que porte ELECTRONLAUNCHER_VERSION dans le .env Nexus des caisses.
#
#   NEXUS_USER=… NEXUS_PASSWORD=… bash scripts/publish_linux_nexus.sh [dist]
set -euo pipefail

DIST="${1:-dist}"
BASE="${NEXUS_BASE_URL:-https://nexus.wynd.eu/repository/integration}"
: "${NEXUS_USER:?NEXUS_USER requis}"
: "${NEXUS_PASSWORD:?NEXUS_PASSWORD requis}"

version_of() { # version_of <fichier> <extension> → version tirée du nom
  basename "$1" | sed -n "s/^electron-launcher-\(.*\)\.$2\$/\1/p"
}

rpm="$(ls "${DIST}"/electron-launcher-*.rpm 2>/dev/null | head -n 1 || true)"
[ -n "${rpm}" ] || { echo "ERREUR aucun paquet .rpm dans ${DIST}" >&2; exit 1; }
VERSION="$(version_of "${rpm}" rpm)"
[ -n "${VERSION}" ] || { echo "ERREUR version illisible dans $(basename "${rpm}")" >&2; exit 1; }

deb="$(ls "${DIST}"/electron-launcher-*.deb 2>/dev/null | head -n 1 || true)"
if [ -n "${deb}" ] && [ "$(version_of "${deb}" deb)" != "${VERSION}" ]; then
  echo "ERREUR versions divergentes : $(basename "${rpm}") et $(basename "${deb}")" >&2
  exit 1
fi

# Noms nus (sans ./) : le dashboard les lit tels quels dans SHA256SUMS.
(
  cd "${DIST}"
  sha256sum "$(basename "${rpm}")" ${deb:+"$(basename "${deb}")"}
) > "${DIST}/SHA256SUMS"

TARGET="${BASE%/}/product/electron_linux/${VERSION}"

upload() { # upload <fichier> — la cible est TARGET/<nom>
  echo "Envoi $(basename "$1") ($(du -h "$1" | cut -f1)) vers ${TARGET}/"
  # --fail-with-body : sans lui, un échec Nexus n'affiche que « error: 500 ».
  curl --fail-with-body --retry 3 --retry-all-errors --retry-delay 5 \
    -u "${NEXUS_USER}:${NEXUS_PASSWORD}" --upload-file "$1" "${TARGET}/$(basename "$1")"
}

upload "${rpm}"
[ -z "${deb}" ] || upload "${deb}"
upload "${DIST}/SHA256SUMS"
echo "Publication OK -> ${TARGET}/"
