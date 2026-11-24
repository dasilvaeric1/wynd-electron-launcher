/**
 * Certificat TLS de l'émulateur WPT.
 *
 * Le POS tourne en HTTPS (Azure) : il ne peut joindre qu'un WPT en HTTPS. Le
 * certificat est auto-signé, généré au premier lancement, réutilisé ensuite —
 * son empreinte est ce que le launcher accepte, et rien d'autre.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { X509Certificate } = require('node:crypto')

const { ensureCertificate } = require('../../src/main/helpers/wpt_emulation/certificate')

const log = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

let dir
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-emu-cert-'))
})
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

describe('ensureCertificate', () => {
	it('génère un certificat localhost + 127.0.0.1 et le persiste', () => {
		const c = ensureCertificate({ dir, log: log() })
		const x = new X509Certificate(c.cert)
		expect(x.subjectAltName).toContain('DNS:localhost')
		expect(x.subjectAltName).toContain('IP Address:127.0.0.1')
		expect(c.fingerprint256).toBe(x.fingerprint256)
		expect(fs.existsSync(path.join(dir, 'cert.pem'))).toBe(true)
		expect(fs.existsSync(path.join(dir, 'key.pem'))).toBe(true)
	})

	it('la clé privée n est lisible que par le propriétaire (hors Windows)', () => {
		ensureCertificate({ dir, log: log() })
		if (process.platform !== 'win32') {
			expect(fs.statSync(path.join(dir, 'key.pem')).mode & 0o077).toBe(0)
		}
	})

	it('réutilise le certificat existant (même empreinte au 2e lancement)', () => {
		const a = ensureCertificate({ dir, log: log() })
		const b = ensureCertificate({ dir, log: log() })
		expect(b.fingerprint256).toBe(a.fingerprint256)
	})

	it('régénère un certificat proche de l expiration', () => {
		const a = ensureCertificate({ dir, log: log() })
		const validTo = new Date(new X509Certificate(a.cert).validTo)
		const later = new Date(validTo.getTime() - 24 * 3600 * 1000) // J-1
		const b = ensureCertificate({ dir, log: log(), now: () => later })
		expect(b.fingerprint256).not.toBe(a.fingerprint256)
	})

	it('régénère un fichier corrompu au lieu de planter', () => {
		ensureCertificate({ dir, log: log() })
		fs.writeFileSync(path.join(dir, 'cert.pem'), 'pas un certificat')
		const l = log()
		const c = ensureCertificate({ dir, log: l })
		expect(() => new X509Certificate(c.cert)).not.toThrow()
		expect(l.warn).toHaveBeenCalled()
	})

	it('régénère si la clé ne correspond pas au certificat', () => {
		ensureCertificate({ dir, log: log() })
		const other = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-emu-other-'))
		ensureCertificate({ dir: other, log: log() })
		fs.copyFileSync(path.join(other, 'key.pem'), path.join(dir, 'key.pem'))
		fs.rmSync(other, { recursive: true, force: true })
		const c = ensureCertificate({ dir, log: log() })
		expect(new X509Certificate(c.cert).checkPrivateKey(require('node:crypto').createPrivateKey(c.key))).toBe(true)
	})
})
