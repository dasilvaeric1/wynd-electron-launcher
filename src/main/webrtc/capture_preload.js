// Preload du capture renderer WebRTC.
// Expose une API minimale au renderer (contextIsolation: true) pour
//   - recevoir les messages signaling depuis le main (offer/answer/ICE)
//   - renvoyer ses propres messages signaling au main
//   - récupérer la chromeMediaSourceId de la container window à capturer
//
// Le renderer fait toute la logique WebRTC (getUserMedia + RTCPeerConnection)
// puisque ces APIs n'existent que dans un renderer Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webrtcBridge", {
  // Le renderer demande l'ID de source à capturer (container BrowserWindow
  // en mode 'window', écran en mode 'screen'). Renvoie une promesse.
  getCaptureSourceId: () => ipcRenderer.invoke("webrtc:get-source-id"),

  // Renvoie la config initiale (mode, screenIndex, peerCount estimé)
  // une fois le renderer monté.
  getInitialConfig: () => ipcRenderer.invoke("webrtc:get-config"),

  // Le renderer envoie un message signaling sortant — main process
  // le forward sur la WS relay.
  sendSignal: (msg) => ipcRenderer.send("webrtc:signal-out", msg),

  // Le main lui pousse les messages signaling entrants.
  onSignal: (cb) => {
    const handler = (_, msg) => cb(msg);
    ipcRenderer.on("webrtc:signal-in", handler);
    return () => ipcRenderer.removeListener("webrtc:signal-in", handler);
  },

  // Le main demande au renderer de stopper toutes ses peer connections.
  onTeardown: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("webrtc:teardown", handler);
    return () => ipcRenderer.removeListener("webrtc:teardown", handler);
  },

  // Log centralisé — repassé au main pour qu'il sorte dans
  // electron_log avec le préfixe [WEBRTC].
  log: (level, message) =>
    ipcRenderer.send("webrtc:log", { level, message }),
});
