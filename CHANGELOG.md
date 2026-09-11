# Changelog

All notable changes to this project will be documented in this file.

## [2.8.X]

### [2.8.1]

Trois defauts trouves en faisant tourner la trace sur un vrai POS (staging
OctiPOS), invisibles en test unitaire.

- fix(trace): la capture reseau n'attrapait RIEN. `startCapture` attachait le
  CDP au webContents disponible a cet instant — la container — alors qu'en
  `view=webview` la webview POS est montee ~2 s plus tard et porte tout le
  trafic. Le recorder, lui, se re-installait bien sur la bonne cible. Et comme
  container et webview partagent la session, le repli `webRequest` etait
  musele par la garde anti-doublon de `net_capture` : ni CDP ni fallback.
  L'attache suit desormais la cible du recorder (callback `onTarget`), qui est
  le seul point connaissant le webContents effectif — y compris apres un reload
  du POS. Mesure avant/apres sur le meme POS : 0 puis 67 requetes captees.
- fix(trace): une seule URL `data:image/svg+xml` emise par react-dom pesait
  12,6 Ko dans `network.json`, soit plus de la moitie du chunk compresse. Les
  schemas qui ne traversent pas le reseau (`data:`, `blob:`, `javascript:`,
  `about:`) sont ecartes, et les URL sont bornees a 512 o. `network.json` passe
  de 12,6 Ko pour 1 entree a 14,7 Ko pour 67.
- fix(trace): `redux.json` etait un tableau nu alors que `session_recorder`
  ecrit `{initial, events, diag}` — le lecteur du dashboard aurait casse sur
  les traces continues, malgre le commentaire affirmant le contraire. Meme
  enveloppe des deux cotes desormais (`initial` reste vide sur une trace
  continue).
- Le log `capture démarrée` porte l'id du webContents cible, pour distinguer
  d'un coup d'oeil l'install container de l'install webview.

Debit mesure sur ce POS, pause d'inactivite desactivee : ~95 Ko/min
(1017 events rrweb + 46 actions Redux -> 64 Ko zippes sur 40 s).

### [2.8.0]

- feat(trace): trace continue de la caisse — rrweb (rejouer l'ecran, taps
  compris), metadonnees reseau et actions Redux, decoupee en chunks
  independamment rejouables et uploadee au fil de l'eau vers le dashboard.
  Repond au besoin « la caisse a eu un souci et on ne sait pas ce qui a ete
  fait » : la trace existe AVANT qu'on sache qu'on en a besoin, contrairement
  au `session_recorder` qui doit etre declenche depuis le BO pendant
  l'incident.

  - Decoupage pilote depuis le main (`stop → take → start`) et non par
    `checkoutEveryNms` : le shim du bundle rrweb vendore fait `record.bind()`,
    ce qui perd `takeFullSnapshot`. Chaque chunk commence donc par un snapshot
    complet par construction et se rejoue seul.
  - Pause sur inactivite (`idle_pause_seconds`, defaut 60 s) : premier levier
    de volume. La reprise reemet un snapshot complet, donc aucune perte de
    fidelite (contrairement a un filtrage d'events, qui laisserait le DOM du
    replay divergent).
  - Reglages ecrans tactiles : `mousemove_ms` (defaut 150) gouverne aussi les
    `touchmove` ; `mouseInteraction` jamais echantillonne (les taps sont le
    signal le plus utile). `slimDOMOptions: all`, `inlineImages: false`,
    `collectFonts: false`, `recordCanvas: false`.
  - Compression au niveau du chunk (ZIP DEFLATE) et non `packFn` event par
    event : meilleur ratio, et le ZIP ne peut pas recompresser du base64 deja
    deflate.
  - Spool disque (`<userData>/logs/trace/`) avec plafond FIFO
    (`spool_max_mb`, defaut 500) : c'est le tampon de panne reseau. Les chunks
    les plus anciens sont jetes en premier, mais JAMAIS le plus recent — un
    plafond mal regle ne doit pas laisser la caisse sans rien a diagnostiquer.
  - Chunk en cours ecrit en NDJSON au fil de l'eau (drain 2 s) : un crash ne
    coute que le dernier drain, et le partiel est finalise puis uploade au
    demarrage suivant.
  - Upload FIFO avec backoff (1→60 s) reutilisant la chaine existante
    `presign → PUT → complete`. Le ZIP part en direct vers le stockage objet,
    donc aucun egress central. Aucun changement d'API requis cote dashboard
    (le `kind: "continuous"` est porte par `meta`).
  - Activation a trois niveaux, precedence `EL_TRACE*` > ordre BO >
    `config.ini [trace]`. Garde-fous non contournables a distance :
    `allow_remote=0` verrouille la caisse, les reglages de masquage ne viennent
    jamais du distant, et un ordre BO DOIT porter un `until` (une activation
    oubliee s'eteint d'elle-meme).
- fix(screen): le poll `/pending` n'est plus coupe court pendant une session
  ecran active. Le heartbeat et les ordres pousses par le BO (tunnel WPT,
  trace) restaient geles toute la duree d'une visu ; le garde-fou de session
  est desormais applique juste avant le traitement de la session elle-meme.

## [2.7.X]

### [2.7.1]

- feat(screen): le chemin de l'`appsettings.json` du service RetailScheduler est
  désormais résolu selon l'OS (Windows `C:\Retail\…`, Linux
  `/opt/retail-scheduler/appsettings.json`) au lieu d'être codé en dur Windows.
  Débloque la prise en main à distance sur Debian sans
  `EL_SCREEN_APPSETTINGS_PATH` explicite.

### [2.7.0]

- feat(log): capture des logs JS du SCO/POS vers `logs/app/` via les capacités
  natives Electron (remplace le logserver HTTP NW.js). Sink unique
  (`handle_sco_log.js`) : persistance fichier opt-in `log.persist_app` + relais
  central inchangé. Trois sources opt-in (off par défaut) : `capture_errors`
  (erreurs non catchées), `capture_console` (error/warn), `capture_network`
  (échecs réseau via CDP). Fonctionne en `view=webview` ET `view=iframe`
  (détection frame POS + injection `webFrameMain`). `net_capture` passé en
  multi-abonnés pour coexister avec la visu BO. Fix signature `console-message`
  Electron 42.

## [2.6.X]

### [2.6.16]

- fix(central): re-arm du retry d'enrôlement après `register.error` (typo
  `central` → `centralState`) — la caisse restait orange jusqu'à un restart WPT.

### [2.6.15]

- fix(rec): shim Redux INLINE dans le preload (plus de readFileSync, qui ratait
  en packagé asar = cause du tap absent, installed:false). + statut preload
  expose via contextBridge (__elReduxPreloadStatus) lu dans le diag redux.json.

### [2.6.14]

- chore(rec): diagnostic Redux embarqué dans redux.json (champ diag: installed,
  composeType, stores, bufLen, href) pour debug sans console DevTools.

### [2.6.13]

- fix(rec): retire l'extension REDUX_DEVTOOLS de l'install debug. Cassée dans ce
  contexte Electron (prepareInjection.js → `sendMessage` undefined) et en conflit
  avec notre tap Redux (elle écrasait/n'installait pas proprement
  `__REDUX_DEVTOOLS_EXTENSION_COMPOSE__`). Le mode debug se comporte désormais
  comme la prod côté Redux → notre shim est seul à fournir le hook. React
  DevTools conservé.

### [2.6.12]

- fix(rec): le tap Redux ne s'installait jamais sur la caisse (`__elReduxInstalled`
  undefined). Cause : le shim était injecté via un `<script>` DOM inline, refusé
  par la CSP de la page POS (script-src sans unsafe-inline) — violation CSP non
  catchable. On l'exécute désormais dans le main world via
  `webFrame.executeJavaScript` (non soumis à la CSP), avec résolution de chemin
  robuste (fallback `process.resourcesPath`) et logs `[el-redux-tap]`.

### [2.6.11]

- feat(rec): capture du state Redux dans le bundle de trace. Au démarrage de
  l'enregistrement, un snapshot de `window.__elReduxState` (baseline) est lu en
  best-effort et stocké dans `reduxInitial`. À chaque tick du drain, le buffer
  `window.__elRedux` (actions/diffs) est vidé et accumulé dans `redux`. À
  l'arrêt, `redux.json` est écrit dans le zip avec la structure
  `{ initial, events }`. Garde-fou : auto-stop si `redux.length > 20000`
  (cohérent avec le cap rrweb existant).

### [2.6.10]

- fix(rec): le recorder ne renvoyait jamais de `recorder-status` (ni recording,
  ni uploading, ni ready) et n'uploadait rien. Cause : le callback `onStatus`
  appelait `sendNet`, un `const` scopé au bloc `if (!activeSession.netStarted)`,
  invisible depuis le closure `ws.on('message')` → `ReferenceError` avalé par le
  try/catch à chaque changement d'état. `onStatus` envoie désormais directement
  sur `activeSession.ws`. (Bug introduit en 2.6.9.)

### [2.6.9]

- feat(rec): session recorder (rrweb) controllable from the BO over the
  screen-session WS. New control messages: `recorder-start` (resolves the POS
  webContents and starts rrweb capture) and `recorder-stop` (stops and uploads).
  Net events are buffered into the recorder via `sessionRecorder.addNet()`.
  Re-injection on POS page reload via `did-finish-load` on the webview wc
  (bound once in the late-mount setTimeout). Auto-stop with upload triggered
  in `stopSession()` before session teardown. Status callbacks forwarded to BO
  as `recorder-status` messages over the same WS.

### [2.6.8]

- fix(net): plus de doublons dans le panneau Réseau du BO. CDP (détail complet,
  scopé au webContents) et le fallback webRequest (métadonnées, scopé à la
  SESSION entière) tournaient en parallèle : quand le CDP d'une webview échoue,
  le fallback s'attachait sur la session partagée et re-captait tout le trafic
  déjà capté en détail → 1 ligne pleine (CDP) + 1 ligne quasi vide (webRequest)
  par requête, non fusionnables (id CDP string ≠ id webRequest entier). On
  musele desormais le webRequest sur toute session deja couverte par un CDP
  (garde au moment de l'event pour gerer l'ordre d'attache).

### [2.6.7]

- fix(egress): ne plus lancer la boucle de capture JPEG (10 fps) quand WebRTC
  est actif. Elle relayait les frames a travers Railway EN PARALLELE du flux
  WebRTC (P2P/TURN) -> double flux + egress Railway massif (~0.5 Mo/s/session,
  ~55 Go/15j observe). JPEG = fallback uniquement quand WebRTC off.

### [2.6.6]

- fix(launch): anycommerce.bat — `cd` vers local-stack-maintenance remonté avant
  le 1er appel `control_center.ps1 -restart wsl` (sinon chemin relatif KO →
  "L'argument control_center.ps1 n'existe pas"). `> null` → `> nul`.

### [2.6.5]

- fix(screen): "Object has been destroyed" looping on close — the overlay-bounds
  refresher (setInterval 1.5s) accessed w.webContents after the window was
  destroyed without going through stopSession; the .catch() didn't cover the
  synchronous throw. Now guards isDestroyed() and self-clears.

### [2.6.4]

- net capture: also emit statusText, mimeType, response size and request
  duration (ms) from CDP timings → richer detail + HAR export in the BO

### [2.6.3]

- net capture: switch to CDP (webContents.debugger + Network domain) to capture
  request/response headers and bodies for XHR/Fetch calls (bodies capped 32 KB,
  binary skipped), with webRequest fallback (metadata-only) when the debugger
  cannot attach → no regression on the request list
- BO Réseau panel: expandable rows showing sent/received headers and bodies

## [1.19.X]

### [1.19.0]

- add self.close nodeIPC command
- add container.state socket request

## [1.18.X]

### [1.18.1]

- fix wpt/restart undefined version
- fix register status update on wpt kill
- add register retry

### [1.18.0]

- change config request
- add config and logs paths to central register

## [1.17.X]

### [1.17.3]

- fix plugin state when reload
- fix plugin state with wpt disconnection
- add customization of plugin state

### [1.17.2]

- fix plugin status
- add more icons

### [1.17.1]

- fix plugin status
- add more icons

### [1.17.0]

- add display plugin
- add logs path on central register

## [1.16.X]

### [1.16.0]

- add clear cache on start parameter

## [1.15.X]

### [1.15.0]

- enable .exe for wpt

## [1.14.X]

### [1.14.2]

- fix loader message (wpt creation)
- add wpt to register if wpt.path is set
- add REDUX_DEV_TOOLS (available on debug mode)
- rework and fix on central request routes

### [1.14.1]

- add EL_DISABLE_HDA(=1) to disable hardware acceleration

### [1.14.0]

- remove ipc to socketio client

## [1.13.X]

### [1.13.4]

- fix validation conflict when value is false

### [1.13.3]

- fix tray icon path access when packaged
- fix node ipc no connecting to api updater

### [1.13.2]

- add node-ipc log
- wait wpt connect if enable to diplay iframe/webview(app)
- config validation: check wait on ipc conflict with detached or shell

### [1.13.1]

- change node-ipc to a safe fork
- change git hub publish CI

### [1.13.0]

- add ipc communication with api updater
- remove pinpad popup  when clicking on wpt icon to return in the main page
- enable env variable in config

## [1.12.X]

### [1.12.0]

- add pin code for wpt icon conf -> wpt.password
- add ctrl+shift+R to reload + clear cache
- on reload the http server will not be restart (destroy and created) -> no conf.http will be take into account
- on reload the wpt server will not be restart (destroy and created) -> no conf.wpt will be take into account
- fix log message (only single parameters now)

## [1.11.X]

### [1.11.5]

- add timeout in http close on reload

### [1.11.4]

- temporary remove http close on reload

### [1.11.3]

- fix wpt central communication (wpt > 1.22.6)

### [1.11.2]

- fix err code
- fix loader
- fix wpt connection (front menu)

### [1.11.1]

- fix err code
- loader progress
- add title instead of name

### [1.11.0]

- add solid border option
- add menu button size and position parameters (menu.button_size && menu.button_position)
- add color to menu button on debug mode
- add ctrl + m to show menu
- change frameless to frame
- fix frame parameter not correctly converted in boolean

### [1.10.2]

- add debug mode
- fix loader for init reload, update

### [1.10.1]

- fix antd items Menu

### [1.10.0]

- upgrade node to 16.16.0
- upgrade electron to 21.0.1
- upgrade react, antd
- upgrade fastify
- add ci workflow on develop push
- fix ci issue with nodejs and electron conflict version

## [1.9.X]

### [1.9.2]

- maximize app if not frameless

### [1.9.1]

### [1.9.0]

- fix default config keep_listener
- add fullscreen params
- add kiosk params
- add frameless params

## [1.8.X]

### [1.8.1]

- add commandline log

### [1.8.0]

- add default config generation
- add wpt timeout parameters (see: README)

## [1.7.X]

### [1.7.1]

- fix clear-cache: webframe undefined
- fix anycommerce icon
- fix windows icon

### [1.7.0]

- change default log menu and windows icons
- add logo customization
- add check central plugin
- add clear cache on reload
- re add delay to close the app on emergency
- rework central.message (update, notification, config.get, config.set, config.wpt.set, reload)
- fix multiple central.register
- fix socket leak memory on wpt reload

## [1.6.X]

### [1.6.11]

- add portable version

### [1.6.10]

- prevent wpt to be killed before sending message (emergency)
- remove delay to close the app on emergency

### [1.6.9]

- fix reload notification request
- add focus on iframe
- add delay to close the app on emergency (case where wpt process has been created by electron launcher)

### [1.6.8]

- add allowPrerelease params into update

### [1.6.7]

- re-fix emergency not sending close crashdrawer on WPT
- change log format and add console for front page

### [1.6.6]

- fix emergency not sending close crashdrawer on WPT

### [1.6.5]

- add publish in config

### [1.6.4]

- add 32 bits version (CI)

### [1.6.0]

- change log and add daily rotation

## [1.5.X]

### [1.5.7]

- fix wpt.cwd can be undefined (config validation)

### [1.5.6]

- fix remove auto add index.html on front part. ( only add if path is a file ) \[regression\]
- close menu if password modal is opened

### [1.5.5]

- add EL_CONFIG_PATH to set the config path
- add more wpt options

### [1.5.4]

- fix wpt process shutting down on Windows. ( add wpt.keep_listeners = 1 in config.init)

### [1.5.3]

- remove auto add index.html on front part. ( only add if path is a file )

### [1.5.2]

- fix plugins
- reload do not close dev tools if opened (Ctrl + shift + I)

### [1.5.1]

- remove strict keys on config
- enhance error on config
- fix remove wpt.path with wait on ipc set to false
- auto remove wait on ipc with .bat file

### [1.5.0]

- add central register
- add central request (update, notification, reload)
- add send log to central
- remove config.socket

## [1.4.X]

### [1.4.2]

- fix href url proxy

### [1.4.1]

- add proxy with local server

### [1.4.0]

- add proxy config
- add command line config
- nsis install per machine

## [1.3.X]

### [1.3.10]

- catch errors of embedded app in iframe and log it in app.log

### [1.3.9]

- add wpt.wait_on_ipc in config  ( disable it for old wpt version )
- fix missing non required property in config.ini to crash the app

### [1.3.8]

- disable start after install (nsis)
- failed auto update on launch will not block the app
- add container focus on show
- work more clear logs (when error)
- add app log (see: README)
- add Config description
