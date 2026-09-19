const { ipcRenderer, contextBridge } = require("electron");
const createRenderLog = require("../../helpers/create_renderer_log");

// Version de build injectée SYNCHRONEMENT (pas d'IPC) — évite la race où
// app_infos arrive avant que React ait monté ses listeners.
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
const SEND_CHANNELS = new Set(["ready", "boot.retry", "boot.open_logs", "boot.quit"]);

const RECEIVE_CHANNELS = new Set([
  "current_status",
  "download_progress",
  "app_infos",
  "loader.action",
  "loader.plan",
  "boot_error",
  "error",
  "user_path",
  "conf",
]);

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
    if (SEND_CHANNELS.has(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, callback) => {
    if (RECEIVE_CHANNELS.has(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  once: (channel, callback) => {
    if (RECEIVE_CHANNELS.has(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  },
  removeAllListeners: (channel) => {
    if (RECEIVE_CHANNELS.has(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  version: appVersion,
  env: {
    NODE_ENV: process.env.NODE_ENV || "production",
    DEV: process.env.DEV || "",
    PORT: process.env.PORT || "5000",
  },
});

// Expose logger on window.log
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

// --- Injection du bundle en DEVELOPPEMENT uniquement ---
// En production, assets/index.html reference deja ../dist/index.js et
// ../dist/index.css. Injecter les memes fichiers ici les chargeait une
// SECONDE fois : le bundle etait parse et execute deux fois a chaque
// demarrage, et React montait deux fois sur le meme noeud. Reliquat de
// l'epoque webpack/dev-server, ou le HTML ne referencait rien.
if (process.env.NODE_ENV === "development") {
  const port = process.env.PORT || 5000;
  window.addEventListener("DOMContentLoaded", () => {
    const scriptNode = document.createElement("script");
    scriptNode.src = `http://localhost:${port}/dist/loader.js`;
    document.body.appendChild(scriptNode);
  });
}
