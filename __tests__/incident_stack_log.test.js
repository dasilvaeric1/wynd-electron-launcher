/**
 * Le signalement d'anomalie joint le journal de demarrage de la stack.
 *
 * C'est souvent le journal qui MANQUE au support : quand WSL ne repart pas,
 * le launcher n'a rien a raconter — il n'a meme pas demarre dans de bonnes
 * conditions. Sans lui, le signalement declenche un aller-retour
 * « pouvez-vous nous envoyer aussi... » qui coute une journee.
 *
 * Ce journal est ecrit par anycommerce.bat, HORS du launcher et avant son
 * demarrage : son chemin est donc resolu, pas lu depuis store.logs.
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");

const {
  stackLogDir,
  buildIncidentZip,
} = require("../src/main/helpers/incident_report");

const PLATFORM = process.platform;
const setPlatform = (value) =>
  Object.defineProperty(process, "platform", { value, configurable: true });

afterEach(() => {
  setPlatform(PLATFORM);
  delete process.env.EL_STACK_LOG_DIR;
});

describe("resolution du dossier", () => {
  test("chemin Retail sur Windows", () => {
    setPlatform("win32");
    expect(stackLogDir()).toBe(String.raw`C:\Retail\ANYCOMMERCE\logs`);
  });

  test("rien hors Windows : aucun script n'ecrit ce journal ailleurs", () => {
    setPlatform("linux");
    expect(stackLogDir()).toBeNull();
  });

  test("EL_STACK_LOG_DIR prime, y compris hors Windows", () => {
    setPlatform("linux");
    process.env.EL_STACK_LOG_DIR = "/var/log/retail";
    expect(stackLogDir()).toBe("/var/log/retail");
  });
});

describe("contenu du ZIP", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stacklog-"));
    process.env.EL_STACK_LOG_DIR = dir;
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const entries = async () => {
    const { buf } = await buildIncidentZip({}, "ca ne demarre pas", Date.now());
    return Object.keys(await JSZip.loadAsync(buf).then((z) => z.files));
  };

  test("le journal de stack est joint", async () => {
    fs.writeFileSync(path.join(dir, "stack-20260926.log"), "restart wsl KO");
    expect(await entries()).toContain("logs/stack.log");
  });

  test("le plus recent gagne, la rotation produisant un fichier par jour", async () => {
    const vieux = path.join(dir, "stack-20260901.log");
    const recent = path.join(dir, "stack-20260926.log");
    fs.writeFileSync(vieux, "ancien");
    fs.writeFileSync(recent, "ATTENDU");
    const passe = Date.now() - 86_400_000;
    fs.utimesSync(vieux, passe / 1000, passe / 1000);

    const { buf } = await buildIncidentZip({}, "", Date.now());
    const zip = await JSZip.loadAsync(buf);
    expect(await zip.file("logs/stack.log").async("string")).toBe("ATTENDU");
  });

  test("un dossier vide ne fait pas echouer le signalement", async () => {
    const noms = await entries();
    expect(noms).toContain("report.json");
    expect(noms).not.toContain("logs/stack.log");
  });

  test("un dossier inexistant ne fait pas echouer le signalement", async () => {
    process.env.EL_STACK_LOG_DIR = path.join(dir, "absent");
    expect(await entries()).toContain("report.json");
  });
});
