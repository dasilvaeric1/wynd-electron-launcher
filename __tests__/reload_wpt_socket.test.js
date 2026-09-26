/**
 * Redemarrage de WPT quand le launcher ne possede pas le process.
 *
 * Sous Linux, WPT est le service systemd wyndpostools, lance sous
 * l'utilisateur systeme `wpt` (nologin). Le launcher ne peut ni le signaler ni
 * le relancer. Il passe donc par le plugin System de WPT : `end` ->
 * endWyndPOSTools() -> SIGHUP + exit(2), et `Restart=always` fait le reste.
 *
 * Deux choses se testent ici, et la seconde est la vraie raison de ce fichier :
 * le succes se lit a la RECONNEXION (WPT meurt avant de pouvoir accuser
 * reception), et un echec doit REJETER — avant, reloadWPT resolvait meme quand
 * tout avait echoue, et le BO recevait END sur un redemarrage qui n'avait pas
 * eu lieu.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));
jest.mock("../src/main/helpers/clear_cache", () => jest.fn());
jest.mock("../src/main/helpers/kill_wpt", () => jest.fn());
jest.mock("../src/main/helpers/create_wpt", () => jest.fn());

const reloadWPT = require("../src/main/helpers/reload_wpt");

/** Socket minimale : on pilote `connected` et on capte les emissions. */
const fakeSocket = () => {
  const handlers = {};
  return {
    connected: true,
    emitted: [],
    emit(event) {
      this.emitted.push(event);
    },
    once(event, fn) {
      handlers[event] = fn;
    },
    removeListener(event) {
      delete handlers[event];
    },
    fire(event, payload) {
      if (handlers[event]) handlers[event](payload);
    },
  };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("chemin socket (process non possede)", () => {
  test("emet `end` et JAMAIS `restart` — ce dernier vaut reboot -f", async () => {
    const socket = fakeSocket();
    const p = reloadWPT({ process: null, socket }, {});

    await Promise.resolve();
    expect(socket.emitted).toEqual(["end"]);
    expect(socket.emitted).not.toContain("restart");
    expect(socket.emitted).not.toContain("shutdown");

    socket.connected = false;
    jest.advanceTimersByTime(250);
    socket.connected = true;
    jest.advanceTimersByTime(250);

    const result = await p;
    expect(result.mode).toBe("socket");
    expect(result.reconnected).toBe(true);
  });

  test("le succes exige la coupure PUIS le retour", async () => {
    const socket = fakeSocket();
    const p = reloadWPT({ process: null, socket }, {});
    const issue = jest.fn();
    p.then(issue, issue);

    // Socket jamais tombee : WPT n'a pas pris l'ordre en compte.
    jest.advanceTimersByTime(19_000);
    await Promise.resolve();
    expect(issue).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    await expect(p).rejects.toThrow(/n'a pas reagi/);
  });

  test("arret constate mais pas de retour : erreur explicite", async () => {
    const socket = fakeSocket();
    const p = reloadWPT({ process: null, socket }, {});
    await Promise.resolve();

    socket.connected = false;
    jest.advanceTimersByTime(21_000);

    await expect(p).rejects.toThrow(/n'est pas revenu/);
  });

  test("end.error (plugin System muet) : erreur immediate et parlante", async () => {
    const socket = fakeSocket();
    const p = reloadWPT({ process: null, socket }, {});
    await Promise.resolve();

    socket.fire("end.error", { code: "PLUGIN_NOT_STARTED" });

    await expect(p).rejects.toThrow(/plugin System/);
  });

  test("socket absente : on le dit, au lieu d'attendre 20 s", async () => {
    await expect(reloadWPT({ process: null, socket: null }, {})).rejects.toThrow(
      /aucune socket connectee/,
    );
  });
});

describe("chemin process (Windows) inchange", () => {
  test("un echec des deux branches REJETTE au lieu de resoudre", async () => {
    const killWPT = require("../src/main/helpers/kill_wpt");
    killWPT.mockRejectedValue(new Error("kill KO"));

    // confWpt sans path/cwd : la branche de relance echoue aussi.
    await expect(
      reloadWPT({ process: { pid: 42 }, socket: null }, {}),
    ).rejects.toThrow();
  });
});
