const path = require("node:path");
const { app, BrowserWindow, BrowserView } = require("electron");

const {
  default: installExtension,
  REACT_DEVELOPER_TOOLS,
} = require("electron-extension-installer");

const pkg = require("../../package.json");

const log = require("./helpers/electron_log");

let pm2 = app.isPackaged ? null : require("pm2");

const getAssetPath = require("./helpers/get_asset");

module.exports = function generatecontainerWindow(store) {
  let isFrame = store.conf.frame;

  if (isFrame === undefined || isFrame === null) {
    isFrame = false;
  } else if (typeof isFrame === "string") {
    isFrame = isFrame === "1" || isFrame === "true";
  }

  const containerWindow = new BrowserWindow({
    show: false,
    frame: isFrame,
    icon: getAssetPath("icons/png/32x32.png"),
    useContentSize: true,
    x:
      store.choosen_screen.x +
      store.choosen_screen.width / 2 -
      store.windows.loader.width / 2,
    y:
      store.choosen_screen.y +
      store.choosen_screen.height / 2 -
      store.windows.loader.height / 2,
    // width: store.choosen_screen.width,
    // height: store.choosen_screen.height,
    webPreferences: {
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: process.env.EL_DEBUG || store.conf.debug,
      preload: path.join(__dirname, "..", "container", "assets", "preload.js"),
    },
    title: store.conf.title ? store.conf.title : store.infos.name,
  });
  // const view = new BrowserView()
  // containerWindow.setBrowserView(view)
  // view.setBounds({ x: 0, y: 0, width: store.choosen_screen.width, height: store.choosen_screen.height })
  // view.webContents.loadURL('http://pos.chrono.demomkt.xyz')
  containerWindow.webContents.on("ready-to-show", async () => {
    if (process.env.EL_DEBUG || store.conf.debug) {
      // REDUX_DEVTOOLS retiré : cassé dans ce contexte Electron
      // (prepareInjection.js → sendMessage undefined) et entrait en conflit
      // avec notre tap Redux (redux_tap.js). React DevTools conservé.
      installExtension([REACT_DEVELOPER_TOOLS], {
        loadExtensionOptions: {
          allowFileAccess: true,
        },
      })
        .then((name) =>
          log.debug("[WINDOW] > container : " + name + " extension Added"),
        )
        .catch((err) => log.error("[WINDOW] > container : " + err.message))
        .finally(() => {
          containerWindow.webContents.openDevTools({ mode: "right" });
        });
    }
    log.debug("[WINDOW] > container : ready-to-show");
  });

  // La page porte desormais un <title> (exige par l'accessibilite). Sans ce
  // garde, il remplacerait le titre de la fenetre des le chargement — or
  // celui-ci vient de `conf.title` et sert aussi de WM_NAME, dont depend
  // l'association de fenetres cote gestionnaire.
  containerWindow.on("page-title-updated", (e) => {
    e.preventDefault();
  });

  containerWindow.on("closed", () => {
    if (pm2 && process.env.NODE_ENV === "development" && store.pm2.connected) {
      pm2.delete(pkg.pm2.process[0].name);
    }
    store.windows.container.current = null;
    // L'ecran client est volontairement `closable: false` — un client ne doit
    // pas pouvoir le fermer. Consequence : il survit a la fermeture de la
    // caisse, `window-all-closed` ne se declenche jamais, et le launcher reste
    // vivant sans fenetre visible. Il faut donc le detruire explicitement.
    try {
      require("./helpers/customer_manager").fermer(store);
    } catch (err) {
      log.error(`[CUSTOMER] fermeture a la sortie: ${err.message}`);
    }
  });
  containerWindow.removeMenu();
  containerWindow.on("show", () => {
    setTimeout(() => {
      containerWindow.focus();
    }, 200);
  });

  return containerWindow;
};
