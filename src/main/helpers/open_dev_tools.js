const { app, webContents } = require('electron')
const log = require('./electron_log')

/**
 * Les DevTools de la page POS, et non celles de la coquille qui l'affiche.
 *
 * La <webview> a son PROPRE webContents : ouvrir les DevTools du conteneur ne
 * donne ni la console ni l'onglet reseau du POS, qui sont pourtant les seules
 * choses utiles pour diagnostiquer un incident caisse a distance. C'etait la
 * demande du support Decathlon Argentine, restee sans reponse.
 *
 * Tout se passe dans le processus PRINCIPAL. Les tentatives precedentes
 * passaient par le renderer (canal IPC + document.getElementById + boucle de
 * relance), ce qui accumulait trois facons d'echouer en silence : un canal
 * absent de la liste blanche du preload, une branche rendue inatteignable par
 * la presence d'un mot de passe, et une attente de 5 s alors que la <webview>
 * n'apparait qu'apres la connexion a WPT. Ici, aucune de ces couches.
 */

/**
 * Les webContents des <webview> POS presentes a cet instant.
 *
 * On les retrouve par leur TYPE plutot que de memoriser une reference : React
 * demonte la <webview> des que `readyToDiplayApp` retombe (perte de WPT,
 * rechargement), et une reference gardee devient alors muette sans rien
 * signaler. `getAllWebContents()` dit la verite du moment.
 *
 * L'ecran client n'est pas concerne : c'est une BrowserWindow, donc de type
 * "window".
 */
function guests() {
	return webContents
		.getAllWebContents()
		.filter((wc) => !wc.isDestroyed() && 'webview' === wc.getType())
}

/**
 * Un guest pas encore attache au DOM refuse l'ouverture. Ce n'est pas fatal :
 * `surveiller` rejoue a dom-ready. D'ou le booleen plutot qu'une exception.
 */
function ouvrirGuest(guest) {
	try {
		guest.openDevTools({ mode: 'detach' })
		return true
	} catch (err) {
		log.debug(`[DEVTOOLS] webview pas encore prete: ${err.message}`)
		return false
	}
}

function etat(store) {
	if (!store.devtools) {
		store.devtools = { attente: false }
	}
	return store.devtools
}

/**
 * Ouvre les DevTools du conteneur ET celles de la page POS.
 *
 * Quand la <webview> n'existe pas encore, la demande est RETENUE plutot que
 * perdue : c'est le cas courant, pas l'exception, puisque la page POS n'est
 * montee qu'une fois WPT connecte. `surveiller` la servira a l'attachement.
 *
 * @param {object} store - store launcher
 * @returns {string[]} ce qui a effectivement ete ouvert
 */
function ouvrir(store) {
	const ouverts = []

	const conteneur = store && store.windows && store.windows.container.current
	if (conteneur && !conteneur.isDestroyed() && conteneur.isVisible()) {
		conteneur.webContents.openDevTools({ mode: 'right' })
		ouverts.push('container')
	}

	for (const guest of guests()) {
		if (ouvrirGuest(guest)) {
			ouverts.push('webview')
		}
	}

	if (!ouverts.includes('webview')) {
		etat(store).attente = true
	}

	log.info(`[DEVTOOLS] ouvert: ${ouverts.join(', ') || 'rien'}`)

	return ouverts
}

/**
 * Branche l'ouverture differee. A appeler une fois au demarrage.
 *
 * Deux declencheurs : une demande retenue par `ouvrir`, ou le mode debug — une
 * caisse lancee avec `debug=1` veut la console du POS, pas seulement celle du
 * conteneur.
 *
 * @param {object} store - store launcher
 */
function surveiller(store) {
	app.on('web-contents-created', (_e, contents) => {
		if ('webview' !== contents.getType()) {
			return
		}

		const debug = Boolean(
			process.env.EL_DEBUG || (store.conf && store.conf.debug),
		)
		if (!etat(store).attente && !debug) {
			return
		}

		// Consommee : sans cela, les DevTools resurgiraient d'elles-memes au
		// prochain remontage de la <webview>, une heure plus tard, sans que
		// personne ne les ait redemandees.
		etat(store).attente = false

		// On tente TOUT DE SUITE : des DevTools ouvertes avant le premier octet
		// capturent le trafic de chargement du POS, qui est justement ce qu'un
		// support veut voir. dom-ready ne sert que de filet.
		if (!ouvrirGuest(contents)) {
			contents.once('dom-ready', () => {
				ouvrirGuest(contents)
			})
		}
	})
}

module.exports = { ouvrir, surveiller }
