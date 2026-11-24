/**
 * Serveur HTTPS + socket.io qui se présente au POS comme un WyndPOSTools.
 *
 * - Écoute sur 127.0.0.1 uniquement : rien n'est exposé au réseau du magasin.
 * - socket.io 4 avec `allowEIO3` : le middleware Redux du POS embarque un
 *   client socket.io 2 (engine.io 3).
 * - Origine vérifiée à la poignée de main (polling ET websocket) et sur la
 *   route HTTP. Une requête SANS Origin vient d'un outil local, pas d'une page
 *   web (un navigateur envoie toujours Origin en WS et en CORS) : acceptée.
 * - Préflight « réseau privé » (page publique Azure → localhost) : on répond
 *   `Access-Control-Allow-Private-Network: true`, pour l'origine du POS seule.
 */

const https = require('node:https')
const { Server } = require('socket.io')

const LISTEN_HOST = '127.0.0.1'
const SERIAL_ROUTE = '/System/api/hardwareserial'

/**
 * @param {string[]} allowedOrigins
 * @returns {(origin: string|undefined) => boolean}
 */
function originPolicy(allowedOrigins) {
	const allowed = new Set((allowedOrigins || []).map((o) => String(o).replace(/\/+$/, '').toLowerCase()))
	return (origin) => {
		if (!origin) return true
		return allowed.has(String(origin).toLowerCase())
	}
}

function sendJson(res, status, body, headers = {}) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
	res.end(JSON.stringify(body), 'utf-8')
}

/**
 * @param {object} opts
 * @param {number} opts.port - 0 = port libre (tests)
 * @param {{key: string, cert: string}} opts.tls
 * @param {string[]} opts.allowedOrigins
 * @param {{handle: (event: string) => Promise<{event: string, payload: unknown}|null>}} opts.plugin
 * @param {{info: Function, warn: Function, error: Function, debug?: Function}} opts.log
 * @returns {Promise<{port: number, address: string, close: () => Promise<void>}>}
 */
function startWptEmulation({ port, tls, allowedOrigins, plugin, log }) {
	const isAllowed = originPolicy(allowedOrigins)
	const refused = new Set() // une ligne de journal par origine refusée, pas une par requête

	const refuse = (origin, where) => {
		if (!refused.has(origin)) {
			refused.add(origin)
			log.warn(`[WPT-EMU] origine REFUSEE (${where}) : ${origin}`)
		}
	}

	const corsHeaders = (origin) =>
		origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Credentials': 'true' } : {}

	// Route HTTP de WPT ; socket.io lui délègue tout ce qui n'est pas /socket.io/.
	async function onHttpRequest(req, res) {
		const origin = req.headers.origin
		if (!isAllowed(origin)) {
			refuse(origin, 'http')
			res.writeHead(403)
			return res.end()
		}
		const pathname = (req.url || '').split('?')[0]
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				...corsHeaders(origin),
				'Access-Control-Allow-Methods': 'GET, OPTIONS',
				'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '',
			})
			return res.end()
		}
		if (req.method !== 'GET' || pathname !== SERIAL_ROUTE) {
			return sendJson(res, 404, { code: 404, message: 'Not found' }, corsHeaders(origin))
		}
		const r = await plugin.handle('hardwareserial')
		if (r && r.event === 'hardwareserial') return sendJson(res, 200, r.payload, corsHeaders(origin))
		return sendJson(res, 500, r ? r.payload : { code: 500, message: 'no serial' }, corsHeaders(origin))
	}

	const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
		onHttpRequest(req, res).catch((err) => {
			log.error(`[WPT-EMU] http ${req.url} : ${err && err.message}`)
			if (!res.headersSent) sendJson(res, 500, { code: 500, message: 'internal error' })
		})
	})

	const io = new Server({
		allowEIO3: true,
		serveClient: false,
		cors: {
			origin: (origin, cb) => cb(null, isAllowed(origin) ? origin || false : false),
			credentials: true,
		},
		allowRequest: (req, cb) => {
			const origin = req.headers.origin
			if (isAllowed(origin)) return cb(null, true)
			refuse(origin, 'socket')
			return cb('origin not allowed', false)
		},
	})
	io.attach(server)

	// Préflight réseau privé : l'en-tête doit être posé AVANT que le module
	// cors d'engine.io ne réponde. socket.io a remplacé les écouteurs `request`
	// par le sien ; on l'enveloppe.
	const inner = server.listeners('request')
	server.removeAllListeners('request')
	server.on('request', (req, res) => {
		if (req.headers['access-control-request-private-network'] === 'true' && isAllowed(req.headers.origin) && req.headers.origin) {
			res.setHeader('Access-Control-Allow-Private-Network', 'true')
		}
		for (const h of inner) h.call(server, req, res)
	})

	io.on('connection', (socket) => {
		const origin = socket.handshake.headers.origin || '(sans origine)'
		log.info(`[WPT-EMU] client connecte ${socket.id} depuis ${origin}`)

		socket.onAny((event) => {
			plugin
				.handle(event)
				.then((r) => {
					if (r) socket.emit(r.event, r.payload)
				})
				.catch((err) => log.error(`[WPT-EMU] ${event} : ${err && err.message}`))
		})

		// WPT annonce sa version à la connexion ; le middleware l'écoute.
		plugin.handle('version').then((r) => r && socket.emit(r.event, r.payload))

		socket.on('disconnect', (reason) => log.info(`[WPT-EMU] client deconnecte ${socket.id} (${reason})`))
	})

	return new Promise((resolve, reject) => {
		const onError = (err) => {
			io.close()
			reject(err)
		}
		server.once('error', onError)
		server.listen(port, LISTEN_HOST, () => {
			server.off('error', onError)
			server.on('error', (err) => log.error(`[WPT-EMU] serveur : ${err.message}`))
			const actual = server.address().port
			log.info(`[WPT-EMU] a l'ecoute sur https://localhost:${actual}`)
			resolve({
				port: actual,
				address: LISTEN_HOST,
				close: () => new Promise((done) => io.close(() => done())),
			})
		})
	})
}

module.exports = { startWptEmulation, originPolicy, SERIAL_ROUTE }
