/**
 * Serveur de l'émulateur WPT — test d'intégration réseau réel.
 *
 * Le client est `socket.io-client` 2.x, la même génération que celle embarquée
 * par `@wynd/redux-wps-middleware` dans le POS (engine.io 3). Si le serveur
 * socket.io 4 n'accepte pas EIO3, la poignée de main échoue : c'est ce que ce
 * test garde.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const io = require('socket.io-client')

const { ensureCertificate } = require('../../src/main/helpers/wpt_emulation/certificate')
const { createSystemPlugin } = require('../../src/main/helpers/wpt_emulation/system_plugin')
const { startWptEmulation } = require('../../src/main/helpers/wpt_emulation/server')

const POS_ORIGIN = 'https://pos.example.azure.net'
const log = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

let dir, tls, emu, l
let serial = { serial: 'SN-TEST', source: 'bios', forced: false }

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-emu-srv-'))
	tls = ensureCertificate({ dir, log: log() })
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

beforeEach(async () => {
	l = log()
	serial = { serial: 'SN-TEST', source: 'bios', forced: false }
	const plugin = createSystemPlugin({ resolveSerial: async () => serial, version: '9.9.9', log: l })
	emu = await startWptEmulation({ port: 0, tls, allowedOrigins: [POS_ORIGIN], plugin, log: l })
})
afterEach(async () => {
	await emu.close()
})

const connect = (origin, transports = ['websocket']) =>
	io(`https://localhost:${emu.port}`, {
		forceNew: true,
		reconnection: false,
		rejectUnauthorized: false,
		forceNode: true, // cf connect_to_wpt.js : Node >= 22 a un WebSocket global sans options TLS
		transports,
		extraHeaders: origin ? { origin } : {},
	})

const ask = (socket, event) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`pas de réponse à ${event}`)), 3000)
		socket.once(event, (data) => {
			clearTimeout(t)
			resolve({ ok: true, data })
		})
		socket.once(`${event}.error`, (data) => {
			clearTimeout(t)
			resolve({ ok: false, data })
		})
		socket.emit(event)
	})

const connected = (socket) =>
	new Promise((resolve, reject) => {
		socket.once('connect', resolve)
		socket.once('connect_error', reject)
		socket.once('error', reject)
	})

const get = (p, headers = {}, method = 'GET') =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{ host: 'localhost', port: emu.port, path: p, method, headers, rejectUnauthorized: false },
			(res) => {
				let body = ''
				res.on('data', (c) => (body += c))
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
			},
		)
		req.on('error', reject)
		req.end()
	})

describe('socket.io (client v2 / EIO3, comme le POS)', () => {
	it.each([[['websocket']], [['polling', 'websocket']]])('hardwareserial aller-retour (%j)', async (transports) => {
		const s = connect(POS_ORIGIN, transports)
		await connected(s)
		await expect(ask(s, 'hardwareserial')).resolves.toEqual({ ok: true, data: 'SN-TEST' })
		s.close()
	})

	it('envoie version spontanément à la connexion (le middleware l attend)', async () => {
		const s = connect(POS_ORIGIN)
		const version = new Promise((resolve) => s.once('version', resolve))
		await connected(s)
		await expect(version).resolves.toContain('9.9.9')
		s.close()
	})

	it('sans serial → hardwareserial.error', async () => {
		serial = null
		const s = connect(POS_ORIGIN)
		await connected(s)
		const r = await ask(s, 'hardwareserial')
		expect(r.ok).toBe(false)
		expect(r.data.code).toBe('NO_SERIAL')
		s.close()
	})

	it('restart est refusé', async () => {
		const s = connect(POS_ORIGIN)
		await connected(s)
		const r = await ask(s, 'restart')
		expect(r).toEqual({ ok: false, data: expect.objectContaining({ code: 'REFUSED' }) })
		s.close()
	})

	it('une origine non autorisée est refusée à la poignée de main', async () => {
		const s = connect('https://evil.example.com')
		await expect(connected(s)).rejects.toBeDefined()
		s.close()
		expect(l.warn).toHaveBeenCalledWith(expect.stringContaining('evil.example.com'))
	})

	it('sans Origin (outil local, pas une page web) → accepté', async () => {
		const s = connect(null)
		await connected(s)
		await expect(ask(s, 'hardwareserial')).resolves.toEqual({ ok: true, data: 'SN-TEST' })
		s.close()
	})
})

describe('HTTP /System/api/hardwareserial (contrat WPT)', () => {
	it('200 + serial en JSON, CORS pour l origine du POS', async () => {
		const r = await get('/System/api/hardwareserial', { origin: POS_ORIGIN })
		expect(r.status).toBe(200)
		expect(JSON.parse(r.body)).toBe('SN-TEST')
		expect(r.headers['access-control-allow-origin']).toBe(POS_ORIGIN)
	})

	it('500 {code,message} sans serial', async () => {
		serial = null
		const r = await get('/System/api/hardwareserial')
		expect(r.status).toBe(500)
		expect(JSON.parse(r.body)).toEqual(expect.objectContaining({ code: 'NO_SERIAL' }))
	})

	it('403 pour une origine non autorisée', async () => {
		const r = await get('/System/api/hardwareserial', { origin: 'https://evil.example.com' })
		expect(r.status).toBe(403)
	})

	it('404 ailleurs', async () => {
		expect((await get('/System/api/restart', { origin: POS_ORIGIN })).status).toBe(404)
	})

	it('préflight réseau privé : Access-Control-Allow-Private-Network pour l origine du POS', async () => {
		const r = await get(
			'/System/api/hardwareserial',
			{
				origin: POS_ORIGIN,
				'access-control-request-method': 'GET',
				'access-control-request-private-network': 'true',
			},
			'OPTIONS',
		)
		expect(r.status).toBe(204)
		expect(r.headers['access-control-allow-private-network']).toBe('true')
		expect(r.headers['access-control-allow-origin']).toBe(POS_ORIGIN)
	})

	it('préflight réseau privé refusé pour une autre origine', async () => {
		const r = await get(
			'/socket.io/?EIO=3&transport=polling',
			{
				origin: 'https://evil.example.com',
				'access-control-request-method': 'GET',
				'access-control-request-private-network': 'true',
			},
			'OPTIONS',
		)
		expect(r.headers['access-control-allow-private-network']).toBeUndefined()
	})
})

describe('cycle de vie', () => {
	it('écoute sur la boucle locale uniquement', () => {
		expect(emu.address).toBe('127.0.0.1')
	})

	it('port occupé → rejet explicite (EADDRINUSE), pas de crash', async () => {
		const plugin = createSystemPlugin({ resolveSerial: async () => serial, version: '1', log: l })
		await expect(
			startWptEmulation({ port: emu.port, tls, allowedOrigins: [POS_ORIGIN], plugin, log: l }),
		).rejects.toEqual(expect.objectContaining({ code: 'EADDRINUSE' }))
	})
})
