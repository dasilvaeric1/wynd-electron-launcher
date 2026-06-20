/**
 * Screen session module — visualisation distante de l'écran de la caisse
 * depuis le BO central. Pattern :
 *  1. Poll régulier de /api/screen-sessions/pending?caisseSerial=…
 *  2. Si pending détecté → affiche un BrowserWindow modal de consentement
 *  3. Si accepté → fetch un ticket /ticket (api-key auth), ouvre WS,
 *     capture selon le mode demandé, envoie JPEG sur le WS
 *  4. Si refusé → POST /decline
 *  5. Reçoit events input via le même WS → injecte selon le mode
 *
 * Modes de capture (choisis par l'opérateur côté BO, transmis via
 * session.mode) :
 *  - 'window' (défaut, sûr) : capture la BrowserWindow container qui
 *    héberge l'iframe POS. Aucune permission OS requise. Inject via
 *    webContents.sendInputEvent (limité au DOM POS). Coords normalisées
 *    multipliées par ContentBounds de la window.
 *  - 'screen' : capture l'écran primaire entier via desktopCapturer.
 *    Sur macOS exige Screen Recording permission. Inject via nut.js
 *    (system-wide, peut bouger n'importe quelle app). Coords normalisées
 *    multipliées par taille d'écran.
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
const {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  webContents: ElectronWebContents,
} = require("electron");
const log = require("./helpers/electron_log");
const getDeviceSummary = require("./helpers/device_summary");
const wptProxyTunnel = require("./helpers/wpt_proxy_tunnel");
const netCapture = require("./helpers/net_capture");
const sessionRecorder = require("./helpers/session_recorder");
const {
  createCaptureWindow,
  destroyCaptureWindow,
  forwardSignalIn,
} = require("./webrtc/capture_window");

const WEBRTC_SIGNAL_TYPES = new Set([
  "want-webrtc",
  "webrtc-offer",
  "webrtc-answer",
  "webrtc-ice",
  "webrtc-bye",
  // Pilotage qualité à distance depuis le BO — routé vers le capture renderer
  // qui applique fps/bitrate/résolution à chaud via setParameters.
  "set-quality",
]);

// Path par défaut sur Windows (caisse en production). Surchargeable via env
// var pour dev local (macOS/Linux) — ou utiliser les EL_SCREEN_* directes.
const APPSETTINGS_PATH =
  process.env.EL_SCREEN_APPSETTINGS_PATH ||
  "C:\\Retail\\ANYCOMMERCE\\RetailScheduler\\appsettings.json";
const POLL_INTERVAL_MS = 5_000;
// 100ms = 10 fps. Compromise raisonnable :
//  - assez fluide pour observer/contrôler une caisse à distance
//  - charge réseau ~JPEG_QUALITY * 10 ≈ 80-250 KB/s par session, OK sur LAN
//    ou WAN décent (côté caisse en magasin = fibre/ADSL généralement)
//  - charge CPU côté launcher : capturePage ~ 5-10ms sur mac M, négligeable
// Pour scale ↑ (30k caisses), ce throughput sera réévalué via long-poll ou
// stream différentiel — pas un souci à ce stade.
const CAPTURE_INTERVAL_MS = 100;
const JPEG_QUALITY = 70;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

let pollTimer = null;
let activeConsentWindow = null;
let activeSession = null; // { sessionId, mode, ws, captureTimer, indicator }
// Référence vers le store partagé du launcher — nécessaire pour accéder à
// store.windows.container.current (la BrowserWindow qui héberge l'iframe POS)
// en mode 'window'. Set par initScreenSessions(store), null en l'absence.
let sharedStore = null;

/**
 * Lit l'api-key + base URL + serial depuis appsettings.json du service C#.
 * Cached après lecture réussie ; re-lu à chaque erreur 401 (rotation).
 */
let cachedConfig = null;
// Suppression du spam : on n'affiche qu'une fois les warnings "config absente",
// puis on reste silencieux jusqu'à ce qu'une lecture réussie change l'état.
let warnedMissing = false;

/**
 * Récupère le serial via l'endpoint local du service C# RetailScheduler.
 * Utile quand `appsettings.json` a `CaisseSerialNumber: ""` (cas par défaut
 * — le service C# résout BIOS-serial > MachineName à runtime sans
 * réécrire le fichier). Retourne null si endpoint indispo.
 */
async function fetchSerialFromLocalService(uiPort) {
  const port = uiPort || 5088;
  try {
    const r = await axios.get(`http://localhost:${port}/api/identity`, {
      timeout: 2_000,
      validateStatus: () => true,
    });
    if (r.status < 400 && r.data?.caisseSerial) {
      return String(r.data.caisseSerial);
    }
    return null;
  } catch {
    return null;
  }
}

async function readCentralConfig() {
  if (cachedConfig) return cachedConfig;

  // Priorité aux env-vars (utile en dev local macOS/Linux sans appsettings.json) :
  //   EL_SCREEN_API_KEY      → CentralApi.ApiKey
  //   EL_SCREEN_BASE_URL     → CentralApi.BaseUrl
  //   EL_SCREEN_SERIAL       → CentralApi.CaisseSerialNumber
  // Si les 3 sont set → on skip la lecture du fichier.
  const envApiKey = process.env.EL_SCREEN_API_KEY;
  const envBaseUrl = process.env.EL_SCREEN_BASE_URL;
  const envSerial = process.env.EL_SCREEN_SERIAL;
  if (envApiKey && envBaseUrl && envSerial) {
    log.info(`[SCREEN] config depuis env vars (dev mode), serial=${envSerial}`);
    cachedConfig = {
      baseUrl: String(envBaseUrl).replace(/\/$/, ""),
      apiKey: String(envApiKey),
      serial: String(envSerial),
    };
    return cachedConfig;
  }

  try {
    if (!fs.existsSync(APPSETTINGS_PATH)) {
      if (!warnedMissing) {
        log.warn(
          `[SCREEN] appsettings non trouvé (${APPSETTINGS_PATH}), screen-session désactivé. ` +
            `Pour dev local, set EL_SCREEN_API_KEY + EL_SCREEN_BASE_URL + EL_SCREEN_SERIAL.`,
        );
        warnedMissing = true;
      }
      return null;
    }
    const raw = fs.readFileSync(APPSETTINGS_PATH, "utf8").replace(/^﻿/, "");
    const json = JSON.parse(raw);
    const c = json?.CentralApi;
    if (!c || !c.BaseUrl || !c.ApiKey) {
      if (!warnedMissing) {
        log.warn(
          "[SCREEN] CentralApi incomplet dans appsettings (BaseUrl/ApiKey requis), screen-session désactivé",
        );
        warnedMissing = true;
      }
      return null;
    }
    // Le serial peut être vide dans appsettings ; le service C# le résout
    // à runtime (BIOS > machine name). On le fetch via /api/identity.
    let serial = String(c.CaisseSerialNumber || "");
    if (!serial) {
      serial = (await fetchSerialFromLocalService(json?.UiPort)) || "";
      if (serial) {
        log.info(`[SCREEN] serial via service local: ${serial}`);
      }
    }
    if (!serial) {
      if (!warnedMissing) {
        log.warn(
          "[SCREEN] CaisseSerialNumber vide et endpoint /api/identity indispo (RetailScheduler éteint ?) — screen-session désactivé",
        );
        warnedMissing = true;
      }
      return null;
    }
    cachedConfig = {
      baseUrl: String(c.BaseUrl).replace(/\/$/, ""),
      apiKey: String(c.ApiKey),
      serial,
    };
    return cachedConfig;
  } catch (err) {
    log.error(`[SCREEN] read appsettings failed: ${err.message}`);
    return null;
  }
}

function clearCachedConfig() {
  cachedConfig = null;
  // En cas de rotation/invalidation, on autorise un nouveau warn pour signaler
  // visiblement la perte de config.
  warnedMissing = false;
}

/**
 * Renvoie la BrowserWindow qui héberge l'iframe POS, ou null si le store
 * n'est pas dispo / la window pas encore créée / déjà détruite.
 */
function getContainerWindow() {
  const w = sharedStore?.windows?.container?.current;
  if (!w || w.isDestroyed()) return null;
  return w;
}

/**
 * Renvoie le webContents enfant du `<webview>` (process POS) si attaché à
 * la container window. Permet d'envoyer les events directement dans le DOM
 * POS via sendInputEvent — sinon Chromium ne propage pas les events depuis
 * le webContents parent vers la guest view. Retourne null si pas de webview.
 */
function getWebviewWebContents(parentWc) {
  if (!parentWc) return null;
  const all = ElectronWebContents.getAllWebContents();
  return (
    all.find(
      (wc) =>
        !wc.isDestroyed() &&
        wc.getType() === "webview" &&
        wc.hostWebContents?.id === parentWc.id,
    ) ?? null
  );
}

/**
 * Interroge le DOM du parent via executeJavaScript pour récupérer les
 * bounds :
 *  - du `<webview id="e-launcher-frame">` (zone POS, route vers webview wc)
 *  - des overlays Wynd qui doivent garder la priorité même quand ils sont
 *    visuellement par-dessus le webview (bouton menu flottant + drawer).
 *
 * Le webview occupe typiquement toute la window — sans connaître les
 * overlays, tout clic serait routé vers le webview et le panneau Wynd
 * deviendrait incliquable à distance.
 *
 * Pas appelée à chaque event (coût IPC) — refresh au start de session
 * + sur 'resize' de la container.
 */
async function refreshWebviewBounds(parentWc) {
  try {
    const result = await parentWc.executeJavaScript(
      `(() => {
        function rectOf(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return null;
          // Filtre les éléments masqués (display:none → getBoundingClientRect = 0×0).
          // Vérifie aussi visibility/opacity via getComputedStyle.
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
            return null;
          }
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }
        const webview = rectOf(document.getElementById('e-launcher-frame'));
        // Le <Drawer> Ant Design portal-mount sous <body>, avec ces classes :
        //   .ant-drawer-content-wrapper → le panneau visible (taille drawer)
        //   .ant-drawer-mask → masque plein écran (à NE PAS inclure, sinon
        //   tout serait routé vers parent quand la drawer est ouverte).
        // On scope avec :scope vers les ant-drawer ACTUELLEMENT OUVERTES
        // (Ant ajoute la classe .ant-drawer-open au root).
        const drawers = Array.from(
          document.querySelectorAll('.ant-drawer-open .ant-drawer-content-wrapper')
        );
        const overlays = [
          rectOf(document.getElementById('el-menu-button')),
          ...drawers.map(rectOf),
        ].filter(Boolean);
        return { webview, overlays };
      })()`,
      true,
    );
    if (
      activeSession &&
      result?.webview &&
      typeof result.webview.w === "number" &&
      result.webview.w > 0
    ) {
      activeSession.webviewBounds = result.webview;
      activeSession.overlayBounds = result.overlays || [];
      log.info(
        `[SCREEN] webview = ${result.webview.x},${result.webview.y} ${result.webview.w}×${result.webview.h} | ${result.overlays.length} overlay(s)`,
      );
    }
  } catch (err) {
    log.debug(`[SCREEN] refreshWebviewBounds: ${err.message}`);
  }
}

/**
 * Capture une frame JPEG selon le mode demandé.
 *  - 'window' : NativeImage.capturePage() sur la BrowserWindow container
 *    (iframe POS uniquement, pas de permission OS requise).
 *  - 'screen' : desktopCapturer.getSources({types:['screen']}) sur l'écran
 *    primaire (bureau complet, exige Screen Recording sur macOS).
 *
 * Renvoie un Buffer JPEG ou null si la capture échoue. Le caller décide
 * d'envoyer ou pas en fonction de l'état du WS.
 */
async function captureFrame(mode) {
  if (mode === "window") {
    const w = getContainerWindow();
    if (!w) return null;
    // Capture la BrowserWindow extérieure (qui rend panneau + webview/iframe
    // inline). Le webview enfant est compositionné dedans → on récupère un
    // rendu complet sans appeler capturePage sur le webview lui-même
    // (peu fiable sur macOS, retourne du noir dans certains cas).
    const image = await w.webContents.capturePage();
    if (activeSession) activeSession.captureSize = image.getSize();
    const resized = image.resize({ width: CAPTURE_WIDTH });
    return resized.toJPEG(JPEG_QUALITY);
  }
  // mode === 'screen'
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
  });
  if (!sources.length) return null;
  // Multi-monitor : sélectionne l'écran demandé par le BO. desktopCapturer
  // renvoie les sources dans un ordre stable (primaire d'abord, puis le
  // ou les écrans secondaires). Si l'index demandé est hors plage (ex :
  // l'opérateur a tapé 1 sur une caisse mono-écran), fallback sur 0 pour
  // ne pas casser la session avec un crash silencieux.
  const idx = activeSession?.screenIndex || 0;
  const source = sources[idx] ?? sources[0];
  if (idx > 0 && !sources[idx]) {
    log.warn(
      `[SCREEN] screenIndex=${idx} demandé mais seulement ${sources.length} écran(s) — fallback 0`,
    );
  }
  return source.thumbnail.toJPEG(JPEG_QUALITY);
}

// axios (déjà dep) — fetch global n'est PAS disponible dans le main process
// Electron 21 (Node 16). Pas la peine de polyfiller, axios fait le job.
const axios = require("axios");
async function httpRequest(method, url, headers = {}, body) {
  try {
    const resp = await axios.request({
      method,
      url,
      headers,
      data: body,
      // axios par défaut throw sur status ≥400 → on désactive pour récupérer
      // le payload d'erreur côté caller (status check explicite).
      validateStatus: () => true,
      timeout: 15_000,
    });
    return { ok: resp.status < 400, status: resp.status, body: resp.data };
  } catch (err) {
    // Network/timeout/dns error → on renvoie un faux 0 status pour que
    // le caller log en debug sans crasher.
    return { ok: false, status: 0, body: { error: err.message } };
  }
}

// Lus une seule fois — coûte rien de les inclure à chaque poll côté serveur
// et permet à la BO de voir version/platform/uptime des launchers sur chaque
// caisse pour diagnostiquer les rollouts (ex : "toutes les caisses qui
// n'ont pas encore 1.23.0 sont en attente d'update").
const launcherInfo = (() => {
  try {
    // Identifiant de build complet (version+date+sha) — le BO affiche cette
    // valeur dans le badge présence par caisse, donc on sait exactement quel
    // build tourne où, sans toucher la caisse.
    const version = require("./helpers/build_version")();
    return {
      version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    };
  } catch {
    return { version: "unknown", platform: process.platform };
  }
})();
const launcherStartedAt = Date.now();

async function pollOnce() {
  const cfg = await readCentralConfig();
  if (!cfg) return;
  // Skip poll si une session est déjà active ou un consent est ouvert
  if (activeSession || activeConsentWindow) return;
  const uptimeSeconds = Math.floor((Date.now() - launcherStartedAt) / 1000);
  // Résumé périphériques (imprimante/TPE/Central) pour la vue flotte BO.
  // Collecte throttlée (voir device_summary.js) — l'échec n'empêche pas le poll.
  let devicesParam = "";
  try {
    const summary = getDeviceSummary(sharedStore);
    if (summary) {
      devicesParam = `&devices=${encodeURIComponent(JSON.stringify(summary))}`;
    }
  } catch {
    // non-bloquant
  }
  const url =
    `${cfg.baseUrl}/api/screen-sessions/pending` +
    `?caisseSerial=${encodeURIComponent(cfg.serial)}` +
    `&launcherVersion=${encodeURIComponent(launcherInfo.version)}` +
    `&platform=${encodeURIComponent(launcherInfo.platform)}` +
    `&uptime=${uptimeSeconds}` +
    devicesParam;
  try {
    const r = await httpRequest("GET", url, { "x-api-key": cfg.apiKey });
    if (r.status === 401 || r.status === 403) {
      log.warn(
        `[SCREEN] poll auth refusé (${r.status}), invalide cache config`,
      );
      clearCachedConfig();
      return;
    }
    if (!r.ok) {
      log.debug(`[SCREEN] poll non-OK: ${r.status}`);
      return;
    }
    // Tunnel WPT demandé par le BO → ouverture d'une WS sortante dédiée
    // (canal indépendant des sessions écran). open() est idempotent.
    if (r.body && r.body.wptTunnel && r.body.wptTunnel.open) {
      wptProxyTunnel
        .open(cfg, sharedStore, httpRequest)
        .catch((e) => log.debug(`[WPT-TUNNEL] open: ${e.message}`));
    }
    const session = r.body && r.body.session;
    if (session && session.id) {
      log.info(
        `[SCREEN] session pending détectée: ${session.id} (requestedBy=${session.requestedBy})`,
      );
      // Consentement caissier : DÉSACTIVÉ par défaut (télémaintenance non
      // surveillée de matériel d'entreprise, comportement RMM standard). Le
      // popup de consentement est OPT-IN via EL_SCREEN_REQUIRE_CONSENT=1.
      // EL_SCREEN_AUTO_ACCEPT reste supporté en alias rétro-compat.
      //
      // ⚠️ Conformité : l'information des salariés (charte, signalétique)
      // relève de l'opérateur du parc.
      const requireConsent = process.env.EL_SCREEN_REQUIRE_CONSENT === "1";
      if (!requireConsent) {
        respondToSession(cfg, session, true).catch((err) =>
          log.error(`[SCREEN] auto-accept failed: ${err.message}`),
        );
        return;
      }
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
      log.error(`[SCREEN] respondToSession: ${err.message}`),
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
      "{}",
    );
    if (!r.ok) {
      log.error(
        `[SCREEN] ${path} failed: ${r.status} ${JSON.stringify(r.body)}`,
      );
      return;
    }
    log.info(
      `[SCREEN] session ${session.id} → ${accepted ? "accepted" : "declined"}`,
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
      "{}",
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

  // Le mode est décidé côté BO et arrive dans la session API. Si absent
  // (vieille version d'API ou bug), on default sur 'window' (plus safe :
  // n'expose pas le bureau entier par inadvertance).
  // Fallback : si mode='window' demandé mais aucune container window dispo
  // (cas pathologique), on bascule sur 'screen' pour ne pas casser la session.
  let mode = session.mode === "screen" ? "screen" : "window";
  if (mode === "window" && !getContainerWindow()) {
    log.warn(
      "[SCREEN] mode='window' demandé mais aucune container window — fallback 'screen'",
    );
    mode = "screen";
  }
  log.info(`[SCREEN] capture mode = ${mode}`);

  // Le champ useWebrtc est positionné côté BO à la création de session.
  // Override possible via EL_USE_WEBRTC=0/1 pour test local sans toucher
  // la DB. En cas d'échec WebRTC on retombe sur JPEG sans intervention
  // (le launcher continue à servir le capture timer).
  const envWebrtc = process.env.EL_USE_WEBRTC;
  const useWebrtc =
    envWebrtc === "1" ? true : envWebrtc === "0" ? false : !!session.useWebrtc;
  log.info(`[SCREEN] capture mode = ${mode} webrtc=${useWebrtc}`);

  // Indicateur visuel "Support en observation" côté caisse : MASQUÉ par
  // défaut (la session doit être discrète). OPT-IN via
  // EL_SCREEN_SHOW_INDICATOR=1 si l'opérateur veut une notification visible.
  const indicator =
    process.env.EL_SCREEN_SHOW_INDICATOR === "1"
      ? showSessionIndicator(mode)
      : null;
  activeSession = {
    sessionId: session.id,
    mode,
    screenIndex: Number.isInteger(session.screenIndex)
      ? session.screenIndex
      : 0,
    useWebrtc,
    cfg, // gardé pour pouvoir re-fetch un ticket lors de la reconnexion WS
    ws,
    captureTimer: null,
    indicator,
    webviewBounds: null,
    resizeHandler: null,
    reconnectAttempts: 0,
  };

  if (useWebrtc) {
    try {
      createCaptureWindow({
        mode,
        screenIndex: activeSession.screenIndex,
        // Passé tel quel au capture renderer pour qu'il construise son
        // RTCPeerConnection avec le bon iceServers (Cloudflare TURN). Le
        // central pousse ces creds dans le payload de session ; ils sont
        // éphémères (TTL ~ session) donc safe en transit.
        iceServers: Array.isArray(session.iceServers)
          ? session.iceServers
          : null,
        getContainerWindow,
        sendToWs: (msg) => {
          const current = activeSession?.ws;
          if (current && current.readyState === 1) {
            current.send(JSON.stringify(msg));
          }
        },
        log,
      });
    } catch (err) {
      log.error(`[WEBRTC] create capture window failed: ${err.message}`);
    }
  }

  // En mode 'window' on prépare le hit-testing : rafraîchit les bounds du
  // webview maintenant + à chaque resize de la container. Le webview peut
  // ne pas encore être monté au start de session → on retry toutes les 2s
  // tant qu'on n'a rien (max 30 attempts = 1 min) pour gérer les chargements
  // lents de page.
  if (mode === "window") {
    const w = getContainerWindow();
    if (w) {
      let attempts = 0;
      const tryFetch = async () => {
        if (!activeSession || activeSession.webviewBounds) return;
        attempts += 1;
        await refreshWebviewBounds(w.webContents);
        if (!activeSession?.webviewBounds && attempts < 30) {
          setTimeout(tryFetch, 2_000);
        }
      };
      tryFetch();
      const onResize = () => {
        refreshWebviewBounds(w.webContents).catch(() => {});
      };
      w.on("resize", onResize);
      // Refresh continu à 1.5s pour capter l'apparition/disparition de la
      // drawer Wynd (le user l'ouvre/ferme → overlays bounds changent sans
      // resize de la BrowserWindow). Coût négligeable (executeJavaScript
      // sur un getBoundingClientRect ~1ms).
      const overlayRefresher = setInterval(() => {
        // Si la window est détruite (fermeture app sans stopSession), l'accès
        // à w.webContents throw SYNCHRONIQUEMENT « Object has been destroyed » —
        // le .catch() ne couvre que le rejet de promesse, pas ce throw → on
        // garde explicitement, sinon exception non catchée en boucle (1,5 s).
        if (!w || w.isDestroyed()) {
          clearInterval(overlayRefresher);
          return;
        }
        try {
          refreshWebviewBounds(w.webContents).catch(() => {});
        } catch (_) {
          /* window détruite entre le check et l'accès */
        }
      }, 1_500);
      activeSession.resizeHandler = { win: w, fn: onResize };
      activeSession.overlayRefresher = overlayRefresher;
    }
  }

  attachWsHandlers(ws, session.id, mode);
}

/**
 * Attache les handlers d'événements WS pour une session. Extrait en
 * fonction pour pouvoir être réinvoqué après une reconnexion (nouvelle
 * WS = nouveaux handlers).
 *
 * La capture loop n'est lancée qu'une fois (à la première ouverture WS) :
 * sur reconnect on garde le même setInterval qui pousse via
 * `activeSession.ws` (donc transparent au changement de socket).
 */
function attachWsHandlers(ws, sessionId, mode) {
  const WebSocketImpl = require("ws");

  ws.on("open", () => {
    log.info(`[SCREEN] WS open for session ${sessionId}`);
    activeSession.reconnectAttempts = 0; // reset le compteur sur succès
    // Capture loop JPEG : démarrée une seule fois — sur reconnect le timer
    // existe déjà et envoie via activeSession.ws (qui pointe maintenant
    // sur la nouvelle socket).
    //
    // ⚠️ EGRESS : en mode WebRTC, le flux vidéo passe par la RTCPeerConnection
    // (P2P / TURN Cloudflare). On NE doit PAS lancer la boucle JPEG en plus,
    // sinon elle relaie 10 fps (~0.5 Mo/s) À TRAVERS Railway en parallèle du
    // WebRTC → double flux et egress Railway massif. La boucle JPEG n'est donc
    // que le fallback quand WebRTC est désactivé.
    if (!activeSession.captureTimer && !activeSession.useWebrtc) {
      activeSession.captureTimer = setInterval(async () => {
        try {
          const jpeg = await captureFrame(mode);
          const currentWs = activeSession?.ws;
          if (
            jpeg &&
            currentWs &&
            currentWs.readyState === WebSocketImpl.OPEN
          ) {
            currentWs.send(jpeg, { binary: true });
          }
        } catch (err) {
          log.debug(`[SCREEN] capture error: ${err.message}`);
        }
      }, CAPTURE_INTERVAL_MS);
    }

    // Capture réseau live → panneau « Réseau » du BO. Démarrée une seule fois
    // (le send pointe sur activeSession.ws, transparent au reconnect).
    if (!activeSession.netStarted) {
      activeSession.netStarted = true;
      const w = getContainerWindow();
      // On passe les webContents (et non les sessions) : net_capture attache le
      // debugger CDP dessus pour capter headers + corps req/res.
      const contents = [];
      if (w?.webContents) contents.push(w.webContents);
      const guest = getWebviewWebContents(w?.webContents);
      if (guest) contents.push(guest);
      const sendNet = (msg) => {
        if (msg && msg.type === "net") sessionRecorder.addNet(msg);
        const cw = activeSession?.ws;
        if (cw && cw.readyState === WebSocketImpl.OPEN) {
          cw.send(JSON.stringify(msg));
        }
      };
      netCapture.start(contents, sendNet);
      // Le webview POS peut être monté tardivement → on retente d'attacher son
      // webContents après quelques secondes.
      setTimeout(() => {
        const g = getWebviewWebContents(getContainerWindow()?.webContents);
        if (g) {
          netCapture.attachWebContents(g);
          if (!g.isDestroyed()) {
            g.on("did-finish-load", () => sessionRecorder.injectIfRecording(g));
          }
        }
      }, 3_000);
    }
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
      // WebRTC signaling : forward au capture renderer si actif.
      // Les messages portent {type, from, to?, sdp?, candidate?}. Le
      // renderer route par from (browser peerId) lui-même.
      if (WEBRTC_SIGNAL_TYPES.has(msg.type)) {
        if (activeSession?.useWebrtc) {
          forwardSignalIn(msg);
        }
        return;
      }
      // Contrôle rrweb recorder depuis le BO.
      if (msg.type === "recorder-start") {
        const posWc = getWebviewWebContents(getContainerWindow()?.webContents);
        sessionRecorder.start({
          posWc,
          cfg: activeSession.cfg,
          posUrl: posWc && !posWc.isDestroyed() ? posWc.getURL() : undefined,
          clientHint: undefined,
          // NB: ne PAS utiliser `sendNet` ici — il est const-scopé au bloc
          // `if (!activeSession.netStarted)` et invisible dans ce closure
          // (ws.on('message')). On envoie directement sur activeSession.ws.
          onStatus: (s) => {
            const cw = activeSession?.ws;
            if (cw && cw.readyState === WebSocketImpl.OPEN) {
              cw.send(JSON.stringify({ type: "recorder-status", ...s }));
            }
          },
        });
        return;
      }
      if (msg.type === "recorder-stop") {
        sessionRecorder.stop();
        return;
      }
      // Phase 2 — Inject input events. `mouse-click` reste supporté en
      // legacy (down+up atomique au même point). Le BO récent envoie plutôt
      // `mouse-down` + `mouse-up` séparés → permet drag, sélection, scroll
      // par drag de scrollbar. `mouse-wheel` pour le scroll molette.
      if (
        msg.type === "mouse-move" ||
        msg.type === "mouse-click" ||
        msg.type === "mouse-down" ||
        msg.type === "mouse-up" ||
        msg.type === "mouse-wheel" ||
        msg.type === "key-tap"
      ) {
        injectInputEvent(msg).catch((err) => {
          // Bumpé en warn — on n'avait quasi aucune visibilité quand nut.js
          // échoue silencieusement (cas typique macOS : permission Accessibilité
          // pas accordée → setPosition/click reste sans effet).
          log.warn(`[SCREEN] input inject error: ${err.message}`);
        });
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", (code) => {
    log.info(`[SCREEN] WS closed for session ${sessionId} (code=${code})`);
    // Si stopSession a déjà été appelé (ex : session-ended reçue, ou
    // teardown), activeSession est null → on ne tente pas de reconnect.
    if (!activeSession || activeSession.sessionId !== sessionId) return;
    // Code 1000 (Normal closure) ou 1008 (replaced by new connection) =
    // intentionnel → on stoppe proprement. Tout autre code (1005, 1006,
    // 1011, …) = anormal → on tente une reco.
    if (code === 1000 || code === 1008) {
      stopSession();
      return;
    }
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log.error(`[SCREEN] WS error: ${err.message}`);
    // L'erreur précède normalement un 'close' qui déclenchera le reconnect.
  });
}

/**
 * Reconnexion exponentielle après coupure WS non-intentionnelle.
 * Backoff : 1s → 2s → 4s → 8s → 16s. Au-delà de MAX_RECONNECT_ATTEMPTS
 * on abandonne et on termine la session (le serveur le fera aussi de
 * son côté après son LAUNCHER_GRACE_MS, mais on libère nos timers).
 */
const MAX_RECONNECT_ATTEMPTS = 5;
function scheduleReconnect() {
  if (!activeSession) return;
  const attempt = activeSession.reconnectAttempts + 1;
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    log.warn(
      `[SCREEN] giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`,
    );
    stopSession();
    return;
  }
  activeSession.reconnectAttempts = attempt;
  const delay = Math.min(16_000, 1_000 * 2 ** (attempt - 1));
  log.info(`[SCREEN] reconnect attempt ${attempt} in ${delay}ms`);
  activeSession.reconnectTimer = setTimeout(() => {
    reconnectWs().catch((err) =>
      log.error(`[SCREEN] reconnect failed: ${err.message}`),
    );
  }, delay);
}

async function reconnectWs() {
  if (!activeSession) return;
  const { cfg, sessionId, mode } = activeSession;
  // Re-fetch un ticket — le précédent est consommé (single-use).
  const r = await httpRequest(
    "POST",
    `${cfg.baseUrl}/api/screen-sessions/${sessionId}/ticket`,
    { "x-api-key": cfg.apiKey, "content-type": "application/json" },
    "{}",
  );
  if (!r.ok || !r.body?.ticket) {
    log.warn(`[SCREEN] ticket refresh failed (${r.status}) — retry later`);
    scheduleReconnect();
    return;
  }
  const wsBase = cfg.baseUrl.replace(/^http/, "ws");
  const wsUrl = `${wsBase}/api/screen-sessions/${sessionId}/stream?ticket=${encodeURIComponent(
    r.body.ticket,
  )}`;
  const WebSocketImpl = require("ws");
  const ws = new WebSocketImpl(wsUrl);
  ws.binaryType = "arraybuffer";
  activeSession.ws = ws;
  attachWsHandlers(ws, sessionId, mode);
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
let nutLoadFailed = false; // mémorise l'échec — évite de re-requérer et de
// spammer les logs à chaque event reçu pendant la session.
async function getNut() {
  if (nutCached) return nutCached;
  if (nutLoadFailed) return null;
  try {
    nutCached = require("@nut-tree-fork/nut-js");
    nutCached.mouse.config.mouseSpeed = 1000;
    nutCached.keyboard.config.autoDelayMs = 0;
    return nutCached;
  } catch (err) {
    nutLoadFailed = true;
    log.error(
      `[SCREEN] nut-js indisponible (${
        err.code || err.message
      }) — mode 'screen' désactivé. ` +
        `Pour l'activer : cd electron-launcher/wynd-electron-launcher && npm i @nut-tree-fork/nut-js. ` +
        `En attendant, utilise le mode 'Fenêtre POS' côté BO.`,
    );
    return null;
  }
}

async function injectInputEvent(msg) {
  // Branche selon le mode de la session active. Si pas de session active
  // (race avec un close), no-op silencieux.
  if (!activeSession) return;
  if (activeSession.mode === "window") {
    return injectInputWindow(msg);
  }
  return injectInputScreen(msg);
}

/**
 * Mode 'window' — injection via webContents.sendInputEvent sur la
 * container BrowserWindow. Coords reçues normalisées → multipliées par
 * la taille de la window (ContentBounds). Aucun module natif requis.
 *
 * Limitation : sendInputEvent ne marche que si la window est focusable
 * et n'a pas été minimisée. Si la window est cachée, l'event est silently
 * dropped par Chromium (acceptable pour notre cas — la caisse est censée
 * être active quand le support la regarde).
 */
/**
 * Convertit les coords normalisées (0-1, fournies par le BO) en pixels CSS
 * relatifs au ContentBounds de la BrowserWindow. On utilise les bounds CSS
 * (pas captureSize) car sendInputEvent attend des coords CSS, alors que
 * capturePage().getSize() renvoie des pixels physiques sur retina (DPR > 1).
 * Sans ça, sur mac retina les clics tombaient à 2× la coord attendue.
 */
function windowMouseCoords(w, msg) {
  if (typeof msg.xNorm !== "number" || typeof msg.yNorm !== "number") {
    return null;
  }
  const bounds = w.getContentBounds();
  if (!bounds.width || !bounds.height) return null;
  const norm = (v) => Math.max(0, Math.min(1, v));
  return {
    x: Math.round(norm(msg.xNorm) * bounds.width),
    y: Math.round(norm(msg.yNorm) * bounds.height),
    button: msg.button === "right" ? "right" : "left",
  };
}

/**
 * Décide entre webview wc et BrowserWindow parent wc en fonction de la
 * position du clic dans la fenêtre.
 *  - Clic à l'intérieur des bounds du webview → webview wc, coords ajustées
 *    relatives au webview (subtract offset).
 *  - Clic ailleurs (typiquement le bouton menu Wynd, qui flotte hors du
 *    webview) → BrowserWindow parent wc, coords inchangées.
 *
 * Si on n'a pas encore récupéré les bounds (premier event avant le refresh
 * ou pas de webview), fallback : webview si présent, parent sinon.
 */
function inside(rect, x, y) {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

function chooseInputTarget(w, x, y) {
  const parentWc = w.webContents;
  const webviewWc = getWebviewWebContents(parentWc);
  if (!webviewWc) {
    logTargetSwitch("parent (no webview attached)");
    return { wc: parentWc, x, y };
  }

  // Priorité 1 : overlays Wynd (bouton menu flottant, drawer ouverte).
  // Le webview est souvent en plein écran sous z-index inférieur — sans
  // cette priorité, on ne peut JAMAIS cliquer le menu Wynd à distance.
  const overlays = activeSession?.overlayBounds || [];
  for (const o of overlays) {
    if (inside(o, x, y)) {
      logTargetSwitch("parent (overlay Wynd)");
      return { wc: parentWc, x, y };
    }
  }

  const b = activeSession?.webviewBounds;
  if (!b) {
    // Pas encore de bounds → default vers webview (cas dominant pour le POS).
    logTargetSwitch("webview (bounds not yet known)");
    return { wc: webviewWc, x, y };
  }
  if (inside(b, x, y)) {
    logTargetSwitch("webview (hit inside bounds)");
    return { wc: webviewWc, x: x - b.x, y: y - b.y };
  }
  logTargetSwitch("parent (hit outside webview)");
  return { wc: parentWc, x, y };
}

// Logue uniquement les changements de target dans la session active —
// évite le spam tout en signalant les transitions panel ↔ webview.
function logTargetSwitch(label) {
  if (!activeSession) return;
  if (activeSession.lastTargetLabel === label) return;
  activeSession.lastTargetLabel = label;
  log.info(`[SCREEN] input target: ${label}`);
}

function injectMouseWindow(w, msg) {
  const c = windowMouseCoords(w, msg);
  if (!c) return;
  const target = chooseInputTarget(w, c.x, c.y);
  const { wc } = target;
  // Override x/y avec les coords éventuellement ajustées par le hit-test.
  c.x = target.x;
  c.y = target.y;
  const { x, y, button } = c;

  switch (msg.type) {
    case "mouse-move":
      wc.sendInputEvent({ type: "mouseMove", x, y });
      return;
    case "mouse-down":
      wc.sendInputEvent({
        type: "mouseDown",
        x,
        y,
        button,
        clickCount: 1,
      });
      return;
    case "mouse-up":
      wc.sendInputEvent({
        type: "mouseUp",
        x,
        y,
        button,
        clickCount: 1,
      });
      return;
    case "mouse-wheel":
      // Electron `mouseWheel` veut deltaX/deltaY en px. On inverse car
      // DOM positif (scroll-down) = Electron négatif.
      wc.sendInputEvent({
        type: "mouseWheel",
        x,
        y,
        deltaX: -Math.round(msg.deltaX || 0),
        deltaY: -Math.round(msg.deltaY || 0),
        canScroll: true,
      });
      return;
    case "mouse-click":
      // Legacy : down + up atomique au même point. Le BO récent envoie
      // plutôt mouse-down + mouse-up séparés (drag + tap supportés).
      wc.sendInputEvent({
        type: "mouseDown",
        x,
        y,
        button,
        clickCount: 1,
      });
      wc.sendInputEvent({
        type: "mouseUp",
        x,
        y,
        button,
        clickCount: 1,
      });
      return;
    default:
      log.debug(`[SCREEN] injectMouseWindow: type inconnu ${msg.type}`);
  }
}

async function injectInputWindow(msg) {
  // On envoie les events sur la BrowserWindow extérieure (qui contient le
  // panneau menu Wynd + le webview/iframe POS rendu inline). Tenter de
  // router vers le webContents enfant du <webview> a 2 problèmes :
  //  1. capturePage() sur un webview enfant retourne du noir sur macOS
  //     (rendu off-process pas compositionné dans le bitmap retourné),
  //  2. les clics ne peuvent plus atteindre le panneau menu Wynd.
  // Trade-off accepté : en mode 'window' on contrôle l'écran complet du
  // launcher (panneau inclus), pas le DOM du POS dans le webview. Pour
  // piloter le POS lui-même, l'opérateur prend le mode 'screen' (nut.js,
  // events OS-level qui traversent le webview).
  const w = getContainerWindow();
  if (!w) {
    log.debug("[SCREEN] injectInputWindow: no container window");
    return;
  }
  // Cible pour clavier : webview enfant prioritaire (le POS attend les
  // frappes), fallback sur la BrowserWindow parent si pas de webview.
  const wc = getWebviewWebContents(w.webContents) ?? w.webContents;
  if (msg.type?.startsWith("mouse")) {
    injectMouseWindow(w, msg);
    return;
  }

  if (msg.type === "key-tap") {
    // Pour que la frappe atteigne le POS, le webview enfant doit avoir le
    // focus. Sans ça, Chromium route les events au document parent. focus()
    // est idempotent — coût négligeable même appelé à chaque touche.
    if (typeof wc.focus === "function") wc.focus();
    injectKeyTapWindow(wc, msg);
  }
}

/**
 * Mapping DOM `key` → keyCode Electron pour les touches non-imprimables.
 * Référence : https://www.electronjs.org/docs/api/accelerator
 */
const KEY_MAP = {
  Enter: "Return",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  " ": "Space",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  Control: "Control",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Meta",
};

/**
 * Convertit les modifiers DOM (`{ctrl, shift, alt, meta}`) en tableau
 * d'Electron modifiers (`['control', 'shift', ...]`). C'est ce format que
 * `sendInputEvent` attend pour appliquer Ctrl+C, Shift+Click, etc.
 */
function toElectronModifiers(mods) {
  if (!mods) return [];
  const out = [];
  if (mods.ctrl) out.push("control");
  if (mods.shift) out.push("shift");
  if (mods.alt) out.push("alt");
  if (mods.meta) out.push("meta");
  return out;
}

function injectKeyTapWindow(wc, msg) {
  const k = String(msg.key || "");
  const mods = msg.modifiers || {};
  // Shift seul ne change PAS la sémantique : le BO envoie déjà la lettre
  // en majuscule (`key: 'A'`) quand l'utilisateur tient Shift. Le `char`
  // event tape directement le bon caractère. Le path keyDown+modifiers
  // est réservé aux VRAIS raccourcis (Ctrl/Alt/Cmd).
  const hasShortcutModifier = !!(mods.ctrl || mods.alt || mods.meta);
  const electronMods = toElectronModifiers(mods);

  if (hasShortcutModifier) {
    // Ctrl+C, Ctrl+V, Alt+F4 etc. — Electron attend le keyCode en MAJ pour
    // les lettres, le nom mappé pour les touches spéciales.
    let keyCode;
    if (k.length === 1) {
      keyCode = k.toUpperCase();
    } else {
      keyCode = KEY_MAP[k];
      if (!keyCode) {
        log.debug(`[SCREEN] key+mod non mappée (window): ${k}`);
        return;
      }
    }
    log.debug(`[SCREEN] key shortcut: ${electronMods.join("+")}+${keyCode}`);
    wc.sendInputEvent({
      type: "keyDown",
      keyCode,
      modifiers: electronMods,
    });
    wc.sendInputEvent({
      type: "keyUp",
      keyCode,
      modifiers: electronMods,
    });
    return;
  }

  if (k.length === 1) {
    // Pour les caractères imprimables, on simule un VRAI cycle clavier
    // matériel : keyDown → char → keyUp. Sans le keyDown, les listeners
    // DOM `addEventListener('keydown')` ne se déclenchent pas (le POS
    // l'utilise pour catcher les scans barcode globalement). Le `char`
    // au milieu reste nécessaire pour l'insertion dans les inputs.
    //
    // keyCode pour keyDown/keyUp = la touche physique (majuscule pour
    // les lettres, accelerator-style). Shift est inclus comme modifier
    // pour que la touche soit interprétée correctement par le POS.
    const physicalKey = k.toUpperCase();
    const shiftMod = mods.shift ? ["shift"] : [];
    wc.sendInputEvent({
      type: "keyDown",
      keyCode: physicalKey,
      modifiers: shiftMod,
    });
    wc.sendInputEvent({ type: "char", keyCode: k });
    wc.sendInputEvent({
      type: "keyUp",
      keyCode: physicalKey,
      modifiers: shiftMod,
    });
    return;
  }
  // Touche spéciale sans modifier (Enter, Tab, ArrowUp, F1, etc.)
  const mapped = KEY_MAP[k];
  if (!mapped) {
    log.debug(`[SCREEN] key-tap non mappée (window): ${k}`);
    return;
  }
  wc.sendInputEvent({ type: "keyDown", keyCode: mapped });
  wc.sendInputEvent({ type: "keyUp", keyCode: mapped });
}

/**
 * Mode 'screen' — injection système-wide via nut.js. Permet d'interagir
 * avec n'importe quelle app au-delà de l'iframe POS (utile si le caissier
 * a une app externe ouverte qui pose problème).
 */
async function injectMouseScreen(nut, msg) {
  const { screen, mouse, Button, Point } = nut;
  if (typeof msg.xNorm !== "number" || typeof msg.yNorm !== "number") return;
  const screenW = await screen.width();
  const screenH = await screen.height();
  const x = Math.round(Math.max(0, Math.min(1, msg.xNorm)) * screenW);
  const y = Math.round(Math.max(0, Math.min(1, msg.yNorm)) * screenH);
  const btn = msg.button === "right" ? Button.RIGHT : Button.LEFT;
  await mouse.setPosition(new Point(x, y));

  switch (msg.type) {
    case "mouse-move":
      return;
    case "mouse-down":
      await mouse.pressButton(btn);
      return;
    case "mouse-up":
      await mouse.releaseButton(btn);
      return;
    case "mouse-wheel":
      // nut.js scroll : N crans molette. Le BO envoie deltaY en px
      // (~100 par cran sur trackpad), on divise pour pas faire un mega-scroll.
      // Sens : DOM positif = down → nut scrollDown.
      if (typeof msg.deltaY === "number" && msg.deltaY !== 0) {
        const steps = Math.max(1, Math.round(Math.abs(msg.deltaY) / 100));
        if (msg.deltaY > 0) await mouse.scrollDown(steps);
        else await mouse.scrollUp(steps);
      }
      return;
    case "mouse-click":
      await mouse.click(btn);
      return;
    default:
      return;
  }
}

// Probe one-shot : tente un getPosition() pour détecter si nut.js a la
// permission Accessibilité macOS. Si refusée, nut.js échoue silencieusement
// sur les appels suivants — on veut une trace claire au lieu de "mes clics
// ne font rien".
let nutPermissionChecked = false;
async function probeNutPermission(nut) {
  if (nutPermissionChecked) return;
  nutPermissionChecked = true;
  try {
    const pos = await nut.mouse.getPosition();
    log.info(`[SCREEN] nut.js OK (mouse at ${pos.x},${pos.y})`);
  } catch (err) {
    log.warn(
      `[SCREEN] nut.js mouse.getPosition a échoué (${err.message}) — ` +
        `vérifie System Settings > Privacy & Security > Accessibility et ` +
        `coche le binaire Electron utilisé pour le launcher.`,
    );
  }
}

async function injectInputScreen(msg) {
  const nut = await getNut();
  if (!nut) return;
  await probeNutPermission(nut);
  const { keyboard, Key } = nut;

  if (msg.type?.startsWith("mouse")) {
    await injectMouseScreen(nut, msg);
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
  netCapture.stop();
  if (activeSession.captureTimer) clearInterval(activeSession.captureTimer);
  if (activeSession.resizeHandler) {
    const { win, fn } = activeSession.resizeHandler;
    if (win && !win.isDestroyed()) win.removeListener("resize", fn);
  }
  if (activeSession.overlayRefresher) {
    clearInterval(activeSession.overlayRefresher);
  }
  if (activeSession.reconnectTimer) {
    clearTimeout(activeSession.reconnectTimer);
  }
  if (activeSession.useWebrtc) {
    try {
      destroyCaptureWindow();
    } catch (err) {
      log.warn(`[WEBRTC] destroy capture window: ${err.message}`);
    }
  }
  if (activeSession.ws && activeSession.ws.readyState <= 1) {
    try {
      activeSession.ws.close();
    } catch {}
  }
  if (activeSession.indicator && !activeSession.indicator.isDestroyed()) {
    activeSession.indicator.close();
  }
  if (sessionRecorder.isRecording()) {
    sessionRecorder.stop().catch(() => {});
  }
  activeSession = null;
}

/**
 * Indicateur visuel permanent pendant la session : petite window 200x40
 * always-on-top en haut à droite. L'utilisateur sait qu'il est observé.
 *
 * @param {'window'|'screen'} mode - affiché dans le badge pour clarifier
 *   au caissier l'étendue de la capture en cours.
 */
function showSessionIndicator(mode) {
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
  const scopeLabel = mode === "screen" ? "écran" : "fenêtre POS";
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
<body><div class="b"><span class="dot"></span>Support — ${scopeLabel}</div></body></html>
		`),
  );
  return win;
}

/**
 * Hook public : appelé depuis index.js après app.whenReady().
 *
 * @param {object} [store] - store partagé du launcher (pour accéder à la
 *   BrowserWindow container en mode capture 'window'). Optionnel : si non
 *   fourni, le mode 'window' fallback vers 'screen'.
 */
function initScreenSessions(store) {
  if (pollTimer) return;
  if (store) sharedStore = store;
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
  wptProxyTunnel.close();
  if (activeConsentWindow && !activeConsentWindow.isDestroyed()) {
    activeConsentWindow.close();
  }
}

module.exports = { initScreenSessions, teardownScreenSessions };
