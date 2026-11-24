/**
 * Serial BIOS de la machine — la valeur que WyndPOSTools renvoyait à
 * `hardwareserial` (plugins/System/lib/SystemDriver).
 *
 * - Windows : WPT faisait `wmic bios get serialnumber`. `wmic` est retiré des
 *   Windows 11 récents ; on lit la même classe Win32_BIOS via PowerShell/CIM.
 * - Linux   : WPT faisait `dmidecode -t system` (root requis). sysfs expose la
 *   même donnée sans lancer de binaire. Le fichier est souvent en 0400 root :
 *   illisible depuis une session caissier → null, et le serial vient alors du
 *   service (appsettings / api/identity) ou du forçage.
 * - macOS   : poste de dev uniquement.
 *
 * Ne jette jamais : une source absente vaut null.
 */

const childProcess = require('node:child_process')
const fsp = require('node:fs/promises')

const EXEC_TIMEOUT_MS = 5000
const LINUX_SERIAL_PATH = '/sys/class/dmi/id/product_serial'

// Valeurs que les BIOS non renseignés renvoient à la place d'un serial.
const PLACEHOLDERS = new Set([
	'tobefilledbyo.e.m.',
	'defaultstring',
	'systemserialnumber',
	'none',
	'n/a',
	'notapplicable',
	'notspecified',
	'0123456789',
])

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function cleanBiosValue(raw) {
	if (typeof raw !== 'string') return null
	const value = raw.trim()
	if (!value) return null
	const compact = value.replace(/\s/g, '').toLowerCase()
	if (PLACEHOLDERS.has(compact) || /^0+$/.test(compact)) return null
	return value
}

function run(execFile, cmd, args) {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
			resolve(err ? null : String(stdout || ''))
		})
	})
}

/**
 * @param {object} [opts]
 * @param {string} [opts.platform]
 * @param {Function} [opts.execFile]
 * @param {(path: string, enc: string) => Promise<string>} [opts.readFile]
 * @returns {Promise<string|null>}
 */
async function readBiosSerial(opts = {}) {
	const platform = opts.platform || process.platform
	const execFile = opts.execFile || childProcess.execFile
	const readFile = opts.readFile || fsp.readFile

	if (platform === 'win32') {
		const out = await run(execFile, 'powershell.exe', [
			'-NoProfile',
			'-NonInteractive',
			'-Command',
			'(Get-CimInstance -ClassName Win32_BIOS).SerialNumber',
		])
		return out === null ? null : cleanBiosValue(out)
	}

	if (platform === 'linux') {
		try {
			return cleanBiosValue(await readFile(LINUX_SERIAL_PATH, 'utf8'))
		} catch {
			return null
		}
	}

	if (platform === 'darwin') {
		const out = await run(execFile, 'ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
		const m = out && /"IOPlatformSerialNumber"\s*=\s*"([^"]*)"/.exec(out)
		return m ? cleanBiosValue(m[1]) : null
	}

	return null
}

module.exports = { readBiosSerial, cleanBiosValue, LINUX_SERIAL_PATH }
