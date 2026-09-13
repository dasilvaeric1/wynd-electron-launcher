const path = require("path");
const { ipcRenderer, contextBridge, webFrame } = require("electron");
const createRenderLog = require("../../helpers/create_renderer_log");

// Version de build injectée synchroniquement (cf preload loader).
let appVersion = "";
// Raison de l'échec gardée pour être tracée dès que le logger existe (il est
// initialisé plus bas, sur l'IPC user_path).
let appVersionErr = null;
try {
  appVersion = require("../../main/helpers/build_version")();
} catch (err) {
  // build_info absent (dev) → version vide.
  appVersionErr = err.message;
}

// --- Channel whitelists ---
const SEND_CHANNELS = [
  "ready",
  "main.action",
  "request_wpt",
  "child.action",
  "container.response",
];

const RECEIVE_CHANNELS = [
  "request_wpt.error",
  "app_infos",
  "request_wpt.done",
  "conf",
  "notification",
  "ask_password",
  "wpt_connect",
  "ready",
  "screens",
  "menu.action",
  "toggle_menu",
  "wpt_plugin_state.init",
  "wpt_plugin_state.update",
  "ask_reload",
  "container.request",
  "user_path",
];

// --- Logger (initialise a l'arrivee de l'IPC user_path) ---
// Avant cet IPC il n'y a pas encore de logger fichier. Plutot que de deverser
// ces premieres lignes sur la console de la page, on les met de cote et on les
// rejoue des que le vrai logger existe. Le tampon est borne : si user_path
// n'arrive jamais, il ne grossit pas indefiniment.
const PENDING_MAX = 200;
const pending = [];
const buffer = (level) => (...args) => {
  if (pending.length < PENDING_MAX) pending.push([level, args]);
};
let wantedLevel = null;
let logger = {
  info: buffer("info"),
  debug: buffer("debug"),
  warn: buffer("warn"),
  error: buffer("error"),
  level: "info",
};

ipcRenderer.once("user_path", (_event, userPath) => {
  logger = createRenderLog(userPath);
  if (wantedLevel) logger.level = wantedLevel;
  for (const [level, args] of pending.splice(0)) logger[level](...args);
  if (appVersionErr) {
    logger.debug(`[PRELOAD] build_version indisponible: ${appVersionErr}`);
  }
});

// --- Expose secure APIs to renderer via contextBridge ---
contextBridge.exposeInMainWorld("electronAPI", {
  send: (channel, ...args) => {
    if (SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, callback) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  once: (channel, callback) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  },
  removeAllListeners: (channel) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  version: appVersion,
});

// Expose logger on window.log (keeps existing renderer code working)
contextBridge.exposeInMainWorld("log", {
  info: (...args) => logger.info(...args),
  debug: (...args) => logger.debug(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
  setLevel: (level) => {
    // Memorise : si l'IPC conf arrive avant user_path, le niveau etait pose
    // sur le stub puis perdu au remplacement par le vrai logger.
    wantedLevel = level;
    logger.level = level;
  },
});

// Expose __STATIC__ for webview preload path
contextBridge.exposeInMainWorld(
  "__STATIC__",
  `file://${path.resolve(__dirname, "./preload_app.js")}`
);

// --- Injection du bundle en DEVELOPPEMENT uniquement ---
// En production, assets/index.html reference deja ../dist/index.js et
// ../dist/index.css. Les reinjecter ici chargeait les memes fichiers une
// SECONDE fois (1,9 Mo de JS parses et executes deux fois a chaque
// demarrage). Reliquat de l'epoque webpack/dev-server.
//
// Le garde sur #electron-launcher-root reste indispensable : ce preload sert
// aussi aux pages POS en mode raw, ou il ne faut rien injecter du tout.
if (process.env.NODE_ENV === "development") {
  window.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("electron-launcher-root")) {
      return;
    }
    const port = process.env.PORT || 5000;
    const scriptNode = document.createElement("script");
    scriptNode.src = `http://localhost:${port}/dist/container.js`;
    document.body.appendChild(scriptNode);
  });
}
