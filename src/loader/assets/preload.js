const { ipcRenderer, contextBridge } = require("electron");
const createRenderLog = require("../../helpers/create_renderer_log");

// Version de build injectée SYNCHRONEMENT (pas d'IPC) — évite la race où
// app_infos arrive avant que React ait monté ses listeners.
let appVersion = "";
try {
  appVersion = require("../../main/helpers/build_version")();
} catch {
  /* build_info absent (dev) → vide */
}

// --- Channel whitelists ---
const SEND_CHANNELS = ["ready"];

const RECEIVE_CHANNELS = [
  "current_status",
  "download_progress",
  "app_infos",
  "loader.action",
  "error",
  "user_path",
];

// --- Logger (initialized async on user_path) ---
let logger = {
  info: (...args) => console.info("[LOG]", ...args),
  debug: (...args) => console.debug("[LOG]", ...args),
  warn: (...args) => console.warn("[LOG]", ...args),
  error: (...args) => console.error("[LOG]", ...args),
  level: "info",
};

ipcRenderer.once("user_path", (_event, userPath) => {
  logger = createRenderLog(userPath);
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
    logger.level = level;
  },
});

// --- Dynamic script/CSS injection ---
const sources = [];
if (process.env.NODE_ENV === "development") {
  const port = process.env.PORT || 5000;
  sources.push(`http://localhost:${port}/dist/loader.js`);
} else {
  sources.push("../dist/index.js");
}

window.addEventListener("DOMContentLoaded", () => {
  if (process.env.NODE_ENV !== "development") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "../dist/index.css";
    document.getElementsByTagName("head")[0].appendChild(link);
  }
  for (let i = 0; i < sources.length; i++) {
    const scriptNode = document.createElement("script");
    scriptNode.src = sources[i];
    document.body.appendChild(scriptNode);
  }
});
