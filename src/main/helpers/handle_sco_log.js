const hasLevel = require("./has_level");

const LEVELS = ["INFO", "DEBUG", "WARN", "ERROR"];

/**
 * Sink unique pour les logs émis par le SCO/POS.
 *
 *  1. Persistance fichier locale (logs/app/) — OPT-IN via `config.log.persist_app`
 *     (entrée absente → désactivé). Écrit le message aplati `flat`. C'est ce qui
 *     remplace l'ancien logserver HTTP de NW.js : Electron écrit déjà dans un
 *     fichier rotatif Winston dédié (cf helpers/create_app_log.js).
 *  2. Relais vers le BO central (socket WPT) — comportement historique, filtré
 *     par `config.central.log`. Envoie le message brut `raw`.
 *
 * Les deux canaux sont indépendants : un log peut être persisté sans être
 * relayé, et inversement.
 *
 * @param {object} store   store launcher (conf, appLog, wpt.socket)
 * @param {string} level   "INFO" | "DEBUG" | "ERROR" (fallback "INFO")
 * @param {{ flat?: string, raw?: * }} payload  flat = message aplati (fichier),
 *   raw = message brut (central). Si `raw` absent, `flat` est réutilisé.
 */
module.exports = function handleScoLog(store, level, payload) {
  const lvl = LEVELS.indexOf(level) >= 0 ? level : "INFO";
  const flat = payload && payload.flat;
  const raw = payload && "raw" in payload ? payload.raw : flat;

  // 1. Persistance fichier locale (opt-in, off par défaut si l'entrée manque).
  if (
    flat &&
    String(flat).length > 0 &&
    store.conf &&
    store.conf.log &&
    store.conf.log.persist_app === true &&
    store.appLog
  ) {
    const line = typeof flat === "object" ? JSON.stringify(flat) : String(flat);
    if (lvl === "ERROR") {
      store.appLog.error(line);
    } else if (lvl === "WARN") {
      store.appLog.warn(line);
    } else if (lvl === "DEBUG") {
      store.appLog.debug(line);
    } else {
      store.appLog.info(line);
    }
  }

  // 2. Relais vers le BO central (comportement historique inchangé).
  if (
    store.conf &&
    store.conf.central &&
    store.conf.central.log &&
    hasLevel(store.conf.central.log, lvl)
  ) {
    const messageContainer = {
      id: Date.now(),
      event: "log",
      type: "PUSH",
      data: {
        type: lvl.toLowerCase(),
        message: raw,
      },
    };
    if (store.wpt && store.wpt.socket) {
      store.wpt.socket.emit("central.message", messageContainer);
    }
  }
};
