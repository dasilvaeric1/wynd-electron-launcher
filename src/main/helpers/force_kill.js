const log = require("../helpers/electron_log")
const CustomError = require('../../helpers/custom_error')

module.exports =  function forceKill(port) {
	return new Promise((resolve, reject) => {
		// `port` vient de conf.wpt.url.port, donc d'un fichier de configuration, et il est
		// interpole dans une commande passee au shell. On le ramene a un entier de plage
		// valide avant toute construction de commande : plus rien d'autre qu'un nombre ne
		// peut atteindre exec(), quoi que contienne la configuration.
		const portNumber = Number.parseInt(port, 10)
		if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
			reject(new CustomError(500, CustomError.CODE.CANNOT_KILL_WPT, `Invalid port: ${JSON.stringify(port)}`))
			return
		}

		let command = null
		if (process.platform === "linux") {
			command = `netstat -ltnp | grep -w ':${portNumber}' | awk '{split($7,a, \"/\"); print  a[1]}'`
		} else if (process.platform === "win32") {
			// Etait `findstr 0.0.0.0:${9963}` : le port configure etait ignore au profit du
			// port par defaut code en dur. Sous Windows la fonction ne visait donc jamais
			// l'instance decrite par la configuration des que celle-ci changeait de port.
			command =  `netstat -a -n -o -p tcp | findstr 0.0.0.0:${portNumber}`
		} else if (process.platform === "darwin") {
			command = `lsof -ti :${portNumber}`
		}

		if (command) {
			let timeout = setTimeout(() => {
				timeout = null
				reject(new CustomError(500, CustomError.CODE.CANNOT_KILL_WPT, "The process does not respond"))
			}, 1000 * 3)
			const exec = require('child_process').exec
			const regexPID = /\d+/
			log.warn("[WPT] > Force kill : Execute command:" + command)
			exec(command, (error, stdout) => {
				if (error) {
					return reject(error);
				}
				if (timeout) {
					clearTimeout(timeout)
				}
				if (process.platform === "win32") {
					stdout = stdout.split(' ').filter((chunk) => {
						return chunk !== ''
					})
					stdout = stdout[4]
				}
				if (regexPID.test(stdout)) {

					const result = process.kill(Number.parseInt(stdout), 'SIGKILL')
					if (result) {
						return resolve()
					} else {
						reject(new CustomError(500,  CustomError.CODE.KILL_WPT_NOT_CONFIRMED, "The process kill has not confirmed"))
					}
				}
				resolve()
			});
		}
		else {
			reject(new CustomError(500,  CustomError.CODE.KILL_WPT_WRONG_PLATFORM, "Cannot kill wpt on platform " + process.platform))
		}
	})
}
