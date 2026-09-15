const path = require("path");
const url = require("url");
const { BrowserWindow } = require("electron");

const log = require("./helpers/electron_log");
const getAssetPath = require("./helpers/get_asset");

/**
 * Ecran d'attente Octipas. Page locale et autonome : elle s'affiche meme sans
 * reseau, et des la premiere frame.
 */
const IDLE_URL = url.format({
  pathname: path.join(__dirname, "..", "local", "customer_idle.html"),
  protocol: "file",
  slashes: true,
});

/**
 * Fenetre de l'ecran client (affichage face client d'une caisse a deux ecrans).
 *
 * Volontairement minimale : elle charge une URL et rien d'autre. Pas de wrapper
 * React, pas de menu, pas de pinpad — un client ne doit pouvoir rien declencher.
 * C'est aussi pour ca qu'elle n'a ni cadre ni raccourci de fermeture.
 *
 * La container, elle, reste la seule fenetre pilotable et la seule capturee par
 * la visu distante.
 */
module.exports = function generateCustomerWindow(store, ecran) {
  const customerWindow = new BrowserWindow({
    show: false,
    frame: false,
    // Sans fond explicite, Chromium peint en BLANC avant le premier rendu.
    // Face client, sur un ecran de magasin, le flash blanc est tres visible.
    backgroundColor: "#11141E",
    x: ecran.x,
    y: ecran.y,
    width: ecran.width,
    height: ecran.height,
    icon: getAssetPath("icons/png/32x32.png"),
    // Un client ne redimensionne pas, ne deplace pas, ne ferme pas.
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    title: "Écran client",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Aucun preload : cette fenetre n'a aucune raison de parler au main.
      // Moins de surface, et rien a exposer a une page distante face public.
      devTools: Boolean(process.env.EL_DEBUG),
    },
  });

  customerWindow.removeMenu();

  customerWindow.on("closed", () => {
    store.windows.customer.current = null;
  });

  // La page client peut etre longue a repondre (reseau magasin) : on affiche
  // des que le rendu est pret plutot que de laisser un rectangle noir.
  customerWindow.once("ready-to-show", () => {
    log.debug("[CUSTOMER] fenetre prete");
    customerWindow.show();
    // setFullScreen apres show : sur Linux/Wayland, appele avant, le plein
    // ecran atterrit sur l'ecran courant du compositeur et pas sur celui
    // qu'on vient de cibler par x/y.
    customerWindow.setFullScreen(true);
  });

  customerWindow.webContents.on(
    "did-fail-load",
    (_e, code, desc, cible, isMainFrame) => {
      // -3 = ABORTED : emis a chaque navigation interrompue, y compris quand on
      // remplace volontairement la page. Le traiter comme un echec ferait
      // clignoter l'ecran a chaque changement.
      if (code === -3 || !isMainFrame) return;
      // Pas de dialogue : personne ne peut cliquer sur un ecran client.
      log.warn(`[CUSTOMER] chargement KO (${code} ${desc}) : ${cible}`);
      // Repli sur l'attente de marque. Un ecran d'erreur Chromium face au
      // public est le pire des affichages possibles.
      if (cible !== IDLE_URL) {
        customerWindow.loadURL(IDLE_URL).catch(() => {});
      }
    },
  );

  // L'attente s'affiche AVANT toute page distante : la fenetre n'est donc
  // jamais ni noire ni blanche, y compris pendant un chargement lent.
  customerWindow.loadURL(IDLE_URL).catch((err) => {
    log.error(`[CUSTOMER] ecran d'attente KO: ${err.message}`);
  });

  return customerWindow;
};

module.exports.IDLE_URL = IDLE_URL;
