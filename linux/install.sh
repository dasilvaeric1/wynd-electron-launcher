#!/usr/bin/env bash
# ==============================================================================
#  Electron Launcher — installeur / updater Linux
# ==============================================================================
#  Distributions supportées :
#    - RHEL / Rocky / AlmaLinux / CentOS Stream / Fedora  (dnf, yum)  → .rpm
#    - Debian / Ubuntu                                     (apt-get)  → .deb
#
#  Usage — one-liner depuis une caisse neuve ou à mettre à jour :
#      curl -fsSL https://<dashboard>/install/launcher.sh | sudo bash
#
#  Usage — depuis un paquet déjà téléchargé (hors ligne) :
#      sudo ./install.sh /chemin/electron-launcher-2.9.0.rpm
#
#  Variables d'environnement (utiliser `sudo -E` pour les propager) :
#      EL_BASE_URL=https://…    racine du dashboard qui sert le manifeste
#      EL_CHANNEL=stable        canal du manifeste                (défaut stable)
#      EL_FORCE=1               réinstalle même si déjà à la bonne version
#      EL_NO_VERIFY=1           saute la vérification SHA256      (à éviter)
#
#  Le paquet natif porte les dépendances (nss, gtk3, libdrm…) : c'est le
#  gestionnaire de paquets qui les résout, pas ce script. C'est toute la raison
#  de préférer .rpm/.deb à un tarball déposé dans /opt.
# ==============================================================================
set -euo pipefail

PKG_NAME="wynd-electron-launcher"
BASE_URL="${EL_BASE_URL:-https://dashboard-api-production-bee9.up.railway.app}"
CHANNEL="${EL_CHANNEL:-stable}"
FORCE="${EL_FORCE:-0}"
NO_VERIFY="${EL_NO_VERIFY:-0}"
LOCAL_PKG="${1:-}"

say()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ préconditions
[[ "${EUID}" -eq 0 ]] || die "Ce script doit être lancé en root : sudo ./install.sh"

DISTRO_PRETTY="inconnue"; DISTRO_ID=""; DISTRO_LIKE=""
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_PRETTY="${PRETTY_NAME:-${NAME:-inconnue}}"
  DISTRO_ID="${ID:-}"; DISTRO_LIKE="${ID_LIKE:-}"
fi

case " ${DISTRO_ID} ${DISTRO_LIKE} " in
  *rhel*|*fedora*|*centos*) PKG_FAMILY="rpm" ;;
  *debian*|*ubuntu*)        PKG_FAMILY="deb" ;;
  *) die "Distribution non reconnue (${DISTRO_PRETTY}). Installez le .rpm ou le .deb à la main." ;;
esac

ARCH="$(uname -m)"
[[ "${ARCH}" == "x86_64" ]] || die "Architecture ${ARCH} non publiée — seul x86_64 est buildé."

say "Cible : ${DISTRO_PRETTY} (${ARCH}) — paquet ${PKG_FAMILY}"

if [[ "${PKG_FAMILY}" == "rpm" ]]; then
  PKG_TOOL="$(command -v dnf || command -v yum || true)"
else
  PKG_TOOL="$(command -v apt-get || true)"
fi
[[ -n "${PKG_TOOL}" ]] || die "Aucun gestionnaire de paquets utilisable trouvé."

# --------------------------------------------------------- version déjà installée
installed_version() {
  if [[ "${PKG_FAMILY}" == "rpm" ]]; then
    rpm -q --qf '%{VERSION}' "${PKG_NAME}" 2>/dev/null || true
  else
    dpkg-query -W -f='${Version}' "${PKG_NAME}" 2>/dev/null || true
  fi
}

CURRENT="$(installed_version)"
if [[ -n "${CURRENT}" ]]; then
  say "Version installée : ${CURRENT}"
else
  say "Aucune version installée — première pose"
fi

# ------------------------------------------------------------------ quel paquet ?
TMP_DIR="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '${TMP_DIR}'" EXIT

if [[ -n "${LOCAL_PKG}" ]]; then
  # ---- Mode hors ligne : paquet fourni en argument.
  [[ -f "${LOCAL_PKG}" ]] || die "Paquet introuvable : ${LOCAL_PKG}"
  PKG_PATH="${LOCAL_PKG}"
  say "Paquet local : ${PKG_PATH}"
else
  # ---- Mode connecté : le manifeste du dashboard fait autorité sur la version.
  command -v curl >/dev/null 2>&1 || die "curl est requis pour l'installation en ligne."
  MANIFEST_URL="${BASE_URL%/}/install/launcher/manifest.json?platform=${PKG_FAMILY}&channel=${CHANNEL}"
  say "Manifeste : ${MANIFEST_URL}"

  MANIFEST="$(curl -fsSL --retry 3 --retry-delay 2 --max-time 30 "${MANIFEST_URL}")" \
    || die "Manifeste injoignable. Vérifiez EL_BASE_URL et la connectivité."

  # Extraction sans jq : il n'est pas garanti présent sur une caisse.
  json_field() { printf '%s' "${MANIFEST}" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"; }
  VERSION="$(json_field version)"
  URL="$(json_field url)"
  SHA256="$(json_field sha256)"

  [[ -n "${VERSION}" && -n "${URL}" ]] || die "Manifeste illisible : ${MANIFEST}"
  say "Version publiée : ${VERSION}"

  if [[ "${CURRENT}" == "${VERSION}" && "${FORCE}" != "1" ]]; then
    ok "Déjà en ${VERSION} — rien à faire (EL_FORCE=1 pour réinstaller)."
    exit 0
  fi

  PKG_PATH="${TMP_DIR}/${PKG_NAME}-${VERSION}.${PKG_FAMILY}"
  say "Téléchargement…"
  curl -fSL --retry 3 --retry-delay 2 --progress-bar -o "${PKG_PATH}" "${URL}" \
    || die "Téléchargement échoué : ${URL}"

  # Le paquet n'est pas signé : le SHA256 du manifeste est le SEUL contrôle
  # d'intégrité. Le sauter laisse passer un binaire tronqué ou substitué.
  if [[ "${NO_VERIFY}" == "1" ]]; then
    warn "Vérification SHA256 désactivée (EL_NO_VERIFY=1)."
  elif [[ -z "${SHA256}" ]]; then
    warn "Le manifeste ne porte pas de sha256 — intégrité non vérifiée."
  else
    say "Vérification de l'empreinte…"
    GOT="$(sha256sum "${PKG_PATH}" | cut -d' ' -f1)"
    [[ "${GOT}" == "${SHA256}" ]] || die "Empreinte invalide.
  attendu : ${SHA256}
  obtenu  : ${GOT}"
    ok "Empreinte conforme"
  fi
fi

# ------------------------------------------------------------------- installation
# L'app tourne dans la session graphique de l'utilisateur, pas en service : le
# gestionnaire de paquets remplacerait les fichiers sous ses pieds. On l'arrête
# d'abord, l'opérateur la relance ensuite.
if pgrep -f "/opt/electron-launcher/${PKG_NAME}" >/dev/null 2>&1; then
  say "Arrêt de l'instance en cours"
  pkill -f "/opt/electron-launcher/${PKG_NAME}" 2>/dev/null || true
  for _ in $(seq 1 15); do
    pgrep -f "/opt/electron-launcher/${PKG_NAME}" >/dev/null 2>&1 || break
    sleep 1
  done
  pkill -9 -f "/opt/electron-launcher/${PKG_NAME}" 2>/dev/null || true
fi

say "Installation du paquet"
if [[ "${PKG_FAMILY}" == "rpm" ]]; then
  if [[ "${FORCE}" == "1" && "${CURRENT}" == "${VERSION:-}" ]]; then
    "${PKG_TOOL}" reinstall -y "${PKG_PATH}"
  else
    "${PKG_TOOL}" install -y "${PKG_PATH}"
  fi
else
  # apt-get install sur un .deb local résout les dépendances, contrairement à
  # dpkg -i qui échouerait en laissant le paquet « à moitié configuré ».
  DEBIAN_FRONTEND=noninteractive "${PKG_TOOL}" install -y --allow-downgrades "${PKG_PATH}"
fi

NEW="$(installed_version)"
[[ -n "${NEW}" ]] || die "Le paquet ne ressort pas comme installé — voir la sortie ci-dessus."

# ---------------------------------------------------------------------- SELinux
# Les .so d'Electron doivent être exécutables par la session utilisateur. Sur un
# système Enforcing, des fichiers posés hors politique sortent mal étiquetés.
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" == "Enforcing" ]]; then
  if command -v restorecon >/dev/null 2>&1; then
    say "SELinux Enforcing — réétiquetage de /opt/electron-launcher"
    restorecon -RF /opt/electron-launcher >/dev/null 2>&1 || \
      warn "restorecon a échoué — si l'app refuse de démarrer, regardez ausearch -m AVC"
  fi
fi

# ------------------------------------------------------------------ vérification
[[ -x "/opt/electron-launcher/${PKG_NAME}" ]] || die "Binaire absent après installation."

if [[ -n "${CURRENT}" && "${CURRENT}" != "${NEW}" ]]; then
  ok "Mis à jour : ${CURRENT} → ${NEW}"
else
  ok "Installé en ${NEW}"
fi

cat <<TXT

  Configuration : ~/.config/electron-launcher/config.ini  (par utilisateur)
  Logs          : ~/.config/electron-launcher/logs/
  Lancement     : depuis la session graphique, ou
                  wynd-electron-launcher --ozone-platform=wayland

  La configuration et les logs vivent dans le HOME : ni l'un ni l'autre n'est
  touché par une mise à jour du paquet.
TXT
