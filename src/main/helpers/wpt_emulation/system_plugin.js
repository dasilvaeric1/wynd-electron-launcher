/**
 * Plugin `System` de WyndPOSTools, émulé par le launcher.
 *
 * Seul ce que le POS consomme est servi : `hardwareserial` (identité de la
 * caisse), plus `version` / `infos` / `plugins` que le middleware Redux et les
 * outils de diagnostic interrogent à la connexion.
 *
 * Contrat repris de WPT (plugins/System/lib/main.js) : la réponse porte le nom
 * de la requête ; un échec part en `<event>.error` avec `{code, message}`.
 *
 * ⚠️ `end`, `restart`, `shutdown` sont REFUSÉS. Sous WPT Linux, `restart` et
 * `shutdown` valent `reboot -f` / `shutdown -h now` : n'importe quelle page
 * autorisée pouvait éteindre la caisse. L'émulateur n'en hérite pas.
 */

// Événements que le plugin System de WPT connaissait (cf main.js `receives`).
const SYSTEM_EVENTS = new Set([
	'hardwareserial',
	'wyndserial',
	'version',
	'infos',
	'encodings',
	'encodings.codes',
	'currencies',
	'cotcot',
	'chrome.end',
	'end',
	'restart',
	'shutdown',
	'ips',
	'plugins',
])

const REFUSED_EVENTS = new Set(['end', 'restart', 'shutdown', 'chrome.end'])

const error = (event, code, message) => ({ event: `${event}.error`, payload: { code, message } })

/**
 * @param {object} deps
 * @param {() => Promise<{serial: string}|null>} deps.resolveSerial
 * @param {string} deps.version - version du launcher
 * @param {{info: Function, warn: Function, error: Function}} deps.log
 */
function createSystemPlugin({ resolveSerial, version, log }) {
	const emulatedVersion = `${version}-launcher-emulation`

	async function serialOrNull() {
		try {
			const r = await resolveSerial()
			return r && r.serial ? r.serial : null
		} catch (err) {
			log.error(`[WPT-EMU] resolution du serial en echec : ${err && err.message}`)
			return null
		}
	}

	const handlers = {
		async hardwareserial() {
			const serial = await serialOrNull()
			return serial
				? { event: 'hardwareserial', payload: serial }
				: error('hardwareserial', 'NO_SERIAL', 'There is no serialnumber')
		},
		async version() {
			return { event: 'version', payload: emulatedVersion }
		},
		async plugins() {
			return {
				event: 'plugins',
				payload: [{ name: 'System', version: emulatedVersion, enabled: true, started: true }],
			}
		},
		async infos() {
			return {
				event: 'infos',
				payload: {
					hardwareserial: await serialOrNull(),
					version: emulatedVersion,
					platform: process.platform,
					emulated: true,
				},
			}
		},
	}

	/**
	 * @param {string} event
	 * @returns {Promise<{event: string, payload: unknown}|null>} null = pas un événement System
	 */
	async function handle(event) {
		if (Object.prototype.hasOwnProperty.call(handlers, event)) {
			return handlers[event]()
		}
		if (REFUSED_EVENTS.has(event)) {
			log.warn(`[WPT-EMU] evenement « ${event} » REFUSE (non emule par securite)`)
			return error(event, 'REFUSED', `${event} is not available on the launcher emulation`)
		}
		if (SYSTEM_EVENTS.has(event)) {
			log.info(`[WPT-EMU] evenement System non emule : ${event}`)
			return error(event, 'NOT_SUPPORTED', `${event} is not supported by the launcher emulation`)
		}
		return null
	}

	return { handle }
}

module.exports = { createSystemPlugin, REFUSED_EVENTS, SYSTEM_EVENTS }
