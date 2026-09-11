/**
 * Capture WebSocket dans la trace.
 *
 * Les WS n'utilisent pas la famille d'events CDP des requetes HTTP : sans les
 * `Network.webSocket*`, tout le trafic temps reel du POS (socket.io, relais
 * central) etait invisible dans la trace — alors que c'est lui qui explique une
 * caisse figee.
 *
 * Contrat par defaut : cycle de vie + compteurs, sans charge utile — tenable en
 * volume et en confidentialite. Les corps de trames s'ajoutent en « mode
 * crise » (opt-in), quand c'est le CONTENU d'un message qui fait planter la
 * caisse et qu'un compteur ne suffit plus.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock("electron", () => ({
  app: { getPath: () => "/tmp/el-test", getVersion: () => "2.8.7" },
  session: {
    defaultSession: {
      webRequest: { onCompleted: jest.fn(), onErrorOccurred: jest.fn() },
    },
  },
  webContents: { getAllWebContents: () => [] },
}));

const { socketIoEventName } = require("../src/main/helpers/net_capture");
const { slimWs } = require("../src/main/trace");

describe("nom d'event socket.io", () => {
  test("extrait le nom d'une trame event", () => {
    expect(socketIoEventName('42["priceUpdate",{"sku":"1234"}]')).toBe(
      "priceUpdate",
    );
  });

  test("gere les accuses de reception numerotes", () => {
    expect(socketIoEventName('4213["cartSync",{"lines":3}]')).toBe("cartSync");
  });

  test("ignore les trames de service (ping/pong/open)", () => {
    expect(socketIoEventName("2")).toBeNull();
    expect(socketIoEventName("3")).toBeNull();
    expect(socketIoEventName('0{"sid":"abc"}')).toBeNull();
  });

  test("ignore ce qui n'est pas du socket.io", () => {
    expect(socketIoEventName('{"type":"custom"}')).toBeNull();
    expect(socketIoEventName("")).toBeNull();
    expect(socketIoEventName(undefined)).toBeNull();
  });

  test("ne renvoie jamais la charge utile, seulement le nom", () => {
    const name = socketIoEventName('42["pay",{"pan":"4970111122223333"}]');
    expect(name).toBe("pay");
    expect(name).not.toMatch(/4970/);
  });
});

describe("event ws retenu dans le chunk", () => {
  const raw = {
    type: "ws",
    event: "closed",
    requestId: "r1",
    url: "wss://pos.example/socket.io/?EIO=4&transport=websocket",
    durationMs: 5000,
    sent: 128,
    recv: 340,
    bytesSent: 9210,
    bytesRecv: 88012,
    events: { priceUpdate: 340, cartSync: 12 },
  };

  test("conserve le cycle de vie et les compteurs", () => {
    const out = slimWs(raw);
    expect(out.event).toBe("closed");
    expect(out.sent).toBe(128);
    expect(out.recv).toBe(340);
    expect(out.events).toEqual({ priceUpdate: 340, cartSync: 12 });
  });

  test("un event de cycle de vie ne transporte aucune charge utile", () => {
    // Hors mode crise, seuls cycle de vie et compteurs remontent : le champ
    // brut payloadData du CDP n'est jamais recopie.
    const out = slimWs({ ...raw, payloadData: '{"pan":"497011112222"}' });
    expect(out).not.toHaveProperty("payloadData");
    expect(out.payload).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/4970/);
  });

  test("borne les URL longues comme pour le reste du reseau", () => {
    const long = "wss://pos.example/socket.io?q=" + "a".repeat(2000);
    const out = slimWs({ ...raw, url: long });
    expect(out.url.length).toBeLessThanOrEqual(513);
    expect(out.url.endsWith("…")).toBe(true);
  });

  test("tolere une socket sans compteurs (event de creation)", () => {
    const out = slimWs({ type: "ws", event: "created", url: "wss://x/" });
    expect(out.event).toBe("created");
    expect(out.url).toBe("wss://x/");
  });
});

describe("mode crise : corps des trames", () => {
  const { resolveTraceConfig } = require("../src/main/helpers/trace_config");
  const FUTURE = "2099-01-01T00:00:00Z";

  test("desactive par defaut", () => {
    expect(resolveTraceConfig({ conf: {}, env: {} }).captureWsFrames).toBe(
      false,
    );
  });

  test("activable par config.ini", () => {
    expect(
      resolveTraceConfig({
        conf: { trace: { capture_ws_frames: true } },
        env: {},
      }).captureWsFrames,
    ).toBe(true);
  });

  test("activable a distance, mais l'ordre doit porter une echeance", () => {
    const ok = resolveTraceConfig({
      conf: {},
      env: {},
      remote: { enable: true, wsFrames: true, until: FUTURE },
    });
    expect(ok.captureWsFrames).toBe(true);

    // Sans `until`, l'ordre entier est refuse : une capture de contenu ne doit
    // pas pouvoir rester active indefiniment par oubli.
    const sansEcheance = resolveTraceConfig({
      conf: {},
      env: {},
      remote: { enable: true, wsFrames: true },
    });
    expect(sansEcheance.captureWsFrames).toBe(false);
  });

  test("allow_remote=0 verrouille aussi le mode crise", () => {
    const cfg = resolveTraceConfig({
      conf: { trace: { allow_remote: false } },
      env: {},
      remote: { enable: true, wsFrames: true, until: FUTURE },
    });
    expect(cfg.captureWsFrames).toBe(false);
  });

  test("l'env prime sur l'ordre distant", () => {
    const cfg = resolveTraceConfig({
      conf: {},
      env: { EL_TRACE_WS_FRAMES: "0" },
      remote: { enable: true, wsFrames: true, until: FUTURE },
    });
    expect(cfg.captureWsFrames).toBe(false);
  });

  test("une trame capturee porte son contenu et son sens", () => {
    const out = slimWs({
      type: "ws",
      event: "frame",
      dir: "in",
      name: "priceUpdate",
      payload: '42["priceUpdate",{"sku":"","price":null}]',
      truncated: false,
      url: "wss://pos/socket.io/",
    });
    expect(out.dir).toBe("in");
    expect(out.name).toBe("priceUpdate");
    // Le champ vide qui fait planter la caisse doit etre lisible tel quel.
    expect(out.payload).toContain('"sku":""');
    expect(out.truncated).toBe(false);
  });
});
