#!/bin/sh
# Ajoute --ozone-platform=x11 a l'entree de bureau posee par electron-builder.
#
# Pourquoi ici et pas dans package.json : electron-builder REFUSE
# `linux.desktop.entry.Exec` (« Please specify executable name as
# linux.executableName instead »), et la valeur qu'on veut n'est pas un nom
# d'executable mais un argument.
#
# Pourquoi pas dans config.ini : Chromium lit `ozone-platform` avant que le
# JS du launcher s'execute. Pose par `[commandline]`, le drapeau est accepte,
# journalise, et sans aucun effet — mesure sur Rocky 10, le process GPU
# demarrait quand meme en wayland.
#
# Pourquoi il le faut : sous Wayland un client n'a pas le droit de positionner
# ses fenetres. Sans X11, l'ecran client s'ouvre par-dessus la caisse au lieu
# du second ecran. Sous XWayland les deux ecrans forment un seul espace X.
set -e

DESKTOP="/usr/share/applications/wynd-electron-launcher.desktop"
[ -f "$DESKTOP" ] || exit 0

# Idempotent : une reinstallation ne doit pas empiler le drapeau.
grep -q -- "--ozone-platform=" "$DESKTOP" && exit 0

sed -i 's|^\(Exec=[^ ]*\)|\1 --ozone-platform=x11|' "$DESKTOP"

# Rafraichit le cache des entrees de bureau si l'outil est present.
command -v update-desktop-database >/dev/null 2>&1 \
  && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

exit 0
