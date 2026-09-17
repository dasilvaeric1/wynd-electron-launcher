const {
  applyConfiguredSwitches,
  removeUnsafeSwitches,
} = require("../src/main/helpers/commandline_switches");
const fs = require("fs");
const path = require("path");

// `ignore-certificate-errors` a ete bloque de 2.8.2 a 2.9.0. Sur une caisse,
// c'est le drapeau qui permet a Chromium d'accepter le certificat AUTO-SIGNE de
// WyndPOSTools : le bloquer coupait la liaison POS <-> materiel cote webview,
// sans qu'aucun remplacant cible ait ete pose. Ce test verrouille le retour en
// arriere, pour qu'un reblocage soit un choix explicite et non une regression.
test("laisse passer ignore-certificate-errors, requis par le certificat auto-signe de WPT", () => {
  const appendSwitch = jest.fn();
  const warn = jest.fn();

  applyConfiguredSwitches(
    { appendSwitch },
    {
      "ignore-certificate-errors": "true",
      "disable-gpu": "true",
    },
    { info: jest.fn(), warn },
  );

  expect(appendSwitch).toHaveBeenCalledWith("ignore-certificate-errors", "true");
  expect(appendSwitch).toHaveBeenCalledWith("disable-gpu", "true");
  expect(warn).not.toHaveBeenCalled();
});

// La liste des drapeaux bloques est vide : le mecanisme reste en place, mais il
// ne retire plus rien. Ces deux tests documentent ce contrat, pour qu'un
// reblocage se fasse en connaissance de cause plutot que par inadvertance.
test.each([
  "ignore-certificate-errors",
  "ignore-ssl-errors",
])("ne retire plus %s de la ligne de commande", (switchName) => {
  const commandLine = {
    hasSwitch: jest.fn((name) => name === switchName),
    removeSwitch: jest.fn(),
  };
  const warn = jest.fn();

  removeUnsafeSwitches(commandLine, { warn }, ["electron", ".", `--${switchName}=true`]);

  expect(commandLine.removeSwitch).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

test("applique un nom de drapeau quelles que soient sa casse et ses tirets", () => {
  const appendSwitch = jest.fn();

  applyConfiguredSwitches(
    { appendSwitch },
    { "--IGNORE-CERTIFICATE-ERRORS": "true" },
    { info: jest.fn(), warn: jest.fn() },
  );

  expect(appendSwitch).toHaveBeenCalledWith("--IGNORE-CERTIFICATE-ERRORS", "true");
});

test("ignores inherited properties from parsed configuration", () => {
  const appendSwitch = jest.fn();
  const switches = Object.create({ "ignore-certificate-errors": "true" });
  switches["disable-http-cache"] = "true";

  applyConfiguredSwitches(
    { appendSwitch },
    switches,
    { info: jest.fn(), warn: jest.fn() },
  );

  expect(appendSwitch).toHaveBeenCalledTimes(1);
  expect(appendSwitch).toHaveBeenCalledWith("disable-http-cache", "true");
});

test("production scaffold does not disable TLS certificate validation", () => {
  const scaffoldPath = path.join(
    __dirname,
    "..",
    "deploy",
    "scaffold",
    "Electron-Launcher",
    "cfg",
    "config.ini",
  );
  const scaffold = fs.readFileSync(scaffoldPath, "utf8");

  expect(scaffold).not.toMatch(/ignore-(certificate|ssl)-errors/i);
});
test("ozone-platform via config.ini est refuse et signale, pas applique en silence", () => {
  // Mesure sur une caisse Rocky 10 : le drapeau etait journalise comme
  // applique, et le process GPU demarrait quand meme en wayland. Un
  // avertissement vaut mieux qu'une reussite apparente — c'est ce qui a coute
  // le plus de temps a diagnostiquer.
  const appendSwitch = jest.fn();
  const warn = jest.fn();

  applyConfiguredSwitches(
    { appendSwitch },
    { "ozone-platform": "x11", "disable-http-cache": "true" },
    { info: jest.fn(), warn },
  );

  // Le drapeau utile passe, celui qui arrive trop tard est ecarte.
  expect(appendSwitch).toHaveBeenCalledTimes(1);
  expect(appendSwitch).toHaveBeenCalledWith("disable-http-cache", "true");
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("SANS EFFET"));
});
