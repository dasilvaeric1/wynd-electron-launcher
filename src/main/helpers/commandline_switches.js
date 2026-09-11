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

function applyConfiguredSwitches(commandLine, switches, log) {
  if (!switches || typeof switches !== "object") return;

  for (const [commandName, value] of Object.entries(switches)) {
    if (BLOCKED_SWITCHES.has(normalizeSwitchName(commandName))) {
      log.warn(`[COMMANDLINE] > blocked unsafe switch ${commandName}`);
      continue;
    }

    commandLine.appendSwitch(commandName, value);
    log.info(`[COMMANDLINE] > ${commandName}, ${value}`);
  }
}

module.exports = { applyConfiguredSwitches, removeUnsafeSwitches };