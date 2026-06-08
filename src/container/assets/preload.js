const path = require("path");
const { ipcRenderer, contextBridge, webFrame } = require("electron");
const createRenderLog = require("../../helpers/create_renderer_log");

// Version de build injectée synchroniquement (cf preload loader).
let appVersion = "";
try {
  appVersion = require("../../main/helpers/build_version")();
} catch {
  /* build_info absent (dev) → vide */
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
    logger.level = level;
  },
});

// Expose __STATIC__ for webview preload path
contextBridge.exposeInMainWorld(
  "__STATIC__",
  `file://${path.resolve(__dirname, "./preload_app.js")}`
);

// --- Dynamic script/CSS injection (shared DOM, works with contextIsolation) ---
window.addEventListener("DOMContentLoaded", () => {
  const sources = [];
  if (document.getElementById("electron-launcher-root")) {
    if (process.env.NODE_ENV === "development") {
      const port = process.env.PORT || 5000;
      sources.push(`http://localhost:${port}/dist/container.js`);
    } else {
      sources.push("../../container/dist/index.js");
    }
    if (process.env.NODE_ENV !== "development") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "../../container/dist/index.css";
      document.getElementsByTagName("head")[0].appendChild(link);
    }
    for (let i = 0; i < sources.length; i++) {
      const scriptNode = document.createElement("script");
      scriptNode.src = sources[i];
      document.body.appendChild(scriptNode);
    }
  }
});
