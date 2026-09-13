const { app, dialog, clipboard } = require('electron')

const log = require("./helpers/electron_log")
const CustomError = require('../helpers/custom_error')

module.exports = function dialogErr(store, err) {
	const message = err.message
	const dialogOpts = {
		type: 'error',
		buttons: ['Close'],
		title: 'Application error',
		message: err.api_code || err.code || "An error as occured",
		detail: message,
	}

	if (dialogOpts.message.startsWith('CONFIG_') && store.path && store.path.conf) {
		try {
			clipboard.writeText(store.path.conf)
			dialogOpts.detail += '\r\r(saved in clipboard)'
		}
		catch(err2) {
			log.error(err2)
		}
	}
	if (err && err.messages && typeof err.messages === "string") {
		dialogOpts.detail = dialogOpts.detail + '\n' + err.messages
	}

	if ((!process.env.EL_DEBUG || process.env.EL_DEBUG !== "loader") && store.windows.loader.current && store.windows.loader.current.isVisible()) {
		store.windows.loader.current.hide()
	}
	dialog.showMessageBox(store.windows.container.current, dialogOpts).then((returnValue) => {
		if (store.http) {
			store.http = null
		}
		if (store.wpt && store.wpt.socket) {
			store.wpt.socket = null
		}

		if (store.http) {
			store.http = '...'
		}
		if (store.windows && store.windows.container.current) {
			store.windows.container.current = '...'
		}
		if (store.windows && store.windows.loader.current) {
			store.windows.loader.current = '...'
		}

		if (store.wpt && store.wpt.process) {
			store.wpt.process = '...'
		}

		if (store.appLog) {
			store.appLog = '...'
		}
		let state
		try {
			state = JSON.stringify(store, null, 2)
		} catch (errState) {
			// Le store porte des handles (sockets, windows) : une reference
			// circulaire ne doit pas empecher de journaliser l'erreur d'origine.
			state = `[store non serialisable: ${errState.message}]`
		}
		log.error("[STATE] > " + state)
		if (err instanceof CustomError) {
			log.error(`[${err.api_code}] > ${err.message}`)
		} else {
			log.error(`[GENERIC] > ${err.message}`)
		}

		if (!process.env.EL_DEBUG || process.env.EL_DEBUG !== "loader") {
			app.quit()
		}
	})
}
