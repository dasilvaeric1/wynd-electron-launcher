const path = require("path");
const url = require("url");
const { BrowserWindow } = require("electron");

const log = require("./helpers/electron_log");
const getAssetPath = require("./helpers/get_asset");

/**
 * Fond par defaut sous une page distante.
 *
 * Le fond de la fenetre ne se voit que la ou la page ne peint pas. L'ecran
 * d'attente peint tout, donc son fond sombre n'a d'effet qu'avant le premier
 * rendu — c'est pour ca que la fenetre nait sombre, sans flash. Une page
 * distante, elle, peut tres bien ne rien peindre : /customer-display du POS
 * est dans ce cas, et le sombre de la fenetre transparaissait. Le blanc est
 * ce que tout navigateur met sous une page sans fond ; c'est donc ce qu'une
 * telle page suppose.
 */
const FOND_PAGE_DEFAUT = "#ffffff";

/** Fond de la fenetre au demarrage : celui de l'ecran d'attente. */
const FOND_ATTENTE = "#18211e";

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
module.exports = function generateCustomerWindow(store, ecran, urlClient, fondPage) {
  const customerWindow = new BrowserWindow({
    show: false,
    frame: false,
    // Sans fond explicite, Chromium peint en BLANC avant le premier rendu.
    // Face client, sur un ecran de magasin, le flash blanc est tres visible.
    backgroundColor: FOND_ATTENTE,
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
    // setFullScreen apres show : appele avant, le plein ecran atterrit sur
    // l'ecran courant du compositeur et pas sur celui qu'on vient de cibler.
    customerWindow.setFullScreen(true);

    // Verification du placement REEL, et pas seulement de ce qu'on a demande.
    //
    // Sous Wayland, un client n'a PAS le droit de positionner ses fenetres :
    // les x/y passes au constructeur sont ignores par le compositeur, et le
    // plein ecran s'applique a l'ecran ou il a decide de la poser. La fenetre
    // se retrouve alors sur l'ecran de la caisse, par-dessus le POS, alors que
    // les logs annoncent l'ecran client. Sans ce controle, l'ecart est
    // invisible a distance — il faut quelqu'un devant la caisse pour le voir.
    //
    // Sous X11/XWayland les deux ecrans forment un seul espace et le
    // positionnement fonctionne.
    setTimeout(() => {
      if (customerWindow.isDestroyed()) return;
      const reel = customerWindow.getBounds();
      const ecartX = Math.abs(reel.x - ecran.x);
      const ecartY = Math.abs(reel.y - ecran.y);
      if (ecartX > 8 || ecartY > 8) {
        log.warn(
          `[CUSTOMER] PLACEMENT IGNORE : demande ${ecran.x},${ecran.y} ` +
            `-> obtenu ${reel.x},${reel.y}. Typique de Wayland, qui interdit a ` +
            `un client de se positionner. Relancer avec --ozone-platform=x11.`,
        );
      } else {
        log.info(
          `[CUSTOMER] placement confirme a ${reel.x},${reel.y} ` +
            `(${reel.width}x${reel.height})`,
        );
      }
    }, 1200);
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

  // Sequence, et PAS deux chargements concurrents : l'ecran d'attente d'abord,
  // affiche des qu'il est pret, la page client ensuite. Lances en parallele,
  // les deux se couraient apres et `ready-to-show` partait pour celui qui
  // gagnait — l'attente n'apparaissait alors jamais, ce qui vide de son sens
  // le fait de l'avoir.
  customerWindow
    .loadURL(IDLE_URL)
    .then(() => {
      if (!urlClient || customerWindow.isDestroyed()) return;
      // Le fond bascule AVANT le chargement : la page distante s'affichera
      // donc sur le fond qu'elle attend, et pas sur celui de l'attente.
      const fond = fondPage || FOND_PAGE_DEFAUT;
      customerWindow.setBackgroundColor(fond);
      log.debug(`[CUSTOMER] chargement de la page client (fond ${fond})`);
      return customerWindow.loadURL(urlClient).catch((err) => {
        // Le repli est deja gere par did-fail-load : l'attente reste affichee.
        log.warn(`[CUSTOMER] page client KO: ${err.message}`);
      });
    })
    .catch((err) => {
      log.error(`[CUSTOMER] ecran d'attente KO: ${err.message}`);
    });

  return customerWindow;
};

module.exports.IDLE_URL = IDLE_URL;
module.exports.FOND_PAGE_DEFAUT = FOND_PAGE_DEFAUT;
