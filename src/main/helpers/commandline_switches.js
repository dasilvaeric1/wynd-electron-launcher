// Liste volontairement VIDE, et le mecanisme conserve pour qu'un reblocage
// reste une ligne a ajouter.
//
// `ignore-certificate-errors` y figurait depuis 2.8.2. Le bloquer a casse le
// seul usage legitime du drapeau sur une caisse : WyndPOSTools sert en HTTPS
// avec un certificat AUTO-SIGNE (genere par node-forge au premier demarrage),
// et c'est ce drapeau qui permettait a Chromium de l'accepter cote webview.
// Aucun remplacant cible n'avait ete pose en contrepartie.
//
// La bonne facon de refermer cette tolerance sans casser la caisse serait un
// gestionnaire `certificate-error` restreint a l'hote de WPT, plutot qu'une
// desactivation globale de la validation TLS. Tant qu'il n'existe pas, bloquer
// le drapeau revient a couper la liaison POS <-> materiel.
const BLOCKED_SWITCHES = new Set([]);

function normalizeSwitchName(name) {
  return String(name).replace(/^-+/, "").toLowerCase();
}

function removeUnsafeSwitches(commandLine, log, argv = process.argv) {
  for (const commandName of BLOCKED_SWITCHES) {
    const argvNames = argv
      .filter((arg) => typeof arg === "string" && arg.startsWith("-"))
      .map((arg) => arg.split("=", 1)[0].replace(/^-+/, ""))
      .filter((arg) => normalizeSwitchName(arg) === commandName);

    if (!commandLine.hasSwitch(commandName) && argvNames.length === 0) continue;

    for (const argvName of argvNames) commandLine.removeSwitch(argvName);
    commandLine.removeSwitch(commandName);
    log.warn(`[COMMANDLINE] > removed unsafe switch ${commandName}`);
  }
}

/**
 * Drapeaux que Chromium lit AVANT que notre JS puisse s'executer : les poser
 * avec appendSwitch les accepte sans erreur et ne change rien. Le piege est
 * qu'on les voyait alors journalises comme appliques.
 *
 * `ozone-platform` en est le cas typique : il decide du backend graphique et
 * doit arriver par argv (`--ozone-platform=x11`, ce que fait le .desktop) ou
 * par l'environnement (`ELECTRON_OZONE_PLATFORM_HINT`). Mesure sur une caisse
 * Rocky 10 : pose par config.ini, le process GPU demarrait malgre tout en
 * `ozone-platform=wayland`.
 */
const TOO_LATE_SWITCHES = new Set(["ozone-platform", "ozone-platform-hint"]);

function applyConfiguredSwitches(commandLine, switches, log) {
  if (!switches || typeof switches !== "object") return;

  for (const [commandName, value] of Object.entries(switches)) {
    if (BLOCKED_SWITCHES.has(normalizeSwitchName(commandName))) {
      log.warn(`[COMMANDLINE] > blocked unsafe switch ${commandName}`);
      continue;
    }

    if (TOO_LATE_SWITCHES.has(normalizeSwitchName(commandName))) {
      log.warn(
        `[COMMANDLINE] > ${commandName} SANS EFFET depuis config.ini : ` +
          `Chromium l'a deja lu. Passer par argv (.desktop) ou par ` +
          `ELECTRON_OZONE_PLATFORM_HINT.`,
      );
      continue;
    }

    commandLine.appendSwitch(commandName, value);
    log.info(`[COMMANDLINE] > ${commandName}, ${value}`);
  }
}

module.exports = {
  applyConfiguredSwitches,
  removeUnsafeSwitches,
  TOO_LATE_SWITCHES,
};