const { ipcRenderer, contextBridge } = require("electron");

const fs = require("fs");
const path = require("path");
try {
  const shimSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "assets", "redux", "redux_tap.js"),
    "utf8",
  );
  const inject = () => {
    if (document.getElementById("__el_redux_tap")) return;
    const s = document.createElement("script");
    s.id = "__el_redux_tap";
    s.textContent = shimSrc;
    (document.head || document.documentElement).prepend(s);
  };
  if (document.documentElement) inject();
  else document.addEventListener("readystatechange", inject, { once: true });
} catch (e) {
  /* tap best-effort, ne casse pas le POS */
}

ipcRenderer.on("parent.action", (event, data) => {
  data.origin = window.origin;
  window.postMessage(data, window.origin);
});

contextBridge.exposeInMainWorld("electron", {
  sendToHost: (data) => ipcRenderer.sendToHost("app.action", data),
});
