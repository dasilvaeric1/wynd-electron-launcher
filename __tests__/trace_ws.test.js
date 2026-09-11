/**
 * Capture WebSocket dans la trace.
 *
 * Les WS n'utilisent pas la famille d'events CDP des requetes HTTP : sans les
 * `Network.webSocket*`, tout le trafic temps reel du POS (socket.io, relais
 * central) etait invisible dans la trace — alors que c'est lui qui explique une
 * caisse figee.
 *
 * On verifie ici le contrat qui rend ca tenable en volume ET en confidentialite :
 * cycle de vie + compteurs, jamais de charge utile.
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

  test("ne transporte aucune charge utile", () => {
    const out = slimWs({ ...raw, payloadData: '{"pan":"497011112222"}' });
    expect(out).not.toHaveProperty("payloadData");
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
