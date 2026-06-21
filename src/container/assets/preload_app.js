const { ipcRenderer, contextBridge, webFrame } = require("electron");

const fs = require("fs");
const path = require("path");
// Tap Redux : on exécute le shim dans le MAIN world via
// webFrame.executeJavaScript (≠ <script> DOM, qui serait refusé par la CSP de
// la page POS) AVANT la création du store. Best-effort : ne casse jamais le POS.
try {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "assets", "redux", "redux_tap.js"),
  ];
  try {
    if (process.resourcesPath)
      candidates.push(
        path.join(process.resourcesPath, "assets", "redux", "redux_tap.js"),
      );
  } catch (_) {
    /* process.resourcesPath indispo */
  }
  let shimSrc = null;
  for (const p of candidates) {
    try {
      shimSrc = fs.readFileSync(p, "utf8");
      if (shimSrc) break;
    } catch (_) {
      /* essaie le candidat suivant */
    }
  }
  if (shimSrc) {
    webFrame
      .executeJavaScript(
        shimSrc +
          "\n;try{console.debug('[el-redux-tap] installed='+!!window.__elReduxInstalled)}catch(e){}",
      )
      .catch((e) => {
        try {
          console.error("[el-redux-tap] exec KO", e && e.message);
        } catch (_) {}
      });
  } else {
    try {
      console.error("[el-redux-tap] shim introuvable", candidates);
    } catch (_) {}
  }
} catch (e) {
  try {
    console.error("[el-redux-tap] KO", e && e.message);
  } catch (_) {}
}

ipcRenderer.on("parent.action", (event, data) => {
  data.origin = window.origin;
  window.postMessage(data, window.origin);
});

contextBridge.exposeInMainWorld("electron", {
  sendToHost: (data) => ipcRenderer.sendToHost("app.action", data),
});
