/**
 * Filtrage réseau de la trace continue.
 *
 * Régression constatée sur un vrai POS : une seule URL `data:image/svg+xml`
 * émise par react-dom pesait 12,6 Ko dans `network.json`, soit plus de la
 * moitié du chunk compressé. Ces schémas ne traversent pas le réseau et
 * portent leur charge utile dans l'URL elle-même : les garder fait grossir la
 * trace sans rien apprendre.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/el-test",
    getVersion: () => "2.8.0",
  },
  session: {
    defaultSession: {
      webRequest: { onCompleted: jest.fn(), onErrorOccurred: jest.fn() },
    },
  },
  webContents: { getAllWebContents: () => [] },
}));

const { slimNet, isNetworkWorthKeeping } = require("../src/main/trace");

const net = (url, extra = {}) => ({ type: "net", url, method: "GET", ...extra });

describe("isNetworkWorthKeeping", () => {
  test("garde les vraies requêtes réseau", () => {
    expect(isNetworkWorthKeeping(net("https://pos.example/api/cart"))).toBe(true);
    expect(isNetworkWorthKeeping(net("http://localhost:9963/plugins"))).toBe(true);
    expect(isNetworkWorthKeeping(net("wss://central/relay"))).toBe(true);
  });

  test("écarte les schémas qui ne traversent pas le réseau", () => {
    expect(isNetworkWorthKeeping(net("data:image/svg+xml,%3csvg…"))).toBe(false);
    expect(isNetworkWorthKeeping(net("blob:https://pos.example/abc"))).toBe(false);
    expect(isNetworkWorthKeeping(net("javascript:void(0)"))).toBe(false);
    expect(isNetworkWorthKeeping(net("about:blank"))).toBe(false);
  });

  test("le filtre est insensible à la casse du schéma", () => {
    expect(isNetworkWorthKeeping(net("DATA:image/png;base64,AAAA"))).toBe(false);
  });

  test("écarte ce qui n'est pas un event réseau", () => {
    expect(isNetworkWorthKeeping(null)).toBe(false);
    expect(isNetworkWorthKeeping({ type: "console" })).toBe(false);
    expect(isNetworkWorthKeeping({ type: "net" })).toBe(true); // url absente → pas un schéma exclu
  });
});

describe("slimNet", () => {
  test("ne retient que des métadonnées, jamais les corps", () => {
    const out = slimNet(
      net("https://pos.example/api/cart", {
        status: 500,
        statusText: "Server Error",
        durationMs: 42,
        resourceType: "XHR",
        reqBody: "{secret:1}",
        resBody: "{pan:'4970…'}",
      }),
    );
    expect(out).not.toHaveProperty("reqBody");
    expect(out).not.toHaveProperty("resBody");
    expect(out.status).toBe(500);
    expect(out.durationMs).toBe(42);
  });

  test("borne les URL trop longues", () => {
    const long = "https://pos.example/x?q=" + "a".repeat(2000);
    const out = slimNet(net(long));
    expect(out.url.length).toBeLessThanOrEqual(513); // 512 + ellipse
    expect(out.url.endsWith("…")).toBe(true);
  });

  test("laisse les URL normales intactes", () => {
    const url = "https://pos.example/api/cart";
    expect(slimNet(net(url)).url).toBe(url);
  });

  test("tolère une url absente", () => {
    expect(slimNet({ type: "net", method: "GET" }).url).toBe("");
  });
});
