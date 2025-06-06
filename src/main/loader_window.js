const path = require('path')
const url = require('url')
const { BrowserWindow } = require('electron')

const log = require("./helpers/electron_log")
const getAssetPath = require("./helpers/get_asset")

module.exports = function generateLoaderWindow(store) {
	const loaderWindow = new BrowserWindow({
		closable: false,
		hasShadow: true,
		show: false,
		closable: false,
		resizable: false,
		width: store.windows.loader.width,
		height: store.windows.loader.height,
		x: store.choosen_screen.x + store.choosen_screen.width / 2 - store.windows.loader.width / 2,
		y: store.choosen_screen.y + store.choosen_screen.height / 2 - store.windows.loader.height / 2,
		icon: getAssetPath('logo.png'),
		frame: false,
		parent: store.windows.container.current,
		enableLargerThanScreen: false,
		paintWhenInitiallyHidden: false,
		alwaysOnTop: true,
		webPreferences: {
		nodeIntegration: true,
		contextIsolation: false,
		preload: path.join(__dirname, '..', 'loader', 'assets', 'preload.js'),
		},
	})
	loaderWindow.on('closed', () => {
		log.info('[WINDOW] > Loader : closed')
		store.windows.loader.current = null
	})

	loaderWindow.on('show', () => {
		log.info('[WINDOW] > Loader : show')
	})
	loaderWindow.webContents.on('ready-to-show', () => {
		log.info('[WINDOW] > Loader : ready-to-show')
	})

	loaderWindow.webContents.on('did-finish-load', () => {
		log.info('[WINDOW] > Loader : did-finish-load')
	})

	loaderWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
		log.error(`[WINDOW] > Loader : did-fail-load - ${errorCode} ${errorDescription} ${validatedURL}`)
	})

	const loaderFile = url.format({
		pathname: path.join(__dirname, '..', 'loader', 'assets', 'index.html'),
		protocol: 'file',
		slashes: true
	})
	log.info(`[WINDOW] > Loading loader from: ${loaderFile}`)
	loaderWindow.loadURL(loaderFile)

	if (process.env.DEV && process.env.DEV.toLowerCase().indexOf("loader") >= 0) {
		loaderWindow.webContents.openDevTools({mode: 'detach'})
		loaderWindow.center()
	}

	// Force open DevTools for debugging
	if (process.env.NODE_ENV === 'development') {
		loaderWindow.webContents.openDevTools({mode: 'detach'})
	}

	return loaderWindow
}
