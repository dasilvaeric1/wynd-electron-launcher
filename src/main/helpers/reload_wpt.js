
const killWPT = require('./kill_wpt')
const clearCache = require('./clear_cache')
const launchWpt = require('./create_wpt')
const log = require('./electron_log')
const CustomError = require('../../helpers/custom_error')

/**
 * Delai max entre l'emission de `end` et le retour de WPT.
 *
 * L'unit systemd pose `Restart=always` / `RestartSec=3`, et WPT doit ensuite
 * rouvrir son port et recharger ses plugins. 20 s laisse de la marge sur une
 * caisse lente sans faire poireauter le BO indefiniment.
 */
const SOCKET_RESTART_TIMEOUT_MS = 20_000
const SOCKET_POLL_MS = 250

/**
 * Redemarrage quand le launcher NE POSSEDE PAS le process (service systemd
 * sous Linux : WPT tourne sous l'utilisateur `wpt`, en nologin — le launcher
 * ne peut ni le signaler ni le relancer).
 *
 * On passe par le plugin System de WPT : son handler `end`
 * (plugins/System/lib/main.js) appelle endWyndPOSTools(), qui sous Linux fait
 * SIGHUP puis exit(2). Avec `Restart=always`, systemd le relance 3 s plus
 * tard. Le launcher n'a donc besoin d'AUCUN privilege : il demande, le
 * superviseur execute.
 *
 * ⚠️ `end`, JAMAIS `restart`. Sur la meme socket, WPT expose aussi `restart`
 * et `shutdown` — et sous Linux ils valent `reboot -f` et `shutdown -f -h now`
 * (CMDLinux.js). Ils redemarrent ou eteignent LA MACHINE, en force et sans
 * demontage propre. Confondre les deux rebooterait une caisse en pleine vente.
 *
 * `end` n'est pas accuse : WPT meurt avant de pouvoir repondre. Le succes se
 * lit donc a la RECONNEXION, pas a une reponse. On surveille l'etat de la
 * socket plutot que ses evenements, parce que `on_socket.js` fait
 * `removeAllListeners()` a chaque reconnexion et emporterait des ecouteurs
 * temporaires.
 */
function restartViaSocket(wpt, timeoutMs = SOCKET_RESTART_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const socket = wpt.socket
		if (!socket || !socket.connected) {
			return reject(new CustomError(
				503,
				CustomError.CODE.$$_NOT_AVAILABLE,
				"WPT n'est pas joignable : aucune socket connectee, impossible de lui demander de s'arreter",
				["WPT_SOCKET"],
			))
		}

		let settled = false
		let sawDisconnect = false
		let poll = null

		const finish = (fn, arg) => {
			if (settled) return
			settled = true
			if (poll) clearInterval(poll)
			socket.removeListener('end.error', onEndError)
			fn(arg)
		}

		// WPT refuse `end` si le plugin System n'est pas demarre (_checkPlugin).
		// C'est justement le cas d'un WPT malade, celui ou le redemarrage
		// servirait le plus : il faut le dire clairement, car sans privileges
		// le launcher n'a aucun autre recours.
		function onEndError(payload) {
			finish(reject, new CustomError(
				502,
				CustomError.CODE.$$_NOT_AVAILABLE,
				`WPT a refuse l'arret : le plugin System ne repond pas (${JSON.stringify(payload)}). `
				+ "Un redemarrage du service est necessaire depuis la caisse.",
				["WPT_SYSTEM_PLUGIN"],
			))
		}
		socket.once('end.error', onEndError)

		const deadline = Date.now() + timeoutMs
		poll = setInterval(() => {
			if (!socket.connected) {
				sawDisconnect = true
			} else if (sawDisconnect) {
				log.info('[WPT] > restart socket : WPT est revenu')
				return finish(resolve, { disconnected: true, reconnected: true })
			}
			if (Date.now() >= deadline) {
				finish(reject, new CustomError(
					408,
					CustomError.CODE.WPT_CONNECTION_TIMEOUT,
					sawDisconnect
						? `WPT s'est arrete mais n'est pas revenu en ${timeoutMs / 1000} s : verifier l'etat du service (systemctl status wyndpostools)`
						: `WPT n'a pas reagi a la demande d'arret en ${timeoutMs / 1000} s`,
				))
			}
		}, SOCKET_POLL_MS)

		log.info('[WPT] > restart socket : emit end')
		socket.emit('end')
	})
}

module.exports = async function  reloadWPT(wpt, confWpt, callback) {
	clearCache()

	// Le launcher ne possede pas le process : ni kill ni spawn ne sont
	// possibles. C'est le cas Linux, ou WPT est le service systemd
	// wyndpostools. On demande l'arret, systemd relance.
	if (!wpt.process) {
		const socketResult = await restartViaSocket(wpt)
		if (callback) {
			callback('wpt_restart_socket', socketResult)
		}
		return {
			mode: 'socket',
			kill_wpt: { pid: null, success: true, err: null },
			start_wpt: { pid: null, success: true, err: null },
			...socketResult,
		}
	}

	const result = {
		mode: 'process',
		kill_wpt: {
			success: true,
			err: null
		},
		start_wpt: {
			pid: null,
			success: true,
			err: null
		}
	}
	if (wpt.process) {
		try {
			const child = await killWPT(wpt, callback)
			result.kill_wpt.pid = child.pid
		} catch(err) {
			result.kill_wpt.success = false
			result.kill_wpt.err = err
		}
	} else {
		result.kill_wpt.success = false
		result.kill_wpt.err = new CustomError(400, CustomError.CODE.$$_NOT_AVAILABLE, null, ["PROCESS"])
	}
	if (confWpt.path && confWpt.cwd) {
		try {
			const child = await launchWpt(confWpt, callback)
			result.start_wpt.pid = child.pid
		} catch(err) {
			result.start_wpt.success = false
			result.start_wpt.err = err
		}
	} else {
		result.start_wpt.success = false
		result.kill_wpt.err = new CustomError(400, CustomError.CODE.$$_NOT_FOUND, null, ["WPT_PATH"])
	}

	// Sans ca, `reloadWPT` RESOLVAIT meme quand ses deux branches avaient
	// echoue : on_socket.js n'atteignait jamais son .catch et repondait `END`
	// au BO, qui croyait le redemarrage reussi. Un echec franc vaut mieux
	// qu'un succes invente.
	if (!result.kill_wpt.success && !result.start_wpt.success) {
		const cause = result.kill_wpt.err || result.start_wpt.err
		throw cause instanceof CustomError
			? cause
			: new CustomError(500, CustomError.CODE.GENERIC, "Redemarrage de WPT impossible")
	}

	return result
}
