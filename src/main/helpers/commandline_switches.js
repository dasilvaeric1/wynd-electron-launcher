const BLOCKED_SWITCHES = new Set([
  "ignore-certificate-errors",
  "ignore-ssl-errors",
]);

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