// Renvoie l'identifiant de build complet (ex "1.23.0+20260608.7ca091c"),
// généré par scripts/stamp_build.js. Fallback sur la version package.json
// (app.getVersion) si build_info.json absent (dev sans stamp).
let cached = null;

module.exports = function buildVersion() {
  if (cached) return cached;
  try {
    const info = require("../build_info.json");
    cached = info.full || info.version;
  } catch {
    try {
      cached = require("electron").app.getVersion();
    } catch {
      cached = "unknown";
    }
  }
  return cached;
};
