/**
 * Résolution du serial que l'émulateur WPT renvoie au POS.
 *
 * Sur ces caisses il n'y a plus de WyndPOSTools : c'est le launcher qui répond
 * à `hardwareserial`. Le serial doit pouvoir être FORCÉ (caisse installée à la
 * main, serial BIOS absent ou générique), et sinon rester celui que WPT
 * renvoyait — le serial BIOS — pour que le POS central retrouve la caisse.
 */

const { normalizeSerial, createSerialResolver } = require('../../src/main/helpers/wpt_emulation/serial')

const silentLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

const sources = (over = {}) => ({
	env: {},
	conf: {},
	readAppsettingsSerial: jest.fn(async () => null),
	fetchIdentitySerial: jest.fn(async () => null),
	readBiosSerial: jest.fn(async () => null),
	log: silentLog(),
	...over,
})

describe('normalizeSerial', () => {
	it('retire tous les blancs, comme le POS (sagaHardwareserial)', () => {
		expect(normalizeSerial(' AB 12\tCD\n')).toBe('AB12CD')
	})

	it('rend null pour une valeur vide, blanche ou non textuelle', () => {
		expect(normalizeSerial('')).toBeNull()
		expect(normalizeSerial('  \n')).toBeNull()
		expect(normalizeSerial(null)).toBeNull()
		expect(normalizeSerial(undefined)).toBeNull()
		expect(normalizeSerial({})).toBeNull()
	})

	it('accepte un nombre (ini peut rendre 0042 en nombre)', () => {
		expect(normalizeSerial(42)).toBe('42')
	})
})

describe('createSerialResolver — priorités', () => {
	it('1. la variable d environnement gagne sur tout', async () => {
		const s = sources({
			env: { EL_WPT_HARDWARE_SERIAL: 'ENV-1' },
			conf: { hardware_serial: 'INI-1' },
			readBiosSerial: jest.fn(async () => 'BIOS-1'),
		})
		const r = await createSerialResolver(s).resolve()
		expect(r).toEqual({ serial: 'ENV-1', source: 'env', forced: true })
		expect(s.readBiosSerial).not.toHaveBeenCalled()
	})

	it('2. config.ini hardware_serial ensuite', async () => {
		const s = sources({ conf: { hardware_serial: 'INI 1' }, readBiosSerial: jest.fn(async () => 'BIOS-1') })
		const r = await createSerialResolver(s).resolve()
		expect(r).toEqual({ serial: 'INI1', source: 'config.ini', forced: true })
	})

	it('un forçage vide ou blanc passe à la source suivante', async () => {
		const s = sources({
			env: { EL_WPT_HARDWARE_SERIAL: '   ' },
			conf: { hardware_serial: '' },
			readBiosSerial: jest.fn(async () => 'BIOS-1'),
		})
		const r = await createSerialResolver(s).resolve()
		expect(r).toEqual({ serial: 'BIOS-1', source: 'bios', forced: false })
	})

	it('3. appsettings du service, puis 4. /api/identity, puis 5. BIOS', async () => {
		const a = sources({ readAppsettingsSerial: jest.fn(async () => 'APP-1'), readBiosSerial: jest.fn(async () => 'B') })
		expect(await createSerialResolver(a).resolve()).toEqual({ serial: 'APP-1', source: 'appsettings', forced: false })

		const b = sources({ fetchIdentitySerial: jest.fn(async () => 'ID-1'), readBiosSerial: jest.fn(async () => 'B') })
		expect(await createSerialResolver(b).resolve()).toEqual({ serial: 'ID-1', source: 'identity', forced: false })

		const c = sources({ readBiosSerial: jest.fn(async () => 'B-1') })
		expect(await createSerialResolver(c).resolve()).toEqual({ serial: 'B-1', source: 'bios', forced: false })
	})

	it('une source qui jette est ignorée, pas fatale', async () => {
		const s = sources({
			readAppsettingsSerial: jest.fn(async () => {
				throw new Error('json cassé')
			}),
			readBiosSerial: jest.fn(async () => 'B-1'),
		})
		expect(await createSerialResolver(s).resolve()).toEqual({ serial: 'B-1', source: 'bios', forced: false })
		expect(s.log.warn).toHaveBeenCalled()
	})

	it('rend null quand aucune source ne répond', async () => {
		expect(await createSerialResolver(sources()).resolve()).toBeNull()
	})
})

describe('createSerialResolver — cache et journal', () => {
	it('met en cache un succès : les sources ne sont interrogées qu une fois', async () => {
		const s = sources({ readBiosSerial: jest.fn(async () => 'B-1') })
		const resolver = createSerialResolver(s)
		await resolver.resolve()
		await resolver.resolve()
		expect(s.readBiosSerial).toHaveBeenCalledTimes(1)
	})

	it('ne met PAS en cache un échec : la requête suivante réessaie', async () => {
		const bios = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('B-2')
		const resolver = createSerialResolver(sources({ readBiosSerial: bios }))
		expect(await resolver.resolve()).toBeNull()
		expect(await resolver.resolve()).toEqual({ serial: 'B-2', source: 'bios', forced: false })
	})

	it('un serial forcé est annoncé en warn (repérable dans les journaux remontés)', async () => {
		const s = sources({ conf: { hardware_serial: 'X' } })
		await createSerialResolver(s).resolve()
		expect(s.log.warn).toHaveBeenCalledWith(expect.stringContaining('FORCE'))
	})
})
