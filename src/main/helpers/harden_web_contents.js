const { shell } = require("electron");
const { URL } = require("url");
const log = require("./electron_log");

/**
 * Gardes de sécurité appliqués à TOUS les webContents (fenêtres + webview
 * POS). Le launcher charge une URL POS distante : sans ces gardes, une page
 * compromise pourrait ouvrir des fenêtres natives arbitraires, naviguer
 * ailleurs, ou attacher un webview avec nodeIntegration.
 *
 * 3 protections :
 *  1. setWindowOpenHandler — refuse toute nouvelle BrowserWindow ; les liens
 *     http(s) externes sont ouverts dans le navigateur système (shell), le
 *     reste est bloqué. Empêche les popups node-enabled.
 *  2. will-attach-webview — force des webPreferences sûrs sur chaque webview
 *     attaché (nodeIntegration off, contextIsolation on) quoi que demande
 *     le DOM. Bloque l'escalade via un <webview> hostile.
 *  3. will-navigate — surveille les navigations hors origines autorisées.
 *     LOG par défaut (pour ne pas casser un éventuel redirect auth/paiement
 *     du POS) ; BLOQUE si EL_STRICT_NAV=1. Les logs montrent quoi
 *     whitelister avant de passer en strict.
 *
 * @param {object} store - store launcher (pour lire l'URL POS courante)
 */
function hardenWebContents(store) {
  const { app } = require("electron");

  // Origines autorisées : l'URL POS configurée + localhost (WPT/HTTP local)
  // + file: (bundle local). Recalculé à chaque event (la conf peut changer).
  const allowedOrigins = () => {
    const origins = new Set(["file://"]);
    try {
      const confUrl = store?.conf?.url?.href || store?.conf?.url;
      if (confUrl && /^https?:/i.test(String(confUrl))) {
        origins.add(new URL(String(confUrl)).origin);
      }
    } catch {
      /* url non parsable → ignore */
    }
    return origins;
  };

  const isAllowed = (target) => {
    try {
      const u = new URL(target);
      if (u.protocol === "file:") return true;
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
      return allowedOrigins().has(u.origin);
    } catch {
      return false;
    }
  };

  app.on("web-contents-created", (_e, contents) => {
    // 1. Pas de nouvelles fenêtres ; liens externes → navigateur système.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        shell.openExternal(url).catch((err) =>
          log.debug(`[HARDEN] openExternal failed: ${err.message}`)
        );
      } else {
        log.warn(`[HARDEN] window.open bloqué: ${url}`);
      }
      return { action: "deny" };
    });

    // 2. webview attaché : on impose des prefs sûres.
    contents.on("will-attach-webview", (_evt, webPreferences, params) => {
      delete webPreferences.preloadURL;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      if (params.src && !isAllowed(params.src)) {
        log.warn(`[HARDEN] webview src hors allowlist: ${params.src}`);
      }
    });

    // 3. navigation hors origines autorisées.
    contents.on("will-navigate", (evt, url) => {
      if (isAllowed(url)) return;
      if (process.env.EL_STRICT_NAV === "1") {
        log.warn(`[HARDEN] navigation BLOQUÉE (strict): ${url}`);
        evt.preventDefault();
      } else {
        log.warn(
          `[HARDEN] navigation hors allowlist (autorisée, set EL_STRICT_NAV=1 pour bloquer): ${url}`
        );
      }
    });
  });
}

module.exports = hardenWebContents;
