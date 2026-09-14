const { buildBootPlan, phaseOfEvent, countsAsStep, PHASE_KEYS } = require('../../src/helpers/boot_plan')

// Config minimale : seules les cles lues par buildBootPlan comptent.
const conf = (over = {}) => ({
	update: { enable: false, on_start: false },
	wpt: { enable: true },
	http: { enable: false },
	...over,
})

describe('countsAsStep', () => {
	it('compte les evenements terminaux', () => {
		expect(countsAsStep('get_conf_done')).toBe(true)
		expect(countsAsStep('create_wpt_skip')).toBe(true)
		expect(countsAsStep('finish')).toBe(true)
	})

	it('ne compte pas les evenements de progression', () => {
		expect(countsAsStep('get_conf')).toBe(false)
		expect(countsAsStep('wpt_connect')).toBe(false)
		expect(countsAsStep('download_progress')).toBe(false)
	})

	it('ne compte pas les evenements exclus du fil du loader', () => {
		// get_wpt_pid_done et wpt_version_done sont filtres par initcallback :
		// les compter ferait deriver la barre au-dela de 100 %.
		expect(countsAsStep('get_wpt_pid_done')).toBe(false)
		expect(countsAsStep('wpt_version_done')).toBe(false)
	})
})

describe('phaseOfEvent', () => {
	it('range chaque evenement du bootstrap dans une phase connue', () => {
		expect(phaseOfEvent('get_conf')).toBe('config')
		expect(phaseOfEvent('check_update_skip')).toBe('update')
		expect(phaseOfEvent('create_wpt_done')).toBe('hardware')
		expect(phaseOfEvent('wpt_infos_done')).toBe('devices')
		expect(phaseOfEvent('finish')).toBe('pos')
	})

	it('couvre "plugins", qui n existait pas dans EStatus et rendait un statut vide', () => {
		expect(phaseOfEvent('plugins')).toBe('devices')
	})

	it('renvoie null pour un evenement inconnu plutot que de jeter', () => {
		expect(phaseOfEvent('evenement_invente')).toBeNull()
	})
})

describe('buildBootPlan', () => {
	it('exclut la phase de mise a jour quand elle est desactivee', () => {
		const plan = buildBootPlan(conf(), 'initialize')
		expect(plan.phases).not.toContain('update')
		expect(plan.phases).toEqual(['config', 'hardware', 'devices', 'pos'])
	})

	it('inclut la phase de mise a jour quand update.on_start est actif', () => {
		const plan = buildBootPlan(conf({ update: { enable: true, on_start: true } }), 'initialize')
		expect(plan.phases).toContain('update')
	})

	it('compte 9 etapes sans mise a jour et 10 avec', () => {
		// C'est le bug d'origine : get_total.ts renvoyait 10 en dur, donc la
		// barre plafonnait a 90 % quand update etait desactive.
		expect(buildBootPlan(conf(), 'initialize').total).toBe(9)
		expect(
			buildBootPlan(conf({ update: { enable: true, on_start: true } }), 'initialize').total
		).toBe(10)
	})

	it('compte pareil que WPT soit actif ou non', () => {
		// WPT desactive emet wpt_connect_skip + wpt_infos_skip + REQUEST_WPT_skip,
		// soit autant d'etapes que connect_done + infos_done + REQUEST_WPT_done.
		const avec = buildBootPlan(conf({ wpt: { enable: true } }), 'initialize').total
		const sans = buildBootPlan(conf({ wpt: { enable: false } }), 'initialize').total
		expect(sans).toBe(avec)
	})

	it('reduit le plan pour les actions autres que initialize', () => {
		expect(buildBootPlan(conf(), 'reload').total).toBeLessThan(
			buildBootPlan(conf(), 'initialize').total
		)
		expect(buildBootPlan(conf(), 'close').phases).toEqual(['shutdown'])
	})

	it('ne jette pas sur une config absente ou partielle', () => {
		expect(() => buildBootPlan(null, 'initialize')).not.toThrow()
		expect(() => buildBootPlan({}, 'initialize')).not.toThrow()
		expect(buildBootPlan(null, 'initialize').total).toBeGreaterThan(0)
	})

	it('expose des phases toutes connues', () => {
		const plan = buildBootPlan(conf({ update: { enable: true, on_start: true } }), 'initialize')
		plan.phases.forEach((p) => expect(PHASE_KEYS).toContain(p))
	})
})
