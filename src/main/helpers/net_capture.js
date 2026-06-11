const { session: electronSession } = require("electron");
const log = require("./electron_log");

/**
 * Capture réseau live de l'app (POS + appels API/WPT du renderer) pour la
 * remonter au BO pendant une session de visu. On écoute UNIQUEMENT les
 * événements webRequest NON bloquants (onCompleted / onErrorOccurred) :
 * chacun porte déjà url + method + statusCode/error → zéro latence ajoutée
 * (aucun callback à honorer, contrairement à onBeforeRequest).
 *
 * Les events sont poussés tels quels sur la WS de session (le relay les
 * forwarde au navigateur, qui les affiche dans un panneau « Réseau »).
 *
 * webRequest est un singleton par session : on a vérifié qu'aucun autre
 * code du main ne l'utilise (sinon on l'écraserait).
 */

const FILTER = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};

let attached = [];
let send = null;

function emit(ev) {
  if (!send) return;
  try {
    send({ type: "net", ...ev });
  } catch (_) {
    /* socket fermée entre-temps */
  }
}

function attach(sess) {
  if (!sess || attached.includes(sess)) return;
  attached.push(sess);
  try {
    sess.webRequest.onCompleted(FILTER, (d) => {
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
      // net::ERR_ABORTED est du bruit normal (navigations annulées) → ignoré.
      if (d.error === "net::ERR_ABORTED") return;
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
    log.warn(`[NET] attach failed: ${e.message}`);
  }
}

function detach(sess) {
  try {
    sess.webRequest.onCompleted(null);
    sess.webRequest.onErrorOccurred(null);
  } catch (_) {
    /* session détruite */
  }
}

/**
 * @param {Array} sessions - sessions Electron à écouter (dédupliquées).
 * @param {function} sendFn - (msg) => envoi sur la WS de session.
 */
function start(sessions, sendFn) {
  send = sendFn;
  // defaultSession capte le gros du trafic renderer ; on ajoute les sessions
  // explicites (container + webview POS) au cas où une partition diffère.
  const targets = new Set([electronSession.defaultSession]);
  for (const s of sessions || []) if (s) targets.add(s);
  for (const s of targets) attach(s);
  log.info(`[NET] capture démarrée (${attached.length} session(s))`);
}

/** Attache une session supplémentaire à chaud (webview POS monté tardivement). */
function attachSession(sess) {
  if (send) attach(sess);
}

function stop() {
  for (const s of attached) detach(s);
  attached = [];
  send = null;
  log.info("[NET] capture arrêtée");
}

module.exports = { start, attachSession, stop };
