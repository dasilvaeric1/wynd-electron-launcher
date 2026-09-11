const {
  applyConfiguredSwitches,
  removeUnsafeSwitches,
} = require("../src/main/helpers/commandline_switches");
const fs = require("fs");
const path = require("path");

test("blocks switches that disable TLS certificate validation", () => {
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

  expect(appendSwitch).toHaveBeenCalledTimes(1);
  expect(appendSwitch).toHaveBeenCalledWith("disable-gpu", "true");
  expect(warn).toHaveBeenCalledWith(
    "[COMMANDLINE] > blocked unsafe switch ignore-certificate-errors",
  );
});

test.each([
  "ignore-certificate-errors",
  "ignore-ssl-errors",
])("removes unsafe CLI switch %s before startup", (switchName) => {
  const commandLine = {
    hasSwitch: jest.fn((name) => name === switchName),
    removeSwitch: jest.fn(),
  };
  const warn = jest.fn();

  removeUnsafeSwitches(commandLine, { warn });

  expect(commandLine.removeSwitch).toHaveBeenCalledWith(switchName);
  expect(warn).toHaveBeenCalledWith(
    `[COMMANDLINE] > removed unsafe switch ${switchName}`,
  );
});

test("removes case-variant CLI switches with inline values", () => {
  const commandLine = {
    hasSwitch: jest.fn(() => false),
    removeSwitch: jest.fn(),
  };

  removeUnsafeSwitches(
    commandLine,
    { warn: jest.fn() },
    ["electron", ".", "--IGNORE-CERTIFICATE-ERRORS=true"],
  );

  expect(commandLine.removeSwitch).toHaveBeenCalledWith(
    "IGNORE-CERTIFICATE-ERRORS",
  );
  expect(commandLine.removeSwitch).toHaveBeenCalledWith(
    "ignore-certificate-errors",
  );
});

test("normalizes case and leading dashes in configured switch names", () => {
  const appendSwitch = jest.fn();

  applyConfiguredSwitches(
    { appendSwitch },
    { "--IGNORE-CERTIFICATE-ERRORS": "true" },
    { info: jest.fn(), warn: jest.fn() },
  );

  expect(appendSwitch).not.toHaveBeenCalled();
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