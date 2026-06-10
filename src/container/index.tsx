import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";

import { Modal, notification } from "antd";

import axios from "axios";

import { Button, Theme, TThemeColorTypes } from "react-antd-cssvars";

import { ICustomWindow } from "../helpers/interface";
import computeTheme from "../helpers/compute_theme";
import { generateDates } from "./helpers/generate";

import { store } from "./store";

import App from "./App";

import {
  setConfigAction,
  setWPTInfosAction,
  setScreensAction,
  setWPTPluginsAction,
  TNextAction,
  wptConnectAction,
  iFrameReadyAction,
  iFrameDisplayAction,
  setAskAction,
  openPinpadAction,
  setAppInfos,
  setReportEnvInfo,
  setToken,
  setReportDates,
  setLoader,
  setToggleMenu,
  wptPluginsStateAction,
  wptPluginsStateUpdateAction,
  setDiagnosticAction,
} from "./store/actions";

import Plugins from "./components/Plugins";
import {
  IAppInfo,
  IEnvInfo,
  IRootState,
  IWPTPluginState,
  TPluginStatus,
  TWPTPluginState,
} from "./interface";

import "./styles/index.less";
import { setReportMaLineSizeAction } from "./store/actions/report";

const { info, confirm } = Modal;

declare let window: ICustomWindow;

window.store = store;
window.theme = new Theme<TThemeColorTypes>(undefined, computeTheme(store));
window.theme.set("primary-color", window.theme.get("menu-background"), true);

window.electronAPI.on("request_wpt.error", (action: string, err: any) => {
  notification.open({
    message: err.code,
    type: "error",
    description: err.message,
    duration: 3,
  });
  store.dispatch(setAskAction(false));
});

window.electronAPI.on("app_infos", (appInfos: IAppInfo) => {
  store.dispatch(setAppInfos(appInfos));
});

window.electronAPI.on("container.request", (action: string) => {
  if (action === "get.state") {
    const state = store.getState();
    // eslint-disable-next-line no-console
    console.log(action, state);
    window.electronAPI.send("container.response", action, state);
  }
});

window.electronAPI.on("request_wpt.done", (action: string, data: any) => {
  const state = store.getState();

  switch (action) {
    case "plugins":
      store.dispatch(setWPTPluginsAction(data));
      if (state.wpt.ask) {
        const modal = info({
          className: "modal-plugins",
          title: "Activate plugins",
          icon: null,
          autoFocusButton: null,
          centered: true,
          content: <Plugins plugins={data} />,
          onOk: () => {
            modal.destroy();
          },
        });
      }
      break;
    case "infos":
      store.dispatch(setWPTInfosAction(data));
      break;
    case "fastprinter.defaultprinterdata":
      store.dispatch(setReportMaLineSizeAction(data.maxlinesize));
      break;
    default:
      break;
  }

  // Diagnostics "Périphériques" : on stocke la réponse brute de chaque requête
  // device dans le slice diagnostics (indexé par event) pour le dashboard.
  const DIAGNOSTIC_EVENTS = [
    "fastprinter.defaultprinterdata",
    "fastprinter.printers",
    "fastprinter.printerdata",
    "universalterminal.plugin",
    "universalterminal.isinitialized",
    "central.applications",
    "lights.devices",
    "lights.test",
  ];
  if (DIAGNOSTIC_EVENTS.includes(action)) {
    store.dispatch(setDiagnosticAction(action, data));
  }
  if (state.wpt.ask) {
    store.dispatch(setAskAction(false));
  }
});

window.electronAPI.on("conf", (conf: any) => {
  if (conf && conf.log && conf.log.renderer) {
    window.log.setLevel(conf.log.renderer);
  }

  store.dispatch(setConfigAction(conf));

  if (conf.theme) {
    for (const themeKey in conf.theme) {
      if (window.theme.has(themeKey as TThemeColorTypes)) {
        const colorTheme = conf.theme[themeKey];
        window.theme.set(themeKey as TThemeColorTypes, `#${colorTheme}`, true);
      }
    }
  }

  if (conf.zoom) {
    if (conf.zoom.level) {
      window.electronAPI.setZoomLevel?.(conf.zoom.level);
    }
    if (conf.zoom.factor) {
      window.electronAPI.setZoomFactor?.(conf.zoom.factor);
    }
  }

  if (conf.menu) {
    const menuButton = document.getElementById("el-menu-button");
    if (menuButton && conf.menu.button_size) {
      menuButton.style.width = `${conf.menu.button_size}px`;
      menuButton.style.height = `${conf.menu.button_size}px`;
    }

    if (menuButton && conf.menu.button_position) {
      menuButton.style.bottom = `${conf.menu.button_position}px`;
      menuButton.style.left = `${conf.menu.button_position}px`;
    }
  }
});

window.electronAPI.on("toggle_menu", (toggle: boolean) => {
  store.dispatch(setToggleMenu(toggle));
});

window.electronAPI.on("screens", (screens: any) => {
  store.dispatch(setScreensAction(screens));
});

window.electronAPI.on("ready", (ready: boolean) => {
  store.dispatch(iFrameReadyAction(ready));
});

window.electronAPI.on("wpt_plugin_state.init", (state: TWPTPluginState) => {
  store.dispatch(wptPluginsStateAction(state));
});

window.electronAPI.on(
  "wpt_plugin_state.update",
  (wptprefix: string, status: TPluginStatus) => {
    store.dispatch(wptPluginsStateUpdateAction(wptprefix, status));
  }
);

window.electronAPI.on("wpt_connect", (connected: boolean) => {
  store.dispatch(wptConnectAction(connected));
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
window.electronAPI.on("ask_password", (action: string, action2: string) => {
  const state: IRootState = store.getState();
  if (state.menu.open) {
    store.dispatch(setToggleMenu(false));
  }
  if (state.conf?.menu.password) {
    store.dispatch(
      openPinpadAction(TNextAction.OPEN_DEV_TOOLS, state.conf?.menu.password)
    );
  } else if (action === "open_dev_tools" && state.conf?.view === "webview") {
    let count = 0;
    let webview: any = document.getElementById("e-launcher-frame");
    if (webview) {
      webview.openDevTools();
    } else {
      const interval = setInterval(() => {
        count++;
        webview = document.getElementById("e-launcher-frame");
        if (webview) {
          clearInterval(interval);
          webview.openDevTools();
        }
        if (count > 10) {
          clearInterval(interval);
        }
      }, 500);
    }
  }
});

window.electronAPI.on("notification", (notif: any) => {
  if (typeof notif === "string") {
    notification.open({
      message: notif,
      duration: 3,
    });
  } else if (typeof notif === "object") {
    if (notif.confirm) {
      const key = `open${Date.now()}`;

      notification.open({
        className: "notification-ask",
        type: notif.type,
        message: notif.header,
        description: notif.message,
        closeIcon: <div></div>,
        duration: 60,
        key,
        btn: (
          <React.Fragment>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                onCallback(TNextAction.NOTIFICATION, true);
                notification.close(key);
              }}
            >
              YES
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                onCallback(TNextAction.NOTIFICATION, false);
                notification.close(key);
              }}
            >
              NO
            </Button>
          </React.Fragment>
        ),
        onClose: () => {
          onCallback(TNextAction.NOTIFICATION, false);
        },
      });
    } else {
      notification.open({
        type: notif.type,
        message: notif.header,
        description: notif.message,
        duration: 3,
      });
    }
  }
});

window.electronAPI.on("menu.action", (action: any) => {
  if (action) {
    const conf = store.getState().conf;
    const display = store.getState().display;
    if (
      conf &&
      conf.menu &&
      conf.menu.password &&
      display.switch === "CONTAINER"
    ) {
      store.dispatch(openPinpadAction(action, conf.menu.password));
    } else {
      onCallback(action);
    }
  }
});

window.electronAPI.send("ready", "main");

const sendChildAction = (event: string, ...data: any) => {
  window.electronAPI.send("child.action", event, ...data);
};

const reloadAndClearCache = (clearSession: boolean) => {
  if (clearSession) {
    localStorage.clear();
    sessionStorage.clear();
  }
  window.electronAPI.send("main.action", "reload", clearSession);
};

const onCallback = (action: TNextAction, ...data: any) => {
  const state = store.getState();
  switch (action) {
    case TNextAction.EMERGENCY:
      window.electronAPI.send("main.action", "emergency");
      break;
    case TNextAction.CLOSE:
      window.electronAPI.send("main.action", "close");
      break;
    case TNextAction.RELOAD:
      const modal = confirm({
        // className: 'emergency-modal',
        title: "reload the application",
        mask: true,
        content: "Do you want to clear the cache ?",
        centered: true,
        okText: "YES",
        cancelButtonProps: {
          type: "link",
        },
        cancelText: "NO",
        onOk() {
          modal.destroy();
          window.log.info("[WINDOW CONTAINER] Click emergency OK");
          store.dispatch(iFrameReadyAction(false));
          reloadAndClearCache(true);
        },
        onCancel() {
          modal.destroy();
          window.log.info("[WINDOW CONTAINER] Click emergency Cancel");
          store.dispatch(iFrameReadyAction(false));
          reloadAndClearCache(false);
        },
      });

      break;
    case TNextAction.NOTIFICATION:
      window.electronAPI.send("main.action", "notification", data[0]);
      break;
    case TNextAction.REQUEST_WPT:
      store.dispatch(setAskAction(true));
      // ipcRenderer.send('main_action', 'plugins')
      if (data && data.length > 0) {
        const keyMessage: string = data.shift();
        window.electronAPI.send("request_wpt", keyMessage, ...data);
      }
      break;
    case TNextAction.REPORT:
      const api_key = Object.keys(sessionStorage).find((key) => {
        return key.indexOf("StorageCache_") === 0;
      });

      if (api_key) {
        let token = sessionStorage.getItem(api_key);
        if (typeof token === "string") {
          token = JSON.parse(token);
        }
        if (Array.isArray(token)) {
          token = token[0];
        }
        const urlParsed = api_key.substring("StorageCache_".length);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const url = new URL(urlParsed);

        if (token) {
          store.dispatch(setToken(token));
        }

        store.dispatch(setLoader(true));
        window.electronAPI.send(
          "request_wpt",
          "fastprinter.defaultprinterdata"
        );
        axios
          .get<IEnvInfo>(`http://localhost:${state.conf?.http.port}/env.json`)
          .then((response) => {
            store.dispatch(setReportEnvInfo(response.data as IEnvInfo));

            const [startDate, endDate] = generateDates();

            store.dispatch(setReportDates(startDate, endDate));

            if (state.display.ready) {
              store.dispatch(iFrameDisplayAction("REPORT"));
              store.dispatch(setToggleMenu(false));
            }
          })
          .catch((err) => {
            notification.open({
              message: err.message,
              description: err.message,
              duration: 3,
            });
          })
          .finally(() => {
            store.dispatch(setLoader(false));
          });
      } else {
        notification.open({
          message: "API_KEY_NOT_FOUND",
          description: "api key not found",
          duration: 3,
        });
      }

      break;
    case TNextAction.WPT_STATUS:
      if (state.display.ready) {
        store.dispatch(
          iFrameDisplayAction(
            state.display.switch === "CONTAINER" ? "WPT" : "CONTAINER"
          )
        );
      }
      break;
    case TNextAction.OPEN_DEV_TOOLS:
      window.electronAPI.send("main.action", "open_dev_tools");
      break;
    default:
      break;
  }
};

window.electronAPI.on("ask_reload", (cleaCache: boolean) => {
  reloadAndClearCache(cleaCache);
});

const root = ReactDOM.createRoot(
  document.getElementById("electron-launcher-root") as HTMLElement
);

root.render(
  <React.Fragment>
    <Provider store={store}>
      <App onCallback={onCallback} sendChildAction={sendChildAction} />
    </Provider>
  </React.Fragment>
);

// win.fullscreen = true

// process.on('SIGTERM', () => {
// 	closeApp(win, child)
// })
