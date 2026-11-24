/**
 * Plugin System émulé : traduit un événement socket en réponse.
 *
 * Contrat repris de WPT (plugins/System/lib/main.js) : la réponse porte le
 * même nom que la requête, l'échec part en `<event>.error`.
 */

const { createSystemPlugin, REFUSED_EVENTS } = require('../../src/main/helpers/wpt_emulation/system_plugin')

const log = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

const plugin = (serial = { serial: 'SN1', source: 'bios', forced: false }, l = log()) =>
	createSystemPlugin({ resolveSerial: async () => serial, version: '2.12.0', log: l })

describe('system_plugin', () => {
	it('hardwareserial → le serial résolu', async () => {
		await expect(plugin().handle('hardwareserial')).resolves.toEqual({ event: 'hardwareserial', payload: 'SN1' })
	})

	it('hardwareserial sans serial → hardwareserial.error NO_SERIAL', async () => {
		const r = await plugin(null).handle('hardwareserial')
		expect(r.event).toBe('hardwareserial.error')
		expect(r.payload.code).toBe('NO_SERIAL')
	})

	it('version → version du launcher, marquée émulée', async () => {
		const r = await plugin().handle('version')
		expect(r.event).toBe('version')
		expect(r.payload).toContain('2.12.0')
	})

	it('plugins → System seul, démarré', async () => {
		const r = await plugin().handle('plugins')
		expect(r.event).toBe('plugins')
		expect(r.payload).toEqual([expect.objectContaining({ name: 'System', enabled: true, started: true })])
	})

	it('infos → porte le serial et signale l émulation', async () => {
		const r = await plugin().handle('infos')
		expect(r.event).toBe('infos')
		expect(r.payload).toEqual(expect.objectContaining({ hardwareserial: 'SN1', emulated: true }))
	})

	it.each(['end', 'restart', 'shutdown', 'chrome.end'])('%s est refusé et journalisé en warn', async (ev) => {
		const l = log()
		const r = await plugin(undefined, l).handle(ev)
		expect(REFUSED_EVENTS.has(ev)).toBe(true)
		expect(r).toEqual({ event: `${ev}.error`, payload: expect.objectContaining({ code: 'REFUSED' }) })
		expect(l.warn).toHaveBeenCalled()
	})

	it('un événement System non émulé répond NOT_SUPPORTED', async () => {
		const r = await plugin().handle('currencies')
		expect(r).toEqual({ event: 'currencies.error', payload: expect.objectContaining({ code: 'NOT_SUPPORTED' }) })
	})

	it('un événement d un autre plugin est ignoré (null) — comme WPT sans ce plugin', async () => {
		await expect(plugin().handle('fastprinter.print')).resolves.toBeNull()
	})

	it('une résolution qui jette devient hardwareserial.error, pas une exception', async () => {
		const p = createSystemPlugin({
			resolveSerial: async () => {
				throw new Error('x')
			},
			version: '1',
			log: log(),
		})
		await expect(p.handle('hardwareserial')).resolves.toEqual(
			expect.objectContaining({ event: 'hardwareserial.error' }),
		)
	})
})
