const {
  app,
  ipcMain,
  session,
  Notification,
  ipcRenderer,
} = require("electron");
const path = require("path");

const showDialogError = require("./dialog_err");

const initialize = require("./helpers/initialize");
const requestWPT = require("./helpers/request_wpt");
const reinitialize = require("./helpers/reinitialize");
const checkWptPlugin = require("./helpers/check_wpt_plugin");
const openLoaderDevTools = require("./helpers/open_loader_dev_tools");
const sendOnReady = require("./helpers/send_on_ready");
const handleScoLog = require("./helpers/handle_sco_log");
const log = require("./helpers/electron_log");
const getCentralRegister = require("./helpers/get_central_register");
const clearCache = require("./helpers/clear_cache");
const buildVersion = require("./helpers/build_version");

module.exports = function generateIpc(store, initCallback) {
  let count = 0;

  ipcMain.on("ready", async (event, who) => {
    log.info(`[WINDOW] > ${who} ready to received info`);
    if (who === "main" && store.windows.container.current) {
      store.ready = true;
      store.windows.container.current.webContents.send(
        "user_path",
        store.infos.user_path,
      );

      const name =
        store.conf && store.conf.title ? store.conf.title : store.infos.name;
      store.windows.container.current.webContents.send("app_infos", {
        version: buildVersion(),
        name: name,
      });
      sendOnReady(store);

      if (store.screens.length > 0) {
        store.windows.container.current.webContents.send(
          "screens",
          store.screens,
        );
      }
      store.windows.container.current.webContents.send(
        "wpt_connect",
        store.wpt.connect,
      );
      if (store.wpt.infos) {
        store.windows.container.current.webContents.send(
          "request_wpt.done",
          "infos",
          store.wpt.infos,
        );
      }
      if (store.wpt.plugins) {
        store.windows.container.current.webContents.send(
          "request_wpt.done",
          "plugins",
          store.wpt.plugins,
        );
      }

      if (store.finish) {
        store.windows.container.current.webContents.send("ready", true);
      }
    } else if (
      who === "loader" &&
      store.windows.loader.current &&
      count === 0
    ) {
      if (store.windows.container.current) {
        store.windows.container.current.webContents.send(
          "user_path",
          store.infos.user_path,
        );
      }
      count++;
      try {
        if (
          store.windows.loader.current &&
          !store.windows.loader.current.isVisible() &&
          !store.windows.loader.current.isDestroyed()
        ) {
          store.windows.loader.current.show();

          const title =
            store.conf && store.conf.title
              ? store.conf.title
              : store.infos.name;

          store.windows.loader.current.webContents.send(
            "loader.action",
            "initialize",
          );
          store.windows.loader.current.webContents.send("app_infos", {
            version: buildVersion(),
            title: title,
            name: store.infos.name,
          });

          if (store.debug) {
            openLoaderDevTools(store);
          }
        }
        await initialize(
          { conf: store.conf || store.path.conf, version: store.infos.version },
          initCallback,
        );

        if (store.conf && store.conf.extensions) {
          for (const name in store.conf.extensions) {
            const extPath = path.resolve(store.conf.extensions[name]);
            await session.defaultSession.loadExtension(extPath, {
              allowFileAccess: true,
            });
          }
        }
      } catch (err) {
        showDialogError(store, err);
      }
    }
  });

  ipcMain.on("container.response", (event, action, data) => {
    if (action === "get.state") {
      store.windows.container.state = data;
    }
  });

  ipcMain.on("child.action", (event, action, ...others) => {
    switch (action) {
      case "log":
        let level = "INFO";
        if (others.length >= 2) {
          level = others.shift();
          if (["INFO", "DEBUG", "ERROR"].indexOf(level) < 0) {
            level = "INFO";
          }
        }
        let tmpLogMessage = "";
        if (
          others.length > 0 &&
          Array.isArray(others[0]) &&
          others[0].length > 0
        ) {
          const message = others[0].shift();
          tmpLogMessage += message;

          if (others[0].length > 0) {
            for (let i = 0; i < others[0].length; i++) {
              tmpLogMessage += " ";
              const data = others[0][i];
              if (Array.isArray(data)) {
                tmpLogMessage += JSON.stringify(data, null, 0);
              } else if (typeof data === "object") {
                tmpLogMessage += JSON.stringify(data, null, 1);
              } else {
                tmpLogMessage += data;
              }
            }
          }
        } else if (Array.isArray(others) && others.length > 0) {
          tmpLogMessage = others[0];
        }

        // Sink unique : persistance fichier locale (opt-in log.persist_app) +
        // relais central (historique, filtré par central.log).
        handleScoLog(store, level, { flat: tmpLogMessage, raw: others[0] });
        break;

      case "central.register":
        store.infos.app_versions = store.infos.app_versions
          ? { ...store.infos.app_versions, ...others[0] }
          : others[0];
        store.central.ready = true;

        if (
          store.wpt.socket &&
          store.conf &&
          store.conf.central &&
          store.conf.central.enable &&
          store.conf.central.mode === "MANUAL" &&
          store.central.status === "READY" &&
          !store.central.registered &&
          !store.central.registering
        ) {
          const register = getCentralRegister(store);
          store.wpt.socket.emit("central.register", register);
        }
        break;
      default:
        break;
    }
  });

  ipcMain.on("request_wpt", async (event, action, ...datas) => {
    if (store.wpt.socket) {
      let err = null;
      if (action.indexOf("fastprinter") === 0) {
        // Un échec du check (plugin absent/désactivé, ou socket lent) ne doit
        // PAS bloquer la requête réelle — on tente quand même, la requête
        // renverra ses propres données ou son erreur.
        try {
          await checkWptPlugin(store.wpt.socket, "FastPrinter");
        } catch (e) {
          // ignore — on poursuit avec la requête
        }
      }

      if (err) {
        if (store.windows.container.current) {
          store.windows.container.current.webContents.send(
            "request_wpt.error",
            action,
            err,
          );
        } else {
          const notification = {
            title: err.api_code || err.code || "An error as occured",
            body: err.message,
          };
          new Notification(notification).show();
        }
      }

      // "lights.*" ne sont pas des events socket : le plugin lights (V2)
      // expose une API REST. fetch natif Node 22, réponse sur le canal
      // request_wpt.done habituel.
      if (action === "lights.devices") {
        const base = (
          store.conf?.wpt?.url?.href || "http://localhost:9963"
        ).replace(/\/+$/, "");
        try {
          const devRes = await fetch(`${base}/lights/api/devices`);
          if (!devRes.ok) throw new Error(`GET devices: HTTP ${devRes.status}`);
          const raw = await devRes.json();
          const devices = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.devices)
              ? raw.devices
              : [];
          if (store.windows.container.current) {
            store.windows.container.current.webContents.send(
              "request_wpt.done",
              action,
              devices,
            );
          }
        } catch (e) {
          log.debug(`[LIGHTS] devices failed: ${e.message}`);
          // diagnostic silencieux — pas de notif, pas d'erreur renderer
        }
        return;
      }
      if (action === "lights.test") {
        const base = (
          store.conf?.wpt?.url?.href || "http://localhost:9963"
        ).replace(/\/+$/, "");
        try {
          const devRes = await fetch(`${base}/lights/api/devices`);
          if (!devRes.ok) throw new Error(`GET devices: HTTP ${devRes.status}`);
          const devices = await devRes.json();
          const dev = Array.isArray(devices)
            ? devices.find((d) => d && d.connected) || devices[0]
            : null;
          if (!dev || !dev.name) throw new Error("No lights device found");
          const testRes = await fetch(
            `${base}/lights/api/devices/${encodeURIComponent(dev.name)}/test`,
            { method: "POST" },
          );
          if (!testRes.ok) throw new Error(`POST test: HTTP ${testRes.status}`);
          if (store.windows.container.current) {
            store.windows.container.current.webContents.send(
              "request_wpt.done",
              action,
              { ok: true, device: dev.name },
            );
          }
        } catch (e) {
          log.warn(`[LIGHTS] test failed: ${e.message}`);
          if (store.windows.container.current) {
            store.windows.container.current.webContents.send(
              "request_wpt.error",
              action,
              { message: e.message },
            );
          }
        }
        return;
      }

      // Les requêtes "device" (imprimante surtout) scannent le matériel et
      // peuvent dépasser 3s → on leur laisse un délai plus long. Et on évite
      // de popper une Notification système quand c'est une requête de
      // diagnostic en arrière-plan (le dashboard gère l'absence de réponse).
      // linedisplay.print n'émet AUCUNE réponse en succès (seulement .error)
      // → le timeout est attendu, on l'avale silencieusement (le test se
      // vérifie sur l'afficheur physique).
      const DIAGNOSTIC_EVENTS = [
        "fastprinter.defaultprinterdata",
        "fastprinter.printers",
        "fastprinter.printerdata",
        "universalterminal.plugin",
        "universalterminal.isinitialized",
        "central.applications",
        "linedisplay.print",
      ];
      const isDeviceQuery = action.indexOf("fastprinter") === 0;
      const isDiagnostic = DIAGNOSTIC_EVENTS.includes(action);
      const delay = isDeviceQuery ? 12 : undefined;

      requestWPT(store.wpt.socket, { emit: action, datas: datas }, delay)
        .then((data) => {
          store.windows.container.current.webContents.send(
            "request_wpt.done",
            action,
            data,
          );
        })
        .catch((err) => {
          if (!isDiagnostic) {
            const notification = {
              title: err.api_code || err.code || "An error as occured",
              body: err.message,
            };
            new Notification(notification).show();
          }

          if (store.windows.container.current) {
            store.windows.container.current.webContents.send(
              "request_wpt.error",
              action,
              err,
            );
          }
        });
    }
  });

  ipcMain.on("main.action", async (event, action, other) => {
    log.info(`[ACTION] > ${action} received`);
    if (!action) {
      return;
    }
    if (
      store.windows.loader.current &&
      !store.windows.loader.current.isDestroyed() &&
      ["close", "reload"].includes(action)
    ) {
      store.windows.loader.current.show();
      store.windows.loader.current.webContents.send("loader.action", action);
    }
    switch (action) {
      case "reload":
        await reinitialize(store, initCallback, {
          keep_wpt: true,
          keep_http: true,
        });
        if (other) {
          await clearCache();
        }
        break;
      case "close":
        if (
          store.windows.loader.current &&
          store.windows.loader.current.isVisible() &&
          !store.windows.loader.current.isDestroyed()
        ) {
          store.windows.loader.current.close();
        }
        if (
          store.windows.container.current &&
          store.windows.container.current.isVisible() &&
          !store.windows.container.current.isDestroyed()
        ) {
          store.windows.container.current.close();
        }
        break;

      case "emergency":
        if (store.wpt.socket && store.wpt.plugins) {
          const fastprinter = store.wpt.plugins.find((plugin) => {
            return plugin.name.toLowerCase() === "fastprinter";
          });

          const cashdrawer = store.wpt.plugins.find((plugin) => {
            return plugin.name.toLowerCase() === "cashdrawer";
          });

          if (fastprinter && fastprinter.enabled) {
            try {
              await requestWPT(
                store.wpt.socket,
                { emit: "fastprinter.cashdrawer", datas: null },
                3,
              );
              log.info(`[ACTION] > ${action} : fastprinter.cashdrawer sent`);
            } catch (err) {
              log.error(
                `[ACTION] > ${action} : fastprinter.cashdrawer sent error, ${err}`,
              );
            }
            log.info(`[ACTION] > ${action} : fastprinter.cashdrawer sent`);
          } else if (fastprinter && !fastprinter.enabled) {
            log.debug(`[ACTION] > ${action} : fastprinter not enabled`);
          } else {
            log.debug(`[ACTION] > ${action} : fastprinter not found`);
          }
          if (cashdrawer && cashdrawer.enabled) {
            try {
              await requestWPT(
                store.wpt.socket,
                { emit: "cashdrawer.open", datas: null },
                3,
              );
              log.info(`[ACTION] > ${action} : cashdrawer.open sent`);
            } catch (err) {
              log.error(
                `[ACTION] > ${action} : cashdrawer.open sent error, ${err}`,
              );
            }
            store.wpt.socket.emit("cashdrawer.open");
            log.info(`[ACTION] > ${action} : cashdrawer.open sent`);
          } else if (cashdrawer && !cashdrawer.enabled) {
            log.debug(`[ACTION] > ${action} : cashdrawer not enabled`);
          } else {
            log.debug(`[ACTION] > ${action} : cashdrawer not found`);
          }
        } else if (!store.wpt.socket) {
          log.error(`[ACTION] > ${action} : socket not found`);
        } else if (!store.wpt.plugins) {
          log.error(`[ACTION] > ${action} : wpt.plugins not found`);
        }

        app.quit();
        break;
      case "notification":
        if (
          store.current_request &&
          store.current_request.event === "notification"
        ) {
          const messageContainer = {
            message: {
              id: store.current_request.id,
              event: store.current_request.event,
              type: other ? "END" : "ERROR",
            },
          };
          if (store.wpt && store.wpt.socket) {
            store.wpt.socket.emit("central.message", messageContainer);
          }
          store.current_request = null;
        }
        break;
      case "open_dev_tools":
        if (
          store.windows.container.current &&
          store.windows.container.current.isVisible() &&
          !store.windows.container.current.isDestroyed()
        ) {
          store.windows.container.current.webContents.openDevTools({
            mode: "right",
          });
        } else if (
          store.windows.loader.current &&
          store.windows.loader.current.isVisible() &&
          !store.windows.loader.current.isDestroyed()
        ) {
          store.windows.loader.current.webContents.openDevTools({
            mode: "undocked",
          });
        }
        break;

      default:
        break;
    }
  });
};
