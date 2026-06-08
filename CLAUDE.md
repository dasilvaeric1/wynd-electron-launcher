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

- Electron **21.0.1** (⚠️ le main process tourne en **Node 16** — pas de
  `fetch` global, on utilise `axios`).
- Renderer : React + webpack 5 (`configs/webpack.config.renderer.*.js`).
- Build : `electron-builder` (Windows portable + NSIS, macOS, Linux AppImage).

## Build & lancement

### Dev local (macOS)

```bash
# ⚠️ ELECTRON_RUN_AS_NODE dans l'env force Electron en mode Node pur
# (require('electron') renvoie un string au lieu de l'API). Toujours préfixer :
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

Le pipeline dev React (`npm run start`) est **fragile sur macOS**. Pour tester
vite, le plus simple :
- soit `raw=true` dans `config.ini` → la container window charge directement
  l'`url=` (pas de wrapper React, pas de menu) ;
- soit builder le bundle prod une fois (`npm run dist`) puis lancer electron.

Le bundle renderer est compilé en `target: 'web'` (pas `electron-renderer`)
car les windows ont `nodeIntegration: false` + `contextIsolation: true` ; le
fallback `events` est poly-rempli dans `webpack.config.renderer.prod.js`.

### Build Windows (prod)

```bash
env -u ELECTRON_RUN_AS_NODE NODE_OPTIONS="--openssl-legacy-provider" npm run build:win
```

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

## config.ini (clés importantes)

- `url=` — URL du POS (ou chemin local).
- `raw=true|false` — `true` charge l'url direct dans la container (pas de
  wrapper React/menu). `false` = wrapper React complet.
- `view=iframe|webview` — `webview` est requis si le POS envoie
  `X-Frame-Options: sameorigin` (sinon l'iframe est bloquée). Le webview a son
  propre process.
- `kiosk`, `full_screen`, `frame`, `menu.enable`, etc.

## Variables d'environnement

| Var | Effet |
|-----|-------|
| `EL_DISABLE_HDA=1` | Désactive l'accélération matérielle |
| `EL_CONFIG_PATH` | Chemin du dossier de config |
| `EL_DEBUG` | Mode debug. `EL_DEBUG=webrtc` affiche la capture window WebRTC + ses DevTools |
| `EL_ENABLE_AUTOSTART=1` | **Opt-in** auto-start au boot Windows (HKCU\Run). Par défaut le launcher **retire** l'entrée Run si un vieux build l'avait posée. |
| `EL_SCREEN_API_KEY` / `EL_SCREEN_BASE_URL` / `EL_SCREEN_SERIAL` | Override de la config screen-session (dev local sans `appsettings.json`). |
| `EL_SCREEN_APPSETTINGS_PATH` | Chemin custom de l'`appsettings.json` du service C# |
| `EL_SCREEN_AUTO_ACCEPT=1` | **DEV UNIQUEMENT** — bypass le consent caissier. Ne JAMAIS shipper en prod (RGPD). |
| `EL_USE_WEBRTC=0\|1` | Force/désactive WebRTC sans toucher la DB (sinon suit `session.useWebrtc`). |

## Screen-session (`src/main/screen_session.js`)

Visualisation + contrôle distant de l'écran caisse depuis le BO central.

### Flux

1. **Poll** `/api/screen-sessions/pending?caisseSerial=…` toutes les 5s
   (`POLL_INTERVAL_MS`). Auth via api-key lue dans l'`appsettings.json` du
   service C# RetailScheduler (path Windows fixe), ou via env vars en dev.
   Le serial peut être vide dans appsettings → fetch via
   `http://localhost:5088/api/identity` (endpoint du service C#).
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
