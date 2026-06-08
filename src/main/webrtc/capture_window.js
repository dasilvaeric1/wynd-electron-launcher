// Gestionnaire du capture renderer WebRTC côté main process.
//
// Cycle :
//   1. screen_session.js appelle createCaptureWindow(ctx) au start de
//      session avec useWebrtc=true.
//   2. Cette fonction crée un BrowserWindow caché qui charge capture.html.
//      Le renderer fait getUserMedia + RTCPeerConnection.
//   3. Le bridge IPC route :
//        - les messages signaling WS entrants (de browser à launcher) →
//          webContents.send('webrtc:signal-in', msg)
//        - les messages sortants du renderer (webrtc:signal-out) → WS
//   4. À la fin de session, destroyCaptureWindow() teardown propre.
//
// Le renderer reçoit sa config initiale via ipcMain.handle :
//   - mode : 'window' | 'screen'
//   - screenIndex : entier (mode 'screen' uniquement)
//   - sourceId : chromeMediaSourceId résolu pour getUserMedia
//
// La sourceId est résolue via desktopCapturer.getSources() :
//   - mode 'window' : on cherche la container BrowserWindow par sa
//     getMediaSourceId() (Electron expose ça depuis 14+)
//   - mode 'screen' : on prend sources[screenIndex] des écrans détectés
const path = require("path");
const { BrowserWindow, ipcMain, desktopCapturer } = require("electron");

let captureWindow = null;
let activeContext = null;

/**
 * @param {{
 *   mode: 'window'|'screen',
 *   screenIndex: number,
 *   getContainerWindow: () => Electron.BrowserWindow | null,
 *   sendToWs: (msg: object) => void,
 *   log: { info: Function, debug: Function, warn: Function, error: Function },
 * }} ctx
 */
function createCaptureWindow(ctx) {
  if (captureWindow) {
    ctx.log.warn("[WEBRTC] capture window already exists, replacing");
    destroyCaptureWindow();
  }
  activeContext = ctx;
  captureWindow = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "capture_preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Capture API : autoriser getUserMedia + desktopCapturer
      // (Electron 21 demande pas de flag spécial, mais on whitelist
      // la permission "media" plus bas).
    },
  });
  captureWindow.loadFile(path.join(__dirname, "capture.html"));

  // Whitelist la permission media pour ce contents — desktop capture
  // ne déclenche pas de prompt sur Electron, mais sait-on jamais.
  captureWindow.webContents.session.setPermissionRequestHandler(
    (_wc, perm, cb) => cb(perm === "media" || perm === "display-capture")
  );

  if (process.env.EL_DEBUG && /webrtc/i.test(process.env.EL_DEBUG)) {
    captureWindow.show();
    captureWindow.webContents.openDevTools({ mode: "detach" });
  }

  captureWindow.on("closed", () => {
    captureWindow = null;
    activeContext = null;
  });

  return captureWindow;
}

function destroyCaptureWindow() {
  if (!captureWindow) return;
  try {
    captureWindow.webContents.send("webrtc:teardown");
  } catch {}
  setTimeout(() => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close();
    }
    captureWindow = null;
    activeContext = null;
  }, 100);
}

/** Le main process reçoit un message signaling depuis la WS et le forward
 * au renderer. No-op si pas de capture window active. */
function forwardSignalIn(msg) {
  if (!captureWindow || captureWindow.isDestroyed()) return;
  captureWindow.webContents.send("webrtc:signal-in", msg);
}

// --- IPC handlers — enregistrés une fois ---

ipcMain.handle("webrtc:get-config", () => {
  if (!activeContext)
    return { mode: "window", screenIndex: 0, iceServers: null };
  return {
    mode: activeContext.mode,
    screenIndex: activeContext.screenIndex,
    iceServers: activeContext.iceServers ?? null,
  };
});

ipcMain.handle("webrtc:get-source-id", async () => {
  if (!activeContext) return null;
  const { mode, screenIndex, getContainerWindow, log } = activeContext;
  try {
    if (mode === "window") {
      const w = getContainerWindow();
      if (!w) {
        log.warn("[WEBRTC] no container window for capture");
        return null;
      }
      // Electron expose getMediaSourceId() sur webContents (et indirectement
      // sur BrowserWindow via getMediaSourceId). Cet ID est compatible
      // chromeMediaSourceId pour getUserMedia.
      if (typeof w.getMediaSourceId === "function") {
        return w.getMediaSourceId();
      }
      // Fallback : on parcourt les windows desktop et on retourne celle qui
      // matche le titre — moins fiable mais filet de sécurité.
      const sources = await desktopCapturer.getSources({ types: ["window"] });
      const found = sources.find(
        (s) => s.name && s.name.includes(w.getTitle())
      );
      return found ? found.id : null;
    }
    // mode === 'screen'
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    const src = sources[screenIndex] || sources[0];
    return src ? src.id : null;
  } catch (e) {
    log.error(`[WEBRTC] resolve source id failed: ${e.message}`);
    return null;
  }
});

ipcMain.on("webrtc:signal-out", (_e, msg) => {
  if (!activeContext) return;
  try {
    activeContext.sendToWs(msg);
  } catch (err) {
    activeContext.log.error(`[WEBRTC] sendToWs failed: ${err.message}`);
  }
});

ipcMain.on("webrtc:log", (_e, { level, message }) => {
  if (!activeContext) return;
  const fn = activeContext.log[level] || activeContext.log.info;
  fn(`[WEBRTC] ${message}`);
});

module.exports = {
  createCaptureWindow,
  destroyCaptureWindow,
  forwardSignalIn,
};
