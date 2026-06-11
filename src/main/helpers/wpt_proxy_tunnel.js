const http = require("http");
const https = require("https");
const log = require("./electron_log");

/**
 * Tunnel d'accès distant à l'UI WyndPosTools (127.0.0.1:9963).
 *
 * Le BO demande l'ouverture → l'API le signale dans le poll /pending
 * (wptTunnel.open) → ici on ouvre une WS SORTANTE vers
 * /api/wpt-proxy/<serial>/tunnel et on relaie chaque requête HTTP que l'API
 * pousse vers le WPT local, puis on renvoie la réponse.
 *
 *   API  →  {reqId, method, path, headers, body(base64)}
 *   nous →  {reqId, status, headers, body(base64)}
 *
 * MVP read-only : seules GET/HEAD sont relayées (aucune modification d'état
 * sur la caisse). Le write viendra avec le durcissement (whitelist de paths).
 * Voir docs/CHANTIER-wpt-remote-proxy.md.
 */

const WebSocketImpl = require("ws");

const REQUEST_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

let ws = null;
let connecting = false;

function wptBase(store) {
  try {
    const href =
      store &&
      store.conf &&
      store.conf.wpt &&
      store.conf.wpt.url &&
      store.conf.wpt.url.href;
    if (href) return href.replace(/\/+$/, "");
  } catch (_) {
    /* fallback */
  }
  return "http://127.0.0.1:9963";
}

function methodAllowed(m) {
  const u = (m || "GET").toUpperCase();
  return u === "GET" || u === "HEAD";
}

/** Aplati les headers Node (valeurs string|string[]) en Record<string,string>. */
function flattenHeaders(h) {
  const out = {};
  for (const k of Object.keys(h || {})) {
    const v = h[k];
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Effectue la requête loopback vers le WPT local. */
function doRequest(base, msg) {
  return new Promise((resolve) => {
    let urlObj;
    try {
      urlObj = new URL(base + (msg.path || "/"));
    } catch (e) {
      resolve({ status: 400, headers: {}, body: Buffer.from("bad path") });
      return;
    }
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(
      urlObj,
      {
        method: (msg.method || "GET").toUpperCase(),
        headers: msg.headers || {},
        // Loopback auto-signé uniquement (127.0.0.1) → pas de surface MITM
        // réseau. Scopé à CET appel, jamais global.
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let aborted = false;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) {
            aborted = true;
            req.destroy();
            resolve({
              status: 502,
              headers: {},
              body: Buffer.from("response too large"),
            });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (aborted) return;
          resolve({
            status: res.statusCode || 502,
            headers: flattenHeaders(res.headers),
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", (e) =>
      resolve({ status: 502, headers: {}, body: Buffer.from(String(e.message)) })
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function handleMessage(store, sock, data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (_) {
    return;
  }
  if (!msg.reqId) return;

  let resp;
  if (!methodAllowed(msg.method)) {
    resp = {
      status: 405,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("read-only tunnel"),
    };
  } else {
    resp = await doRequest(wptBase(store), msg);
  }

  if (sock.readyState === WebSocketImpl.OPEN) {
    sock.send(
      JSON.stringify({
        reqId: msg.reqId,
        status: resp.status,
        headers: resp.headers,
        body: resp.body.toString("base64"),
      })
    );
  }
}

/**
 * Ouvre le tunnel si pas déjà ouvert. `httpRequest` est injecté depuis
 * screen_session.js (même helper axios que le reste du poll).
 */
async function open(cfg, store, httpRequest) {
  if (ws || connecting) return;
  connecting = true;
  try {
    const r = await httpRequest(
      "POST",
      `${cfg.baseUrl}/api/wpt-proxy/${encodeURIComponent(cfg.serial)}/tunnel-ticket`,
      { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      "{}"
    );
    if (!r.ok || !r.body || !r.body.ticket) {
      log.warn(`[WPT-TUNNEL] ticket grant failed: ${r.status}`);
      connecting = false;
      return;
    }
    const wsBase = cfg.baseUrl.replace(/^http/, "ws");
    const wsUrl = `${wsBase}/api/wpt-proxy/${encodeURIComponent(
      cfg.serial
    )}/tunnel?ticket=${encodeURIComponent(r.body.ticket)}`;

    const sock = new WebSocketImpl(wsUrl);
    sock.on("open", () => {
      ws = sock;
      connecting = false;
      log.info("[WPT-TUNNEL] tunnel ouvert");
    });
    sock.on("message", (data) => {
      handleMessage(store, sock, data).catch((e) =>
        log.debug(`[WPT-TUNNEL] relay error: ${e.message}`)
      );
    });
    sock.on("close", () => {
      if (ws === sock) ws = null;
      connecting = false;
      log.info("[WPT-TUNNEL] tunnel fermé");
    });
    sock.on("error", (e) => {
      log.warn(`[WPT-TUNNEL] ws error: ${e.message}`);
      connecting = false;
    });
  } catch (e) {
    connecting = false;
    log.warn(`[WPT-TUNNEL] open failed: ${e.message}`);
  }
}

function close() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

module.exports = { open, close };
