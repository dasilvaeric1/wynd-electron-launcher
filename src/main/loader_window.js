const path = require('node:path')
const url = require('node:url')
const { BrowserWindow } = require('electron')

const log = require("./helpers/electron_log")
const getAssetPath = require("./helpers/get_asset")

module.exports = function generateLoaderWindow(store) {
	const loaderWindow = new BrowserWindow({
		closable: false,
		hasShadow: true,
		show: false,
		resizable: false,
		// Sans fond explicite, Chromium peint la fenetre en BLANC avant le
		// premier rendu React : sur un loader sombre, le flash est franc.
		backgroundColor: '#11141E',
		width: store.windows.loader.width,
		height: store.windows.loader.height,
		x: store.choosen_screen.x + store.choosen_screen.width / 2 - store.windows.loader.width / 2,
		y: store.choosen_screen.y + store.choosen_screen.height / 2 - store.windows.loader.height / 2,
		icon: getAssetPath('logo.png'),
		frame: false,
		parent: store.windows.container.current,
		enableLargerThanScreen: false,
		// DOIT rester true (valeur par defaut d'Electron) : la fenetre est creee
		// avec show:false et n'est affichee qu'a reception de l'IPC `ready`, que
		// le renderer envoie apres son premier rendu. Une fenetre masquee qui ne
		// peint pas ne produit aucune frame -> requestAnimationFrame ne se
		// declenche jamais -> `ready` ne part pas -> la fenetre n'est jamais
		// affichee. Peindre masque permet aussi d'avoir l'UI complete des la
		// premiere frame visible, donc zero flash.
		paintWhenInitiallyHidden: true,
		alwaysOnTop: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: false,
			preload: path.join(__dirname, '..', 'loader', 'assets', 'preload.js'),
		},
	})

	loaderWindow.on('closed', () => {
		store.windows.loader.current = null
	})

	loaderWindow.webContents.on('ready-to-show', () => {
		log.debug('[WINDOW] > Loader : ready-to-show')
	})

	const loaderFile = url.format({
		pathname: path.join(__dirname, '..', 'loader', 'assets', 'index.html'),
		protocol: 'file',
		slashes: true
	})

	loaderWindow.loadURL(loaderFile)

	if (process.env.DEV && process.env.DEV.toLowerCase().indexOf("loader") >= 0) {
		loaderWindow.webContents.openDevTools({mode: 'detach'})
		loaderWindow.center()
	}

	return loaderWindow
}
