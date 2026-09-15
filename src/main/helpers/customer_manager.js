const fs = require("fs");
const path = require("path");
const { app, screen } = require("electron");

const log = require("./electron_log");
const getScreens = require("./get_screens");
const generateCustomerWindow = require("../customer_window");
const {
  buildCustomerState,
  resolveCustomerScreen,
  MODE,
} = require("../../helpers/customer_display");

/**
 * Pilotage de l'ecran client : ouverture, fermeture, replacement, et reaction
 * au branchement d'un ecran.
 *
 * Le choix manuel fait depuis le panneau lateral est persiste ICI et pas dans
 * config.ini, pour deux raisons :
 *   - config.ini peut etre ecrase en entier par une poussee du BO
 *     (cf on_socket.js) : un choix ecrit la serait perdu sans trace ;
 *   - le reecrire pour une seule cle imposerait de re-serialiser tout le
 *     fichier, donc de perdre les commentaires de l'exploitant.
 *
 * Precedence : choix manuel > config.ini. Meme logique que la trace, ou
 * l'ordre le plus proche de l'operateur gagne.
 */

const FICHIER = () =>
  path.join(app.getPath("userData"), "customer_display.json");

/** Lit le choix manuel. Absent ou illisible = pas de choix. */
function lireChoix() {
  try {
    const brut = JSON.parse(fs.readFileSync(FICHIER(), "utf8"));
    const i = Number(brut.screen);
    return Number.isInteger(i) && i >= 0 ? i : null;
  } catch {
    return null;
  }
}

/** Ecrit le choix manuel. `null` efface et rend la main a config.ini. */
function ecrireChoix(index) {
  try {
    if (index === null) {
      fs.rmSync(FICHIER(), { force: true });
      return;
    }
    fs.writeFileSync(
      FICHIER(),
      JSON.stringify({ screen: index, at: new Date().toISOString() }, null, 2),
    );
  } catch (err) {
    log.warn(`[CUSTOMER] choix non persiste: ${err.message}`);
  }
}

/** Section [customer] effective : config.ini surchargee par le choix manuel. */
function confEffective(store) {
  const base = (store.conf && store.conf.customer) || {};
  const manuel = lireChoix();
  return manuel === null ? base : { ...base, screen: manuel };
}

/** Pousse l'etat au panneau lateral. Sans container, il n'y a personne a qui parler. */
function pousserEtat(store) {
  const win = store.windows.container.current;
  if (!win || win.isDestroyed()) return;
  const etat = buildCustomerState(
    confEffective(store),
    store.screens,
    store.choosen_screen ? store.choosen_screen.id : null,
  );
  etat.manuel = lireChoix() !== null;
  win.webContents.send("customer.state", etat);
}

function fermer(store) {
  const win = store.windows.customer.current;
  if (!win || win.isDestroyed()) return;
  // closable:false empeche close() : destroy() est le seul chemin.
  win.destroy();
  store.windows.customer.current = null;
}

/**
 * Met la fenetre client en accord avec l'etat courant : l'ouvre, la deplace ou
 * la ferme. Idempotent — c'est ce qui permet de l'appeler sur chaque evenement
 * d'ecran sans se demander ce qui a change.
 */
function appliquer(store) {
  const conf = confEffective(store);
  const posIndex = store.choosen_screen ? store.choosen_screen.id : null;
  const resolu = resolveCustomerScreen(conf, store.screens, posIndex);

  if (!resolu.ok) {
    if (store.windows.customer.current) {
      log.info(`[CUSTOMER] fermeture : ${resolu.libelle}`);
      fermer(store);
    } else {
      log.debug(`[CUSTOMER] inactif : ${resolu.libelle}`);
    }
    pousserEtat(store);
    return;
  }

  const { screen: ecran, index } = resolu;
  const existante = store.windows.customer.current;

  if (existante && !existante.isDestroyed()) {
    // Deja ouverte : la replacer suffit, recharger la page ferait clignoter
    // un ecran face client pour rien.
    if (store.windows.customer.screenIndex !== index) {
      log.info(`[CUSTOMER] deplacement vers l'ecran ${index}`);
      existante.setFullScreen(false);
      existante.setBounds({
        x: ecran.x,
        y: ecran.y,
        width: ecran.width,
        height: ecran.height,
      });
      existante.setFullScreen(true);
      store.windows.customer.screenIndex = index;
    }
    pousserEtat(store);
    return;
  }

  log.info(
    `[CUSTOMER] ouverture sur l'ecran ${index} -> ${
      resolu.mode === MODE.PAGE ? conf.url : "ecran d'attente"
    }`,
  );
  // L'url est passee a la fabrique, qui l'enchaine APRES l'ecran d'attente.
  // La charger ici la mettait en concurrence avec l'attente, et l'abandon de
  // celle-ci remontait en erreur alors qu'il etait voulu.
  const win = generateCustomerWindow(
    store,
    ecran,
    resolu.mode === MODE.PAGE ? conf.url : null,
    conf.background || null,
  );
  store.windows.customer.current = win;
  store.windows.customer.screenIndex = index;
  pousserEtat(store);
}

/** Re-enumere les ecrans puis reapplique. C'est le « recheck » du panneau. */
function rafraichir(store) {
  store.screens = getScreens();
  log.info(`[CUSTOMER] ecrans detectes: ${store.screens.length}`);
  const win = store.windows.container.current;
  if (win && !win.isDestroyed()) {
    win.webContents.send("screens", store.screens);
  }
  appliquer(store);
}

/** Choix manuel depuis le panneau. `null` revient a config.ini. */
function choisirEcran(store, index) {
  const i = index === null || index === undefined ? null : Number(index);
  ecrireChoix(i !== null && Number.isInteger(i) && i >= 0 ? i : null);
  log.info(`[CUSTOMER] choix manuel: ${i === null ? "auto (config.ini)" : i}`);
  // Re-enumerer avant d'appliquer : l'operateur choisit souvent juste apres
  // avoir branche l'ecran.
  rafraichir(store);
}

/**
 * Abonne le launcher aux changements d'ecrans.
 *
 * Sans ca, les ecrans n'etaient lus qu'au demarrage : un ecran client branche
 * apres coup, ou dont le pilote s'initialise en retard, n'etait jamais vu et
 * imposait un redemarrage.
 */
function init(store) {
  // Les evenements arrivent en rafale : passer la container en plein ecran
  // modifie la zone de travail, ce qui emet display-metrics-changed, mesure
  // sur la caisse de test a 4 fois dans la meme seconde. `appliquer` est
  // idempotent donc rien ne cassait, mais on re-enumerait les ecrans quatre
  // fois pour rien. Un anti-rebond court replie la rafale en un seul passage.
  let attente = null;
  const surChangement = (quoi) => () => {
    log.info(`[CUSTOMER] ${quoi}`);
    if (attente) clearTimeout(attente);
    attente = setTimeout(() => {
      attente = null;
      rafraichir(store);
    }, 400);
  };
  screen.on("display-added", surChangement("ecran branche"));
  screen.on("display-removed", surChangement("ecran debranche"));
  // Un changement de resolution deplace les bounds : la fenetre client doit
  // suivre, sinon elle deborde ou laisse une bande noire.
  screen.on("display-metrics-changed", surChangement("metriques ecran modifiees"));
  appliquer(store);
}

module.exports = {
  init,
  appliquer,
  rafraichir,
  choisirEcran,
  pousserEtat,
  fermer,
};
