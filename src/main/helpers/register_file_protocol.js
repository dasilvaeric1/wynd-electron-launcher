const { protocol, app, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// Le scheme custom `assets://` (logo menu) doit être déclaré privilégié
// AVANT app.ready — sinon protocol.handle ne peut pas l'intercepter.
// Migration Electron 42 : registerFileProtocol (supprimé) → protocol.handle.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "assets",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

module.exports = function configureProtocol(store) {
  protocol.handle("assets", () => {
    const file = path.normalize(
      `${app.getPath("userData")}/assets/${store.conf.menu.logo}`
    );
    return net.fetch(pathToFileURL(file).toString());
  });
};
