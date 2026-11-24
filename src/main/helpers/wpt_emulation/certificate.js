/**
 * Certificat TLS auto-signé de l'émulateur WPT.
 *
 * Généré au premier lancement dans `<userData>/wpt-emulation/`, réutilisé
 * ensuite. L'empreinte SHA-256 est ce que `trust.js` accepte : c'est NOTRE
 * certificat qu'on reconnaît, pas un hôte — un autre service qui écouterait
 * sur le même port avec un autre certificat serait refusé.
 *
 * Régénéré s'il est absent, illisible, sans clé correspondante, ou à moins de
 * REGENERATE_BEFORE_DAYS de l'expiration.
 */

const fs = require('node:fs')
const path = require('node:path')
const { X509Certificate, createPrivateKey } = require('node:crypto')
const selfsigned = require('selfsigned')

const VALIDITY_DAYS = 3650
const REGENERATE_BEFORE_DAYS = 30
const DAY_MS = 24 * 3600 * 1000

function readExisting(certPath, keyPath, now) {
	if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return { reason: 'absent' }
	const cert = fs.readFileSync(certPath, 'utf8')
	const key = fs.readFileSync(keyPath, 'utf8')
	const x509 = new X509Certificate(cert) // jette si illisible
	if (!x509.checkPrivateKey(createPrivateKey(key))) return { reason: 'cle ne correspondant pas au certificat' }
	const remainingMs = new Date(x509.validTo).getTime() - now().getTime()
	if (remainingMs < REGENERATE_BEFORE_DAYS * DAY_MS) return { reason: `expire le ${x509.validTo}` }
	return { pem: { cert, key, fingerprint256: x509.fingerprint256 } }
}

function generate(certPath, keyPath) {
	const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
		days: VALIDITY_DAYS,
		keySize: 2048,
		algorithm: 'sha256',
		extensions: [
			{ name: 'basicConstraints', cA: false },
			{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
			{ name: 'extKeyUsage', serverAuth: true },
			{
				name: 'subjectAltName',
				altNames: [
					{ type: 2, value: 'localhost' },
					{ type: 7, ip: '127.0.0.1' },
				],
			},
		],
	})
	fs.writeFileSync(keyPath, pems.private, { mode: 0o600 })
	fs.chmodSync(keyPath, 0o600) // writeFileSync ne change pas le mode d'un fichier existant
	fs.writeFileSync(certPath, pems.cert)
	const fingerprint256 = new X509Certificate(pems.cert).fingerprint256
	return { cert: pems.cert, key: pems.private, fingerprint256 }
}

/**
 * @param {object} opts
 * @param {string} opts.dir
 * @param {{info: Function, warn: Function}} opts.log
 * @param {() => Date} [opts.now]
 * @returns {{cert: string, key: string, fingerprint256: string}}
 */
function ensureCertificate({ dir, log, now = () => new Date() }) {
	fs.mkdirSync(dir, { recursive: true })
	const certPath = path.join(dir, 'cert.pem')
	const keyPath = path.join(dir, 'key.pem')

	let reason
	try {
		const existing = readExisting(certPath, keyPath, now)
		if (existing.pem) return existing.pem
		reason = existing.reason
	} catch (err) {
		reason = `illisible (${err.message})`
		log.warn(`[WPT-EMU] certificat ${reason}`)
	}

	const pem = generate(certPath, keyPath)
	log.info(`[WPT-EMU] certificat genere (${reason}), empreinte ${pem.fingerprint256}`)
	return pem
}

module.exports = { ensureCertificate }
