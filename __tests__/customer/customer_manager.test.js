/**
 * customer_manager — ouverture, deplacement, fermeture et persistance du choix.
 *
 * La logique de DECISION est testee a part (customer_display.test.js, pure).
 * Ici on verifie l'effet de bord : est-ce qu'une fenetre est bien creee, une
 * seule fois, deplacee plutot que recreee, et fermee quand l'ecran disparait.
 * C'est exactement ce qu'un test pur ne peut pas couvrir, et c'est la ou une
 * regression serait invisible jusqu'a la caisse.
 */

const path = require("path");
const os = require("os");
const fs = require("fs");

jest.mock("../../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// Prefixe `mock` obligatoire : jest hisse les fabriques jest.mock au-dessus
// des declarations et n'autorise que ces noms-la en reference.
// Dossier userData jetable : la persistance du choix manuel ecrit un fichier.
const mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), "el-customer-"));

const mockEcrans = { liste: [] };
const mockAbonnements = {};

jest.mock("electron", () => ({
  app: { getPath: () => mockUserData },
  screen: {
    getAllDisplays: () => mockEcrans.liste,
    on: (ev, cb) => {
      mockAbonnements[ev] = cb;
    },
  },
  BrowserWindow: jest.fn(),
}));

// La fabrique de fenetre est remplacee : on ne teste pas Electron, on teste
// qu'on l'appelle au bon moment avec les bonnes bornes.
const mockFenetres = [];
jest.mock("../../src/main/customer_window", () => {
  const fabrique = jest.fn((_store, ecran) => {
    const win = {
      bounds: { ...ecran },
      detruite: false,
      isDestroyed: () => win.detruite,
      destroy: jest.fn(() => {
        win.detruite = true;
      }),
      setBounds: jest.fn((b) => {
        win.bounds = b;
      }),
      setFullScreen: jest.fn(),
      loadURL: jest.fn(() => Promise.resolve()),
    };
    mockFenetres.push(win);
    return win;
  });
  fabrique.IDLE_URL = "file:///idle";
  return fabrique;
});

const manager = require("../../src/main/helpers/customer_manager");
const fabriqueFenetre = require("../../src/main/customer_window");

// Deux formes cohabitent, et les confondre casse tout :
//   - `display()` = ce que rend screen.getAllDisplays() (size/bounds imbriques) ;
//   - `ecran()`   = ce que rend getScreens() apres aplatissement.
// getScreens() est volontairement laisse REEL dans ces tests : c'est lui qui
// fait la conversion, et une regression la dedans serait invisible autrement.
const display = (over = {}) => {
	const e = { width: 1920, height: 1080, x: 0, y: 0, ...over };
	return { size: { width: e.width, height: e.height }, bounds: { x: e.x, y: e.y } };
};
const ecran = (over = {}) => ({ width: 1920, height: 1080, x: 0, y: 0, ...over });

const envoyes = [];
function makeStore(customer, nbEcrans = 2) {
  mockEcrans.liste = [display(), display({ x: 1920 })].slice(0, nbEcrans);
  return {
    conf: { customer },
    screens: mockEcrans.liste.map((d) => ({
      width: d.size.width, height: d.size.height, x: d.bounds.x, y: d.bounds.y,
    })),
    choosen_screen: { id: 0, ...ecran() },
    windows: {
      container: {
        current: {
          isDestroyed: () => false,
          webContents: { send: (canal, data) => envoyes.push({ canal, data }) },
        },
      },
      customer: { current: null, screenIndex: null },
    },
  };
}

beforeEach(() => {
  mockFenetres.length = 0;
  envoyes.length = 0;
  fabriqueFenetre.mockClear();
  fs.rmSync(path.join(mockUserData, "customer_display.json"), { force: true });
});

afterAll(() => {
  fs.rmSync(mockUserData, { recursive: true, force: true });
});

describe("ouverture", () => {
  it("n ouvre rien quand la section est desactivee", () => {
    manager.appliquer(makeStore({ enable: false }));
    expect(fabriqueFenetre).not.toHaveBeenCalled();
  });

  it("n ouvre rien sur un seul ecran", () => {
    manager.appliquer(makeStore({ enable: true, url: "http://c" }, 1));
    expect(fabriqueFenetre).not.toHaveBeenCalled();
  });

  it("ouvre sur l ecran libre et y charge la page", () => {
    const store = makeStore({ enable: true, url: "http://c" });
    manager.appliquer(store);
    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
    // Bornes de l'ecran 1, pas de l'ecran 0 qui porte la caisse.
    expect(fabriqueFenetre.mock.calls[0][1].x).toBe(1920);
    expect(mockFenetres[0].loadURL).toHaveBeenCalledWith("http://c");
  });

  it("ouvre sans charger d url en mode attente", () => {
    // La fenetre affiche deja l'ecran d'attente : un loadURL de plus le
    // remplacerait par lui-meme et ferait clignoter l'ecran.
    manager.appliquer(makeStore({ enable: true }));
    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
    expect(mockFenetres[0].loadURL).not.toHaveBeenCalled();
  });

  it("est idempotent : deux appels ne creent qu une fenetre", () => {
    const store = makeStore({ enable: true, url: "http://c" });
    manager.appliquer(store);
    manager.appliquer(store);
    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
  });
});

describe("deplacement et fermeture", () => {
  it("deplace au lieu de recreer quand l ecran choisi change", () => {
    const store = makeStore({ enable: true, url: "http://c" });
    manager.appliquer(store);
    const win = mockFenetres[0];

    store.conf.customer.screen = 0;
    store.choosen_screen = { id: 1, ...ecran({ x: 1920 }) };
    manager.appliquer(store);

    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
    expect(win.setBounds).toHaveBeenCalled();
    expect(win.bounds.x).toBe(0);
    // Recharger la page ferait clignoter un ecran face client pour rien.
    expect(win.loadURL).toHaveBeenCalledTimes(1);
  });

  it("ferme la fenetre quand le second ecran disparait", () => {
    const store = makeStore({ enable: true, url: "http://c" });
    manager.appliquer(store);
    const win = mockFenetres[0];

    store.screens = [ecran()];
    manager.appliquer(store);

    expect(win.destroy).toHaveBeenCalled();
    expect(store.windows.customer.current).toBeNull();
  });
});

describe("choix manuel", () => {
  it("gagne sur config.ini et survit au redemarrage", () => {
    const store = makeStore({ enable: true, url: "http://c", screen: 1 }, 3);
    mockEcrans.liste = [display(), display({ x: 1920 }), display({ x: 3840 })];
    store.screens = [ecran(), ecran({ x: 1920 }), ecran({ x: 3840 })];

    manager.choisirEcran(store, 2);
    expect(store.windows.customer.screenIndex).toBe(2);

    // Le fichier est le mecanisme de survie : sans lui le technicien devrait
    // refaire son choix a chaque demarrage.
    const fichier = path.join(mockUserData, "customer_display.json");
    expect(JSON.parse(fs.readFileSync(fichier, "utf8")).screen).toBe(2);
  });

  it("rend la main a config.ini quand on l efface", () => {
    const store = makeStore({ enable: true, url: "http://c", screen: 1 }, 3);
    mockEcrans.liste = [display(), display({ x: 1920 }), display({ x: 3840 })];
    store.screens = [ecran(), ecran({ x: 1920 }), ecran({ x: 3840 })];

    manager.choisirEcran(store, 2);
    manager.choisirEcran(store, null);

    expect(store.windows.customer.screenIndex).toBe(1);
    expect(fs.existsSync(path.join(mockUserData, "customer_display.json"))).toBe(false);
  });
});

describe("branchement a chaud", () => {
  it("s abonne aux trois evenements d ecran", () => {
    manager.init(makeStore({ enable: false }));
    expect(Object.keys(mockAbonnements).sort()).toEqual([
      "display-added",
      "display-metrics-changed",
      "display-removed",
    ]);
  });

  it("ouvre la fenetre au branchement d un second ecran", () => {
    // Le cas qui imposait un redemarrage avant : le launcher demarre sur un
    // seul ecran, le technicien branche l'ecran client ensuite.
    jest.useFakeTimers();
    const store = makeStore({ enable: true, url: "http://c" }, 1);
    manager.init(store);
    expect(fabriqueFenetre).not.toHaveBeenCalled();

    mockEcrans.liste = [display(), display({ x: 1920 })];
    mockAbonnements["display-added"]();
    jest.advanceTimersByTime(500);

    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("replie une rafale d evenements en un seul rafraichissement", () => {
    // Mesure sur la caisse : passer la container en plein ecran emet
    // display-metrics-changed 4 fois dans la meme seconde.
    jest.useFakeTimers();
    const store = makeStore({ enable: true, url: "http://c" }, 1);
    manager.init(store);
    fabriqueFenetre.mockClear();

    mockEcrans.liste = [display(), display({ x: 1920 })];
    for (let i = 0; i < 4; i += 1) mockAbonnements["display-metrics-changed"]();
    jest.advanceTimersByTime(500);

    expect(fabriqueFenetre).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe("etat pousse au panneau", () => {
  it("expose la liste des ecrans meme quand rien ne s affiche", () => {
    // C'est exactement le moment ou l'operateur en a besoin pour en choisir un.
    manager.appliquer(makeStore({ enable: true, url: "http://c" }, 1));
    const etat = envoyes.filter((e) => e.canal === "customer.state").pop();
    expect(etat.data.ok).toBe(false);
    expect(etat.data.screens).toHaveLength(1);
  });
});
