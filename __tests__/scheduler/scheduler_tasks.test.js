// electron_log tire l'API Electron : on le neutralise pour tester la mise en
// forme, qui est pure.
jest.mock('../../src/main/helpers/electron_log', () => ({
	error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
}))

const { shapeForCashier } = require('../../src/main/helpers/scheduler_tasks')

const NOW = Date.parse('2026-09-13T22:00:00Z')
const iso = (minutesDepuisNow) => new Date(NOW + minutesDepuisNow * 60000).toISOString()

const tache = (over = {}) => ({
	name: 't', description: '', enabled: true, isRunning: false,
	lastRunUtc: null, nextRunUtc: null, lastRunSuccess: null,
	scheduleType: 'cron', schedule: '', executionCount: 0, successCount: 0, failureCount: 0,
	...over,
})

describe('shapeForCashier', () => {
	it('renvoie une liste vide sans planificateur', () => {
		expect(shapeForCashier(null, NOW)).toEqual([])
		expect(shapeForCashier([], NOW)).toEqual([])
	})

	it('place les taches en cours en tete', () => {
		const out = shapeForCashier([
			tache({ name: 'finie', lastRunUtc: iso(-5), lastRunSuccess: true }),
			tache({ name: 'encours', isRunning: true }),
		], NOW)
		expect(out[0].name).toBe('encours')
		expect(out[0].etat).toBe('running')
	})

	it('remonte les echecs recents', () => {
		const out = shapeForCashier([
			tache({ name: 'ko', lastRunUtc: iso(-30), lastRunSuccess: false }),
		], NOW)
		expect(out[0].etat).toBe('failed')
	})

	it('garde un echec ancien mais ne le signale plus comme recent', () => {
		// Le masquer donnait une liste plus courte que ce qui est configure, ce
		// qui fait douter de l'outil. C'est `recent` qui decide si on alerte.
		const out = shapeForCashier([
			tache({ name: 'vieux', lastRunUtc: iso(-60 * 48), lastRunSuccess: false }),
		], NOW)
		expect(out).toHaveLength(1)
		expect(out[0].etat).toBe('failed')
		expect(out[0].recent).toBe(false)
	})

	it('marque un echec recent', () => {
		const out = shapeForCashier([
			tache({ name: 'frais', lastRunUtc: iso(-30), lastRunSuccess: false }),
		], NOW)
		expect(out[0].recent).toBe(true)
	})

	it('classe un echec recent avant un echec ancien', () => {
		const out = shapeForCashier([
			tache({ name: 'vieux', lastRunUtc: iso(-60 * 48), lastRunSuccess: false }),
			tache({ name: 'frais', lastRunUtc: iso(-30), lastRunSuccess: false }),
		], NOW)
		expect(out.map((t) => t.name)).toEqual(['frais', 'vieux'])
	})

	it('montre la prochaine echeance des taches saines', () => {
		const out = shapeForCashier([
			tache({ name: 'ok', lastRunUtc: iso(-10), lastRunSuccess: true, nextRunUtc: iso(45) }),
		], NOW)
		expect(out[0].etat).toBe('ok')
		expect(out[0].nextRunUtc).toBe(iso(45))
	})

	it('garde les taches desactivees, en dernier', () => {
		// Les ecarter faisait mentir le total affiche dans la modale.
		const out = shapeForCashier([
			tache({ name: 'off', enabled: false, nextRunUtc: iso(10) }),
			tache({ name: 'on', lastRunUtc: iso(-1), lastRunSuccess: true, nextRunUtc: iso(20) }),
		], NOW)
		expect(out.map((t) => t.name)).toEqual(['on', 'off'])
		expect(out[1].etat).toBe('disabled')
	})

	it('ne tronque plus la liste', () => {
		// L'ancien plafond a 5 masquait 7 des 12 taches de la caisse de test.
		// La modale de detail doit montrer TOUT ce qui est configure.
		const beaucoup = Array.from({ length: 20 }, (_u, i) =>
			tache({ name: 't' + i, lastRunUtc: iso(-1), lastRunSuccess: true, nextRunUtc: iso(i + 1) }))
		expect(shapeForCashier(beaucoup, NOW)).toHaveLength(20)
	})

	it('remonte toutes les taches en cours', () => {
		const beaucoup = Array.from({ length: 12 }, (_u, i) => tache({ name: 'r' + i, isRunning: true }))
		const out = shapeForCashier(beaucoup, NOW)
		expect(out.filter((t) => t.etat === 'running')).toHaveLength(12)
	})

	it('accepte les cles PascalCase du service C#', () => {
		const out = shapeForCashier([
			{ Name: 'csharp', Enabled: true, IsRunning: true },
		], NOW)
		expect(out[0].name).toBe('csharp')
		expect(out[0].etat).toBe('running')
	})

	it('ne jette pas sur des entrees malformees', () => {
		expect(() => shapeForCashier([null, {}, 'x', 42], NOW)).not.toThrow()
	})
})
