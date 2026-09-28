/**
 * start.ps1 : nouveau lanceur de caisse, en parallele d'anycommerce.bat.
 *
 * Meme sequence que le .bat (WSL, launcher, apiupdater), mais sans console :
 * un ecran de chargement s'affiche aussitot (WinForms, sous Windows), les
 * redemarrages tournent caches avec leur sortie dans le journal de la stack,
 * et un launcher deja ouvert n'est plus tue.
 *
 * Ces tests executent le vrai script avec pwsh quand il est disponible (poste
 * de dev). Hors Windows, WinForms n'existe pas : le script prend alors son
 * chemin de repli, sans ecran, qui est justement celui qu'on veut prouver.
 * control_center.ps1 et le launcher sont remplaces par des faux qui notent
 * leurs appels dans un fichier de trace.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

const START = path.join(
  __dirname,
  "..",
  "deploy",
  "scaffold",
  "Electron-Launcher",
  "launch",
  "start.ps1"
);

const pwsh = spawnSync("pwsh", ["-v"], { encoding: "utf-8" });
const avecPwsh = pwsh.status === 0 ? test : test.skip;

jest.setTimeout(60_000);

describe("start.ps1 (fichier)", () => {
  test("UTF-8 avec BOM : Windows PowerShell 5.1 lit sinon les accents en ANSI", () => {
    const octets = fs.readFileSync(START);
    expect([...octets.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test("compatible Windows PowerShell 5.1 : ni ??, ni ternaire, ni $IsWindows", () => {
    const code = fs
      .readFileSync(START, "utf-8")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/\?\?/);
    expect(code).not.toMatch(/\$IsWindows/);
    expect(code).not.toMatch(/ForEach-Object\s+-Parallel/);
  });

  avecPwsh("syntaxe PowerShell valide", () => {
    const r = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${START}', [ref]$null, [ref]$e); $e.Count`,
      ],
      { encoding: "utf-8" }
    );
    expect(r.stdout.trim()).toBe("0");
  });
});

describe("create-test-shortcut.ps1", () => {
  const SHORTCUT = path.join(path.dirname(START), "create-test-shortcut.ps1");

  test("UTF-8 avec BOM, et -Restore pour revenir a l'etat d'origine", () => {
    const octets = fs.readFileSync(SHORTCUT);
    expect([...octets.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const s = octets.toString("utf-8");
    expect(s).toMatch(/\[switch\]\$Restore/);
    // Echange au demarrage : l'ancien raccourci est renomme, jamais supprime.
    expect(s).toContain("ChapsPOS.lnk.desactive");
    expect(s).not.toMatch(/Remove-Item[^\n]*\$Ancien\b/);
  });

  avecPwsh("syntaxe PowerShell valide", () => {
    const r = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${SHORTCUT}', [ref]$null, [ref]$e); $e.Count`,
      ],
      { encoding: "utf-8" }
    );
    expect(r.stdout.trim()).toBe("0");
  });
});

describe("start.ps1 (execution)", () => {
  let dir, trace, logDir, maint, launcher;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "start-ps1-"));
    trace = path.join(dir, "trace.txt");
    logDir = path.join(dir, "logs");
    maint = path.join(dir, "local-stack-maintenance");
    fs.mkdirSync(maint);
    // Faux control_center.ps1 : trace l'appel, parle sur les deux flux,
    // echoue quand FAKE_CC_FAIL vaut l'action demandee.
    fs.writeFileSync(
      path.join(maint, "control_center.ps1"),
      [
        "param([string]$restart)",
        "Add-Content -Path $env:FAKE_TRACE -Value \"cc $restart\"",
        "Write-Output \"sortie de $restart\"",
        "[Console]::Error.WriteLine(\"erreur de $restart\")",
        "if ($env:FAKE_CC_FAIL -eq $restart) { exit 3 }",
        "exit 0",
      ].join("\n")
    );
    // Faux launcher : un executable qui trace ses arguments.
    launcher = path.join(dir, "Electron-Launcher");
    fs.writeFileSync(
      launcher,
      '#!/bin/sh\necho "launcher $*" >> "$FAKE_TRACE"\n'
    );
    fs.chmodSync(launcher, 0o755);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (env = {}, extra = []) =>
    spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        START,
        "-Root",
        dir,
        "-MaintenanceDir",
        maint,
        "-LogDir",
        logDir,
        "-LauncherExe",
        launcher,
        "-LauncherConfig",
        path.join(dir, "config.ini"),
        "-LauncherProcessName",
        "faux-launcher-inexistant",
        "-PowerShellExe",
        "pwsh",
        "-WslWaitSeconds",
        "0",
        ...extra,
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, FAKE_TRACE: trace, ...env },
        timeout: 50_000,
      }
    );

  const lignes = () =>
    fs.existsSync(trace)
      ? fs.readFileSync(trace, "utf-8").trim().split("\n")
      : [];
  const journal = () => {
    const f = fs.readdirSync(logDir).find((n) => /^stack-\d{8}\.log$/.test(n));
    return fs.readFileSync(path.join(logDir, f), "utf-8");
  };

  avecPwsh("avec WSL : wsl, puis le launcher, puis l'apiupdater", () => {
    const r = run({ wsl__version: "2.3.1" });
    expect({ status: r.status, sortie: r.stdout + r.stderr }).toMatchObject({ status: 0 });
    expect(lignes()).toEqual([
      "cc wsl",
      `launcher -c ${path.join(dir, "config.ini")}`,
      "cc apiupdater",
    ]);
  });

  avecPwsh("sans WSL : pas de redemarrage de WSL", () => {
    const r = run({ wsl__version: "" });
    expect({ status: r.status, sortie: r.stdout + r.stderr }).toMatchObject({ status: 0 });
    expect(lignes()).toEqual([
      `launcher -c ${path.join(dir, "config.ini")}`,
      "cc apiupdater",
    ]);
  });

  avecPwsh("sortie de control_center.ps1 (stdout et stderr) dans le journal, rien a l'ecran", () => {
    const r = run({ wsl__version: "2.3.1" });
    expect(r.status).toBe(0);
    const j = journal();
    expect(j).toMatch(/===== .* \[start\.ps1\] restart wsl 2\.3\.1 =====/);
    expect(j).toMatch(/===== .* \[start\.ps1\] restart apiupdater =====/);
    expect(j).toContain("sortie de wsl");
    expect(j).toContain("erreur de apiupdater");
    expect(r.stdout).not.toContain("sortie de");
  });

  avecPwsh("durees notees pour comparer avec l'ancien lancement", () => {
    run({ wsl__version: "" });
    expect(journal()).toMatch(/\[start\.ps1\] launcher lance a \+\d+(\.\d+)? s/);
    expect(journal()).toMatch(/\[start\.ps1\] termine en \d+(\.\d+)? s/);
  });

  avecPwsh("WSL en echec : note au journal, la caisse se lance quand meme", () => {
    const r = run({ wsl__version: "2.3.1", FAKE_CC_FAIL: "wsl" });
    expect(r.status).toBe(0);
    expect(lignes()).toContain(`launcher -c ${path.join(dir, "config.ini")}`);
    expect(journal()).toMatch(/restart wsl en echec \(code 3\)/);
  });

  avecPwsh("sans ecran possible (hors Windows) : repli sans erreur", () => {
    const r = run({ wsl__version: "" }, []);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(journal()).toMatch(/ecran de chargement indisponible/);
  });

  avecPwsh("launcher deja ouvert : rien n'est relance ni redemarre", async () => {
    // Un vrai processus au nom attendu fait office de launcher ouvert.
    const nom = "sleep";
    const occupant = spawn(nom, ["30"]);
    try {
      const r = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          START,
          "-Root",
          dir,
          "-MaintenanceDir",
          maint,
          "-LogDir",
          logDir,
          "-LauncherExe",
          launcher,
          "-LauncherProcessName",
          nom,
          "-PowerShellExe",
          "pwsh",
          "-WslWaitSeconds",
          "0",
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, FAKE_TRACE: trace, wsl__version: "2.3.1" },
          timeout: 50_000,
        }
      );
      expect({ status: r.status, sortie: r.stdout + r.stderr }).toMatchObject({ status: 0 });
      expect(lignes()).toEqual([]);
      expect(journal()).toMatch(/launcher deja ouvert/);
    } finally {
      occupant.kill();
    }
  });

  avecPwsh("rotation : journaux de plus de 14 jours supprimes", () => {
    fs.mkdirSync(logDir, { recursive: true });
    const vieux = path.join(logDir, "stack-20200101.log");
    const recent = path.join(logDir, "stack-20990101.log");
    fs.writeFileSync(vieux, "x");
    fs.writeFileSync(recent, "x");
    const t = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    fs.utimesSync(vieux, t, t);
    run({ wsl__version: "" });
    expect(fs.existsSync(vieux)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });
});
