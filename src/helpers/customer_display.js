/**
 * Ecran client : quel display utiliser, et pourquoi.
 *
 * Module PUR et partage (main + renderer) : aucune dependance Electron, pour
 * que la decision se teste sans fenetre ni ecran physique.
 *
 * La regle differe volontairement de `choose_screen.js`, qui retombe en silence
 * sur l'ecran 0 quand l'index demande n'existe pas. Ici un repli silencieux
 * poserait la page CLIENT par-dessus la caisse : le caissier perdrait son POS
 * sans comprendre pourquoi. On prefere ne pas ouvrir et le dire.
 */

/** Raisons pour lesquelles l'ecran client n'est pas affiche. */
const RAISON = {
  DISABLED: "disabled",
  SINGLE_SCREEN: "single_screen",
  SCREEN_MISSING: "screen_missing",
  SAME_AS_POS: "same_as_pos",
};

/**
 * Ce que la fenetre affiche.
 *   page — la page client configuree ;
 *   idle — l'ecran d'attente Octipas, faute d'url.
 *
 * L'absence d'url n'empeche PLUS d'ouvrir : un ecran noir face au public est
 * pire qu'une attente de marque. L'ecran d'attente sert aussi de repli pendant
 * le chargement de la page et si elle devient injoignable.
 */
const MODE = { PAGE: "page", IDLE: "idle" };

/**
 * Libelles caissier. Le panneau lateral n'a pas la place d'une phrase, et le
 * technicien qui vient brancher l'ecran doit comprendre sans ouvrir les logs.
 */
const LIBELLE = {
  [RAISON.DISABLED]: "Désactivé dans la configuration",
  [RAISON.SINGLE_SCREEN]: "Un seul écran détecté",
  [RAISON.SCREEN_MISSING]: "L'écran choisi n'est pas branché",
  [RAISON.SAME_AS_POS]: "Écran déjà utilisé par la caisse",
};

/**
 * Identifiant stable d'un display.
 *
 * `getAllDisplays()` renvoie un `id` systeme, mais il change au rebranchement
 * sur certaines configurations ; l'index de tableau, lui, bouge des qu'un ecran
 * disparait. On expose les deux : l'index sert a la config (lisible, ecrit a la
 * main dans config.ini), l'id sert a re-retrouver le meme ecran apres un
 * rebranchement.
 */
function cleEcran(ecran) {
  return ecran && ecran.id !== undefined && ecran.id !== null
    ? String(ecran.id)
    : null;
}

/**
 * Met les ecrans en forme pour l'interface.
 *
 * @param {Array} screens        sortie de get_screens (width/height/x/y/id)
 * @param {number|null} posIndex index de l'ecran occupe par la caisse
 * @param {number|null} clientIndex index retenu pour l'ecran client
 */
function describeScreens(screens, posIndex, clientIndex) {
  if (!Array.isArray(screens)) return [];
  return screens.map((ecran, index) => ({
    index,
    id: cleEcran(ecran),
    width: ecran.width,
    height: ecran.height,
    x: ecran.x,
    y: ecran.y,
    // `principal` au sens de l'OS : celui dont l'origine est (0,0).
    principal: ecran.x === 0 && ecran.y === 0,
    role:
      index === posIndex ? "pos" : index === clientIndex ? "client" : "libre",
  }));
}

/**
 * Decide de l'ecran client.
 *
 * @param {object} conf   section [customer] de config.ini
 * @param {Array} screens ecrans disponibles a l'instant t
 * @param {number} posIndex index de l'ecran de la caisse
 * @returns {{ok: boolean, index: number|null, screen: object|null,
 *            raison: string|null, libelle: string|null}}
 */
function resolveCustomerScreen(conf, screens, posIndex) {
  const ko = (raison) => ({
    ok: false,
    index: null,
    screen: null,
    mode: null,
    raison,
    libelle: LIBELLE[raison],
  });

  if (!conf || conf.enable === false) return ko(RAISON.DISABLED);

  const liste = Array.isArray(screens) ? screens : [];
  if (liste.length < 2) return ko(RAISON.SINGLE_SCREEN);

  // `screen` peut valoir 0 : ne pas le confondre avec absent.
  const demande =
    conf.screen === undefined || conf.screen === null
      ? null
      : Number(conf.screen);

  // Sans choix explicite, le premier ecran qui n'est pas celui de la caisse.
  // C'est le cas d'une caisse a deux ecrans, de loin le plus frequent, et ca
  // evite d'imposer un reglage pour la configuration la plus courante.
  const index =
    demande === null || Number.isNaN(demande)
      ? liste.findIndex((_e, i) => i !== posIndex)
      : demande;

  if (index < 0 || index >= liste.length) return ko(RAISON.SCREEN_MISSING);
  if (index === posIndex) return ko(RAISON.SAME_AS_POS);

  return {
    ok: true,
    index,
    screen: liste[index],
    mode: conf.url ? MODE.PAGE : MODE.IDLE,
    raison: null,
    libelle: null,
  };
}

/**
 * Etat complet pousse au renderer : ce qui est affiche, ou, et la liste des
 * ecrans pour permettre un choix manuel.
 */
function buildCustomerState(conf, screens, posIndex) {
  const resolu = resolveCustomerScreen(conf, screens, posIndex);
  return {
    ok: resolu.ok,
    mode: resolu.mode,
    raison: resolu.raison,
    libelle: resolu.libelle,
    url: (conf && conf.url) || null,
    posIndex: posIndex === undefined ? null : posIndex,
    clientIndex: resolu.index,
    screens: describeScreens(screens, posIndex, resolu.index),
  };
}

module.exports = {
  RAISON,
  MODE,
  LIBELLE,
  describeScreens,
  resolveCustomerScreen,
  buildCustomerState,
};
