# Migration Electron 21 → 42 (B1)

Branche : `chore/electron-upgrade`. **NE PAS merger sur `develop` sans avoir
passé le gate de test ci-dessous** — c'est un saut de 21 versions majeures
(Chromium 106 → ~136, Node 16 → 22), non testable en runtime depuis macOS.

## Versions

| Paquet | Avant | Après |
|--------|-------|-------|
| electron | 21.0.1 | ^42.3.3 |
| electron-builder | 22.13.1 | ^26.15.2 |
| electron-updater | 5.3.0 | ^6.8.9 |

## Breaking changes identifiés (audit code)

### 🔴 1. `protocol.registerFileProtocol` supprimé
`src/main/helpers/register_file_protocol.js` sert un scheme custom
`assets://` (logo menu). `registerFileProtocol` est déprécié (E25) puis
**supprimé**. Migrer vers `protocol.handle` :
```js
const { protocol, app, net } = require("electron")
const { pathToFileURL } = require("url")
const path = require("path")
// AVANT app.whenReady() :
protocol.registerSchemesAsPrivileged([
  { scheme: "assets", privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
// APRÈS ready :
module.exports = function configureProtocol(store) {
  protocol.handle("assets", () => {
    const file = path.normalize(`${app.getPath("userData")}/assets/${store.conf.menu.logo}`)
    return net.fetch(pathToFileURL(file).toString())
  })
}
```
⚠️ À valider : rendu de `<img src="assets://...">` dans le menu.

### 🟠 2. Module natif `@nut-tree-fork/nut-js` (mode screen)
Prébuilds liés à l'ABI Node. Electron 42 = NODE_MODULE_VERSION ~127.
→ rebuild via `@electron/rebuild`, ou vérifier que le fork publie des
prébuilds compatibles. N'impacte QUE le mode `screen` (input nut.js).

### 🟠 3. `electron-extension-installer@1.2.0`
Charge Redux/React DevTools (`container_window.js`, mode debug seulement).
Vieux paquet, peut ne pas supporter E42. → tester en mode debug, sinon
remplacer ou gater plus strictement.

### 🟡 4. electron-builder 22 → 26
Schéma de config globalement compatible. `electronVersion` auto-détecté.
À revérifier : targets portable/nsis, signature, `requestExecutionLevel`.

### 🟡 5. electron-updater 5 → 6
API `autoUpdater` (helpers/auto_updater.js, check_update, download_update,
quit_and_install). Revue des signatures + events.

### ✅ Déjà OK
- `enableRemoteModule` déjà retiré (hardening contextIsolation).
- `desktopCapturer.getSources` déjà en main process (requis depuis E17).
- `webPreferences` : contextIsolation:true + sandbox:false + nodeIntegration:false.
- preloads en whitelist contextBridge.

## Gate de test (obligatoire avant merge develop)

1. `npm install` résout sans erreur bloquante.
2. `npm run dist` (bundle renderer) OK.
3. CI `build:win` produit le `.exe` portable x64.
4. Lancement Windows réel :
   - POS chargé dans le webview (contextIsolation actif),
   - menu latéral + logo `assets://` OK,
   - screen-session : modes window + screen + WebRTC,
   - auto-update (electron-updater) fonctionnel,
   - pas de régression au boot (WPT/HTTP).

## Statut (vérifié sur macOS, branche chore/electron-upgrade)

- ✅ **Résolution deps** : electron 42.3.3 + builder 26.15.2 + updater 6.8.9
  installés sans conflit, binaire electron téléchargé.
- ✅ **Bundle prod renderer** (`npm run dist`) : compile (warnings de taille
  seulement). C'est le bundle qui ship → build-viable.
- ✅ **Fix appliqué** : `registerFileProtocol` → `protocol.handle` +
  `registerSchemesAsPrivileged` (à valider au runtime : logo menu).
- ✅ **Fix appliqué** : hook `prepare` (DLL dev) → script manuel `dll`.
  Le DLL dev plantait (webpack 5.36 ne gère pas les imports `node:` des
  glob/rimraf récents tirés par electron-extension-installer). Le DLL ne
  sert QU'au hot-reload dev (le prod ne l'utilise pas) → désormais `npm
  run dll` à la demande. Débloque `npm install` + la CI.

### Reste à faire / valider (gate)

- 🔴 Runtime Windows réel (le point non testable depuis macOS) : POS dans
  le webview, logo `assets://`, screen-session (window/screen/webrtc),
  auto-update, boot WPT/HTTP.
- 🟠 `@nut-tree-fork/nut-js` : rebuild ABI E42 (mode screen).
- 🟠 `electron-extension-installer` (devtools, mode debug) : valider ou
  remplacer sous E42.
- 🟡 Hot-reload dev : si on veut le réparer, monter webpack (gère `node:`)
  ou externaliser electron-extension-installer du DLL.
- 🟡 CI : lancer le job `build:win` sur cette branche pour produire le .exe
  à tester.
