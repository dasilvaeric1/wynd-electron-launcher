const wptBaseUrl = require("../src/main/helpers/wpt_base_url");

describe("wptBaseUrl", () => {
  it("retire le slash final", () => {
    expect(wptBaseUrl({ conf: { wpt: { url: { href: "https://x:1/" } } } })).toBe(
      "https://x:1",
    );
  });

  it("retire une serie de slashes, sans regex super-lineaire", () => {
    expect(
      wptBaseUrl({ conf: { wpt: { url: { href: "https://x:1////" } } } }),
    ).toBe("https://x:1");
  });

  it("laisse intacte une url deja propre", () => {
    expect(wptBaseUrl({ conf: { wpt: { url: { href: "https://x:1" } } } })).toBe(
      "https://x:1",
    );
  });

  it("retombe sur le defaut quand la conf ne porte pas d url", () => {
    expect(wptBaseUrl({})).toBe("http://127.0.0.1:9963");
    expect(wptBaseUrl(null)).toBe("http://127.0.0.1:9963");
    expect(wptBaseUrl({ conf: { wpt: {} } })).toBe("http://127.0.0.1:9963");
  });

  it("respecte le defaut fourni par l appelant", () => {
    // ipc.js et le tunnel n'ont pas le meme repli historique : le parametre
    // evite de changer le comportement de l'un en factorisant l'autre.
    expect(wptBaseUrl({}, "http://localhost:9963")).toBe("http://localhost:9963");
  });

  it("ne renvoie pas une chaine vide sur une url faite de slashes", () => {
    expect(wptBaseUrl({ conf: { wpt: { url: { href: "///" } } } })).toBe("");
  });
});
