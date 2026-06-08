const { Tray, Menu, ipcMain, app, shell, clipboard } = require('electron')
const path = require("path")
const log = require("./helpers/electron_log")
module.exports = (store) => {

	const iconPath = path.join(__dirname, store.infos.packaged ? '../../../assets/icons/png/16x16.png' : '../../assets/icons/png/16x16.png')
	appIcon = new Tray(iconPath)
	const onClick = (e, focusedWindow, focusedWebContents) => {
		if (store.windows.container.current) {
			if (store && store.conf && store.conf.raw) {
				ipcMain.emit("main.action", null, e.label.toLowerCase())
			} else if (store.windows.container.current.webContents) {
				store.windows.container.current.webContents.send("menu.action", e.label.toUpperCase())
			}
		} else {
			ipcMain.emit("main.action", null, e.label.toLowerCase())
		}
	}

	// Logs accessibles depuis le tray — gain support énorme : un caissier
	// peut envoyer son dossier de logs sans avoir à naviguer dans
	// %APPDATA%/electron-launcher/logs à l'aveugle.
	const logsDir = path.join(app.getPath("userData"), "logs")
	const openLogsFolder = () => {
		shell.openPath(logsDir).then((err) => {
			if (err) log.error(`[TRAY] openPath failed: ${err}`)
		})
	}
	const copyLogsPath = () => {
		clipboard.writeText(logsDir)
		log.info(`[TRAY] logs path copied to clipboard: ${logsDir}`)
	}

	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Reload', type: 'normal', click: onClick },
		{ type: 'separator' },
		{ label: `Version ${app.getVersion()}`, type: 'normal', enabled: false },
		{ label: 'Ouvrir le dossier des logs', type: 'normal', click: openLogsFolder },
		{ label: 'Copier le chemin des logs', type: 'normal', click: copyLogsPath },
		{ type: 'separator' },
		{ label: 'Close', type: 'normal', click: onClick }
	])

	appIcon.setContextMenu(contextMenu)
	appIcon.setToolTip(`Wynd Electron Launcher ${app.getVersion()}`)

	return appIcon
}
