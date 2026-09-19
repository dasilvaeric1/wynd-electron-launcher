const io = require('socket.io-client')
const CustomError = require('../../helpers/custom_error')

module.exports = function connectToWpt(conf, wpt_url, callback) {
	let resolved = false

	let timeout = null
	let socket = null

	return new Promise((resolve, reject) => {
		const generateTimeout = () => {
			if (timeout) {
				clearTimeout(timeout)
			}
			timeout = setTimeout(() => {

				if (socket) {
					socket.removeAllListeners()
				}
				reject(new CustomError(408, CustomError.CODE.WPT_CONNECTION_TIMEOUT, `Cannot connect to Wyndpostools (url: ${wpt_url}), (timeout: ${conf.wpt.connection_timeout})`))
			}, 1000 * conf.wpt.connection_timeout)
		}

		socket = io(wpt_url, {
			autoConnect: false,
			rejectUnauthorized: false,
			// forceNode : indispensable depuis Electron 42 (Node 24).
			// Node >= 22 expose un `WebSocket` GLOBAL (celui d'undici), et
			// engine.io-client 3 le prefere au module `ws` des qu'il existe
			// (transports/websocket.js : `usingBrowserWebSocket = BrowserWebSocket
			// && !opts.forceNode`). Or l'implementation d'undici n'accepte AUCUNE
			// option TLS — ni rejectUnauthorized, ni ca — et les options ne sont
			// transmises que dans le chemin Node. Resultat sur un WPT en HTTPS a
			// certificat auto-signe : « websocket error » avec une pile dans
			// node:internal/deps/undici, et un timeout de connexion.
			forceNode: true,
			reconnection: true,
			transports: ["websocket"]
		});

		if (callback) {
			callback('wpt_connect', socket)
		}
		generateTimeout()

		socket.once('version', (version) => {
			socket.wpt_version = version
			if (callback) {
				callback('wpt_version_done', version)
			}
		})

		socket.once('connect', () => {
			generateTimeout()
			setTimeout(() => {
				if (callback) {
					callback('wpt_infos')
				}
				socket.emit('infos')
			}, 300)
		})

		socket.on('disconnect', () => {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}
			if (callback) {
				callback('wpt_connect_done', false)
			}
		})
		socket.once('error', (err) => {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}
			reject(err)
		})

		// WPT repond `<evenement>.error` quand il ne peut pas servir une
		// requete — typiquement « [System] - Not running plugin » lorsque le
		// plugin System est installe mais arrete. Sans ces ecouteurs, le
		// launcher attendait betement l'expiration du delai et affichait un
		// WPT_CONNECTION_TIMEOUT generique, alors que WPT avait repondu tout
		// de suite et disait precisement ce qui manquait.
		const rejectWithWptError = (event) => (err) => {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}
			const detail = err && (err.message || err.error || err)
			reject(
				new CustomError(
					502,
					CustomError.CODE.SERVICE_$$_NOT_AVAILABLE,
					`Wyndpostools a refuse la requete « ${event} » : ${detail}`,
					['WPT']
				)
			)
		}
		socket.once('infos.error', rejectWithWptError('infos'))
		socket.once('plugins.error', rejectWithWptError('plugins'))
		socket.once('version.error', rejectWithWptError('version'))

		socket.once('infos', function (infos) {
			if (callback) {
				callback('wpt_infos_done', infos)
			}
			generateTimeout()
			setTimeout(() => {
				if (callback) {
					callback('plugins')
				}
				socket.emit('plugins')
			}, 300)


		});
		socket.once('plugins', function (plugins) {
			if (timeout) {
				clearTimeout(timeout)
				timeout = null
			}

			if (conf.central?.enable) {
				const centralPlugin = plugins.find((plugin) => {
					return plugin.name.toLowerCase() === 'central'
				})
				if (!centralPlugin) {
					reject(new CustomError(404, CustomError.CODE.$$_NOT_FOUND, 'missing central wpt.plugin', ["CENTRAL PLUGIN"]))
					resolved = true
					return null
				}

				if (centralPlugin && !centralPlugin.enabled) {
					reject(new CustomError(400, CustomError.CODE.$$_NOT_AVAILABLE, 'central wpt.plugin not enable', ["CENTRAL PLUGIN"]))
					return null
				}
			}

			if (callback) {
				callback('REQUEST_WPT_done', plugins)
			}
			if(!resolved) {
				resolved = true
				setTimeout(() => {
					socket.removeListener("connect")
					socket.removeListener("disconnect")
					socket.removeListener("error")
					resolve(socket)
				}, 300)
			}
		});

		socket.connect()

	})

}
