/**
 * Résolution du webContents portant le POS.
 *
 * En `view=webview` le POS vit dans un guest webContents enfant de la
 * container window ; en `view=iframe` il est une sous-frame de la container
 * elle-même. Dans les deux cas c'est le webContents retourné ici qui porte le
 * DOM à capturer (`executeJavaScript` cible le main world de sa frame
 * principale, et le POS y est soit seul, soit atteignable).
 */

const { webContents: ElectronWebContents } = require("electron");

function getContainerWebContents(store) {
  const w = store?.windows?.container?.current;
  if (!w || w.isDestroyed()) return null;
  return w.webContents;
}

/** @returns {object|null} guest webview enfant du webContents parent */
function getWebviewWebContents(parentWc) {
  if (!parentWc) return null;
  return (
    ElectronWebContents.getAllWebContents().find(
      (wc) =>
        !wc.isDestroyed() &&
        wc.getType() === "webview" &&
        wc.hostWebContents?.id === parentWc.id,
    ) ?? null
  );
}

/**
 * webContents où injecter la capture : le guest en webview, la container en
 * iframe (ou tant que le guest n'est pas monté).
 */
function getPosWebContents(store) {
  const container = getContainerWebContents(store);
  if (!container) return null;
  return getWebviewWebContents(container) || container;
}

module.exports = {
  getPosWebContents,
  getContainerWebContents,
  getWebviewWebContents,
};
