const requestWPT = require("./request_wpt");
const log = require("./electron_log");

/**
 * Résumé périphériques pour le heartbeat central (vue flotte BO).
 *
 * Collecte avec parcimonie — les requêtes imprimante scannent le matériel et
 * certaines caisses en liaison COM supportent mal les sollicitations
 * répétées (port bloqué) :
 *   - TPE (isinitialized/plugin) : requêtes légères, refresh max 1×/60s
 *   - Imprimante (printerdata)   : scan device, refresh max 1×/5min
 *   - WPT / Central              : lus directement dans le store (instantané)
 *
 * getDeviceSummary() est synchrone : renvoie le dernier résumé connu et
 * déclenche les refreshs expirés en arrière-plan (fire & forget).
 */

const TPE_TTL_MS = 60_000;
const PRINTER_TTL_MS = 300_000;

// Normalise un nom de plugin pour matcher les clés de plugins_state
// (préfixes d'event, ex. "FastPrinter" → "fastprinter").
function normKey(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

const cache = {
  tpe: null, // { initialized, plugin }
  tpeAt: 0,
  tpeRunning: false,
  printer: null, // { online, paperOk, coverClosed, name }
  printerAt: 0,
  printerRunning: false,
};

async function refreshTpe(socket) {
  if (cache.tpeRunning) return;
  cache.tpeRunning = true;
  try {
    const [init, plugin] = await Promise.all([
      requestWPT(socket, { emit: "universalterminal.isinitialized" }).catch(
        () => null
      ),
      requestWPT(socket, { emit: "universalterminal.plugin" }).catch(
        () => null
      ),
    ]);
    cache.tpe = {
      initialized: typeof init === "boolean" ? init : null,
      plugin: plugin && plugin.name ? plugin.name : null,
    };
    cache.tpeAt = Date.now();
  } catch (err) {
    log.debug(`[DEVSUM] tpe refresh failed: ${err.message}`);
  } finally {
    cache.tpeRunning = false;
  }
}

async function refreshPrinter(socket) {
  if (cache.printerRunning) return;
  cache.printerRunning = true;
  try {
    // Config de l'imprimante par défaut (léger, pas de scan).
    const cfg = await requestWPT(socket, {
      emit: "fastprinter.defaultprinterdata",
    }).catch(() => null);
    if (!cfg || !cfg.type) {
      cache.printer = null;
      cache.printerAt = Date.now();
      return;
    }
    // Scan du device — 1 seule fois par TTL, timeout long (matériel lent).
    const d = await requestWPT(
      socket,
      {
        emit: "fastprinter.printerdata",
        datas: { type: cfg.type, address: cfg.address, name: cfg.name },
      },
      12
    ).catch(() => null);
    cache.printer = {
      name: (d && d.name) || cfg.name || null,
      online: d && typeof d.online === "boolean" ? d.online : null,
      paperOk:
        d && d.paper && typeof d.paper.end === "boolean" ? !d.paper.end : null,
      coverClosed:
        d && typeof d.cover_opened === "boolean" ? !d.cover_opened : null,
    };
    cache.printerAt = Date.now();
  } catch (err) {
    log.debug(`[DEVSUM] printer refresh failed: ${err.message}`);
  } finally {
    cache.printerRunning = false;
  }
}

/**
 * @param {object} store - store main du launcher
 * @returns {object|null} résumé compact, ou null si rien d'utile
 */
function getDeviceSummary(store) {
  if (!store) return null;
  const socket = store.wpt && store.wpt.socket;
  const wptConnected = !!(store.wpt && store.wpt.connect);

  // Refreshs en arrière-plan si TTL expiré et WPT joignable.
  if (socket && wptConnected) {
    const now = Date.now();
    if (now - cache.tpeAt > TPE_TTL_MS) {
      refreshTpe(socket);
    }
    if (now - cache.printerAt > PRINTER_TTL_MS) {
      refreshPrinter(socket);
    }
  }

  const central = store.central || {};

  // Liste complète des plugins — 100% en mémoire (registre `plugins` +
  // états live `plugins_state` poussés), AUCUN scan matériel → pas de
  // sollicitation des ports COM. Donne au BO le statut de tous les plugins
  // (lights, linedisplay, scanner, tiroir, balance…), pas seulement les 3
  // détaillés ci-dessus.
  const states = store.wpt.plugins_state || {};
  const plugins = Array.isArray(store.wpt.plugins)
    ? store.wpt.plugins.map((p) => {
        const st = states[normKey(p && p.name)];
        return {
          name: p && p.name ? p.name : "?",
          enabled: !!(p && p.enabled),
          status: st && st.status ? st.status : null,
        };
      })
    : null;

  return {
    wpt: wptConnected,
    printer: cache.printer,
    tpe: cache.tpe,
    central: {
      registered: !!central.registered,
      status: central.status || null,
    },
    plugins,
  };
}

module.exports = getDeviceSummary;
