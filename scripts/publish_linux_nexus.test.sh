#!/usr/bin/env bash
# Tests du script de publication Linux. Aucun envoi réel : curl est simulé.
#   bash scripts/publish_linux_nexus.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/publish_linux_nexus.sh"
FAILS=0
fail() { echo "ÉCHEC: $*"; FAILS=$((FAILS + 1)); }

setup() {
  T="$(mktemp -d)"
  mkdir -p "${T}/fakes" "${T}/dist"
  export FAKE_LOG="${T}/curl.log"
  : > "${FAKE_LOG}"
  # Faux curl : journalise le fichier envoyé, la cible et l'identité ; succès.
  cat > "${T}/fakes/curl" <<'EOF'
#!/bin/sh
file=""; target=""; user=""
while [ $# -gt 0 ]; do
  case "$1" in
    --upload-file) file="$2"; shift 2 ;;
    -u) user="$2"; shift 2 ;;
    http*) target="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$(basename "$file") -> $target (as $user)" >> "$FAKE_LOG"
EOF
  chmod +x "${T}/fakes/curl"
  # macOS n'a pas sha256sum (le runner CI alpine l'a, via coreutils).
  if ! PATH=/usr/bin:/bin command -v sha256sum >/dev/null 2>&1; then
    printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' > "${T}/fakes/sha256sum"
    chmod +x "${T}/fakes/sha256sum"
  fi
  export PATH="${T}/fakes:/usr/bin:/bin"
  export NEXUS_USER="ci-user" NEXUS_PASSWORD="s3cret-pass"
}
teardown() { rm -rf "${T}"; }

# 1. Cas nominal : .rpm puis .deb puis SHA256SUMS, dans le dossier de la version.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
base="https://nexus.wynd.eu/repository/integration/product/electron_linux/2.9.1"
sed -n 1p "${FAKE_LOG}" | grep -qF "electron-launcher-2.9.1.rpm -> ${base}/electron-launcher-2.9.1.rpm (as ci-user:s3cret-pass)" \
  || fail "le .rpm doit partir en premier, avec l'identité CI"
sed -n 2p "${FAKE_LOG}" | grep -qF "electron-launcher-2.9.1.deb -> ${base}/electron-launcher-2.9.1.deb" \
  || fail "le .deb doit partir en second"
sed -n 3p "${FAKE_LOG}" | grep -qF "SHA256SUMS -> ${base}/SHA256SUMS" \
  || fail "SHA256SUMS doit partir en dernier"
grep -qE '^[a-f0-9]{64}  electron-launcher-2\.9\.1\.rpm$' "${T}/dist/SHA256SUMS" \
  || fail "SHA256SUMS au format sha256sum, nom nu sans ./"
if grep -q 's3cret-pass' "${T}/out.txt"; then fail "le mot de passe ne doit pas apparaître dans la sortie"; fi
teardown

# 2. Aucun .rpm : échec explicite, rien n'est envoyé.
setup
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "sans .rpm, le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "sans .rpm, rien ne doit être envoyé"
grep -q "aucun paquet .rpm" "${T}/out.txt" || fail "message explicite sans .rpm"
teardown

# 3. Versions divergentes entre .rpm et .deb : échec, rien n'est envoyé.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.0.deb"
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "versions divergentes : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "versions divergentes : rien ne doit être envoyé"
teardown

if [ "${FAILS}" -eq 0 ]; then echo "OK publish_linux_nexus"; else echo "${FAILS} échec(s)"; exit 1; fi
