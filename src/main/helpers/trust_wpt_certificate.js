const { app } = require('electron')
const { URL } = require('url')
const { X509Certificate } = require('node:crypto')
const log = require('./electron_log')

const emulatorHosts = (port) => new Set([`localhost:${port}`, `127.0.0.1:${port}`])

/** Empreinte SHA-256 du certificat Electron (`cert.data` = PEM), ou null. */
function empreinte(cert) {
	try {
		return cert && cert.data ? new X509Certificate(cert.data).fingerprint256 : null
	} catch {
		return null
	}
}

/**
 * Accepte le certificat auto-signe de WyndPOSTools, et LUI SEUL.
 *
 * WPT sert en HTTPS un certificat qu'il genere lui-meme au premier demarrage
 * (node-forge) : aucune autorite ne le signe, Chromium le refuse, et la caisse
 * s'en sortait jusqu'ici avec `ignore-certificate-errors` — c'est-a-dire en
 * desactivant la validation TLS du processus ENTIER, POS distant compris.
 *
 * Le durcissement 2.8.2 avait bloque ce drapeau sans contrepartie, coupant la
 * liaison POS <-> materiel sur les caisses concernees. Cette fonction est la
 * contrepartie qui manquait : la tolerance ne porte plus que sur l'hote que
 * l'exploitant a lui-meme designe dans `wpt.url`. Tout le reste — a commencer
 * par l'URL du POS — reste verifie normalement.
 *
 * A enregistrer avant la creation des fenetres.
 *
 * @param {object} store - store launcher (pour lire wpt.url a chaque appel)
 */
function trustWptCertificate(store) {
	// L'exception est journalisee une seule fois : Chromium redemande a chaque
	// requete tant qu'il n'a pas mis la decision en cache.
	let annonce = false

	const hoteAttendu = () => {
		const url = store && store.conf && store.conf.wpt && store.conf.wpt.url
		if (!url) {
			return null
		}
		if (url.host) {
			return String(url.host).toLowerCase()
		}
		try {
			return new URL(String(url)).host.toLowerCase()
		} catch (err) {
			log.debug(`[TLS] url wpt non analysable: ${err.message}`)
			return null
		}
	}

	app.on('certificate-error', (event, _webContents, url, error, cert, callback) => {
		let hote = null
		try {
			hote = new URL(url).host.toLowerCase()
		} catch (err) {
			log.debug(`[TLS] url en cause non analysable (${url}): ${err.message}`)
		}

		// Emulateur WPT du launcher : sur ses hotes, l'EMPREINTE fait foi et la
		// regle d'hote ci-dessous ne s'applique pas. default_config pose
		// `wpt.url=localhost:9963` meme WPT desactive : sans cela, n'importe
		// quel certificat presente sur ce port serait accepte.
		const emu = store && store.wptEmulation
		if (emu && hote && emulatorHosts(emu.port).has(hote)) {
			if (empreinte(cert) === emu.fingerprint256) {
				event.preventDefault()
				callback(true)
				return
			}
			log.warn(`[TLS] certificat REFUSE pour ${url} : empreinte differente de celle de l'emulateur WPT`)
			callback(false)
			return
		}

		const attendu = hoteAttendu()

		// Comparaison sur l'hote COMPLET, port compris : un suffixe commun ne
		// doit pas suffire (`wpt.magasin.fr.attaquant.com`).
		if (attendu && hote === attendu) {
			if (!annonce) {
				annonce = true
				log.info(
					`[TLS] certificat auto-signe accepte pour l'hote WPT configure (${attendu})`,
				)
			}
			event.preventDefault()
			callback(true)
			return
		}

		log.warn(`[TLS] certificat REFUSE pour ${url} (${error})`)
		callback(false)
	})
}

module.exports = trustWptCertificate
