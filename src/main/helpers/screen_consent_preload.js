const { contextBridge, ipcRenderer } = require('electron')

// Petit pont entre la page HTML du consent et le main. Pas de Node API
// exposé — juste les deux actions accept / decline.
contextBridge.exposeInMainWorld('screenConsent', {
	accept: () => ipcRenderer.send('screen-consent:answer', true),
	decline: () => ipcRenderer.send('screen-consent:answer', false),
})
