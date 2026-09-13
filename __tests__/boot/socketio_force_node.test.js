// Verrouille l'option forceNode sur tous les clients socket.io du main.
//
// Node >= 22 (donc Electron 42) expose un WebSocket GLOBAL — celui d'undici —
// et engine.io-client 3 le prefere au module `ws` des qu'il existe. undici
// n'accepte aucune option TLS : sur un WPT en HTTPS a certificat auto-signe,
// la connexion echoue en « websocket error ». forceNode: true ramene le
// chemin `ws`, seul a recevoir rejectUnauthorized.
jest.mock('../../src/main/helpers/electron_log', () => ({
	error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
}))

const captured = []
jest.mock('socket.io-client', () => {
	return jest.fn((url, opts) => {
		captured.push({ url, opts })
		const handlers = {}
		const socket = {
			on: (e, h) => { handlers[e] = h; return socket },
			once: (e, h) => { handlers[e] = h; return socket },
			_handlers: handlers,
			off: () => socket,
			removeListener: () => socket,
			removeAllListeners: () => socket,
			emit: () => socket,
			connect: () => socket,
			close: () => socket,
			destroy: () => socket,
		}
		return socket
	})
})

const connectToWpt = require('../../src/main/helpers/connect_to_wpt')

// connect_to_wpt arme un setTimeout pour son delai de connexion : sans faux
// timers il reste pendant apres le test et Jest signale un handle ouvert.
beforeEach(() => {
	captured.length = 0
	require('socket.io-client').mockClear()
	jest.useFakeTimers()
})
afterEach(() => {
	jest.clearAllTimers()
	jest.useRealTimers()
})

describe('connect_to_wpt', () => {
	const conf = { wpt: { connection_timeout: 10 } }

	it('passe forceNode pour eviter le WebSocket global d undici', () => {
		connectToWpt(conf, 'https://localhost:9963', null).catch(() => {})
		expect(captured).toHaveLength(1)
		expect(captured[0].opts.forceNode).toBe(true)
	})

	it('conserve rejectUnauthorized, sans effet sans forceNode', () => {
		connectToWpt(conf, 'https://localhost:9963', null).catch(() => {})
		expect(captured[0].opts.rejectUnauthorized).toBe(false)
	})

	it('reste en transport websocket (pas de repli polling)', () => {
		// Le repli polling connecte aussi, mais l'upgrade vers websocket echoue
		// pour la meme raison : on resterait en long-polling, avec la latence
		// que cela implique sur un lecteur code-barres.
		connectToWpt(conf, 'https://localhost:9963', null).catch(() => {})
		expect(captured[0].opts.transports).toEqual(['websocket'])
	})
})

describe('erreurs renvoyees par WPT', () => {
	// WPT repond `<evenement>.error` quand il ne peut pas servir une requete
	// (ex. « [System] - Not running plugin »). Sans ces ecouteurs, le launcher
	// attendait l'expiration du delai et masquait la vraie cause derriere un
	// WPT_CONNECTION_TIMEOUT.
	const conf = { wpt: { connection_timeout: 10 } }

	// mockClear() remet results a zero a chaque test : le socket courant est
	// donc le dernier cree.
	const socketDe = () => {
		const r = require('socket.io-client').mock.results
		return r[r.length - 1].value
	}

	it('ecoute infos.error, plugins.error et version.error', () => {
		connectToWpt(conf, 'https://localhost:9963', null).catch(() => {})
		const h = socketDe()._handlers
		expect(Object.keys(h)).toEqual(expect.arrayContaining(['infos.error', 'plugins.error', 'version.error']))
	})

	it('rejette immediatement avec le message de WPT', async () => {
		const p = connectToWpt(conf, 'https://localhost:9963', null)
		socketDe()._handlers['infos.error'](new Error('[System] - Not running plugin'))
		await expect(p).rejects.toThrow(/Not running plugin/)
	})

	it('nomme la requete refusee dans l erreur', async () => {
		const p = connectToWpt(conf, 'https://localhost:9963', null)
		socketDe()._handlers['plugins.error'](new Error('boom'))
		await expect(p).rejects.toThrow(/plugins/)
	})
})
