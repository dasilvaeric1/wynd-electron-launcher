/**
 * net_capture — modèle multi-abonnés (fan-out).
 *
 * Vérifie que la capture réseau supporte plusieurs sinks sur UNE SEULE attache
 * debugger CDP (Electron n'autorise qu'un debugger par webContents), et surtout
 * que l'arrêt de la session de visu (stop) NE COUPE PAS un sink persistant
 * (log fichier) — le point de régression le plus sensible du refactor.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock("electron", () => ({
  session: { defaultSession: { webRequest: { onCompleted: jest.fn(), onErrorOccurred: jest.fn() } } },
  webContents: {},
}));

function makeFakeWc() {
  let msgHandler = null;
  const dbg = {
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn(() => Promise.resolve({})),
    on: jest.fn((ev, cb) => {
      if (ev === "message") msgHandler = cb;
    }),
  };
  return {
    debugger: dbg,
    isDestroyed: () => false,
    session: { webRequest: { onCompleted: jest.fn(), onErrorOccurred: jest.fn() } },
    once: jest.fn(),
    on: jest.fn(),
    // Simule une requête XHR qui échoue → doit produire un event 'net' avec error.
    driveFailure(id, errorText) {
      msgHandler({}, "Network.requestWillBeSent", {
        requestId: id,
        request: { url: "https://api/x", method: "GET", headers: {} },
        type: "XHR",
        timestamp: 1,
      });
      msgHandler({}, "Network.loadingFailed", {
        requestId: id,
        errorText,
        timestamp: 2,
      });
    },
  };
}

let netCapture;
beforeEach(() => {
  jest.resetModules();
  netCapture = require("../src/main/helpers/net_capture");
});

test("un sink abonné reçoit les échecs réseau (CDP)", () => {
  const wc = makeFakeWc();
  const sink = jest.fn();
  netCapture.subscribe(sink, [wc]);
  expect(wc.debugger.attach).toHaveBeenCalled();

  wc.driveFailure("1", "net::ERR_TIMED_OUT");
  expect(sink).toHaveBeenCalledTimes(1);
  const ev = sink.mock.calls[0][0];
  expect(ev.type).toBe("net");
  expect(ev.error).toBe("net::ERR_TIMED_OUT");
  expect(ev.url).toBe("https://api/x");
});

test("session + sink fichier reçoivent tous les deux (une seule attache)", () => {
  const wc = makeFakeWc();
  const fileSink = jest.fn();
  const sessionSink = jest.fn();

  netCapture.subscribe(fileSink, [wc]); // persistant
  netCapture.start([wc], sessionSink); // session BO

  // Le debugger n'est attaché qu'UNE fois (2e attachTarget → déjà attaché).
  expect(wc.debugger.attach).toHaveBeenCalledTimes(1);

  wc.driveFailure("1", "net::ERR_FAILED");
  expect(fileSink).toHaveBeenCalledTimes(1);
  expect(sessionSink).toHaveBeenCalledTimes(1);
});

test("stop() de session ne coupe PAS le sink fichier persistant", () => {
  const wc = makeFakeWc();
  const fileSink = jest.fn();
  const sessionSink = jest.fn();
  netCapture.subscribe(fileSink, [wc]);
  netCapture.start([wc], sessionSink);

  netCapture.stop(); // fin de session de visu

  wc.driveFailure("2", "net::ERR_FAILED");
  expect(sessionSink).not.toHaveBeenCalled(); // session détachée
  expect(fileSink).toHaveBeenCalledTimes(1); // fichier toujours actif
  expect(wc.debugger.detach).not.toHaveBeenCalled(); // debugger conservé
});

test("désabonnement du dernier sink → détache le debugger", () => {
  const wc = makeFakeWc();
  const unsub = netCapture.subscribe(jest.fn(), [wc]);
  unsub();
  expect(wc.debugger.detach).toHaveBeenCalled();
});
