/**
 * trace_recorder — orchestration des chunks.
 *
 * Le découpage est piloté depuis le main (stop → take → start) plutôt que par
 * `checkoutEveryNms` de rrweb : ce test verrouille les quatre comportements
 * dont tout le reste dépend — rotation à l'échéance, pause sur inactivité,
 * reprise avec un nouveau snapshot, et détection du rechargement du POS.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../src/main/helpers/get_asset", () => () => "/fake/rrweb.js");

// On ne remplace QUE la lecture du bundle rrweb : mocker `fs` en entier casse
// jest lui-meme, qui s'en sert pour resoudre les modules.
jest.mock("fs", () => {
  const real = jest.requireActual("fs");
  return {
    ...real,
    readFileSync: (p, ...rest) =>
      p === "/fake/rrweb.js"
        ? "/* bundle rrweb */"
        : real.readFileSync(p, ...rest),
  };
});

const { createRecorder } = require("../src/main/helpers/trace_recorder");

const CFG = {
  chunkSeconds: 300,
  idlePauseSeconds: 60,
  mousemoveMs: 150,
  maskAllInputs: true,
  maskTextClass: "el-mask",
  blockClass: "el-norec",
};

/**
 * Faux webContents qui interprète les scripts injectés. `lastAct` et `alive`
 * sont pilotés par le test pour simuler l'activité caissier et un reload.
 */
function makeFakePos({ id = 1 } = {}) {
  const state = {
    id,
    alive: true,
    buffered: 0,
    lastAct: Date.now(),
    calls: [],
    starts: 0,
    stops: 0,
  };

  const wc = {
    id,
    isDestroyed: () => false,
    executeJavaScript: jest.fn(async (src) => {
      state.calls.push(src);

      if (src.includes("window.__elTrace = T;")) return "ok";
      if (src === "!!window.__elTrace") return state.alive;
      // ⚠️ Ordre significatif : le script de rotation contient `T.start();`,
      // il doit donc être reconnu AVANT la branche générique `.start(`.
      if (src.includes("T.stop();") && src.includes("T.start();")) {
        // rotation atomique : stop → take → start
        state.stops += 1;
        state.starts += 1;
        const n = state.buffered;
        state.buffered = 1; // snapshot du chunk suivant
        return { events: new Array(n).fill({ e: 1 }), redux: [], dropped: 0, lastAct: state.lastAct, running: true };
      }
      if (src.includes("T.stop();")) {
        // pause : stop → take
        state.stops += 1;
        const n = state.buffered;
        state.buffered = 0;
        return { events: new Array(n).fill({ e: 1 }), redux: [], dropped: 0, lastAct: state.lastAct, running: false };
      }
      if (src.includes(".start(")) {
        state.starts += 1;
        state.buffered += 1; // le start réémet un snapshot complet
        return "ok";
      }
      if (src.includes(".peek();")) {
        return { n: state.buffered, lastAct: state.lastAct, running: true };
      }
      if (src.includes(".take();")) {
        const n = state.buffered;
        state.buffered = 0;
        return { events: new Array(n).fill({ e: 1 }), redux: [{ type: "SCAN_ITEM" }], dropped: 0, lastAct: state.lastAct, running: true };
      }
      return null;
    }),
  };

  return { wc, state };
}

function setup(cfgOverrides = {}) {
  const { wc, state } = makeFakePos();
  const chunks = [];
  const partials = [];
  const recorder = createRecorder({
    cfg: { ...CFG, ...cfgOverrides },
    getWebContents: () => (state.alive ? wc : wc),
    onChunk: (c) => chunks.push(c),
    onPartial: (p) => partials.push(p),
  });
  return { recorder, wc, state, chunks, partials };
}

test("starting the recorder installs the hook and starts rrweb", async () => {
  const { recorder, state } = setup();
  await recorder.start();

  expect(state.starts).toBe(1);
  expect(recorder.isRunning()).toBe(true);
  await recorder.stop();
});

test("an interval tick drains the buffer into the partial chunk", async () => {
  const { recorder, state, partials, chunks } = setup();
  await recorder.start();
  state.buffered = 5;

  await recorder.tick();

  expect(partials).toHaveLength(1);
  expect(partials[0].events).toHaveLength(5);
  // Les actions Redux suivent le même drain → chapitrage du replay.
  expect(partials[0].redux).toEqual([{ type: "SCAN_ITEM" }]);
  expect(chunks).toHaveLength(0);
  await recorder.stop();
});

test("the chunk rotates once its wall-clock duration elapses", async () => {
  // 0s de chunk → la première échéance est déjà dépassée.
  const { recorder, state, chunks } = setup({ chunkSeconds: 0 });
  await recorder.start();
  state.buffered = 3;

  await recorder.tick();

  expect(chunks).toHaveLength(1);
  expect(chunks[0].reason).toBe("interval");
  expect(chunks[0].events).toHaveLength(3);
  // Un nouveau start a suivi → le chunk suivant commence par un snapshot.
  expect(state.starts).toBe(2);
  await recorder.stop();
});

test("an idle till pauses the capture and closes its chunk", async () => {
  const { recorder, state, chunks } = setup({ idlePauseSeconds: 1 });
  await recorder.start();
  state.buffered = 2;
  state.lastAct = Date.now() - 5_000; // aucune interaction depuis 5s

  await recorder.tick();

  expect(recorder.isPaused()).toBe(true);
  expect(chunks).toHaveLength(1);
  expect(chunks[0].reason).toBe("idle");
  await recorder.stop();
});

test("a touch after a pause resumes with a fresh full snapshot", async () => {
  const { recorder, state } = setup({ idlePauseSeconds: 1 });
  await recorder.start();
  state.lastAct = Date.now() - 5_000;
  await recorder.tick();
  expect(recorder.isPaused()).toBe(true);

  const startsWhilePaused = state.starts;
  state.lastAct = Date.now(); // le caissier touche l'écran
  await recorder.tick();

  expect(recorder.isPaused()).toBe(false);
  // Un start supplémentaire = un nouveau snapshot complet : le replay reprend
  // sur un DOM exact, pas sur un état divergent.
  expect(state.starts).toBe(startsWhilePaused + 1);
  await recorder.stop();
});

test("a POS reload closes the chunk and reinstalls the hook", async () => {
  const { recorder, state, chunks } = setup();
  await recorder.start();
  const startsBefore = state.starts;

  state.alive = false; // la page a rechargé, window.__elTrace a disparu
  await recorder.tick();

  expect(chunks).toHaveLength(1);
  expect(chunks[0].reason).toBe("reload");
  expect(state.starts).toBe(startsBefore + 1);
  await recorder.stop();
});

test("stopping closes the chunk in flight", async () => {
  const { recorder, state, chunks } = setup();
  await recorder.start();
  state.buffered = 4;

  await recorder.stop();

  expect(chunks).toHaveLength(1);
  expect(chunks[0].reason).toBe("stop");
  expect(chunks[0].events).toHaveLength(4);
  expect(recorder.isRunning()).toBe(false);
});

test("the injected recorder is tuned for touch screens", async () => {
  const { recorder, state } = setup({ mousemoveMs: 150 });
  await recorder.start();

  const install = state.calls.find((c) => c.includes("window.__elTrace = T;"));
  // mousemove gouverne aussi les touchmove ; les taps ne sont jamais échantillonnés.
  expect(install).toContain("mousemove: o.mousemoveMs");
  expect(install).toContain("mouseInteraction: true");
  // Réglages anti-volume.
  expect(install).toContain("slimDOMOptions: 'all'");
  expect(install).toContain("inlineImages: false");
  expect(install).toContain("collectFonts: false");

  const start = state.calls.find((c) => c.includes(".start({"));
  expect(start).toContain('"mousemoveMs":150');
  expect(start).toContain('"maskAllInputs":true');
  await recorder.stop();
});
