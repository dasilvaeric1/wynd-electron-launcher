const {
  defaultAppsettingsPath,
  resolveAppsettingsPath,
} = require("../src/main/helpers/screen_config_path");

test("default appsettings path is the Debian RetailScheduler location on Linux", () => {
  expect(defaultAppsettingsPath("linux")).toBe(
    "/opt/retail-scheduler/appsettings.json",
  );
});

test("default appsettings path remains the RetailScheduler location on Windows", () => {
  expect(defaultAppsettingsPath("win32")).toBe(
    "C:\\Retail\\ANYCOMMERCE\\RetailScheduler\\appsettings.json",
  );
});

test("missing Windows appsettings override is ignored on Linux", () => {
  const existsSync = jest.fn(() => false);

  expect(
    resolveAppsettingsPath({
      env: {
        EL_SCREEN_APPSETTINGS_PATH:
          "C:\\Retail\\ANYCOMMERCE\\RetailScheduler\\appsettings.json",
      },
      platform: "linux",
      existsSync,
    }),
  ).toBe("/opt/retail-scheduler/appsettings.json");
});

test("custom POSIX appsettings override is preserved on Linux", () => {
  expect(
    resolveAppsettingsPath({
      env: { EL_SCREEN_APPSETTINGS_PATH: "/etc/wynd/appsettings.json" },
      platform: "linux",
      existsSync: jest.fn(() => false),
    }),
  ).toBe("/etc/wynd/appsettings.json");
});
