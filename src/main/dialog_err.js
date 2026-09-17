const { app, dialog, clipboard } = require('electron')

const log = require("./helpers/electron_log")
const CustomError = require('../helpers/custom_error')

const MARQUEUR = '...'

/**
 * Projection SERIALISABLE du store, pour le journal.
 *
 * L'ancienne version remplacait les handles vivants dans le store LUI-MEME
 * (`store.wpt.process = '...'`, `store.wpt.socket = null`, les fenetres) avant
 * de le serialiser. Le store etant partage avec tout le processus principal,
 * la caisse repartait avec de faux handles — et `app.quit()` suit deux lignes
 * plus bas.
 *
 * `before-quit` (src/main/index.js) fait alors :
 *
 *   if (wpt.process && !wpt.process.killed) { await killWPT(wpt) }
 *
 * `'...'` est vrai, `'...'.killed` est undefined : on entre, `kill_wpt.js`
 * appelle `child.once('exit')` sur une chaine, leve « child.once is not a
 * function », et le catch avale l'erreur. **Le processus WPT survit au
 * launcher** : le port 9963 est encore pris au demarrage suivant, que le
 * launcher force-kill alors via netstat. Le socket, mis a null, n'etait pas
 * ferme non plus.
 *
 * On construit donc une COPIE. Au passage, la boucle sur `windows` couvre
 * l'ecran client, ajoute bien apres cet assainissement manuel et jamais
 * repris : c'est lui qui rendait le store non serialisable.
 */
function etatSerialisable(store) {
	if (!store || "object" !== typeof store) { return store }

	const vue = Object.assign({}, store)

	if (store.wpt && "object" === typeof store.wpt) {
		vue.wpt = Object.assign({}, store.wpt, {
			process: store.wpt.process ? MARQUEUR : null,
			socket: store.wpt.socket ? MARQUEUR : null
		})
	}

	if (store.windows && "object" === typeof store.windows) {
		vue.windows = Object.assign({}, store.windows)
		Object.keys(store.windows).forEach((nom) => {
			const emplacement = store.windows[nom]
			if (emplacement && "object" === typeof emplacement && "current" in emplacement) {
				vue.windows[nom] = Object.assign({}, emplacement, {
					current: emplacement.current ? MARQUEUR : null
				})
			}
		})
	}

	if (store.http) { vue.http = MARQUEUR }
	if (store.appLog) { vue.appLog = MARQUEUR }

	return vue
}

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

	const loader = store.windows && store.windows.loader && store.windows.loader.current
	if ((!process.env.EL_DEBUG || process.env.EL_DEBUG !== "loader") && loader && loader.isVisible()) {
		loader.hide()
	}
	const conteneur = (store.windows && store.windows.container && store.windows.container.current) || null
	dialog.showMessageBox(conteneur, dialogOpts).then((returnValue) => {
		let state
		try {
			state = JSON.stringify(etatSerialisable(store), null, 2)
		} catch (errState) {
			// Filet : la projection couvre les handles connus, mais le store peut
			// porter demain une nouvelle reference circulaire. Une erreur ici ne
			// doit pas empecher de journaliser l'erreur d'origine.
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
