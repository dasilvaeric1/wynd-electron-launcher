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
  unset FAKE_HEAD_CODE FAKE_FAIL_ON EXPECTED_VERSION FORCE 2>/dev/null || true
  # Faux curl :
  #   -I + -w  : vérification d'immuabilité -> imprime FAKE_HEAD_CODE (défaut 404)
  #   --upload-file : upload -> journalise dans FAKE_LOG (jamais l'identifiant),
  #                   échoue avec le code 22 si FAKE_FAIL_ON correspond à l'extension.
  cat > "${T}/fakes/curl" <<'EOF'
#!/bin/sh
head_mode=0
file=""
target=""
netrc=""
while [ $# -gt 0 ]; do
  case "$1" in
    -I) head_mode=1; shift ;;
    -s) shift ;;
    -o) shift 2 ;;
    -w) shift 2 ;;
    --netrc-file) netrc="$2"; shift 2 ;;
    --upload-file) file="$2"; shift 2 ;;
    --fail-with-body) shift ;;
    --retry) shift 2 ;;
    --retry-all-errors) shift ;;
    --retry-delay) shift 2 ;;
    http*) target="$1"; shift ;;
    *) shift ;;
  esac
done

if [ "${head_mode}" = "1" ]; then
  printf '%s' "${FAKE_HEAD_CODE:-404}"
  exit 0
fi

base="$(basename "${file}")"
case "${base}" in
  *."${FAKE_FAIL_ON:-__none__}") exit 22 ;;
esac

netrc_marker="no-netrc"
[ -z "${netrc}" ] || netrc_marker="netrc"
echo "${base} -> ${target} [${netrc_marker}]" >> "${FAKE_LOG}"
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
teardown() {
  rm -rf "${T}"
  unset FAKE_HEAD_CODE FAKE_FAIL_ON EXPECTED_VERSION FORCE 2>/dev/null || true
}

sha256_of() { # sha256_of <fichier> -> digest hex de référence (PATH réel, hors fakes)
  if PATH=/usr/bin:/bin command -v sha256sum >/dev/null 2>&1; then
    PATH=/usr/bin:/bin sha256sum "$1" | cut -d' ' -f1
  else
    PATH=/usr/bin:/bin shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

base_url="https://nexus.wynd.eu/repository/integration/product/electron_linux/2.9.1"

# 1. Cas nominal : .rpm puis .deb puis SHA256SUMS, dans le dossier de la version.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
sed -n 1p "${FAKE_LOG}" | grep -qF "electron-launcher-2.9.1.rpm -> ${base_url}/electron-launcher-2.9.1.rpm [netrc]" \
  || fail "le .rpm doit partir en premier, via --netrc-file"
sed -n 2p "${FAKE_LOG}" | grep -qF "electron-launcher-2.9.1.deb -> ${base_url}/electron-launcher-2.9.1.deb [netrc]" \
  || fail "le .deb doit partir en second, via --netrc-file"
sed -n 3p "${FAKE_LOG}" | grep -qF "SHA256SUMS -> ${base_url}/SHA256SUMS [netrc]" \
  || fail "SHA256SUMS doit partir en dernier, via --netrc-file"
grep -qE '^[a-f0-9]{64}  electron-launcher-2\.9\.1\.rpm$' "${T}/dist/SHA256SUMS" \
  || fail "SHA256SUMS au format sha256sum, nom nu sans ./ pour le .rpm"
grep -qE '^[a-f0-9]{64}  electron-launcher-2\.9\.1\.deb$' "${T}/dist/SHA256SUMS" \
  || fail "SHA256SUMS doit aussi contenir une ligne pour le .deb"
expected_deb_sha="$(sha256_of "${T}/dist/electron-launcher-2.9.1.deb")"
grep -qF "${expected_deb_sha}  electron-launcher-2.9.1.deb" "${T}/dist/SHA256SUMS" \
  || fail "le digest du .deb dans SHA256SUMS doit correspondre au contenu réel du fichier"
if grep -q 's3cret-pass' "${T}/out.txt" "${FAKE_LOG}"; then fail "le mot de passe ne doit apparaître nulle part (sortie ni argv de curl)"; fi
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

# 4. Plusieurs .rpm dans dist : échec explicite, rien n'est envoyé.
setup
printf 'rpm1' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'rpm2' > "${T}/dist/electron-launcher-2.9.2.rpm"
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "plusieurs .rpm : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "plusieurs .rpm : rien ne doit être envoyé"
grep -q "plusieurs paquets .rpm" "${T}/out.txt" || fail "message explicite plusieurs .rpm"
teardown

# 5. Plusieurs .deb dans dist : échec explicite, rien n'est envoyé.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb1' > "${T}/dist/electron-launcher-2.9.1.deb"
printf 'deb2' > "${T}/dist/electron-launcher-2.9.1-dup.deb"
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "plusieurs .deb : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "plusieurs .deb : rien ne doit être envoyé"
grep -q "plusieurs paquets .deb" "${T}/out.txt" || fail "message explicite plusieurs .deb"
teardown

# 6. Aucun .deb : avertissement affiché, seuls le .rpm et SHA256SUMS partent.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
grep -qF "aucun .deb dans dist" "${T}/out.txt" || fail "avertissement absent sans .deb"
[ "$(wc -l < "${FAKE_LOG}")" -eq 2 ] || fail "sans .deb, seuls le .rpm et SHA256SUMS doivent partir"
teardown

# 7. Immuabilité : version déjà publiée (HEAD 200), sans FORCE -> échec, rien envoyé.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
export FAKE_HEAD_CODE=200
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "version déjà publiée (HTTP 200) : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "version déjà publiée : rien ne doit être envoyé"
grep -q "déjà publiée" "${T}/out.txt" || fail "message explicite version déjà publiée"
teardown

# 8. Immuabilité : version déjà publiée (HEAD 200) mais FORCE=1 -> republication.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
export FAKE_HEAD_CODE=200 FORCE=1
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
[ "$(wc -l < "${FAKE_LOG}")" -eq 3 ] || fail "FORCE=1 doit republier les 3 fichiers malgré le 200"
teardown

# 9. Immuabilité : vérification impossible (HTTP 500) -> échec, rien envoyé (jamais "absent").
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
export FAKE_HEAD_CODE=500
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "vérification impossible (HTTP 500) : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "vérification impossible : rien ne doit être envoyé"
grep -q "vérification Nexus impossible (HTTP 500)" "${T}/out.txt" || fail "message explicite vérification impossible"
teardown

# 10. Tag ↔ version : EXPECTED_VERSION divergent -> échec avant tout appel réseau.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
export EXPECTED_VERSION=2.9.9
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "EXPECTED_VERSION divergent : le script doit échouer"
[ ! -s "${FAKE_LOG}" ] || fail "EXPECTED_VERSION divergent : rien ne doit être envoyé"
[ ! -e "${T}/dist/SHA256SUMS" ] || fail "EXPECTED_VERSION divergent : SHA256SUMS ne doit même pas être calculé"
grep -q "le tag annonce 2.9.9 mais le paquet est en 2.9.1" "${T}/out.txt" || fail "message explicite tag/version"
teardown

# 11. Tag ↔ version : EXPECTED_VERSION correspondant -> publication normale.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
export EXPECTED_VERSION=2.9.1
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
[ "$(wc -l < "${FAKE_LOG}")" -eq 3 ] || fail "EXPECTED_VERSION correspondant : les 3 fichiers doivent partir"
teardown

# 12. Échec d'upload du .deb : le script échoue, SHA256SUMS n'est jamais envoyé.
setup
printf 'rpm' > "${T}/dist/electron-launcher-2.9.1.rpm"
printf 'deb' > "${T}/dist/electron-launcher-2.9.1.deb"
export FAKE_FAIL_ON=deb
set +e
bash "${SCRIPT}" "${T}/dist" > "${T}/out.txt" 2>&1
code=$?
set -e
[ "${code}" -ne 0 ] || fail "échec d'upload du .deb : le script doit échouer"
grep -q "electron-launcher-2.9.1.rpm" "${FAKE_LOG}" || fail "le .rpm doit être parti avant l'échec du .deb"
grep -q "SHA256SUMS" "${FAKE_LOG}" && fail "SHA256SUMS ne doit jamais partir si l'upload du .deb échoue"
teardown

if [ "${FAILS}" -eq 0 ]; then echo "OK publish_linux_nexus"; else echo "${FAILS} échec(s)"; exit 1; fi
