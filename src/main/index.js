const { app, globalShortcut } = require("electron");

const path = require("path");
const os = require("os");

let pm2 = app.isPackaged ? null : require("pm2");

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const package = require("../../package.json");

const getScreens = require("./helpers/get_screens");
const killWPT = require("./helpers/kill_wpt");
const chooseScreen = require("./helpers/choose_screen");
const getConfig = require("./helpers/config/get_config");
const log = require("./helpers/electron_log");
const showDialogError = require("./dialog_err");
const createAppLog = require("./helpers/create_app_log");
const configureProtocol = require("./helpers/register_file_protocol");
const hardenWebContents = require("./helpers/harden_web_contents");
const captureJsErrors = require("./helpers/capture_js_errors");
const nodeIpcConnect = require("./helpers/node_ipc");
const generateLoaderWindow = require("./loader_window");
const generateContainerWindow = require("./container_window");
const generateIpc = require("./ipc");
const generateInitCallback = require("./initcallback");
const innerGlobalShortcut = require("./global_shortcut");
const generateTray = require("./tray");
const CustomError = require("../helpers/custom_error");
const {
  initScreenSessions,
  teardownScreenSessions,
  getCentralConfig,
} = require("./screen_session");
const { initTrace, teardownTrace } = require("./trace");

require("./lock");
require("./helpers/stream_logger")(log);
// require('@electron/remote/main').initialize()

// contextMenu({});
// try {
// 	const Hooks = require(path.join(app.getPath("userData"), 'hooks'))

// 	const hooks = new Hooks()
// }
// catch(err) {
// }
const wpt = {
  process: null,
  version: null,
  pid: null,
  socket: null,
  infos: null,
  plugins: null,
  connect: false,
  datas: null,
  plugins_state: {},
};

const [appLog, appLogPath] = createAppLog(app);

const store = {
  infos: {
    name: app.getName(),
    version: app.getVersion(),
    user_path: app.getPath("userData"),
    stack: {
      electron: process.versions.electron,
      node: process.versions.node,
      os: os.release(),
    },
    app_versions: null,
    os: {
      platform: process.platform,
      arch: os.arch(),
      version: os.release(),
    },
    debug: !!process.env.EL_DEBUG,
    packaged: app.isPackaged,
  },

  wpt: wpt,
  central: {
    registered: false,
    registering: false,
    status: "DISCONNECTED",
    ready: false,
    pending_messages: [],
  },
  conf: null,
  screens: [],
  ready: false,
  path: {
    conf: null,
  },
  ask: {
    request: null,
    next_action: null,
  },
  choosen_screen: null,
  windows: {
    container: {
      current: null,
      state: null,
    },
    loader: {
      current: null,
      width: 300,
      height: 140,
    },
  },
  pm2: {
    connected: false,
  },
  http: null,
  finish: false,
  appLog: appLog,
  logs: {
    app: appLogPath,
    main: log._readableState.pipes[1].dirname,
  },
  current_request: null,
};

if (process.env.NODE_ENV === "development") {
  process.env.APPIMAGE = path.join(
    __dirname,
    "..",
    "..",
    "dist",
    `${app.name}-1.0.0.AppImage`,
  );
}

const default_path =
  process.env.EL_CONFIG_PATH ||
  (app.isPackaged
    ? path.resolve(store.infos.user_path, "config.ini")
    : "../../config.ini");

if (process.env.EL_CONFIG_PATH) {
  log.info(`[CONFIG] EL_CONFIG_PATH env is set ${process.env.EL_CONFIG_PATH}`);
}

const argv =
  // .option('hooks', {
  //   alias: 'h',
  //   type: 'string',
  //   description: 'set hooks file',
  // 	default: null
  // })
  yargs(hideBin(process.argv))
    .option("config_path", {
      alias: "c",
      type: "string",
      description: "set config path",
      default: default_path,
    })
    .option("screen", {
      alias: "s",
      type: "number",
      description: "set screen",
      default: 0,
    })
    .option("url", {
      alias: "u",
      type: "string",
      description: "set app URL (used as fallback when no config.ini exists)",
      default: null,
    }).argv;

if (argv.config_path !== default_path) {
  log.info(`[CONFIG] --config_path set ${argv.config_path}`);
}

store.path.conf = path.isAbsolute(argv.config_path)
  ? argv.config_path
  : app.isPackaged
    ? path.resolve(path.dirname(process.execPath), argv.config_path)
    : path.resolve(__dirname, argv.config_path);

store.version = app.getVersion();

log.info(`[CONFIG] > path used ${store.path.conf}`);
log.info(`[LOG] > path used ${path.join(app.getPath("userData"), "logs")}`);

const initCallback = generateInitCallback(store, log);

const createWindows = () => {
  log.debug(`[APP] > packaged: ${(app.isPackaged, process.resourcesPath)}`);

  store.choosen_screen = chooseScreen(argv.screen, store.screens);

  try {
    store.windows.container.current = generateContainerWindow(store);
    store.windows.loader.current = generateLoaderWindow(store);
    generateIpc(store, initCallback);
  } catch (err) {
    throw new CustomError(
      500,
      err.api_code || err.code || CustomError.CODE.GENERATE_WINDOWS,
      err.message,
    );
  }
};

app.commandLine.appendSwitch("disable-http-cache");

app.on("will-quit", async (e) => {
  globalShortcut.unregisterAll();
  teardownScreenSessions();
  // Ferme le chunk de trace en cours : il finira d'être uploadé au prochain
  // démarrage (récupération du partiel) si le quit coupe l'envoi.
  try {
    await teardownTrace();
  } catch (err) {
    log.error(`[TRACE] teardown: ${err.message}`);
  }
  if (wpt.process && !wpt.process.killed) {
    try {
      await killWPT(wpt);
    } catch (err) {
      log.error(`[QUIT] > before-quit: ${err.message}`);
    }
  }
  if (wpt.socket) {
    wpt.socket.close();
    wpt.socket = null;
  }
  if (store.http) {
    store.http.close();
    store.http = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (pm2 && process.env.NODE_ENV === "development" && store.pm2.connected) {
      pm2.delete(package.pm2.process[0].name);
    }
    app.quit();
  }
});

if (process.env.EL_DISABLE_HDA && process.env.EL_DISABLE_HDA !== "0") {
  app.disableHardwareAcceleration();
  log.info("[HARDWARE] > Disable hardware accceleration");
}

getConfig(store.path.conf, undefined, argv.url)
  .then((conf) => {
    store.conf = conf;
    if (conf.commandline) {
      for (const commandName in conf.commandline) {
        const value = conf.commandline[commandName];
        app.commandLine.appendSwitch(commandName, value);
        log.info("[COMMANDLINE] > " + commandName + ", " + value);
      }
    }
  })
  .catch((err) => {
    store.pre_error_init = err;
  })
  .finally(() => {
    app
      .whenReady()
      .then(() => {
        if (store.pre_error_init) {
          showDialogError(store, store.pre_error_init);
          throw err;
        }
        process.on("SIGINT", () => {
          log.info("[PROCESS] > SIGINT");
          app.quit();
        });

        process.on("SIGTERM", () => {
          log.info("[PROCESS] > SIGTERM");
          app.quit();
        });
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          if (pm2 && process.env.NODE_ENV === "development") {
            pm2.connect(true, (err) => {
              if (err) {
                return reject(err);
              }
              store.pm2.connected = true;
              resolve();
            });
          } else {
            resolve();
          }
        });
      })
      .then(() => {
        configureProtocol(store);
      })
      .then(() => {
        // Gardes sécurité sur tous les webContents (fenêtres + webview POS) :
        // bloque les popups natifs, sanitize les webview, surveille les
        // navigations hors allowlist. À enregistrer avant createWindows.
        hardenWebContents(store);
        // Capture des erreurs JS non catchées du POS en webview (opt-in
        // config.log.capture_errors). À enregistrer avant createWindows.
        captureJsErrors(store);
      })
      .then(() => {
        innerGlobalShortcut(store, log);
      })
      .then(() => {
        store.screens = getScreens();
      })
      .then(createWindows)
      .then(() => {
        return nodeIpcConnect(store, initCallback, log);
      })
      .then(() => {
        generateTray(store);
        return null;
      })
      .then(() => {
        // Screen sessions — démarre le poller central qui écoute les
        // demandes de visualisation distante de l'écran. No-op si pas
        // d'appsettings.json du service C# détecté (= dev local).
        try {
          initScreenSessions(store);
        } catch (err) {
          log.error(`[SCREEN] init failed: ${err.message}`);
        }
        return null;
      })
      .then(() => {
        // Trace continue de la caisse (rrweb + réseau + Redux). Désactivée
        // par défaut : s'active via config.ini [trace], EL_TRACE=1, ou à la
        // demande depuis le dashboard (bloc `trace` du poll screen-session).
        // L'uploader démarre même trace désactivée pour finir d'écouler un
        // spool résiduel.
        try {
          initTrace(store, { getCentralConfig });
        } catch (err) {
          log.error(`[TRACE] init failed: ${err.message}`);
        }
        return null;
      })
      .then(() => {
        // Auto-start au boot Windows : opt-IN strict via env var
        // EL_ENABLE_AUTOSTART=1. Par défaut, on s'assure que le launcher
        // n'inscrit RIEN dans HKCU\Run — c'est la responsabilité de
        // l'installeur ou de l'IT magasin si elle le souhaite.
        //
        // Cleanup actif : si une version précédente du launcher avait
        // ajouté l'entrée Run (opt-out par défaut, ancien comportement),
        // on la retire pour respecter la préférence de l'opérateur.
        if (process.platform === "win32" && app.isPackaged) {
          try {
            const optIn = process.env.EL_ENABLE_AUTOSTART === "1";
            const current = app.getLoginItemSettings();
            if (optIn && !current.openAtLogin) {
              app.setLoginItemSettings({
                openAtLogin: true,
                openAsHidden: false,
                path: process.execPath,
                args: [],
              });
              log.info("[BOOT] auto-start enabled via EL_ENABLE_AUTOSTART=1");
            } else if (!optIn && current.openAtLogin) {
              app.setLoginItemSettings({ openAtLogin: false });
              log.info("[BOOT] auto-start removed (was set by an older build)");
            }
          } catch (err) {
            log.warn(`[BOOT] auto-start cleanup failed: ${err.message}`);
          }
        }
        return null;
      })
      .catch((err) => {
        log.error(err.code ? `[${err.code}] ${err.message}` : err.message);
      });

    app.on("activate", () => {
      if (store.windows.container.current === null) createWindows();
    });
  });
