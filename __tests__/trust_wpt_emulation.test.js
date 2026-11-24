/**
 * trust_wpt_certificate × émulateur WPT.
 *
 * Quand le launcher émule WPT, c'est SON certificat qu'il accepte sur
 * localhost:<port> — reconnu à l'empreinte, pas à l'hôte. La règle « hôte de
 * wpt.url » ne suffit plus ici : default_config pose `wpt.url=localhost:9963`
 * même WPT désactivé, et accepterait alors n'importe quel certificat présenté
 * sur ce port (un autre processus local qui l'occuperait avant nous).
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const mockApp = { ecouteurs: {} }
const mockLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }

jest.mock('electron', () => ({
	app: { on: (ev, cb) => { mockApp.ecouteurs[ev] = cb } },
}))
jest.mock('../src/main/helpers/electron_log', () => mockLog)

const trustWptCertificate = require('../src/main/helpers/trust_wpt_certificate')
const { ensureCertificate } = require('../src/main/helpers/wpt_emulation/certificate')

let ours, other, dirs
beforeAll(() => {
	dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'tw-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'tw-b-'))]
	ours = ensureCertificate({ dir: dirs[0], log: mockLog })
	other = ensureCertificate({ dir: dirs[1], log: mockLog })
})
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
beforeEach(() => { mockApp.ecouteurs = {} })

// Conf par défaut : wpt désactivé mais wpt.url posé à localhost:9963.
const store = (emu) => ({
	conf: { wpt: { enable: false, url: { host: 'localhost:9963', href: 'http://localhost:9963/' } } },
	wptEmulation: emu,
})

const verifier = (url, pem) => {
	let accepte = null
	mockApp.ecouteurs['certificate-error'](
		{ preventDefault: () => {} }, {}, url, 'ERR_CERT_AUTHORITY_INVALID', { data: pem }, (ok) => { accepte = ok },
	)
	return accepte
}

describe('émulateur actif', () => {
	const emu = () => ({ port: 9963, fingerprint256: ours.fingerprint256 })

	it('accepte NOTRE certificat sur localhost:<port> et 127.0.0.1:<port>', () => {
		trustWptCertificate(store(emu()))
		expect(verifier('https://localhost:9963/socket.io/?EIO=3', ours.cert)).toBe(true)
		expect(verifier('wss://localhost:9963/socket.io/?EIO=3', ours.cert)).toBe(true)
		expect(verifier('https://127.0.0.1:9963/System/api/hardwareserial', ours.cert)).toBe(true)
	})

	it('refuse un AUTRE certificat sur le même hôte, malgré wpt.url', () => {
		trustWptCertificate(store(emu()))
		expect(verifier('https://localhost:9963/', other.cert)).toBe(false)
		expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('empreinte'))
	})

	it('refuse un certificat absent ou illisible', () => {
		trustWptCertificate(store(emu()))
		expect(verifier('https://localhost:9963/', undefined)).toBe(false)
		expect(verifier('https://localhost:9963/', 'pas un pem')).toBe(false)
	})

	it('ne change rien pour un autre hôte (le POS distant reste vérifié)', () => {
		trustWptCertificate(store(emu()))
		expect(verifier('https://pos.exemple.com/', ours.cert)).toBe(false)
	})
})

describe('émulateur inactif', () => {
	it('règle historique inchangée : hôte de wpt.url accepté', () => {
		trustWptCertificate(store(undefined))
		expect(verifier('https://localhost:9963/', other.cert)).toBe(true)
	})
})
