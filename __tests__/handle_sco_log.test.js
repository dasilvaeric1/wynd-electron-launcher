/**
 * Tests du sink unique des logs SCO/POS (handle_sco_log).
 *
 * Couvre les deux features du ticket [SCO] "store JS errors using Electron
 * built-in capabilities" :
 *  - persistance fichier locale (logs/app/) OPT-IN via config.log.persist_app,
 *    désactivée si l'entrée est absente ;
 *  - relais vers le BO central inchangé (filtré par config.central.log).
 */

const handleScoLog = require('../src/main/helpers/handle_sco_log')

function makeStore(conf) {
	const appLog = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
	const emit = jest.fn()
	return {
		store: { conf, appLog, wpt: { socket: { emit } } },
		appLog,
		emit,
	}
}

describe('handle_sco_log — persistance fichier (log.persist_app)', () => {
	test("entrée absente → pas d'écriture fichier (off par défaut)", () => {
		const { store, appLog } = makeStore({ log: {} })
		handleScoLog(store, 'ERROR', { flat: 'boom' })
		expect(appLog.error).not.toHaveBeenCalled()
		expect(appLog.info).not.toHaveBeenCalled()
	})

	test("section log absente → pas d'écriture, pas de crash", () => {
		const { store, appLog } = makeStore({})
		handleScoLog(store, 'ERROR', { flat: 'boom' })
		expect(appLog.error).not.toHaveBeenCalled()
	})

	test('persist_app=true + ERROR → appLog.error(flat)', () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'ERROR', { flat: 'boom' })
		expect(appLog.error).toHaveBeenCalledWith('boom')
	})

	test('persist_app=true + INFO → appLog.info', () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'INFO', { flat: 'hello' })
		expect(appLog.info).toHaveBeenCalledWith('hello')
		expect(appLog.error).not.toHaveBeenCalled()
	})

	test('persist_app=true + WARN → appLog.warn', () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		appLog.warn = jest.fn()
		handleScoLog(store, 'WARN', { flat: 'attention' })
		expect(appLog.warn).toHaveBeenCalledWith('attention')
		expect(appLog.error).not.toHaveBeenCalled()
	})

	test('niveau inconnu → fallback INFO', () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'WAT', { flat: 'x' })
		expect(appLog.info).toHaveBeenCalledWith('x')
	})

	test('flat objet → sérialisé en JSON', () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'ERROR', { flat: { a: 1 } })
		expect(appLog.error).toHaveBeenCalledWith('{"a":1}')
	})

	test("flat vide → pas d'écriture", () => {
		const { store, appLog } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'ERROR', { flat: '' })
		expect(appLog.error).not.toHaveBeenCalled()
	})
})

describe('handle_sco_log — relais central (central.log)', () => {
	test('central.log absent → pas de relais', () => {
		const { store, emit } = makeStore({ log: { persist_app: true } })
		handleScoLog(store, 'ERROR', { flat: 'boom' })
		expect(emit).not.toHaveBeenCalled()
	})

	test('central.log=error + ERROR → relais avec message brut (raw)', () => {
		const { store, emit } = makeStore({ central: { log: 'error' } })
		handleScoLog(store, 'ERROR', { flat: 'boom', raw: ['boom', { code: 1 }] })
		expect(emit).toHaveBeenCalledTimes(1)
		const [channel, payload] = emit.mock.calls[0]
		expect(channel).toBe('central.message')
		expect(payload.event).toBe('log')
		expect(payload.data).toEqual({
			type: 'error',
			message: ['boom', { code: 1 }],
		})
	})

	test('central.log=error + INFO → pas de relais (niveau insuffisant)', () => {
		const { store, emit } = makeStore({ central: { log: 'error' } })
		handleScoLog(store, 'INFO', { flat: 'info msg' })
		expect(emit).not.toHaveBeenCalled()
	})

	test('raw absent → réutilise flat comme message central', () => {
		const { store, emit } = makeStore({ central: { log: 'info' } })
		handleScoLog(store, 'INFO', { flat: 'only-flat' })
		expect(emit.mock.calls[0][1].data.message).toBe('only-flat')
	})
})
