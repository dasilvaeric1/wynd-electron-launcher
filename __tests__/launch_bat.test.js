/**
 * anycommerce.bat ne doit plus pouvoir etre fige par un clic de la caissiere.
 *
 * La console du .bat s'ouvre a l'ouverture de session, devant la caissiere.
 * Un clic dedans (selection, mode « edition rapide » de Windows) suspend tout
 * processus qui y ecrit. Le 28/09/2026, sur une caisse le-gac, cela a fige
 * control_center.ps1 pendant 1 h 40 : le Retail Scheduler, qui le voit tourner,
 * a suspendu taches et commandes a distance (maintenance), et la caisse est
 * apparue hors ligne.
 *
 * Trois protections, verifiees ici :
 *   1. le .bat se relance dans une console reduite, hors de portee d'un clic ;
 *   2. il coupe l'edition rapide de cette console (no_quickedit.ps1) ;
 *   3. control_center.ps1 n'ecrit jamais dans la console : meme selectionnee,
 *      elle ne peut plus le figer.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const LAUNCH = path.join(
  __dirname,
  "..",
  "deploy",
  "scaffold",
  "Electron-Launcher",
  "launch"
);
const BAT = path.join(LAUNCH, "anycommerce.bat");
const PS1 = path.join(LAUNCH, "no_quickedit.ps1");

/** Lignes de commande du .bat, sans les commentaires REM ni les vides. */
const commandes = () =>
  fs
    .readFileSync(BAT, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^rem\b/i.test(l));

describe("anycommerce.bat", () => {
  test("se relance d'abord dans une console reduite, une seule fois", () => {
    const lignes = commandes();
    expect(lignes[0]).toBe("@echo off");
    // Garde avant toute autre commande : sans elle, on relancerait en boucle.
    expect(lignes[1]).toBe('if /i not "%~1"=="--minimise" (');
    expect(lignes[2]).toBe(
      'start "Octipas POS" /min cmd /c ""%~f0" --minimise"'
    );
    expect(lignes[3]).toBe("exit /b");
    expect(lignes[4]).toBe(")");
  });

  test("coupe l'edition rapide avant le premier control_center.ps1", () => {
    const lignes = commandes();
    const qe = lignes.findIndex((l) => l.includes("no_quickedit.ps1"));
    const cc = lignes.findIndex((l) => l.includes("control_center.ps1"));
    expect(qe).toBeGreaterThan(-1);
    expect(qe).toBeLessThan(cc);
    // Facultatif (un deploiement partiel ne doit pas empecher le demarrage)
    // et muet (rien dans la console).
    expect(lignes[qe]).toBe(
      'if exist "%~dp0no_quickedit.ps1" Powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0no_quickedit.ps1" > nul 2>&1'
    );
  });

  test("control_center.ps1 n'ecrit jamais dans la console", () => {
    const appels = commandes().filter((l) => l.includes("control_center.ps1"));
    expect(appels.length).toBeGreaterThan(0);
    for (const l of appels) expect(l).toMatch(/>> "%STACK_LOG%" 2>&1$/);
  });
});

describe("no_quickedit.ps1", () => {
  const ps1 = () => fs.readFileSync(PS1, "utf-8");

  test("retire ENABLE_QUICK_EDIT_MODE de l'entree de la console", () => {
    const s = ps1();
    expect(s).toMatch(/\$STD_INPUT_HANDLE\s*=\s*-10\b/);
    expect(s).toMatch(/\$ENABLE_QUICK_EDIT_MODE\s*=\s*0x0040\b/);
    // Sans ENABLE_EXTENDED_FLAGS, Windows ignore le changement de QuickEdit.
    expect(s).toMatch(/\$ENABLE_EXTENDED_FLAGS\s*=\s*0x0080\b/);
    expect(s).toContain("SetConsoleMode");
  });

  test("n'empeche jamais le demarrage : erreurs avalees, sortie 0", () => {
    const s = ps1();
    expect(s).toMatch(/\btry\s*\{/);
    expect(s).toMatch(/\}\s*catch\s*\{/);
    expect(s.trimEnd()).toMatch(/exit 0$/);
  });

  // Execute pour de vrai quand pwsh est disponible (poste de dev) : hors
  // Windows, kernel32 n'existe pas, le script doit donc sortir proprement.
  const pwsh = spawnSync("pwsh", ["-v"], { encoding: "utf-8" });
  const avecPwsh = pwsh.status === 0 ? test : test.skip;

  avecPwsh("syntaxe PowerShell valide", () => {
    const r = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${PS1}', [ref]$null, [ref]$e); $e.Count`,
      ],
      { encoding: "utf-8" }
    );
    expect(r.stdout.trim()).toBe("0");
  });

  avecPwsh("sans console Windows : ne dit rien et sort en 0", () => {
    const r = spawnSync("pwsh", ["-NoProfile", "-File", PS1], {
      encoding: "utf-8",
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });
});
