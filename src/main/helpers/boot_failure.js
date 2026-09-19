const log = require('./electron_log')
const showDialogError = require('../dialog_err')

/**
 * Route une erreur de bootstrap vers le LOADER plutot que vers la boite de
 * dialogue native.
 *
 * Avant : toute erreur de demarrage passait par dialog_err.js, qui affiche une
 * dialog Windows en anglais avec un unique bouton « Close » puis appelle
 * app.quit(). Concretement, un WPT muet au boot = caisse morte, sans relance
 * possible et sans qu'un exploitant magasin puisse faire autre chose
 * qu'appeler le support.
 *
 * Le canal `error` existait deja dans la whitelist du preload du loader, mais
 * AUCUN emetteur ne l'utilisait : le handler cote React etait du code mort.
 *
 * La dialog native reste le repli quand le loader n'est pas exploitable
 * (fenetre pas encore creee, detruite, ou erreur survenue avant whenReady).
 */

/** Reduit une erreur a ce que le loader doit afficher. */
function serializeError(err) {
	if (!err) {
		return { code: 'INTERNAL_ERROR', message: 'Erreur inconnue', detail: null }
	}
	return {
		code: err.api_code || err.code || 'INTERNAL_ERROR',
		message: err.message || String(err),
		// `messages` porte le detail agrege des erreurs de validation de config.
		detail: typeof err.messages === 'string' ? err.messages : null,
		status: err.status || null,
	}
}

function loaderIsUsable(store) {
	const loader = store?.windows?.loader.current
	return !!(
		loader &&
		typeof loader.isDestroyed === 'function' &&
		!loader.isDestroyed() &&
		loader.webContents &&
		!loader.webContents.isDestroyed()
	)
}

/**
 * @returns {boolean} true si l'erreur a ete affichee dans le loader,
 *                    false si on est retombe sur la dialog native.
 */
function reportBootFailure(store, err) {
	const payload = serializeError(err)
	log.error(`[BOOT] > echec: [${payload.code}] ${payload.message}`)

	if (!loaderIsUsable(store)) {
		// Pas de loader exploitable : on ne peut pas laisser l'erreur muette.
		showDialogError(store, err)
		return false
	}

	const loader = store.windows.loader.current
	try {
		if (!loader.isVisible()) {
			loader.show()
		}
		loader.webContents.send('boot_error', payload)
		return true
	} catch (sendErr) {
		log.error(`[BOOT] > impossible d'afficher l'erreur dans le loader: ${sendErr.message}`)
		showDialogError(store, err)
		return false
	}
}

module.exports = { reportBootFailure, serializeError, loaderIsUsable }
