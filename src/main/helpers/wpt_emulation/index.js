/**
 * Émulation du plugin `System` de WyndPOSTools par le launcher.
 *
 * Pour les caisses SANS WPT dont le POS est servi en central (HTTPS) : le POS
 * se connecte à `https://localhost:<port>` (WPT_HOST/WPT_PORT de son env.json)
 * et y obtient `hardwareserial`, comme auprès d'un WPT.
 *
 *   config.ini [wpt_emulation] enable=1, port=9963, hardware_serial=, allowed_origins=
 *
 * Pièces :
 *   certificate.js   — certificat auto-signé persistant (empreinte = ce qu'on accepte)
 *   serial.js        — forçage > service RetailScheduler > BIOS
 *   system_plugin.js — événements System servis / refusés
 *   server.js        — HTTPS + socket.io (EIO3), origine vérifiée
 *   trust_wpt_certificate.js (hors dossier) — accepte NOTRE empreinte sur localhost:<port>
 *
 * Un échec de démarrage est journalisé et rend null : le launcher continue, le
 * POS affichera son erreur de connexion WPT — plus parlante qu'un crash.
 */

const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')
const { app } = require('electron')

const log = require('../electron_log')
const { resolveAppsettingsPath } = require('../screen_config_path')
const { ensureCertificate } = require('./certificate')
const { createSerialResolver } = require('./serial')
const { readBiosSerial } = require('./bios_serial')
const { createSystemPlugin } = require('./system_plugin')
const { startWptEmulation } = require('./server')

const IDENTITY_TIMEOUT_MS = 2000
const DEFAULT_UI_PORT = 5088

function toOrigin(value) {
	try {
		const u = new URL(String(value).trim())
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
	} catch {
		return null
	}
}

/**
 * @param {object} conf - conf launcher validée (`url` éclatée par le validateur)
 * @returns {string[]}
 */
function resolveAllowedOrigins(conf) {
	const explicit = conf && conf.wpt_emulation && conf.wpt_emulation.allowed_origins
	if (explicit) {
		return String(explicit)
			.split(',')
			.map(toOrigin)
			.filter(Boolean)
	}
	const fromUrl = conf && conf.url && toOrigin(conf.url.href || conf.url)
	return fromUrl ? [fromUrl] : []
}

/**
 * Lecture du serial auprès du service RetailScheduler, s'il est installé.
 * @param {{path?: string, httpGet?: Function}} [opts]
 */
function readServiceSerial({ path: appsettingsPath = resolveAppsettingsPath(), httpGet = axios.get } = {}) {
	const readJson = () => {
		try {
			if (!fs.existsSync(appsettingsPath)) return null
			return JSON.parse(fs.readFileSync(appsettingsPath, 'utf8').replace(/^﻿/, ''))
		} catch (err) {
			log.warn(`[WPT-EMU] appsettings illisible (${appsettingsPath}) : ${err.message}`)
			return null
		}
	}
	return {
		async appsettings() {
			const json = readJson()
			const serial = json && json.CentralApi && json.CentralApi.CaisseSerialNumber
			return serial ? String(serial) : null
		},
		async identity() {
			const json = readJson()
			const port = (json && json.UiPort) || DEFAULT_UI_PORT
			try {
				const r = await httpGet(`http://localhost:${port}/api/identity`, {
					timeout: IDENTITY_TIMEOUT_MS,
					validateStatus: () => true,
				})
				return r && r.status < 400 && r.data && r.data.caisseSerial ? String(r.data.caisseSerial) : null
			} catch {
				return null
			}
		},
	}
}

function wptPort(wptConf) {
	const url = wptConf && wptConf.url
	if (!url) return null
	if (url.port) return Number(url.port)
	return url.protocol === 'https:' ? 443 : 80
}

/**
 * @param {object} store - store launcher ; reçoit `store.wptEmulation`
 * @returns {Promise<{port: number, fingerprint256: string, close: () => Promise<void>}|null>}
 */
async function initWptEmulation(store) {
	const conf = store && store.conf
	const emuConf = conf && conf.wpt_emulation
	if (!emuConf || !emuConf.enable) return null

	const port = Number(emuConf.port)
	if (conf.wpt && conf.wpt.enable && wptPort(conf.wpt) === port) {
		log.error(
			`[WPT-EMU] non demarree : [wpt] enable=1 utilise deja le port ${port}. ` +
				`L'emulation remplace WPT, elle ne cohabite pas avec lui sur le meme port.`,
		)
		return null
	}

	const allowedOrigins = resolveAllowedOrigins(conf)
	if (allowedOrigins.length === 0) {
		log.error(
			"[WPT-EMU] non demarree : aucune origine autorisee. Renseigner [wpt_emulation] allowed_origins " +
				'ou une cle url= en https.',
		)
		return null
	}

	try {
		const tls = ensureCertificate({ dir: path.join(app.getPath('userData'), 'wpt-emulation'), log })
		const service = readServiceSerial()
		const resolver = createSerialResolver({
			env: process.env,
			conf: emuConf,
			readAppsettingsSerial: service.appsettings,
			fetchIdentitySerial: service.identity,
			readBiosSerial: () => readBiosSerial(),
			log,
		})
		const plugin = createSystemPlugin({ resolveSerial: resolver.resolve, version: app.getVersion(), log })
		const emu = await startWptEmulation({ port, tls, allowedOrigins, plugin, log })

		store.wptEmulation = { port: emu.port, fingerprint256: tls.fingerprint256, close: emu.close }
		log.info(`[WPT-EMU] origines autorisees : ${allowedOrigins.join(', ')}`)

		// Résolution anticipée : la source du serial (et un éventuel forçage)
		// apparaît dans le journal dès le démarrage, pas au premier appel du POS.
		resolver.resolve().then((r) => {
			if (!r) log.warn('[WPT-EMU] aucun serial resolu pour l instant (forcer via hardware_serial si besoin)')
		})

		return store.wptEmulation
	} catch (err) {
		log.error(`[WPT-EMU] demarrage en echec : ${err.code ? `${err.code} ` : ''}${err.message}`)
		return null
	}
}

module.exports = { initWptEmulation, resolveAllowedOrigins, readServiceSerial }
