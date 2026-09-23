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
#
# Variables optionnelles :
#   EXPECTED_VERSION  si définie, doit être égale à la version portée par le
#                      .rpm (le tag de release l'annonce) — sinon échec avant
#                      tout appel réseau.
#   FORCE=1            autorise de republier une version déjà présente sur
#                       Nexus (écrase SHA256SUMS et les paquets en place).
set -euo pipefail

DIST="${1:-dist}"
BASE="${NEXUS_BASE_URL:-https://nexus.wynd.eu/repository/integration}"

# Pas de `: "${VAR:?...}"` : ça tue le script avant que le trap EXIT (mis en
# place plus bas pour le netrc temporaire) ne soit actif, et se comporte mal
# sous bash 3.2 combiné à un trap EXIT.
if [ -z "${NEXUS_USER:-}" ]; then
  echo "ERREUR NEXUS_USER requis" >&2
  exit 1
fi
if [ -z "${NEXUS_PASSWORD:-}" ]; then
  echo "ERREUR NEXUS_PASSWORD requis" >&2
  exit 1
fi

version_of() { # version_of <fichier> <extension> → version tirée du nom
  basename "$1" | sed -n "s/^electron-launcher-\(.*\)\.$2\$/\1/p"
}

rpm_count="$(ls "${DIST}"/electron-launcher-*.rpm 2>/dev/null | wc -l | tr -d ' ')" || true
[ "${rpm_count}" -le 1 ] || { echo "ERREUR plusieurs paquets .rpm dans dist : un seul attendu" >&2; exit 1; }
rpm="$(ls "${DIST}"/electron-launcher-*.rpm 2>/dev/null | head -n 1 || true)"
[ -n "${rpm}" ] || { echo "ERREUR aucun paquet .rpm dans ${DIST}" >&2; exit 1; }
VERSION="$(version_of "${rpm}" rpm)"
[ -n "${VERSION}" ] || { echo "ERREUR version illisible dans $(basename "${rpm}")" >&2; exit 1; }

deb_count="$(ls "${DIST}"/electron-launcher-*.deb 2>/dev/null | wc -l | tr -d ' ')" || true
[ "${deb_count}" -le 1 ] || { echo "ERREUR plusieurs paquets .deb dans dist : un seul attendu" >&2; exit 1; }
deb="$(ls "${DIST}"/electron-launcher-*.deb 2>/dev/null | head -n 1 || true)"
if [ -n "${deb}" ]; then
  if [ "$(version_of "${deb}" deb)" != "${VERSION}" ]; then
    echo "ERREUR versions divergentes : $(basename "${rpm}") et $(basename "${deb}")" >&2
    exit 1
  fi
else
  echo "  !! aucun .deb dans dist : seul le .rpm est publié"
fi

# Tag ↔ version : avant tout appel réseau (avant même le calcul de SHA256SUMS).
if [ -n "${EXPECTED_VERSION:-}" ] && [ "${EXPECTED_VERSION}" != "${VERSION}" ]; then
  echo "ERREUR le tag annonce ${EXPECTED_VERSION} mais le paquet est en ${VERSION}" >&2
  exit 1
fi

# Noms nus (sans ./) : le dashboard les lit tels quels dans SHA256SUMS.
(
  cd "${DIST}"
  sha256sum "$(basename "${rpm}")" ${deb:+"$(basename "${deb}")"}
) > "${DIST}/SHA256SUMS"

TARGET="${BASE%/}/product/electron_linux/${VERSION}"

# Identifiants via un netrc temporaire : jamais en clair sur la ligne de
# commande curl (visible dans `ps`/les logs CI). Supprimé par un trap EXIT
# qui préserve le code de sortie réel du script.
NETRC=""
cleanup() {
  local ec=$?
  [ -z "${NETRC:-}" ] || rm -f "${NETRC}"
  exit "${ec}"
}
trap cleanup EXIT

umask 077
NETRC="$(mktemp)"
NEXUS_HOST="${BASE#*://}"
NEXUS_HOST="${NEXUS_HOST%%/*}"
{
  printf 'machine %s\n' "${NEXUS_HOST}"
  printf 'login %s\n' "${NEXUS_USER}"
  printf 'password %s\n' "${NEXUS_PASSWORD}"
} > "${NETRC}"

# Immuabilité : une version déjà publiée n'est jamais écrasée sans FORCE=1.
# Un échec de la vérification (ni 200 ni 404 : 000, 401, 5xx…) n'est JAMAIS
# traité comme "absent" — mieux vaut bloquer que republier par erreur.
head_code="$(curl -s -o /dev/null -w '%{http_code}' --netrc-file "${NETRC}" -I "${TARGET}/SHA256SUMS" || true)"
case "${head_code}" in
  200)
    if [ "${FORCE:-0}" != "1" ]; then
      echo "ERREUR version ${VERSION} déjà publiée sur Nexus : incrémenter la version, ou FORCE=1" >&2
      exit 1
    fi
    ;;
  404) ;;
  *)
    echo "ERREUR vérification Nexus impossible (HTTP ${head_code})" >&2
    exit 1
    ;;
esac

upload() { # upload <fichier> — la cible est TARGET/<nom>
  echo "Envoi $(basename "$1") ($(du -h "$1" | cut -f1)) vers ${TARGET}/"
  # --fail-with-body : sans lui, un échec Nexus n'affiche que « error: 500 ».
  curl --fail-with-body --retry 3 --retry-all-errors --retry-delay 5 \
    --netrc-file "${NETRC}" --upload-file "$1" "${TARGET}/$(basename "$1")"
}

upload "${rpm}"
[ -z "${deb}" ] || upload "${deb}"
upload "${DIST}/SHA256SUMS"
echo "Publication OK -> ${TARGET}/"
