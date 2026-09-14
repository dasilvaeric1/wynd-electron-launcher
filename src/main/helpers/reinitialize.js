const { webFrame } = require('electron')
const { reportBootFailure } = require("./boot_failure")
const initialize = require('./initialize')
const closeHttp = require('./close_http')

module.exports = async function reinitialize(store, initCallback, opts) {

	if (!opts) {
		opts = {}
	}

	if (webFrame) {
		webFrame.clearCache()
	}

	if (store.wpt.socket && !opts.keep_socket_connection) {
		store.wpt.socket.destroy()
		store.wpt.socket.close()
	}

	if (store.http && !opts.keep_http) {
		const isClosed = await closeHttp(store.http)
		if (isClosed) {
			store.http = null
		}
	}

	try {
		await initialize({ conf: store.path.conf, wpt_version: store.wpt.version, infos: store.infos }, initCallback, opts)
		// if (store.wpt.socket) {
		// 	store.wpt.socket.emit("central.custom", '@cdm/wynd-desktop', 'connected', store.version)
		// }
	}
	catch (err) {
		// Une relance qui echoue doit rester DANS le loader : l'utilisateur
		// vient justement d'y cliquer « Reessayer ». Retomber sur la dialog
		// native fermait l'application au deuxieme echec.
		reportBootFailure(store, err)
	}

	if (store.windows.container.current) {
		store.windows.container.current.reload()
	}

}
