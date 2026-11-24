/**
 * Serial renvoyé au POS par l'émulateur WPT.
 *
 * Ordre de résolution :
 *   1. EL_WPT_HARDWARE_SERIAL       — forçage ponctuel, sans toucher la config
 *   2. [wpt_emulation] hardware_serial (config.ini) — forçage durable
 *   3. appsettings.json du RetailScheduler (CaisseSerialNumber)
 *   4. http://localhost:5088/api/identity (le service résout BIOS > nom machine)
 *   5. serial BIOS lu directement — ce que WyndPOSTools renvoyait
 *
 * Le forçage ne concerne QUE ce que voit le POS : screen-session, présence
 * fleet et trace gardent le serial réel (sinon deux caisses forcées au même
 * serial se confondraient côté central).
 *
 * Un succès est mis en cache ; un échec non, pour qu'une caisse dont le
 * service démarre après le launcher finisse par répondre.
 */

const ENV_VAR = 'EL_WPT_HARDWARE_SERIAL'

/**
 * Retire TOUS les blancs, comme le POS (`serial.replace(/\s/g, '')`).
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeSerial(value) {
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const s = String(value).replace(/\s/g, '')
	return s ? s : null
}

/**
 * @param {object} deps
 * @param {Record<string,string|undefined>} deps.env
 * @param {{hardware_serial?: unknown}} deps.conf - section [wpt_emulation]
 * @param {() => Promise<string|null>} deps.readAppsettingsSerial
 * @param {() => Promise<string|null>} deps.fetchIdentitySerial
 * @param {() => Promise<string|null>} deps.readBiosSerial
 * @param {{info: Function, warn: Function}} deps.log
 * @returns {{resolve: () => Promise<{serial: string, source: string, forced: boolean}|null>}}
 */
function createSerialResolver(deps) {
	const { env = {}, conf = {}, log } = deps
	let cached = null

	const forced = [
		{ source: 'env', value: () => env[ENV_VAR] },
		{ source: 'config.ini', value: () => conf && conf.hardware_serial },
	]
	const real = [
		{ source: 'appsettings', read: deps.readAppsettingsSerial },
		{ source: 'identity', read: deps.fetchIdentitySerial },
		{ source: 'bios', read: deps.readBiosSerial },
	]

	async function resolveOnce() {
		for (const f of forced) {
			const serial = normalizeSerial(f.value())
			if (serial) {
				log.warn(`[WPT-EMU] serial FORCE (source: ${f.source}) : ${serial}`)
				return { serial, source: f.source, forced: true }
			}
		}
		for (const r of real) {
			if (typeof r.read !== 'function') continue
			let raw = null
			try {
				raw = await r.read()
			} catch (err) {
				log.warn(`[WPT-EMU] source serial ${r.source} en echec : ${err && err.message}`)
				continue
			}
			const serial = normalizeSerial(raw)
			if (serial) {
				log.info(`[WPT-EMU] serial (source: ${r.source}) : ${serial}`)
				return { serial, source: r.source, forced: false }
			}
		}
		return null
	}

	return {
		async resolve() {
			if (cached) return cached
			const result = await resolveOnce()
			if (result) cached = result
			return result
		},
	}
}

module.exports = { normalizeSerial, createSerialResolver, ENV_VAR }
