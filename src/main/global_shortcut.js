const { globalShortcut } = require("electron")
const openDevToolsForLoader = require('./helpers/open_loader_dev_tools')
const { ouvrir: ouvrirDevTools } = require('./helpers/open_dev_tools')
module.exports = function (store, log) {

	globalShortcut.unregisterAll()
	globalShortcut.register('Control+R', () => {
		return false
	})

	globalShortcut.register('Control+Shift+R', () => {
		if (store.windows.container.current?.isVisible() && !store.ask.request) {

			if (store.conf?.menu?.password) {
				log.info('[SHORTCUT] > Control+Shift+C ask_password reload')
				store.windows.container.current.webContents.send("ask_password", "reload")
				return true
			} else {
				log.info('[SHORTCUT] > Control+Shift+C ask_reload true')
				store.windows.container.current.webContents.send("ask_reload", true)
				return true
			}
		}
	})

	globalShortcut.register('Control+Shift+I', () => {
		if (store.windows.container.current?.isVisible()) {

			// Mot de passe : le pinpad s'en charge, et son retour repasse par
			// `main.action/open_dev_tools` (cf ipc.js), donc par le meme chemin.
			if (store.conf && store.conf.menu && store.conf.menu.password) {
				if (!store.ask.request) {
					store.windows.container.current.webContents.send("ask_password", "open_dev_tools")
					return true
				}
				return false
			}

			// Sans mot de passe, on ouvre les deux d'un coup : la fenetre
			// conteneur ET la page POS. Le `send("open_dev_tools")` qui trainait
			// ici ne servait a rien — ce canal n'existe ni dans la liste blanche
			// du preload ni comme ecouteur cote renderer.
			ouvrirDevTools(store)
			return true
		}

		if (store.windows.loader.current?.isVisible()) {
			openDevToolsForLoader(store)
		}

		return true;
	})

	globalShortcut.register('Control+Shift+F', () => {
		if (store.windows.loader.current?.isVisible()) {
		  if (store.windows.loader.current.isFullScreen()) {
				store.windows.loader.current.setFullScreen(false)
				store.windows.loader.current.setSize(300, 120)
				store.windows.loader.current.center()
				store.windows.loader.current.show()
			}
		}
		return true;
	})

	globalShortcut.register('Control+Shift+O', () => {
		if (store.windows.loader.current?.isVisible()) {
			if (store.windows.loader.current.isFullScreen()) {
				store.windows.loader.current.setFullScreen(false)
				store.windows.loader.current.setSize(300, 120)
				store.windows.loader.current.center()
				store.windows.loader.current.show()
			} else {
				openDevToolsForLoader(store)
			}
		}
		return true;
	})

	globalShortcut.register('Control+M', () => {

		if (store.windows.container.current?.isVisible()) {
			store.windows.container.current.webContents.send("toggle_menu", true)
		}
		return true;
	})

}
