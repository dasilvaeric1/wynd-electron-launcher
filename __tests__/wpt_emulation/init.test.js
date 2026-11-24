/**
 * Démarrage de l'émulateur WPT depuis la conf du launcher.
 *
 * Ce qui est gardé ici : les cas où l'émulateur NE DOIT PAS démarrer
 * (désactivé, port en conflit avec un vrai WPT, aucune origine autorisée),
 * et la déduction des origines autorisées depuis `url=`.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-emu-init-'))
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

jest.mock('electron', () => ({
	app: { getPath: () => mockUserData, getVersion: () => '2.12.0' },
}))
jest.mock('../../src/main/helpers/electron_log', () => mockLog)

const { initWptEmulation, resolveAllowedOrigins, readServiceSerial } = require('../../src/main/helpers/wpt_emulation')

afterAll(() => fs.rmSync(mockUserData, { recursive: true, force: true }))
beforeEach(() => Object.values(mockLog).forEach((f) => f.mockClear()))

const POS = { href: 'https://pos.example.azure.net/caisse/', protocol: 'https:' }

describe('resolveAllowedOrigins', () => {
	it('déduit l origine de url= (sans chemin)', () => {
		expect(resolveAllowedOrigins({ url: POS, wpt_emulation: {} })).toEqual(['https://pos.example.azure.net'])
	})

	it('allowed_origins explicite gagne, liste séparée par des virgules', () => {
		expect(
			resolveAllowedOrigins({
				url: POS,
				wpt_emulation: { allowed_origins: ' https://a.example.com/ , https://b.example.com:8443 ' },
			}),
		).toEqual(['https://a.example.com', 'https://b.example.com:8443'])
	})

	it('ignore une entrée illisible ou non http(s)', () => {
		expect(
			resolveAllowedOrigins({ wpt_emulation: { allowed_origins: 'pas une url, file:///x, https://ok.example.com' } }),
		).toEqual(['https://ok.example.com'])
	})

	it('url= locale (file:) ne donne aucune origine', () => {
		expect(resolveAllowedOrigins({ url: { href: 'file:///C:/pos/index.html', protocol: 'file:' }, wpt_emulation: {} })).toEqual([])
	})
})

describe('initWptEmulation — ne démarre pas', () => {
	it('désactivée → null, rien sur le store', async () => {
		const store = { conf: { url: POS, wpt_emulation: { enable: false, port: 9963 } } }
		await expect(initWptEmulation(store)).resolves.toBeNull()
		expect(store.wptEmulation).toBeUndefined()
	})

	it('un vrai WPT activé sur le même port → refus explicite', async () => {
		const store = {
			conf: {
				url: POS,
				wpt: { enable: true, url: { port: '9963', protocol: 'https:' } },
				wpt_emulation: { enable: true, port: 9963 },
			},
		}
		await expect(initWptEmulation(store)).resolves.toBeNull()
		expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('9963'))
	})

	it('aucune origine autorisée → refus explicite (le POS ne pourrait pas se connecter)', async () => {
		const store = { conf: { url: { href: 'file:///x', protocol: 'file:' }, wpt_emulation: { enable: true, port: 9963 } } }
		await expect(initWptEmulation(store)).resolves.toBeNull()
		expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('origine'))
	})
})

describe('initWptEmulation — démarre', () => {
	it('écoute, publie port + empreinte sur le store, et se ferme', async () => {
		const store = {
			conf: { url: POS, wpt_emulation: { enable: true, port: 0, hardware_serial: 'FORCED-1' } },
		}
		const emu = await initWptEmulation(store)
		try {
			expect(emu.port).toBeGreaterThan(0)
			expect(store.wptEmulation.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
			expect(fs.existsSync(path.join(mockUserData, 'wpt-emulation', 'cert.pem'))).toBe(true)
		} finally {
			await emu.close()
		}
	})

	it('un port déjà pris → null et erreur journalisée, pas d exception', async () => {
		const net = require('node:net')
		const blocker = net.createServer()
		await new Promise((r) => blocker.listen(0, '127.0.0.1', r))
		const port = blocker.address().port
		const store = { conf: { url: POS, wpt_emulation: { enable: true, port } } }
		try {
			await expect(initWptEmulation(store)).resolves.toBeNull()
			expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE'))
		} finally {
			blocker.close()
		}
	})
})

describe('readServiceSerial (appsettings du RetailScheduler)', () => {
	const write = (json) => {
		const p = path.join(mockUserData, `appsettings-${Math.random()}.json`)
		fs.writeFileSync(p, typeof json === 'string' ? json : JSON.stringify(json))
		return p
	}

	it('lit CentralApi.CaisseSerialNumber (BOM toléré)', async () => {
		const p = write('\uFEFF' + JSON.stringify({ CentralApi: { CaisseSerialNumber: 'APP-1' } }))
		await expect(readServiceSerial({ path: p }).appsettings()).resolves.toBe('APP-1')
	})

	it('fichier absent → null', async () => {
		await expect(readServiceSerial({ path: '/nexiste/pas.json' }).appsettings()).resolves.toBeNull()
	})

	it('identity interroge le UiPort de l appsettings', async () => {
		const p = write({ UiPort: 6001, CentralApi: {} })
		const get = jest.fn(async () => ({ status: 200, data: { caisseSerial: 'ID-1' } }))
		await expect(readServiceSerial({ path: p, httpGet: get }).identity()).resolves.toBe('ID-1')
		expect(get.mock.calls[0][0]).toBe('http://localhost:6001/api/identity')
	})

	it('identity indisponible → null', async () => {
		const get = jest.fn(async () => {
			throw new Error('ECONNREFUSED')
		})
		await expect(readServiceSerial({ path: '/nexiste/pas.json', httpGet: get }).identity()).resolves.toBeNull()
	})
})
