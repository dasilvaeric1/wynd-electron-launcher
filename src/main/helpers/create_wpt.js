const path = require('path')
const log = require('../helpers/electron_log')
const fs = require('fs')
const CustomError = require('../../helpers/custom_error')

module.exports = function launchWpt(wpt, callback) {

	// var started = /\[HTTPS? Server] started/;
	let wptPid = null
	let messages = ''

	return new Promise((resolve, reject) => {
		let timeout = setTimeout(() => {
			if (child.stdout) {
				child.stdout.removeAllListeners()
			}
			if (child.stderr) {
				child.stderr.removeAllListeners()
			}
			child.removeAllListeners()
			if (child && !child.killed) {
				child.kill('SIGKILL')
			}
			if (wptPid) {
				process.kill(wptPid)
			}
			timeout = null
			reject(
				new CustomError(
					500,
					CustomError.CODE.WPT_CANNOT_BE_CREATED,
					'Cannot create Wyndpostools (timeout: ' + wpt.creation_timeout + ' sec)'
				)
			)
		}, 1000 * wpt.creation_timeout)
		// cannot use fork same node version of nw used
		const spawn = require('child_process').spawn

		// wpt.path est modifiable a distance (node_ipc.js, evenement 'wpt.restart') et part
		// dans spawn avec options.shell a true par defaut. Un chemin d'installation legitime
		// — historiquement C:\Retail\... sous Windows, un dossier applicatif ailleurs — ne
		// contient aucun de ces caracteres ; leur presence ne peut venir que d'une tentative
		// d'injection. On refuse avant toute construction de commande plutot que de parier
		// sur l'echappement du shell, qui differe entre cmd.exe et sh.
		if (typeof wpt.path !== 'string' || /[;&|`$(){}<>\n\r"']/.test(wpt.path)) {
			clearTimeout(timeout)
			timeout = null
			reject(
				new CustomError(
					400,
					CustomError.CODE.INVALID_$$_PATH,
					'wpt path contains shell metacharacters: ' + JSON.stringify(wpt.path),
					['WPT']
				)
			)
			return
		}

		const isShell =
			path.extname(wpt.path) === '.sh' || path.extname(wpt.path) === '.bat'
		let isJs = path.extname(wpt.path) === '.js'

		const isExe = path.extname(wpt.path) === '.exe' || path.extname(wpt.path) === '.AppImage'

		const exePath =
			isShell || isJs || isExe ? wpt.path : path.join(wpt.path, 'lib', 'main.js')
		isJs = path.extname(exePath) === '.js'
		const exe = isShell || isExe ? wpt.path : wpt.cwd ? wpt.cwd : 'node'
		const args = isShell
			? []
			: [exePath]

		if (!fs.existsSync(exePath)) {
			// Le `return` manquait : rejeter la promesse n'interrompt pas la fonction, et le
			// spawn plus bas s'executait malgre le controle. Comme `options.shell` vaut true
			// par defaut (config_validator), un chemin porteur de metacaracteres partait au
			// shell alors meme qu'il venait d'etre juge invalide. Le controle d'existence est
			// desormais bloquant, ce qui ecarte du meme coup tout chemin qui n'est pas un
			// fichier reel — wpt.path etant modifiable via l'IPC (node_ipc.js, 'wpt.restart').
			// Le minuteur de creation doit etre desarme avant de sortir : son callback
			// manipule `child`, declare en const plus bas. Sortir sans l'annuler le ferait
			// lever un ReferenceError dans le processus principal a l'echeance.
			clearTimeout(timeout)
			timeout = null
			reject(
				new CustomError(
					400,
					CustomError.CODE.INVALID_$$_PATH,
					'wrong wpt path in config: ' + wpt.path,
					['WPT']
				)
			)
			return
		}

		if (!isJs && path.extname(exePath) === '.bat') {
			wpt.wait_on_ipc = false
		} else if (isJs && wpt.wait_on_ipc === null) {
			wpt.wait_on_ipc = true
		} else if (wpt.shell && wpt.detached) {
			wpt.wait_on_ipc = false
		}

		const options = {
			stdio: wpt.wait_on_ipc ? ['pipe', 'pipe', 'pipe']: undefined,
			windowsHide: true,
			shell:wpt.shell,
			detached: wpt.detached,
		}
		if (wpt.wait_on_ipc && options.stdio && !isShell && (path.extname(exePath) === '.sh' || isJs)) {
			// not working on Windows with .bat ...
			options.stdio.push('ipc')
		}
		log.info("[WPT] exe opts: " + JSON.stringify(options))
		log.info("[WPT] exe: " + exe + " " + args)
		const child = spawn(exe, args, options)
		log.info("[WPT] child pid: " + child.pid)
		if (wpt.wait_on_ipc) {
			child.on('message', message => {
				log.info("[WPT] child message: " + (typeof message === "object" ? JSON.stringify(message) : message))
				if (typeof message === 'object' && message.pid) {
					wptPid = message.pid
					if (callback) {
						log.info("[WPT] pid: " + wptPid)
						callback('wpt_ipc_datas', message)
						callback('get_wpt_pid_done', wptPid)
					} else {
						wpt.pid = wptPid
					}
				} else if (
					typeof message === 'string' &&
					message.toUpperCase().indexOf('READY') >= 0
				) {
					if (timeout) {
						clearTimeout(timeout)
						timeout = null
					}
					if (child.stdout) {
						child.stdout.removeAllListeners()
					}
					if (child.stderr) {
						child.stderr.removeAllListeners()
					}
					child.removeAllListeners()
					if (callback) {
						callback('create_wpt_done', child)
					}
					resolve(child)
				}
			})
		}

		if (
			child.stdout && (!wpt.wait_on_ipc ||
			(process.env.EL_DEBUG && process.env.EL_DEBUG === 'wpt'))
		) {
			child.stdout.on('data', function (data) {
				if (process.env.EL_DEBUG && process.env.EL_DEBUG === 'wpt') {
					// eslint-disable-next-line no-console
					console.log('WPT ->', data.toString())
				}
				if (messages.length > 0) {
					messages.length = ""
				}

				if (!wpt.wait_on_ipc && data.indexOf('[pid] ') >= 0 || data.indexOf('pid') >= 0) {
					let pid = typeof data === "object" ? data.toString().split("\n") : data.split("\n")
					for (let i = 0; i < pid.length; i++) {
						if (pid[i].indexOf('[pid]' >= 0) || pid[i].indexOf('pid' >= 0)) {
							pid = pid[i]
							break
						}
					}
					const pids = pid.split(" ")
					if (pid.length > 0) {
						pid = pids.pop()
						pid = Number.parseInt(pid, 10)
						if (Number.isNaN(pid)) {
							if (pids.length > 0) {
								pid = pids.pop()
								pid = Number.parseInt(pid, 10)
							} else {
								pid = null
							}
						}

						if (pid && !Number.isNaN(pid) && callback) {
							log.info("[WPT] pid: " + pid)
							callback('get_wpt_pid_done', pid)
						}
					}

				}

				if (
					!wpt.wait_on_ipc &&
					(data.indexOf('[HTTP Server] started on port') >= 0 ||
						data.indexOf('[HTTPS Server] started on port') >= 0)
				) {

					if (timeout) {
						clearTimeout(timeout)
						timeout = null
					}
					child.stdout.removeAllListeners()
					child.stderr.removeAllListeners()
					child.removeAllListeners()
					if (callback) {
						callback('create_wpt_done', child)
					}
					resolve(child)
				}
			})
		}
		if (child.stderr) {
			child.stderr.on('data', function (data) {
				messages += data.toString()
			})
		}

		child.once('exit', reason => {
			setTimeout(() => {
				if (child.stdout) {
					child.stdout.removeAllListeners()
				}
				if (child.stderr) {
					child.stderr.removeAllListeners()
				}
				child.removeAllListeners()
				reject(
					new CustomError(
						500,
						CustomError.CODE.WPT_CANNOT_BE_CREATED,
						messages
							? messages
							: 'Cannot create Wyndpostools. Exit(' + reason + ')'
					)
				)
			}, 1000)
		})

		child.once('error', err => {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}
			if (!child.killed) {
				child.kill('SIGKILL')
				if (child.stdout) {
					child.stdout.removeAllListeners()
				}
				if (child.stderr) {
					child.stderr.removeAllListeners()
				}
				child.removeAllListeners()
			}
			err.messages = messages
			reject(err)
		})

		if (child && wpt.shell) {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}
			setTimeout(() => {
				if (child.stdout) {
					child.stdout.removeAllListeners()
				}
				if (child.stderr) {
					child.stderr.removeAllListeners()
				}
				child.removeAllListeners()
				if (callback) {
					callback('create_wpt_done', child)
				}
				resolve(child)
			}, 3000)
		}
	})
}
