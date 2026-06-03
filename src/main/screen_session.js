/**
 * Screen session module — visualisation distante de l'écran de la caisse
 * depuis le BO central. Pattern :
 *  1. Poll régulier de /api/screen-sessions/pending?caisseSerial=…
 *  2. Si pending détecté → affiche un BrowserWindow modal de consentement
 *  3. Si accepté → fetch un ticket /ticket (api-key auth), ouvre WS,
 *     capture l'écran via desktopCapturer 5fps, envoie JPEG sur le WS
 *  4. Si refusé → POST /decline
 *  5. Phase 2 (à venir) : reçoit events input via le même WS → nut.js
 *
 * Auth : on lit l'api-key + base URL + serial depuis l'appsettings.json
 * du C# RetailSchedulerService (path Windows fixe). Le launcher n'a pas
 * son propre canal d'auth — il piggyback sur la trust relationship
 * établie par le service C# avec le central.
 *
 * Ce module se déclenche tant qu'il a une config valide ; si appsettings
 * est absent (machine non Windows, dev local, etc.), il devient un no-op.
 */

const path = require("path");
const fs = require("fs");
const { BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const log = require("./helpers/electron_log");

const APPSETTINGS_PATH =
  "C:\\Retail\\ANYCOMMERCE\\RetailScheduler\\appsettings.json";
const POLL_INTERVAL_MS = 5_000;
const CAPTURE_INTERVAL_MS = 1_000; // 1 fps Phase 1 — bumpable plus tard
const JPEG_QUALITY = 70;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

let pollTimer = null;
let activeConsentWindow = null;
let activeSession = null; // { sessionId, ws, captureTimer, indicator }

/**
 * Lit l'api-key + base URL + serial depuis appsettings.json du service C#.
 * Cached après lecture réussie ; re-lu à chaque erreur 401 (rotation).
 */
let cachedConfig = null;
function readCentralConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    if (!fs.existsSync(APPSETTINGS_PATH)) {
      log.warn(
        `[SCREEN] appsettings non trouvé (${APPSETTINGS_PATH}), screen-session désactivé`
      );
      return null;
    }
    const raw = fs.readFileSync(APPSETTINGS_PATH, "utf8").replace(/^﻿/, "");
    const json = JSON.parse(raw);
    const c = json && json.CentralApi;
    if (!c || !c.BaseUrl || !c.ApiKey || !c.CaisseSerialNumber) {
      log.warn(
        "[SCREEN] CentralApi incomplet dans appsettings, screen-session désactivé"
      );
      return null;
    }
    cachedConfig = {
      baseUrl: String(c.BaseUrl).replace(/\/$/, ""),
      apiKey: String(c.ApiKey),
      serial: String(c.CaisseSerialNumber),
    };
    return cachedConfig;
  } catch (err) {
    log.error(`[SCREEN] read appsettings failed: ${err.message}`);
    return null;
  }
}

function clearCachedConfig() {
  cachedConfig = null;
}

async function httpRequest(method, url, headers = {}, body) {
  // fetch global est dispo en Electron 21 (Chromium ≥104)
  const resp = await fetch(url, {
    method,
    headers,
    body,
  });
  const text = await resp.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: resp.ok, status: resp.status, body: parsed };
}

async function pollOnce() {
  const cfg = readCentralConfig();
  if (!cfg) return;
  // Skip poll si une session est déjà active ou un consent est ouvert
  if (activeSession || activeConsentWindow) return;
  const url = `${
    cfg.baseUrl
  }/api/screen-sessions/pending?caisseSerial=${encodeURIComponent(cfg.serial)}`;
  try {
    const r = await httpRequest("GET", url, { "x-api-key": cfg.apiKey });
    if (r.status === 401 || r.status === 403) {
      log.warn(
        `[SCREEN] poll auth refusé (${r.status}), invalide cache config`
      );
      clearCachedConfig();
      return;
    }
    if (!r.ok) {
      log.debug(`[SCREEN] poll non-OK: ${r.status}`);
      return;
    }
    const session = r.body && r.body.session;
    if (session && session.id) {
      log.info(
        `[SCREEN] session pending détectée: ${session.id} (requestedBy=${session.requestedBy})`
      );
      showConsentDialog(cfg, session);
    }
  } catch (err) {
    log.debug(`[SCREEN] poll error (non-fatal): ${err.message}`);
  }
}

function showConsentDialog(cfg, session) {
  if (activeConsentWindow) return;

  const win = new BrowserWindow({
    width: 480,
    height: 320,
    frame: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    modal: false,
    title: "Demande de support distant",
    webPreferences: {
      preload: path.join(__dirname, "helpers", "screen_consent_preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  activeConsentWindow = win;

  // Auto-close timeout 30s (laisse le central répondre à la décision)
  const autoCloseTimer = setTimeout(() => {
    log.info("[SCREEN] consent auto-decline (timeout 30s)");
    ipcMain.emit("screen-consent:answer", null, false);
  }, 30_000);

  const handler = (e, accepted) => {
    clearTimeout(autoCloseTimer);
    ipcMain.removeListener("screen-consent:answer", handler);
    respondToSession(cfg, session, accepted).catch((err) =>
      log.error(`[SCREEN] respondToSession: ${err.message}`)
    );
    if (!win.isDestroyed()) win.close();
  };
  ipcMain.on("screen-consent:answer", handler);

  win.loadFile(path.join(__dirname, "..", "local", "screen_consent.html"), {
    query: {
      sessionId: session.id,
      ttlSeconds: String(session.ttlSeconds || 900),
      requestedBy: session.requestedBy || "",
    },
  });

  win.on("closed", () => {
    clearTimeout(autoCloseTimer);
    ipcMain.removeListener("screen-consent:answer", handler);
    activeConsentWindow = null;
  });
}

async function respondToSession(cfg, session, accepted) {
  const path = accepted ? "accept" : "decline";
  try {
    const r = await httpRequest(
      "POST",
      `${cfg.baseUrl}/api/screen-sessions/${session.id}/${path}`,
      { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      "{}"
    );
    if (!r.ok) {
      log.error(
        `[SCREEN] ${path} failed: ${r.status} ${JSON.stringify(r.body)}`
      );
      return;
    }
    log.info(
      `[SCREEN] session ${session.id} → ${accepted ? "accepted" : "declined"}`
    );
    if (accepted) {
      startCaptureLoop(cfg, session);
    }
  } catch (err) {
    log.error(`[SCREEN] respond ${path} threw: ${err.message}`);
  }
}

async function startCaptureLoop(cfg, session) {
  if (activeSession) {
    log.warn("[SCREEN] capture already running, ignoring start");
    return;
  }

  // 1. Fetch ticket WS
  let wsUrl;
  try {
    const r = await httpRequest(
      "POST",
      `${cfg.baseUrl}/api/screen-sessions/${session.id}/ticket`,
      { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      "{}"
    );
    if (!r.ok || !r.body || !r.body.ticket) {
      log.error(`[SCREEN] ticket grant failed: ${r.status}`);
      return;
    }
    const wsBase = cfg.baseUrl.replace(/^http/, "ws");
    wsUrl = `${wsBase}/api/screen-sessions/${
      session.id
    }/stream?ticket=${encodeURIComponent(r.body.ticket)}`;
  } catch (err) {
    log.error(`[SCREEN] ticket fetch threw: ${err.message}`);
    return;
  }

  // 2. Open WS
  const WebSocketImpl = require("ws");
  const ws = new WebSocketImpl(wsUrl);
  ws.binaryType = "arraybuffer";

  const indicator = showSessionIndicator();
  activeSession = { sessionId: session.id, ws, captureTimer: null, indicator };

  ws.on("open", () => {
    log.info(`[SCREEN] WS open for session ${session.id}`);
    // 3. Start capture loop
    activeSession.captureTimer = setInterval(async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        });
        if (!sources.length) return;
        // Prend l'écran primaire (premier source). Multi-écran : à raffiner si besoin.
        const jpeg = sources[0].thumbnail.toJPEG(JPEG_QUALITY);
        if (ws.readyState === WebSocketImpl.OPEN) {
          ws.send(jpeg, { binary: true });
        }
      } catch (err) {
        log.debug(`[SCREEN] capture error: ${err.message}`);
      }
    }, CAPTURE_INTERVAL_MS);
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) return; // ignore binaires reçus
    try {
      const msg = JSON.parse(data.toString("utf8"));
      if (msg.type === "session-ended") {
        log.info(`[SCREEN] session ended by central: ${msg.reason || ""}`);
        stopSession();
        return;
      }
      // Phase 2 — Inject input events au niveau OS via nut.js
      if (
        msg.type === "mouse-move" ||
        msg.type === "mouse-click" ||
        msg.type === "key-tap"
      ) {
        injectInputEvent(msg).catch((err) =>
          log.debug(`[SCREEN] input inject error: ${err.message}`)
        );
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    log.info(`[SCREEN] WS closed for session ${session.id}`);
    stopSession();
  });

  ws.on("error", (err) => {
    log.error(`[SCREEN] WS error: ${err.message}`);
  });
}

/**
 * Phase 2 — Injection des events souris/clavier au niveau OS via nut.js.
 *
 * Lazy-load du module nut-js (~native binding compilé) au 1er event reçu —
 * évite le coût startup quand personne n'utilise le control mode.
 *
 * Coords reçues normalisées 0-1 (rect de l'élément côté browser) → on
 * multiplie par la taille de l'écran courant. Permet au browser de
 * scaler son rendu sans casser les coordonnées.
 */
let nutCached = null;
async function getNut() {
  if (nutCached) return nutCached;
  try {
    nutCached = require("@nut-tree-fork/nut-js");
    nutCached.mouse.config.mouseSpeed = 1000;
    nutCached.keyboard.config.autoDelayMs = 0;
    return nutCached;
  } catch (err) {
    log.error(
      `[SCREEN] nut-js load failed: ${err.message} — Phase 2 control désactivé`
    );
    return null;
  }
}

async function injectInputEvent(msg) {
  const nut = await getNut();
  if (!nut) return;
  const { screen, mouse, keyboard, Button, Key, Point } = nut;
  const screenW = await screen.width();
  const screenH = await screen.height();

  if (msg.type === "mouse-move" || msg.type === "mouse-click") {
    if (typeof msg.xNorm !== "number" || typeof msg.yNorm !== "number") return;
    const x = Math.round(Math.max(0, Math.min(1, msg.xNorm)) * screenW);
    const y = Math.round(Math.max(0, Math.min(1, msg.yNorm)) * screenH);
    await mouse.setPosition(new Point(x, y));
    if (msg.type === "mouse-click") {
      const btn = msg.button === "right" ? Button.RIGHT : Button.LEFT;
      await mouse.click(btn);
    }
    return;
  }

  if (msg.type === "key-tap") {
    // 2 modes : touche spéciale (Enter, Tab, Escape, etc.) → Key.X via keyboard.pressKey
    // ou caractère imprimable (msg.key.length === 1) → keyboard.type
    const k = String(msg.key || "");
    if (k.length === 1) {
      await keyboard.type(k);
      return;
    }
    // Mapping minimal des touches non-imprimables courantes
    const map = {
      Enter: Key.Enter,
      Tab: Key.Tab,
      Escape: Key.Escape,
      Backspace: Key.Backspace,
      Delete: Key.Delete,
      ArrowUp: Key.Up,
      ArrowDown: Key.Down,
      ArrowLeft: Key.Left,
      ArrowRight: Key.Right,
      Home: Key.Home,
      End: Key.End,
      PageUp: Key.PageUp,
      PageDown: Key.PageDown,
      " ": Key.Space,
    };
    const mapped = map[k];
    if (mapped !== undefined) {
      await keyboard.pressKey(mapped);
      await keyboard.releaseKey(mapped);
    } else {
      log.debug(`[SCREEN] key-tap non mappée: ${k}`);
    }
  }
}

function stopSession() {
  if (!activeSession) return;
  if (activeSession.captureTimer) clearInterval(activeSession.captureTimer);
  if (activeSession.ws && activeSession.ws.readyState <= 1) {
    try {
      activeSession.ws.close();
    } catch {}
  }
  if (activeSession.indicator && !activeSession.indicator.isDestroyed()) {
    activeSession.indicator.close();
  }
  activeSession = null;
}

/**
 * Indicateur visuel permanent pendant la session : petite window 200x40
 * always-on-top en haut à droite. L'utilisateur sait qu'il est observé.
 */
function showSessionIndicator() {
  const win = new BrowserWindow({
    width: 240,
    height: 44,
    x: 20,
    y: 20,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    transparent: false,
    webPreferences: { contextIsolation: true, sandbox: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;font-family:system-ui,sans-serif;background:#dc2626;color:#fff;}
  .b{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;font-weight:600;}
  .dot{width:10px;height:10px;border-radius:999px;background:#fff;animation:p 1s infinite;}
  @keyframes p{0%,100%{opacity:.4}50%{opacity:1}}
</style></head>
<body><div class="b"><span class="dot"></span>Support en observation</div></body></html>
		`)
  );
  return win;
}

/**
 * Hook public : appelé depuis index.js après app.whenReady().
 */
function initScreenSessions() {
  if (pollTimer) return;
  log.info("[SCREEN] poller started");
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => log.debug(`[SCREEN] pollOnce: ${err.message}`));
  }, POLL_INTERVAL_MS);
  // Tick immédiat
  pollOnce().catch(() => {});
}

function teardownScreenSessions() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  stopSession();
  if (activeConsentWindow && !activeConsentWindow.isDestroyed()) {
    activeConsentWindow.close();
  }
}

module.exports = { initScreenSessions, teardownScreenSessions };
