// electron_log et dialog_err tirent l'API Electron : on les neutralise pour
// pouvoir tester la logique de routage seule.
jest.mock('../../src/main/helpers/electron_log', () => ({
	error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
}))
jest.mock('../../src/main/dialog_err', () => jest.fn())

const showDialogError = require('../../src/main/dialog_err')
const { reportBootFailure, serializeError, loaderIsUsable } = require('../../src/main/helpers/boot_failure')

const makeLoader = (over = {}) => ({
	isDestroyed: () => false,
	isVisible: () => true,
	show: jest.fn(),
	webContents: { isDestroyed: () => false, send: jest.fn() },
	...over,
})
const makeStore = (loader) => ({ windows: { loader: { current: loader }, container: { current: null } } })

beforeEach(() => jest.clearAllMocks())

describe('serializeError', () => {
	it('preserve le code applicatif et le message', () => {
		const err = Object.assign(new Error('Cannot connect to Wyndpostools'), {
			api_code: 'WPT_CONNECTION_TIMEOUT', status: 408,
		})
		expect(serializeError(err)).toEqual({
			code: 'WPT_CONNECTION_TIMEOUT',
			message: 'Cannot connect to Wyndpostools',
			detail: null,
			status: 408,
		})
	})

	it('remonte le detail agrege des erreurs de config', () => {
		const err = Object.assign(new Error('config invalide'), { messages: 'url: required' })
		expect(serializeError(err).detail).toBe('url: required')
	})

	it('ne jette pas sur une erreur absente', () => {
		expect(serializeError(null).code).toBe('INTERNAL_ERROR')
	})
})

describe('loaderIsUsable', () => {
	it('accepte un loader vivant', () => {
		expect(loaderIsUsable(makeStore(makeLoader()))).toBe(true)
	})
	it('refuse un loader absent ou detruit', () => {
		expect(loaderIsUsable(makeStore(null))).toBe(false)
		expect(loaderIsUsable(makeStore(makeLoader({ isDestroyed: () => true })))).toBe(false)
	})
	it('refuse un loader dont le webContents est detruit', () => {
		const l = makeLoader({ webContents: { isDestroyed: () => true, send: jest.fn() } })
		expect(loaderIsUsable(makeStore(l))).toBe(false)
	})
})

describe('reportBootFailure', () => {
	it('envoie l erreur au loader et n ouvre PAS la dialog native', () => {
		const loader = makeLoader()
		const ok = reportBootFailure(makeStore(loader), new Error('boom'))
		expect(ok).toBe(true)
		expect(loader.webContents.send).toHaveBeenCalledWith('boot_error', expect.objectContaining({ message: 'boom' }))
		expect(showDialogError).not.toHaveBeenCalled()
	})

	it('affiche le loader s il etait masque', () => {
		const loader = makeLoader({ isVisible: () => false })
		reportBootFailure(makeStore(loader), new Error('boom'))
		expect(loader.show).toHaveBeenCalled()
	})

	it('retombe sur la dialog native quand le loader est inutilisable', () => {
		const ok = reportBootFailure(makeStore(null), new Error('boom'))
		expect(ok).toBe(false)
		expect(showDialogError).toHaveBeenCalled()
	})

	it('retombe sur la dialog native si l envoi IPC jette', () => {
		const loader = makeLoader({
			webContents: { isDestroyed: () => false, send: () => { throw new Error('IPC mort') } },
		})
		const ok = reportBootFailure(makeStore(loader), new Error('boom'))
		expect(ok).toBe(false)
		expect(showDialogError).toHaveBeenCalled()
	})
})
