const { initialState, reduce } = require('../../src/loader/store/reducer')

const PLAN = { action: 'initialize', phases: ['config', 'hardware', 'devices', 'pos'], total: 9 }

const withPlan = () => reduce(initialState(), { type: 'plan', plan: PLAN })
const feed = (state, events) =>
	events.reduce((s, e) => reduce(s, typeof e === 'string' ? { type: 'status', event: e } : e), state)

describe('plan', () => {
	it('installe les phases et remet la progression a zero', () => {
		const s = withPlan()
		expect(s.phases).toEqual(['config', 'hardware', 'devices', 'pos'])
		expect(s.total).toBe(9)
		expect(s.current).toBe(0)
		expect(s.phaseState.config).toBe('active')
		expect(s.phaseState.pos).toBe('pending')
	})

	it('efface une erreur et l alerte de lenteur precedentes', () => {
		let s = withPlan()
		s = reduce(s, { type: 'error', error: { code: 'X', message: 'y', detail: null, status: null } })
		s = reduce(s, { type: 'slow' })
		s = reduce(s, { type: 'plan', plan: PLAN })
		expect(s.error).toBeNull()
		expect(s.slow).toBe(false)
	})
})

describe('progression', () => {
	it('avance sur les evenements terminaux et pas sur les autres', () => {
		let s = feed(withPlan(), ['get_conf'])
		expect(s.current).toBe(0)
		s = feed(s, ['get_conf_done'])
		expect(s.current).toBe(1)
	})

	it('ne depasse jamais le total', () => {
		const trop = Array(30).fill('get_conf_done')
		expect(feed(withPlan(), trop).current).toBe(9)
	})

	it('ne compte pas wpt_connect_done quand la connexion a echoue', () => {
		// initcallback renvoie aussi wpt_connect_done avec false sur 'disconnect'.
		const s = feed(withPlan(), [{ type: 'status', event: 'wpt_connect_done', data: false }])
		expect(s.current).toBe(0)
	})

	it('compte wpt_connect_done quand la connexion a reussi', () => {
		const s = feed(withPlan(), [{ type: 'status', event: 'wpt_connect_done', data: true }])
		expect(s.current).toBe(1)
	})

	it('atteint exactement 100 % sur une sequence nominale sans mise a jour', () => {
		const s = feed(withPlan(), [
			'get_conf', 'get_conf_done', 'check_conf', 'check_conf_done',
			'get_screens', 'get_screens_done', 'create_wpt', 'create_wpt_done',
			'create_http_skip',
			'wpt_connect', { type: 'status', event: 'wpt_connect_done', data: true },
			'wpt_infos', 'wpt_infos_done', 'plugins', 'REQUEST_WPT_done',
			'finish',
		])
		expect(s.current).toBe(9)
		expect(s.total).toBe(9)
	})
})

describe('phases', () => {
	it('marque les phases traversees comme terminees', () => {
		const s = feed(withPlan(), ['get_conf_done', 'check_conf_done', 'get_screens', 'get_screens_done'])
		expect(s.phaseState.config).toBe('done')
		expect(s.phaseState.hardware).toBe('active')
		expect(s.phaseState.devices).toBe('pending')
	})

	it('termine toutes les phases sur finish', () => {
		const s = feed(withPlan(), ['finish'])
		Object.values(s.phaseState).forEach((v) => expect(v).toBe('done'))
	})

	it('ignore un evenement inconnu sans casser l etat', () => {
		const before = withPlan()
		const after = feed(before, ['evenement_invente'])
		expect(after.phaseState).toEqual(before.phaseState)
	})
})

describe('libelles', () => {
	it('traduit les evenements connus en francais', () => {
		expect(feed(withPlan(), ['wpt_infos']).detail).toMatch(/périphériques/i)
	})

	it('retombe sur le nom brut pour un evenement inconnu', () => {
		expect(feed(withPlan(), ['truc_bidule']).detail).toBe('truc_bidule')
	})

	it('affiche le message porte par une erreur non bloquante', () => {
		const s = feed(withPlan(), [
			{ type: 'status', event: 'check_update_skip', data: { message: 'Pas de reseau' } },
		])
		expect(s.detail).toBe('Pas de reseau')
	})
})

describe('telechargement de mise a jour', () => {
	it('ouvre la barre puis suit le pourcentage', () => {
		let s = feed(withPlan(), ['download_update'])
		expect(s.download).toBe(true)
		expect(s.progress).toBe(0)
		s = reduce(s, { type: 'progress', percent: 42 })
		expect(s.progress).toBe(42)
	})

	it('borne le pourcentage a 0-100', () => {
		let s = reduce(withPlan(), { type: 'progress', percent: 250 })
		expect(s.progress).toBe(100)
		s = reduce(s, { type: 'progress', percent: -5 })
		expect(s.progress).toBe(0)
	})
})

describe('erreur', () => {
	const err = { code: 'WPT_CONNECTION_TIMEOUT', message: 'timeout', detail: null, status: 408 }

	it('marque la phase en cours en echec et retient l erreur', () => {
		let s = feed(withPlan(), ['get_conf_done', 'check_conf_done', 'get_screens_done'])
		s = reduce(s, { type: 'error', error: err })
		expect(s.error).toEqual(err)
		expect(s.phaseState.hardware).toBe('failed')
		expect(s.phaseState.config).toBe('done')
	})

	it('efface l erreur et repart de zero sur retry', () => {
		let s = reduce(withPlan(), { type: 'error', error: err })
		s = reduce(s, { type: 'retry' })
		expect(s.error).toBeNull()
		expect(s.current).toBe(0)
		expect(s.phaseState.config).toBe('active')
	})
})

describe('lenteur', () => {
	it('leve puis retire l alerte a la transition suivante', () => {
		let s = reduce(withPlan(), { type: 'slow' })
		expect(s.slow).toBe(true)
		s = feed(s, ['get_conf_done'])
		expect(s.slow).toBe(false)
	})
})

describe('immutabilite', () => {
	it('ne mute jamais l etat recu', () => {
		const before = withPlan()
		const copie = JSON.parse(JSON.stringify(before))
		reduce(before, { type: 'status', event: 'get_conf_done' })
		reduce(before, { type: 'error', error: { code: 'X', message: 'y', detail: null, status: null } })
		expect(before).toEqual(copie)
	})
})
