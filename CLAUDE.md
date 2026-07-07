# CLAUDE.md — Wynd Electron Launcher

Guide de travail pour ce repo. Lis-le avant de toucher au code.

## Ce que fait le launcher

Application Electron qui affiche le POS Wynd en plein écran sur les caisses
(Windows en prod). Le POS est chargé soit dans une `<iframe>` soit dans une
`<webview>` (selon `view=` dans `config.ini`). Le launcher gère aussi :

- le **loader** (écran de chargement pendant le bootstrap WPT/HTTP),
- le **menu latéral** Wynd (drawer Ant Design, bouton flottant),
- le **screen-session** : visualisation + contrôle distant de l'écran caisse
  depuis le BO central (voir plus bas — c'est la partie la plus complexe).

## Stack

- Electron **42.4.0** (Node ~22 embarqué → `fetch` global dispo, mais le code
  historique du main utilise `axios`, cf `helpers/request.js`, `screen_session.js`).
- Renderer : React + **Vite** (`npm run dist` → `RENDERER=container` puis
  `RENDERER=loader`). ⚠️ plus de webpack (l'ancienne mention
  `configs/webpack.config.renderer.*.js` n'existe plus).
- Build : `electron-builder` (Windows portable + NSIS, macOS, Linux AppImage
  + `.deb`).

## Build & lancement

### Dev local (macOS)

```bash
# ⚠️ ELECTRON_RUN_AS_NODE dans l'env force Electron en mode Node pur
# (require('electron') renvoie un string au lieu de l'API). Toujours préfixer :
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

Pour tester vite, le plus simple :
- soit `raw=true` dans `config.ini` → la container window charge directement
  l'`url=` (pas de wrapper React, pas de menu) ;
- soit builder les bundles renderer une fois (`npm run dist`, Vite) puis lancer
  electron.

Les bundles renderer sont buildés par Vite en cible **web** (pas
`electron-renderer`) car les windows ont `nodeIntegration: false` +
`contextIsolation: true`.

### Build Windows (prod)

```bash
env -u ELECTRON_RUN_AS_NODE npm run build:win
```
(Le `NODE_OPTIONS=--openssl-legacy-provider` d'antan n'est plus nécessaire
depuis le passage à Vite + Node moderne.)

Sort dans `dist/` : `electron-launcher-<ver>-x64-portable.exe` (le plus utilisé),
+ ia32 + installeurs NSIS. Le portable extrait dans
`%TEMP%\electron-launcher-portable` (nom déterministe → 1er lancement lent,
suivants quasi instantanés). **Vider ce dossier après un nouveau déploiement**
sinon Windows réutilise l'ancien extracted :
```cmd
rmdir /s /q %TEMP%\electron-launcher-portable
```

Vérifier qu'un changement est bien dans le bundle :
```bash
grep -c "<symbole>" dist/win-unpacked/resources/app.asar
```

### Build Linux (Debian 13)

```bash
# ⚠️ Sur Mac Apple Silicon, electron-builder suit l'archi hôte → arm64.
# Toujours forcer --x64 pour une caisse Debian x64.
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron-builder --linux AppImage --x64 --publish never

# .deb (recommandé sur Debian : pas de dépendance FUSE, apt-installable).
# Le .deb exige des métadonnées absentes du package.json → override CLI :
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron-builder --linux deb --x64 --publish never \
  -c.extraMetadata.homepage="https://wynd.eu" \
  -c.extraMetadata.author="<Nom> <email>" \
  -c.deb.maintainer="<Nom> <email>"
```

- **AppImage sur Debian 13 (Trixie)** : nécessite **FUSE 2** (`libfuse.so.2`), non
  fourni par défaut. Sinon `sudo apt install libfuse2t64`, OU lancer avec
  `--appimage-extract-and-run`. → le **`.deb` évite tout ça**.
- Sur une caisse, si erreur de sandbox : lancer avec `--no-sandbox`.
- Logs Linux : `~/.config/electron-launcher/logs/` (équivalent de `%APPDATA%`).

## config.ini (clés importantes)

- `url=` — URL du POS (ou chemin local).
- `raw=true|false` — `true` charge l'url direct dans la container (pas de
  wrapper React/menu). `false` = wrapper React complet.
- `view=iframe|webview` — `webview` est requis si le POS envoie
  `X-Frame-Options: sameorigin` (sinon l'iframe est bloquée). Le webview a son
  propre process.
- `kiosk`, `full_screen`, `frame`, `menu.enable`, etc.
- Section `[log]` (niveaux `main`/`renderer`/`app` = `info|debug|error|warn`) +
  capture des logs JS du SCO/POS (voir « Logs & capture SCO » plus bas) :
  - `persist_app=1` — écrit les logs SCO dans `logs/app/` (interrupteur maître fichier).
  - `capture_errors=1` — erreurs JS non catchées du POS (webview **et** iframe).
  - `capture_console=1` — `console.error`/`console.warn` du POS.
  - `capture_network=1` — requêtes réseau en échec du POS (via CDP, corps tronqués).
  - Toutes **off si absentes**. Valeurs `1|0|true|false`.

## Variables d'environnement

| Var | Effet |
|-----|-------|
| `EL_DISABLE_HDA=1` | Désactive l'accélération matérielle |
| `EL_CONFIG_PATH` | Chemin du dossier de config |
| `EL_DEBUG` | Mode debug. `EL_DEBUG=webrtc` affiche la capture window WebRTC + ses DevTools |
| `EL_ENABLE_AUTOSTART=1` | **Opt-in** auto-start au boot Windows (HKCU\Run). Par défaut le launcher **retire** l'entrée Run si un vieux build l'avait posée. |
| `EL_SCREEN_API_KEY` / `EL_SCREEN_BASE_URL` / `EL_SCREEN_SERIAL` | Override de la config screen-session (dev local sans `appsettings.json`). |
| `EL_SCREEN_APPSETTINGS_PATH` | Override du chemin de l'`appsettings.json` du service RetailScheduler. Défaut résolu selon l'OS : Windows `C:\Retail\ANYCOMMERCE\RetailScheduler\appsettings.json`, Linux `/opt/retail-scheduler/appsettings.json`. |
| `EL_SCREEN_REQUIRE_CONSENT=1` | Affiche le popup de consentement caissier. **Par défaut : auto-accept** (télémaintenance non surveillée). |
| `EL_SCREEN_SHOW_INDICATOR=1` | Affiche l'indicateur "Support en observation" côté caisse. **Par défaut : masqué** (session discrète). |
| `EL_USE_WEBRTC=0\|1` | Force/désactive WebRTC sans toucher la DB (sinon suit `session.useWebrtc`). |
| `EL_STRICT_NAV=1` | Bloque les navigations hors origines autorisées (POS + localhost + file). Par défaut : log-only (cf `helpers/harden_web_contents.js`). |

## Screen-session (`src/main/screen_session.js`)

Visualisation + contrôle distant de l'écran caisse depuis le BO central.

### Flux

1. **Poll** `/api/screen-sessions/pending?caisseSerial=…` toutes les 5s
   (`POLL_INTERVAL_MS`). Auth via api-key lue dans l'`appsettings.json` du
   service RetailScheduler — **chemin résolu selon l'OS** (Windows
   `C:\Retail\…`, Linux `/opt/retail-scheduler/appsettings.json`, cf
   `defaultAppsettingsPath()`), ou via env vars `EL_SCREEN_*`. ⚠️ L'api-key est
   **générée à l'enrôlement** par le central (vide dans la baseline) : la caisse
   doit être enrôlée (service qui tourne) sinon screen-session désactivé.
   Le serial peut être vide dans appsettings → fetch via
   `http://localhost:5088/api/identity` (endpoint du service).
   Le poll envoie aussi `launcherVersion` / `platform` / `uptime` (heartbeat
   → présence + version visibles côté BO).
2. **Consent** : si session pending → popup de consentement caissier
   (`screen_consent.html`). `EL_SCREEN_AUTO_ACCEPT=1` bypass (dev).
3. **Ticket** : POST `/ticket` (api-key) → ticket single-use TTL 30s → WS.
   Aucune creds dans l'URL WS (anti-leak via logs proxy).
4. **Capture** : selon `session.mode` :
   - `window` (défaut) : capture la **BrowserWindow container** via
     `webContents.capturePage()` (le webview enfant est compositionné dedans
     — capturer le webview directement rend du **noir** sur macOS).
   - `screen` : `desktopCapturer.getSources({types:['screen']})` sur l'écran
     `session.screenIndex` (multi-monitor).
   - Transport : **JPEG** sur le WS à 10 fps (`CAPTURE_INTERVAL_MS=100`,
     `JPEG_QUALITY=70`, largeur `CAPTURE_WIDTH=1280`), OU **WebRTC** si
     `session.useWebrtc` (voir plus bas).
5. **Contrôle (input)** : le BO envoie `mouse-move/down/up/click/wheel` +
   `key-tap` (coords normalisées 0-1) sur le WS.
   - `window` : `webContents.sendInputEvent`. **Hit-testing** entre le
     webview POS et les overlays Wynd (bouton menu + drawer Ant Design qui
     portal-mount sous `<body>`, classe `.ant-drawer-open .ant-drawer-content-wrapper`).
     Coords en **px CSS** (`getContentBounds`), PAS px physiques (retina ÷2).
     Clavier : `keyDown+char+keyUp` (le `char` seul ne déclenche pas le
     `keydown` DOM → casse les listeners barcode du POS). Modifiers
     Ctrl/Alt/Cmd → vrais raccourcis ; Shift seul → `char` (majuscule déjà
     résolue par le BO).
   - `screen` : `@nut-tree-fork/nut-js` (input système-wide). **Pas installé
     par défaut** — `getNut()` échoue proprement (1 seul warn). Requiert la
     permission **Accessibilité** macOS (probe au 1er event).
6. **Reconnexion** : sur close WS anormal (≠1000/1008), backoff exponentiel
   1→2→4→8→16s, max 5 essais (re-fetch ticket à chaque fois). Le serveur a
   un grace de 10s côté launcher avant de tuer la session.

### WebRTC (`src/main/webrtc/`)

Transport alternatif au JPEG (÷10 bande passante, ÷4 latence). Opt-in via
le toggle BO (`session.useWebrtc`) ou `EL_USE_WEBRTC=1`.

- `capture_window.js` (main) : crée une **BrowserWindow cachée** qui charge
  `capture.html`. Bridge IPC : route le signaling SDP/ICE entre le renderer
  et le WS relay du central.
- `capture.js` (renderer) : `getUserMedia({chromeMediaSource:'desktop'})` →
  N `RTCPeerConnection` (1 par browser viewer, fan-out). **Race fix** : les
  `want-webrtc` reçus avant que `getUserMedia` résolve sont queue puis flush
  (sinon offer sans track → le BO reste en `<img>`).
- `capture_preload.js` : `contextBridge` (getSourceId, signaling, log).
- **ICE servers** : Cloudflare TURN éphémère, poussé par le central dans le
  payload session (`iceServers`). Sans TURN, échec sur NAT symétrique
  (firewall magasin). Fallback STUN Google.
- Le JPEG reste actif en parallèle → fallback transparent si WebRTC échoue.

### Limites connues

- Mode `window` : les events injectés sur la container **ne traversent pas
  toujours** vers le webview enfant (limite Chromium guest view selon les
  cas). Le hit-testing route au mieux ; pour piloter le POS au-delà, mode
  `screen` + nut.js.
- Raccourcis OS (Alt+Tab, Win+L) inaccessibles en mode `window`.

## Logs & capture SCO (`helpers/handle_sco_log.js`, `helpers/capture_js_errors.js`)

Le launcher écrit ses logs (Winston, rotation quotidienne) dans
`<userData>/logs/` : `main/` (process principal), `renderer/` (wrapper React),
`app/` (logs applicatifs SCO/POS). `<userData>` = `%APPDATA%\electron-launcher`
sur Windows, `~/.config/electron-launcher` sur Linux.

Remplace l'ancien logserver HTTP NW.js par les capacités natives Electron. Un
**sink unique** (`handle_sco_log.js`) reçoit tous les logs SCO :
- **fichier** `logs/app/` si `log.persist_app=1` (interrupteur maître) ;
- **relais BO central** (socket WPT) filtré par `central.log` (inchangé).

Trois **sources** opt-in l'alimentent (config `[log]`, off si absentes) :
`capture_errors` (erreurs non catchées), `capture_console` (error/warn),
`capture_network` (échecs réseau via CDP). `capture_js_errors.js` injecte un
hook dans le **main world** de la frame POS (détectée par URL via
`webFrameMain`) et remonte via `console-message` ; marche en `view=webview`
**et** `view=iframe`. Le réseau réutilise `net_capture.js` passé en
**multi-abonnés** (fan-out) pour coexister avec la visu BO sur une seule
attache debugger CDP. ⚠️ Signature `console-message` = nouvelle API Electron ≥37
`(event, details)` (le code gère aussi l'ancienne).

## Distribution / built-in update

Le `.exe` est buildé ici. Le **service C# RetailScheduler** gère sa propre
update via le dashboard (`/install/RetailSchedulerService-latest.zip`). Le
launcher Electron n'a pas (encore) d'auto-update intégré côté ce repo.

## Git — push vers les 2 remotes

`origin` est configuré pour pousser vers **github + gitlab** en un seul
`git push origin <branche>` :

```
origin (fetch): https://github.com/dasilvaeric1/wynd-electron-launcher.git
origin (push) : https://github.com/dasilvaeric1/wynd-electron-launcher.git
origin (push) : git@gitlab.wynd.eu:product/common/pocs/electron-launcher.git
```

Branche de travail : `develop`.

## Pièges récurrents

- `ELECTRON_RUN_AS_NODE` dans l'env → `require('electron')` renvoie un string.
  Toujours `env -u ELECTRON_RUN_AS_NODE`.
- Scripts PowerShell (`install-service.ps1` côté service C#) : **ASCII only**.
  PowerShell 5.1 lit les fichiers sans BOM en Windows-1252 → les accents
  cassent le parser (faux `MissingEndCurlyBrace`).
- Capturer le webview directement = noir sur macOS → capturer la container.
- Coords input en px CSS, pas physiques (retina).
- Après build, vider `%TEMP%\electron-launcher-portable` avant de retester.
