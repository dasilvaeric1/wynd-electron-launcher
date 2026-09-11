const { URL } = require("url");
const log = require("./electron_log");
const handleScoLog = require("./handle_sco_log");
const netCapture = require("./net_capture");

// Marqueurs préfixant les messages console émis par le hook injecté, pour les
// distinguer des logs "normaux" du POS. Une collision (le POS logguant lui-même
// une chaîne commençant par ces tokens) serait au pire un doublon inoffensif.
const M_ERR = "[EL_JS_ERROR]";
const M_CON = "[EL_CONSOLE]"; // suivi de ":error" | ":warn"

/**
 * Script injecté dans le MAIN world de la frame POS. Le MAIN world n'a pas
 * accès au bridge preload (ipcRenderer) : on remonte au main via console.error
 * taggé, capté par l'event webContents 'console-message' (même contournement
 * d'isolation que le tap Redux, cf preload_app.js).
 *
 * @param {{err: boolean, con: boolean}} flags  quelles captures installer.
 */
function buildHookSrc(flags) {
  return `(function () {
  if (window.__elErrHook) return;
  window.__elErrHook = true;
  var M_ERR = ${JSON.stringify(M_ERR)};
  var M_CON = ${JSON.stringify(M_CON)};
  var origError = console.error.bind(console);
  function report(marker, payload) {
    try { origError(marker + JSON.stringify(payload)); } catch (e) { /* noop */ }
  }
  function serialize(a) {
    if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
    return String(a);
  }
  ${
    flags.err
      ? `
  window.addEventListener('error', function (ev) {
    // Ignore les erreurs de chargement de ressource (img/script 404) : ni
    // message ni objet Error → bruit inutile.
    if (!ev || (!ev.message && !ev.error)) return;
    report(M_ERR, {
      kind: 'error',
      message: ev.message ? String(ev.message) : String(ev.error),
      source: ev.filename || undefined,
      line: ev.lineno, col: ev.colno,
      stack: ev.error && ev.error.stack ? String(ev.error.stack) : undefined
    });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    report(M_ERR, {
      kind: 'unhandledrejection',
      message: r && r.message ? String(r.message) : String(r),
      stack: r && r.stack ? String(r.stack) : undefined
    });
  });`
      : ""
  }
  ${
    flags.con
      ? `
  ['error', 'warn'].forEach(function (lvl) {
    var orig = console[lvl] ? console[lvl].bind(console) : function () {};
    console[lvl] = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        report(M_CON + ':' + lvl, { level: lvl, message: args.map(serialize).join(' ') });
      } catch (e) { /* noop */ }
      return orig.apply(console, args);
    };
  });`
      : ""
  }
})();`;
}

// Aplati un payload d'erreur structuré en une ligne lisible pour le fichier.
function flattenErr(payload) {
  if (typeof payload !== "object" || payload === null) return String(payload);
  let out = payload.message || "";
  if (payload.source) {
    out += ` (${payload.source}:${payload.line || 0}:${payload.col || 0})`;
  }
  if (payload.stack) out += ` | ${payload.stack}`;
  return out;
}

// Sink réseau → fichier : ne persiste QUE les échecs (erreur réseau ou HTTP
// >= 400). Les corps (déjà tronqués à 32 Ko par net_capture) sont inclus.
function netFileSink(store) {
  return (msg) => {
    if (!msg || msg.type !== "net") return;
    const failed =
      !!msg.error || (typeof msg.status === "number" && msg.status >= 400);
    if (!failed) return;
    const lvl = msg.error || msg.status >= 500 ? "ERROR" : "WARN";
    let flat = `${msg.method || "?"} ${msg.url || ""}`;
    if (msg.status) {
      flat += ` → ${msg.status}${msg.statusText ? " " + msg.statusText : ""}`;
    }
    if (msg.error) flat += ` → ${msg.error}`;
    if (msg.durationMs != null) flat += ` (${msg.durationMs}ms)`;
    if (msg.reqBody) flat += `\n  req: ${msg.reqBody}`;
    if (msg.resBody) flat += `\n  res: ${msg.resBody}`;
    handleScoLog(store, lvl, { flat: `[SCO net] ${flat}`, raw: msg });
  };
}

// La frame chargée correspond-elle au POS ? Match par origine (POS distant) ou
// protocole file: (POS local). Permet de cibler la frame POS aussi bien en
// webview (frame principale du guest) qu'en iframe (sous-frame du container),
// sans injecter dans les frames internes du launcher (loader, wrapper React
// distant est file://).
function matchesPos(store, url) {
  if (!url) return false;
  const conf = store.conf && store.conf.url;
  const href = conf && (conf.href || conf);
  if (!href) return false;
  const h = String(href);
  if (/^https?:/i.test(h)) {
    try {
      return new URL(url).origin === new URL(h).origin;
    } catch (e) {
      return false;
    }
  }
  // POS local (file://). Le wrapper React est aussi file:// → on ne peut pas
  // distinguer : on injecte dans les frames file: (hook idempotent, inoffensif).
  return url.startsWith("file:");
}

/**
 * Capture des signaux du POS vers le sink SCO commun (handle_sco_log → fichier
 * logs/app/ si log.persist_app, relais central si central.log). Trois sources
 * OPT-IN indépendantes (absentes → désactivées) :
 *
 *  - log.capture_errors  : erreurs JS non catchées (window.onerror + rejections)
 *  - log.capture_console : console.error / console.warn du POS
 *  - log.capture_network : requêtes réseau en échec (via net_capture, CDP)
 *
 * Fonctionne en view=webview (frame principale du guest) ET view=iframe
 * (sous-frame du container), via détection de la frame POS par URL + injection
 * ciblée (webFrameMain). Le réseau attache le webContents porteur (guest en
 * webview, container en iframe) : le CDP couvre toutes ses frames.
 *
 * @param {object} store  store launcher (conf, appLog, wpt.socket)
 */
module.exports = function captureJsErrors(store) {
  const { app, webFrameMain } = require("electron");

  const logCfg = () => (store.conf && store.conf.log) || {};
  const errEnabled = () => logCfg().capture_errors === true;
  const consoleEnabled = () => logCfg().capture_console === true;
  const netEnabled = () => logCfg().capture_network === true;

  let netUnsub = null; // désabonnement du sink réseau fichier (une seule fois)

  const getFrame = (pid, rid) => {
    try {
      return webFrameMain.fromId(pid, rid);
    } catch (e) {
      return null;
    }
  };

  app.on("web-contents-created", (_e, contents) => {
    // Injection dans la frame POS dès qu'elle a fini de charger. did-frame-
    // finish-load couvre la frame principale (webview) ET les sous-frames
    // (iframe). Ré-injection idempotente (garde window.__elErrHook).
    contents.on(
      "did-frame-finish-load",
      (_evt, _isMainFrame, frameProcessId, frameRoutingId) => {
        const frame = getFrame(frameProcessId, frameRoutingId);
        if (!frame || !matchesPos(store, frame.url)) return;

        if (errEnabled() || consoleEnabled()) {
          const src = buildHookSrc({
            err: errEnabled(),
            con: consoleEnabled(),
          });
          Promise.resolve(frame.executeJavaScript(src, true)).catch((err) =>
            log.debug(`[JS-ERR] injection hook KO: ${err && err.message}`),
          );
        }

        if (netEnabled()) {
          if (!netUnsub) netUnsub = netCapture.subscribe(netFileSink(store));
          netCapture.attachWebContents(contents);
        }
      },
    );

    // Remontée des messages taggés → sink SCO. console-message remonte les
    // messages de toutes les frames du webContents (frame POS incluse).
    // Signature selon la version Electron :
    //  - récent (≥ 37) : (event, messageDetails{ message, level, … })
    //  - ancien         : (event, level, message, line, sourceId)
    contents.on("console-message", (arg1, arg2, arg3) => {
      let message;
      if (
        arg2 &&
        typeof arg2 === "object" &&
        typeof arg2.message === "string"
      ) {
        message = arg2.message;
      } else if (typeof arg3 === "string") {
        message = arg3;
      } else if (typeof arg2 === "string") {
        message = arg2;
      }
      if (typeof message !== "string") return;

      if (errEnabled() && message.startsWith(M_ERR)) {
        let payload = message.slice(M_ERR.length);
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          /* garde la string brute */
        }
        handleScoLog(store, "ERROR", {
          flat: `[SCO uncaught] ${flattenErr(payload)}`,
          raw: payload,
        });
        return;
      }

      if (consoleEnabled() && message.startsWith(M_CON)) {
        const rest = message.slice(M_CON.length); // ":error{...}" | ":warn{...}"
        const sep = rest.indexOf("{");
        const lvlTag = sep > 0 ? rest.slice(1, sep) : "error";
        let payload = sep > 0 ? rest.slice(sep) : rest;
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          /* garde la string brute */
        }
        const level = lvlTag === "warn" ? "WARN" : "ERROR";
        const text =
          payload && typeof payload === "object" ? payload.message : payload;
        handleScoLog(store, level, {
          flat: `[SCO console.${lvlTag}] ${text}`,
          raw: payload,
        });
      }
    });
  });
};
