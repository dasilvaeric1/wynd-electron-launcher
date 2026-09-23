/**
 * open_dev_tools — la console de la <webview> POS, pas seulement celle du
 * conteneur qui l'héberge.
 *
 * Incident Decathlon Argentine du 2026-09-17 : le support demande « l'onglet
 * réseau du POS » pour une erreur à l'ajout d'article. Ctrl+Shift+I n'ouvrait
 * que les DevTools du conteneur React, où le trafic de la page POS n'apparaît
 * pas — la <webview> a son PROPRE webContents. Trois défauts se combinaient :
 *
 *   1. le raccourci envoyait `send("open_dev_tools")` au renderer, canal qui
 *      n'existe ni dans RECEIVE_CHANNELS (preload) ni comme écouteur ;
 *   2. dans index.tsx, `if (menu.password) … else if (view === "webview")`
 *      rendait la branche webview INATTEIGNABLE dès qu'un mot de passe était
 *      configuré, c'est-à-dire sur toute caisse de production ;
 *   3. le retour du pinpad n'envoyait que `main.action/open_dev_tools`, qui
 *      côté principal n'ouvrait que la fenêtre conteneur.
 *
 * Le remède tient ici : le processus principal atteint le guest directement,
 * sans canal IPC, sans DOM, et sans dépendre du mot de passe.
 */

const mockWebContents = { liste: [] }
const mockApp = { ecouteurs: {} }

jest.mock('electron', () => ({
	app: {
		on: (ev, cb) => {
			mockApp.ecouteurs[ev] = cb
		},
	},
	webContents: {
		getAllWebContents: () => mockWebContents.liste,
	},
}))

jest.mock('../src/main/helpers/electron_log', () => ({
	info: jest.fn(),
	warn: jest.fn(),
	debug: jest.fn(),
	error: jest.fn(),
}))

const { ouvrir, surveiller } = require('../src/main/helpers/open_dev_tools')

// Doublure de webContents : `type` décide si c'est un guest de <webview>.
const contents = (type, over = {}) => {
	const wc = {
		detruit: false,
		domReady: null,
		getType: () => type,
		isDestroyed: () => wc.detruit,
		openDevTools: jest.fn(),
		once: jest.fn((ev, cb) => {
			if ('dom-ready' === ev) {
				wc.domReady = cb
			}
		}),
		...over,
	}
	return wc
}

const fenetre = (over = {}) => {
	const win = {
		detruite: false,
		visible: true,
		isDestroyed: () => win.detruite,
		isVisible: () => win.visible,
		webContents: contents('window'),
		...over,
	}
	return win
}

const store = (conteneur, conf = {}) => ({
	conf,
	windows: { container: { current: conteneur } },
})

beforeEach(() => {
	mockWebContents.liste = []
	mockApp.ecouteurs = {}
	delete process.env.EL_DEBUG
})

describe('ouverture immédiate', () => {
	it('ouvre les DevTools du conteneur', () => {
		const win = fenetre()

		expect(ouvrir(store(win))).toStrictEqual(['container'])
		expect(win.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'right' })
	})

	it('ouvre AUSSI celles de la page POS — le défaut corrigé', () => {
		const win = fenetre()
		const pos = contents('webview')
		mockWebContents.liste = [win.webContents, pos]

		expect(ouvrir(store(win))).toStrictEqual(['container', 'webview'])
		// Non docké : un guest ne peut pas s'ancrer dans la fenêtre hôte.
		expect(pos.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
	})

	it('ignore les webContents détruits', () => {
		const mort = contents('webview')
		mort.detruit = true
		mockWebContents.liste = [mort]

		expect(ouvrir(store(null))).toStrictEqual([])
		expect(mort.openDevTools).not.toHaveBeenCalled()
	})

	it("n'ouvre rien sur un conteneur détruit ou caché", () => {
		const detruite = fenetre({ detruite: true })
		expect(ouvrir(store(detruite))).toStrictEqual([])

		const cachee = fenetre()
		cachee.visible = false
		expect(ouvrir(store(cachee))).toStrictEqual([])
	})

	it('ne casse pas quand Electron refuse le guest', () => {
		const recalcitrant = contents('webview', {
			openDevTools: jest.fn(() => {
				throw new Error('The WebView must be attached to the DOM')
			}),
		})
		mockWebContents.liste = [recalcitrant]

		expect(() => ouvrir(store(null))).not.toThrow()
		expect(ouvrir(store(null))).toStrictEqual([])
	})
})

describe('ouverture différée', () => {
	it("retient la demande quand la <webview> n'existe pas encore", () => {
		// C'est le cas COURANT, pas l'exception : la <webview> n'est montée que
		// lorsque WPT est connecté et l'URL du POS chargée. Demander les DevTools
		// avant — au démarrage, ou pendant que la caisse charge — était perdu.
		const monStore = store(fenetre())
		ouvrir(monStore)
		surveiller(monStore)

		const pos = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, pos)

		expect(pos.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
	})

	it("n'ouvre rien à l'attachement quand personne n'a rien demandé", () => {
		const monStore = store(fenetre())
		surveiller(monStore)

		const pos = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, pos)

		expect(pos.openDevTools).not.toHaveBeenCalled()
	})

	it('ne sert la demande retenue QU UNE fois', () => {
		const monStore = store(fenetre())
		ouvrir(monStore)
		surveiller(monStore)

		const premier = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, premier)
		// Remontage plus tard (reconnexion WPT, rechargement) : on ne veut pas
		// voir les DevTools resurgir d'elles-mêmes une heure après.
		const second = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, second)

		expect(premier.openDevTools).toHaveBeenCalledTimes(1)
		expect(second.openDevTools).not.toHaveBeenCalled()
	})

	it('laisse passer les webContents qui ne sont pas des guests', () => {
		const monStore = store(fenetre())
		ouvrir(monStore)
		surveiller(monStore)

		const autre = contents('window')
		mockApp.ecouteurs['web-contents-created'](null, autre)

		expect(autre.openDevTools).not.toHaveBeenCalled()
	})

	it('repasse par dom-ready quand le guest refuse encore', () => {
		const monStore = store(fenetre())
		ouvrir(monStore)
		surveiller(monStore)

		let pret = false
		const pos = contents('webview', {
			openDevTools: jest.fn(() => {
				if (!pret) {
					throw new Error('dom-ready not emitted')
				}
			}),
		})
		mockApp.ecouteurs['web-contents-created'](null, pos)
		expect(pos.once).toHaveBeenCalledWith('dom-ready', expect.any(Function))

		pret = true
		pos.domReady()
		expect(pos.openDevTools).toHaveBeenCalledTimes(2)
	})
})

describe('mode debug', () => {
	it("ouvre d'office la console du POS quand debug=1", () => {
		// Sans cela, une caisse en debug n'ouvrait les DevTools que du conteneur :
		// la question « et s'ils ont un debug = 1 ? » n'avait pas de bonne réponse.
		const monStore = store(fenetre(), { debug: true })
		surveiller(monStore)

		const pos = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, pos)

		expect(pos.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
	})

	it('respecte EL_DEBUG au même titre', () => {
		process.env.EL_DEBUG = '1'
		const monStore = store(fenetre(), {})
		surveiller(monStore)

		const pos = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, pos)

		expect(pos.openDevTools).toHaveBeenCalled()
	})

	it('ne se déclenche pas sans debug ni demande', () => {
		const monStore = store(fenetre(), { debug: false })
		surveiller(monStore)

		const pos = contents('webview')
		mockApp.ecouteurs['web-contents-created'](null, pos)

		expect(pos.openDevTools).not.toHaveBeenCalled()
	})
})
