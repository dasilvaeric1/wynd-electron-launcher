#!/usr/bin/env bash
# Fumigation d'un build PACKAGE : construit l'app pour la plateforme hote,
# la lance vraiment, et verifie qu'elle passe ses require.
#
# Raison d'etre : electron-builder omet silencieusement des dependances
# transitives de cet arbre pnpm (alias npm de @isaacs/cliui, deps de glob@7…).
# Le symptome n'apparait QU'AU LANCEMENT du binaire packagé — ni `pnpm test`,
# ni `pnpm dist`, ni le build lui-meme ne le voient. Trois plantages en
# production ont ete decouverts ainsi (string-width, strip-ansi, fs.realpath).
#
# A lancer AVANT de taguer une release.
#
#   bash scripts/smoke_packaged.sh
#
# Sortie 0 = l'app demarre. Sortie 1 = elle meurt au demarrage (le log dit sur
# quel module).

set -uo pipefail
cd "$(dirname "$0")/.."

UD="$(mktemp -d)/ud"
mkdir -p "$UD"
cat > "$UD/config.ini" <<'INI'
url=https://example.com
raw=true
kiosk=false
full_screen=false
frame=true
view=iframe
debug=false

[wpt]
enable=false

[central]
enable=false

[log]
main=info
INI

case "$(uname -s)" in
  Darwin) TARGET="--mac dir"; BIN_GLOB="dist/mac*/*.app/Contents/MacOS/*" ;;
  Linux)  TARGET="--linux dir"; BIN_GLOB="dist/linux*unpacked/*" ;;
  *) echo "plateforme non geree"; exit 2 ;;
esac

echo "→ build packagé ($TARGET)"
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false \
  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron-builder $TARGET --publish never \
  >/dev/null 2>&1

BIN=$(ls $BIN_GLOB 2>/dev/null | head -1)
[ -x "$BIN" ] || { echo "✗ binaire introuvable apres le build"; exit 1; }

echo "→ lancement de $BIN"
env -u ELECTRON_RUN_AS_NODE "$BIN" --user-data-dir="$UD" --no-sandbox >"$UD/stdout.log" 2>&1 &
PID=$!
n=0
while kill -0 $PID 2>/dev/null && [ $n -lt 15 ]; do sleep 1; n=$((n+1)); done
ALIVE=$(kill -0 $PID 2>/dev/null && echo 1 || echo 0)
kill -9 $PID 2>/dev/null

if grep -qi "cannot find module" "$UD/stdout.log" 2>/dev/null; then
  echo "✗ module manquant dans le bundle :"
  grep -i "cannot find module" "$UD/stdout.log" | head -3
  exit 1
fi

if [ ! -f "$UD/logs/main/"*.log ] 2>/dev/null && [ -z "$(ls "$UD/logs/main/" 2>/dev/null)" ]; then
  echo "✗ aucun log ecrit : l'app est morte avant son initialisation"
  head -20 "$UD/stdout.log" 2>/dev/null
  exit 1
fi

[ "$ALIVE" = "1" ] || { echo "✗ l'app s'est arretee toute seule"; exit 1; }

echo "✓ l'app packagée demarre et journalise"
grep -h "\[TRACE\]\|\[CONFIG\]" "$UD/logs/main/"*.log 2>/dev/null | head -4
exit 0
