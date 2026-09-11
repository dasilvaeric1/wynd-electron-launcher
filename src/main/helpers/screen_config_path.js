const fs = require("fs");

const WINDOWS_APPSETTINGS_PATH =
  "C:\\Retail\\ANYCOMMERCE\\RetailScheduler\\appsettings.json";
const LINUX_APPSETTINGS_PATH = "/opt/retail-scheduler/appsettings.json";

function defaultAppsettingsPath(platform = process.platform) {
  if (platform === "win32") return WINDOWS_APPSETTINGS_PATH;
  return LINUX_APPSETTINGS_PATH;
}

function looksLikeWindowsAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(String(value || ""));
}

function resolveAppsettingsPath({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
} = {}) {
  const override = env.EL_SCREEN_APPSETTINGS_PATH;
  if (!override) return defaultAppsettingsPath(platform);

  if (
    platform !== "win32" &&
    looksLikeWindowsAbsolutePath(override) &&
    !existsSync(override)
  ) {
    return defaultAppsettingsPath(platform);
  }

  return override;
}

module.exports = {
  defaultAppsettingsPath,
  resolveAppsettingsPath,
};
