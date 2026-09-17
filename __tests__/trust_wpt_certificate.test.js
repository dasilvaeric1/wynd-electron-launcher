/**
 * trust_wpt_certificate — la tolérance TLS ciblée qui remplace le drapeau global.
 *
 * WyndPOSTools sert en HTTPS avec un certificat AUTO-SIGNÉ, généré par
 * node-forge au premier démarrage : aucune autorité ne le signe, et Chromium
 * le refuse. Jusqu'ici la caisse s'en sortait avec `ignore-certificate-errors`
 * dans le `[commandline]` de config.ini — c'est-à-dire en désactivant la
 * validation TLS de TOUT le processus, POS distant compris.
 *
 * Le commit de durcissement 2.8.2 avait bloqué ce drapeau sans rien mettre à
 * la place, coupant la liaison POS <-> matériel sur les caisses concernées
 * (cf commandline_switches.js). Ce module est la contrepartie qui manquait :
 * on accepte le certificat du seul hôte que l'exploitant a lui-même désigné
 * dans `wpt.url`, et rien d'autre.
 */

const mockApp = { ecouteurs: {} }
const mockLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }

jest.mock('electron', () => ({
	app: {
		on: (ev, cb) => {
			mockApp.ecouteurs[ev] = cb
		},
	},
}))

jest.mock('../src/main/helpers/electron_log', () => mockLog)

const trustWptCertificate = require('../src/main/helpers/trust_wpt_certificate')

// La conf porte l'URL WPT sous forme éclatée (cf config_validator.convertUrl),
// pas comme un objet URL : c'est `host` qui fait foi, port compris.
const store = (host) => ({
	conf: host ? { wpt: { url: { host, href: `https://${host}/` } } } : {},
})

// Rejoue l'événement Electron et rend la décision prise.
const verifier = (url) => {
	let accepte = null
	let empeche = false
	mockApp.ecouteurs['certificate-error'](
		{ preventDefault: () => { empeche = true } },
		{},
		url,
		'ERR_CERT_AUTHORITY_INVALID',
		{},
		(ok) => { accepte = ok },
	)
	return { accepte, empeche }
}

beforeEach(() => {
	mockApp.ecouteurs = {}
	mockLog.info.mockClear()
	mockLog.warn.mockClear()
	mockLog.debug.mockClear()
})

describe('hôte WPT configuré', () => {
	it('accepte son certificat auto-signé', () => {
		trustWptCertificate(store('127.0.0.1:9963'))

		expect(verifier('https://127.0.0.1:9963/socket.io/')).toStrictEqual({
			accepte: true,
			empeche: true,
		})
	})

	it("n'accepte que lui", () => {
		trustWptCertificate(store('127.0.0.1:9963'))

		// Le POS distant : son certificat doit rester vérifié. C'est toute la
		// différence avec `ignore-certificate-errors`, qui l'acceptait aussi.
		expect(verifier('https://pos.exemple.com/caisse')).toStrictEqual({
			accepte: false,
			empeche: false,
		})
	})

	it('distingue le port', () => {
		trustWptCertificate(store('127.0.0.1:9963'))

		expect(verifier('https://127.0.0.1/').accepte).toBe(false)
		expect(verifier('https://127.0.0.1:8443/').accepte).toBe(false)
	})

	it('ne se laisse pas prendre à un hôte qui lui ressemble', () => {
		trustWptCertificate(store('wpt.magasin.fr'))

		expect(verifier('https://wpt.magasin.fr.attaquant.com/').accepte).toBe(false)
		expect(verifier('https://notwpt.magasin.fr/').accepte).toBe(false)
	})

	it('ignore la casse, comme le fait un nom d hôte', () => {
		trustWptCertificate(store('WPT.Magasin.fr'))

		expect(verifier('https://wpt.magasin.fr/').accepte).toBe(true)
	})
})

describe('conf incomplète ou URL illisible', () => {
	it('refuse quand aucune URL WPT n est configurée', () => {
		trustWptCertificate(store(null))

		expect(verifier('https://127.0.0.1:9963/').accepte).toBe(false)
	})

	it('refuse sans lever quand l URL en cause est illisible', () => {
		trustWptCertificate(store('127.0.0.1:9963'))

		expect(() => verifier('pas-une-url')).not.toThrow()
		expect(verifier('pas-une-url').accepte).toBe(false)
	})
})

describe('journalisation', () => {
	it('trace le refus, qui est le cas à diagnostiquer', () => {
		trustWptCertificate(store('127.0.0.1:9963'))
		verifier('https://pos.exemple.com/')

		expect(mockLog.warn).toHaveBeenCalledWith(
			expect.stringContaining('pos.exemple.com'),
		)
	})

	it("n'annonce l'exception WPT qu'une fois, pas à chaque requête", () => {
		trustWptCertificate(store('127.0.0.1:9963'))
		verifier('https://127.0.0.1:9963/socket.io/')
		verifier('https://127.0.0.1:9963/plugins')
		verifier('https://127.0.0.1:9963/infos')

		expect(mockLog.info).toHaveBeenCalledTimes(1)
	})
})
