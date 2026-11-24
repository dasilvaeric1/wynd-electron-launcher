/**
 * Lecture du serial BIOS — la valeur que WyndPOSTools renvoyait.
 *
 * WPT faisait `wmic bios get serialnumber` (Windows) et `dmidecode` (Linux).
 * `wmic` a disparu des Windows 11 récents : on passe par PowerShell / CIM, qui
 * lit la même classe Win32_BIOS. Sous Linux, sysfs expose la même donnée que
 * dmidecode, sans le lancer.
 */

const { readBiosSerial, cleanBiosValue } = require('../../src/main/helpers/wpt_emulation/bios_serial')

const execOk = (stdout) => jest.fn((cmd, args, opts, cb) => cb(null, stdout, ''))
const execKo = () => jest.fn((cmd, args, opts, cb) => cb(new Error('boom'), '', 'boom'))

describe('cleanBiosValue', () => {
	it('écarte les valeurs génériques des BIOS non renseignés', () => {
		for (const v of ['To be filled by O.E.M.', 'Default string', 'System Serial Number', '0', 'None', '00000000']) {
			expect(cleanBiosValue(v)).toBeNull()
		}
	})

	it('garde un vrai serial, rogné', () => {
		expect(cleanBiosValue('  PF2ABCDE \r\n')).toBe('PF2ABCDE')
	})
})

describe('readBiosSerial', () => {
	it('win32 : interroge Win32_BIOS via PowerShell', async () => {
		const execFile = execOk('PF2ABCDE\r\n')
		await expect(readBiosSerial({ platform: 'win32', execFile })).resolves.toBe('PF2ABCDE')
		const [cmd, args] = execFile.mock.calls[0]
		expect(cmd).toBe('powershell.exe')
		expect(args.join(' ')).toContain('Win32_BIOS')
	})

	it('linux : lit /sys/class/dmi/id/product_serial', async () => {
		const readFile = jest.fn(async () => 'SN123\n')
		await expect(readBiosSerial({ platform: 'linux', readFile })).resolves.toBe('SN123')
		expect(readFile).toHaveBeenCalledWith('/sys/class/dmi/id/product_serial', 'utf8')
	})

	it('linux : fichier illisible (root seulement) → null, sans jeter', async () => {
		const readFile = jest.fn(async () => {
			throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
		})
		await expect(readBiosSerial({ platform: 'linux', readFile })).resolves.toBeNull()
	})

	it('darwin (dev) : IOPlatformSerialNumber via ioreg', async () => {
		const execFile = execOk('    "IOPlatformSerialNumber" = "C02XYZ"\n')
		await expect(readBiosSerial({ platform: 'darwin', execFile })).resolves.toBe('C02XYZ')
	})

	it('commande en échec → null', async () => {
		await expect(readBiosSerial({ platform: 'win32', execFile: execKo() })).resolves.toBeNull()
	})

	it('plateforme inconnue → null', async () => {
		await expect(readBiosSerial({ platform: 'aix' })).resolves.toBeNull()
	})
})
