const {
  session: electronSession,
  webContents: ElectronWebContents,
} = require("electron");
const log = require("./electron_log");

/**
 * Capture réseau live de l'app (POS + appels API/WPT du renderer) pour la
 * remonter au BO pendant une session de visu.
 *
 * Deux modes, par ordre de préférence :
 *
 *  1. CDP (Chrome DevTools Protocol) via `webContents.debugger` + domaine
 *     `Network`. Donne le DÉTAIL complet : headers + corps envoyé (postData)
 *     et corps reçu (getResponseBody). C'est le seul moyen d'obtenir les
 *     bodies dans Electron — `webRequest` ne les expose pas.
 *
 *  2. Fallback `webRequest` (onCompleted/onErrorOccurred) si le debugger ne
 *     peut pas s'attacher (DevTools déjà ouvert, wc protégé…). On ne récupère
 *     alors QUE les métadonnées (url/method/status), comme avant — zéro
 *     régression sur la liste.
 *
 * Les events sont poussés tels quels sur la WS de session (le relay les
 * forwarde au navigateur, qui les affiche dans un panneau « Réseau »).
 */

const FILTER = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};

// On ne capture le détail (headers + corps) que des appels applicatifs.
// Les sous-ressources (images, css, polices, scripts…) restent listées mais
// sans corps → on évite de saturer la WS avec des binaires/gros assets.
const DETAIL_TYPES = new Set(["XHR", "Fetch"]);
// Corps tronqués pour rester raisonnable sur le tunnel WS.
const BODY_MAX = 32 * 1024; // 32 Ko par corps
// Content-types dont on tente de lire le corps de réponse (texte exploitable).
const TEXT_CT = /(json|text|xml|javascript|x-www-form-urlencoded|graphql)/i;

let send = null;
let wrSessions = []; // sessions attachées via webRequest (fallback)
let dbgContents = []; // webContents attachés via CDP
// Sessions déjà couvertes en DÉTAIL par un debugger CDP. webRequest étant
// scopé à la session entière (≠ CDP, scopé au webContents), si on laissait le
// fallback émettre sur une session déjà CDP, on doublerait chaque requête :
// 1 ligne pleine (CDP) + 1 ligne métadonnées (webRequest). On muselle donc le
// webRequest sur ces sessions. Le fallback ne sert que pour les sessions SANS
// aucun CDP (où il est la seule source).
let cdpSessions = new Set();

function emit(ev) {
  if (!send) return;
  try {
    send({ type: "net", ...ev });
  } catch (_) {
    /* socket fermée entre-temps */
  }
}

function clip(value) {
  if (value == null) return { body: undefined, truncated: false };
  const s = typeof value === "string" ? value : String(value);
  if (s.length > BODY_MAX)
    return { body: s.slice(0, BODY_MAX), truncated: true };
  return { body: s, truncated: false };
}

/* -------------------------------------------------------------------------- */
/* CDP — détail complet (headers + corps req/res)                             */
/* -------------------------------------------------------------------------- */

function attachDebugger(wc) {
  if (!wc || wc.isDestroyed() || dbgContents.includes(wc)) return false;
  const dbg = wc.debugger;
  try {
    dbg.attach("1.3");
  } catch (e) {
    log.warn(`[NET] debugger attach KO (${e.message}) → fallback webRequest`);
    return false;
  }
  dbgContents.push(wc);
  try {
    if (wc.session) cdpSessions.add(wc.session);
  } catch (_) {
    /* wc sans session accessible */
  }

  // État par requestId entre requestWillBeSent → responseReceived → finished.
  const pending = new Map();

  async function finalize(requestId, opts = {}) {
    const { errorText, finishTs, size } = opts;
    const p = pending.get(requestId);
    pending.delete(requestId);
    if (!p) return;
    const detail = DETAIL_TYPES.has(p.resourceType);
    // Timestamps CDP en secondes (monotones) → ms.
    const durationMs =
      finishTs != null && p.ts != null
        ? Math.max(0, Math.round((finishTs - p.ts) * 1000))
        : undefined;

    if (errorText) {
      emit({
        id: p.id,
        url: p.url,
        method: p.method,
        error: errorText,
        resourceType: p.resourceType,
        ts: p.ts,
        durationMs,
        reqHeaders: detail ? p.reqHeaders : undefined,
        reqBody: detail ? clip(p.reqBody).body : undefined,
      });
      return;
    }

    // Corps de requête : complété si tronqué/absent et qu'il y en a un.
    if (detail && p.hasPostData && !p.reqBody) {
      try {
        const r = await dbg.sendCommand("Network.getRequestPostData", {
          requestId,
        });
        p.reqBody = r?.postData;
      } catch (_) {
        /* indispo */
      }
    }
    const reqClip = clip(p.reqBody);

    // Corps de réponse : seulement pour XHR/Fetch texte, taille bornée.
    let resBody;
    let resBodyTruncated = false;
    let resBodyOmitted;
    if (detail) {
      const ct = p.mimeType || "";
      if (TEXT_CT.test(ct) || ct === "") {
        try {
          const r = await dbg.sendCommand("Network.getResponseBody", {
            requestId,
          });
          let body = r?.body || "";
          if (r?.base64Encoded) {
            try {
              body = Buffer.from(body, "base64").toString("utf8");
            } catch (_) {
              /* garde le base64 brut */
            }
          }
          const c = clip(body);
          resBody = c.body;
          resBodyTruncated = c.truncated;
        } catch (_) {
          resBodyOmitted = "indisponible";
        }
      } else {
        resBodyOmitted = "binaire";
      }
    } else {
      resBodyOmitted = "non-xhr";
    }

    emit({
      id: p.id,
      url: p.url,
      method: p.method,
      status: p.status,
      statusText: p.statusText,
      mimeType: p.mimeType,
      resourceType: p.resourceType,
      ts: p.ts,
      durationMs,
      resSize: size,
      reqHeaders: detail ? p.reqHeaders : undefined,
      reqBody: reqClip.body,
      reqBodyTruncated: reqClip.truncated,
      resHeaders: detail ? p.resHeaders : undefined,
      resBody,
      resBodyTruncated,
      resBodyOmitted,
    });
  }

  dbg.on("message", (_e, method, params) => {
    try {
      if (method === "Network.requestWillBeSent") {
        const r = params.request || {};
        pending.set(params.requestId, {
          id: params.requestId,
          url: r.url,
          method: r.method,
          reqHeaders: r.headers,
          reqBody: r.postData,
          hasPostData: r.hasPostData,
          resourceType: params.type,
          ts: params.timestamp,
        });
      } else if (method === "Network.responseReceived") {
        const p = pending.get(params.requestId);
        if (p) {
          const resp = params.response || {};
          p.status = resp.status;
          p.statusText = resp.statusText;
          p.resHeaders = resp.headers;
          p.mimeType = resp.mimeType;
          if (params.type) p.resourceType = params.type;
        }
      } else if (method === "Network.loadingFinished") {
        finalize(params.requestId, {
          finishTs: params.timestamp,
          size: params.encodedDataLength,
        });
      } else if (method === "Network.loadingFailed") {
        // net::ERR_ABORTED = bruit normal (navigations annulées) → ignoré.
        if (params.errorText !== "net::ERR_ABORTED") {
          finalize(params.requestId, {
            errorText: params.errorText,
            finishTs: params.timestamp,
          });
        } else {
          pending.delete(params.requestId);
        }
      }
    } catch (err) {
      log.debug(`[NET] cdp msg err: ${err.message}`);
    }
  });

  try {
    dbg.sendCommand("Network.enable", {
      maxResourceBufferSize: 5 * 1024 * 1024,
      maxTotalBufferSize: 20 * 1024 * 1024,
    });
  } catch (e) {
    log.warn(`[NET] Network.enable KO: ${e.message}`);
  }

  const cleanup = () => {
    dbgContents = dbgContents.filter((c) => c !== wc);
  };
  dbg.on("detach", cleanup);
  try {
    wc.once("destroyed", cleanup);
  } catch (_) {
    /* wc déjà parti */
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* webRequest — fallback métadonnées seules                                   */
/* -------------------------------------------------------------------------- */

function attachWebRequest(sess) {
  if (!sess || wrSessions.includes(sess)) return;
  wrSessions.push(sess);
  try {
    sess.webRequest.onCompleted(FILTER, (d) => {
      // Session couverte par CDP (détail complet) → on n'émet pas le doublon
      // métadonnées. Garde au moment de l'event (≠ à l'attache) car le CDP
      // peut s'attacher APRÈS le webRequest selon l'ordre de montage des wc.
      if (cdpSessions.has(sess)) return;
      emit({
        id: d.id,
        url: d.url,
        method: d.method,
        status: d.statusCode,
        resourceType: d.resourceType,
        fromCache: d.fromCache,
        ts: d.timestamp,
      });
    });
    sess.webRequest.onErrorOccurred(FILTER, (d) => {
      if (d.error === "net::ERR_ABORTED") return;
      if (cdpSessions.has(sess)) return;
      emit({
        id: d.id,
        url: d.url,
        method: d.method,
        error: d.error,
        resourceType: d.resourceType,
        ts: d.timestamp,
      });
    });
  } catch (e) {
    log.warn(`[NET] webRequest attach failed: ${e.message}`);
  }
}

/** Attache un webContents : CDP si possible, sinon fallback webRequest. */
function attachTarget(wc) {
  if (!wc) return;
  const ok = attachDebugger(wc);
  if (!ok) {
    const sess = wc.session;
    if (sess) attachWebRequest(sess);
  }
}

/**
 * @param {Array} contents - webContents à écouter (container + webview POS).
 * @param {function} sendFn - (msg) => envoi sur la WS de session.
 */
function start(contents, sendFn) {
  send = sendFn;
  for (const wc of contents || []) if (wc) attachTarget(wc);
  // Si rien n'a pu être attaché (aucun wc fourni), filet de sécurité sur la
  // defaultSession en mode métadonnées.
  if (dbgContents.length === 0 && wrSessions.length === 0) {
    attachWebRequest(electronSession.defaultSession);
  }
  log.info(
    `[NET] capture démarrée (cdp=${dbgContents.length}, webRequest=${wrSessions.length})`,
  );
}

/** Attache une cible supplémentaire à chaud (webview POS monté tardivement). */
function attachWebContents(wc) {
  if (send) attachTarget(wc);
}

function stop() {
  for (const wc of dbgContents) {
    try {
      if (wc && !wc.isDestroyed()) wc.debugger.detach();
    } catch (_) {
      /* déjà détaché */
    }
  }
  for (const sess of wrSessions) {
    try {
      sess.webRequest.onCompleted(null);
      sess.webRequest.onErrorOccurred(null);
    } catch (_) {
      /* session détruite */
    }
  }
  dbgContents = [];
  wrSessions = [];
  cdpSessions = new Set();
  send = null;
  log.info("[NET] capture arrêtée");
}

module.exports = { start, attachWebContents, stop };
