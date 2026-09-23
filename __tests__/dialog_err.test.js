/**
 * dialog_err — journaliser l'état ne doit pas DÉTRUIRE l'état.
 *
 * Pour écrire le store dans le journal, `dialogErr` remplaçait les handles
 * vivants par la chaîne `'...'` — dans le store lui-même, qui est partagé avec
 * tout le processus principal. Juste après, il appelle `app.quit()`.
 *
 * `before-quit` (src/main/index.js) fait alors :
 *
 *   if (wpt.process && !wpt.process.killed) { await killWPT(wpt) }
 *
 * `'...'` est vrai, `'...'.killed` est `undefined`, on entre ; `kill_wpt.js`
 * appelle `child.once('exit')` sur une chaîne et lève « child.once is not a
 * function ». L'erreur est avalée par le catch, et **le processus WPT survit au
 * launcher** : port 9963 encore pris au démarrage suivant, que le launcher
 * force-kill alors via netstat. Constaté dans le journal d'une caisse
 * Decathlon Argentine le 2026-09-17.
 *
 * Même mécanisme pour `store.wpt.socket`, mis à `null` : `before-quit` ne le
 * ferme donc jamais.
 *
 * Ces tests verrouillent la séparation : une COPIE part au journal, le store
 * vivant n'est pas touché.
 */

const mockApp = { quit: jest.fn() }
const mockDialog = { showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })) }
const mockLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }

jest.mock('electron', () => ({
	app: mockApp,
	dialog: mockDialog,
	clipboard: { writeText: jest.fn() },
}))

jest.mock('../src/main/helpers/electron_log', () => mockLog)

const dialogErr = require('../src/main/dialog_err')

// Doublures : ce qui compte est qu'elles ne soient PAS des chaînes après coup.
const fenetre = (nom) => {
	const win = { nom, isVisible: () => true, hide: jest.fn(), webContents: {} }
	win.webContents.hote = win // référence circulaire, comme un vrai BrowserWindow
	return win
}

const faireStore = () => {
	const conteneur = fenetre('container')
	const store = {
		conf: { view: 'webview' },
		path: { conf: 'C:\\cfg\\config.ini' },
		http: { close: jest.fn() },
		appLog: { write: jest.fn() },
		screens: [{ width: 1920, height: 1080, x: 0, y: 0 }],
		wpt: {
			process: { pid: 4242, once: jest.fn(), kill: jest.fn(), killed: false },
			socket: { id: 'abc', close: jest.fn(), connected: true },
			pid: 4242,
		},
		windows: {
			container: { current: conteneur },
			loader: { current: fenetre('loader'), width: 420, height: 260 },
			// Ajouté après l'écriture de dialog_err, et jamais pris en compte par
			// son assainissement manuel : c'est lui qui rendait le store
			// non sérialisable.
			customer: { current: fenetre('customer'), screenIndex: 1 },
		},
	}
	return store
}

const attendreDialogue = () => new Promise((res) => setImmediate(res))

beforeEach(() => {
	mockApp.quit.mockClear()
	mockLog.error.mockClear()
	mockDialog.showMessageBox.mockClear()
	delete process.env.EL_DEBUG
})

describe('le store vivant est préservé', () => {
	it('laisse le handle du processus WPT intact', async () => {
		const store = faireStore()
		const processusWpt = store.wpt.process

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		// Le cas qui orphelinait WPT : `before-quit` doit encore pouvoir le tuer.
		expect(store.wpt.process).toBe(processusWpt)
		expect(typeof store.wpt.process.once).toBe('function')
	})

	it('laisse le socket WPT intact pour que la sortie le ferme', async () => {
		const store = faireStore()
		const socket = store.wpt.socket

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		expect(store.wpt.socket).toBe(socket)
	})

	it('laisse les fenêtres et le serveur http intacts', async () => {
		const store = faireStore()
		const conteneur = store.windows.container.current
		const http = store.http

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		expect(store.windows.container.current).toBe(conteneur)
		expect(store.windows.loader.current).not.toBe('...')
		expect(store.windows.customer.current).not.toBe('...')
		expect(store.http).toBe(http)
		expect(store.appLog).not.toBe('...')
	})
})

describe("l'état journalisé", () => {
	const etatJournalise = () => {
		const ligne = mockLog.error.mock.calls
			.map((c) => String(c[0]))
			.find((m) => m.startsWith('[STATE] > '))
		return ligne ? ligne.slice('[STATE] > '.length) : null
	}

	it('reste sérialisable malgré les références circulaires', async () => {
		const store = faireStore()

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		const etat = etatJournalise()
		expect(etat).not.toBeNull()
		expect(etat).not.toContain('non serialisable')
		expect(() => JSON.parse(etat)).not.toThrow()
	})

	it('remplace les handles par un marqueur au lieu de les déverser', async () => {
		const store = faireStore()

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		const etat = JSON.parse(etatJournalise())
		expect(etat.wpt.process).toBe('...')
		expect(etat.wpt.socket).toBe('...')
		expect(etat.windows.container.current).toBe('...')
		expect(etat.windows.customer.current).toBe('...')
		expect(etat.http).toBe('...')
		expect(etat.appLog).toBe('...')
	})

	it('conserve ce qui sert vraiment au diagnostic', async () => {
		const store = faireStore()

		dialogErr(store, new Error('boom'))
		await attendreDialogue()

		const etat = JSON.parse(etatJournalise())
		// Le pid survit au marqueur : c'est lui qu'on cherche quand un WPT
		// fantôme tient encore le port.
		expect(etat.wpt.pid).toBe(4242)
		expect(etat.conf.view).toBe('webview')
		expect(etat.path.conf).toBe('C:\\cfg\\config.ini')
		expect(etat.screens).toHaveLength(1)
		expect(etat.windows.loader.width).toBe(420)
	})

	it('supporte un store sans section wpt ni fenêtres', async () => {
		const store = { conf: null }

		expect(() => dialogErr(store, new Error('tot'))).not.toThrow()
		await attendreDialogue()

		expect(etatJournalise()).not.toBeNull()
	})
})

describe('comportement inchangé', () => {
	it('quitte après le dialogue', async () => {
		dialogErr(faireStore(), new Error('boom'))
		await attendreDialogue()

		expect(mockApp.quit).toHaveBeenCalled()
	})

	it('ne quitte pas en EL_DEBUG=loader', async () => {
		process.env.EL_DEBUG = 'loader'

		dialogErr(faireStore(), new Error('boom'))
		await attendreDialogue()

		expect(mockApp.quit).not.toHaveBeenCalled()
	})

	it("journalise l'erreur d'origine", async () => {
		dialogErr(faireStore(), new Error('boom'))
		await attendreDialogue()

		const messages = mockLog.error.mock.calls.map((c) => String(c[0]))
		expect(messages.some((m) => m.includes('boom'))).toBe(true)
	})
})
