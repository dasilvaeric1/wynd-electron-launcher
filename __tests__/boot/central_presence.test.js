const p = require('../../src/main/helpers/central_presence')

const T0 = 1_700_000_000_000

beforeEach(() => p.reset())

describe('presenceLevel (fonction pure)', () => {
	it('off quand screen-session n est pas configure', () => {
		expect(p.presenceLevel({ configured: false, lastContactAt: T0, consecutiveFailures: 0 }, T0)).toBe('off')
		expect(p.presenceLevel(null, T0)).toBe('off')
	})

	it('ok sous 30 s, warn au-dela', () => {
		const s = { configured: true, lastContactAt: T0, consecutiveFailures: 0 }
		expect(p.presenceLevel(s, T0 + 5_000)).toBe('ok')
		expect(p.presenceLevel(s, T0 + 30_000)).toBe('ok')
		expect(p.presenceLevel(s, T0 + 30_001)).toBe('warn')
	})

	it('down apres 3 echecs consecutifs, meme si le dernier contact est recent', () => {
		const s = { configured: true, lastContactAt: T0, consecutiveFailures: 3 }
		expect(p.presenceLevel(s, T0 + 1_000)).toBe('down')
	})

	it('warn tant qu aucun contact n a eu lieu', () => {
		expect(p.presenceLevel({ configured: true, lastContactAt: null, consecutiveFailures: 1 }, T0)).toBe('warn')
	})
})

describe('transitions', () => {
	it('un succes efface les echecs accumules', () => {
		p.noteFailure(T0)
		p.noteFailure(T0)
		expect(p.snapshot(T0).level).toBe('warn')
		p.noteSuccess(T0)
		expect(p.snapshot(T0).level).toBe('ok')
	})

	it('trois echecs font tomber en down', () => {
		p.noteSuccess(T0)
		p.noteFailure(T0 + 5_000)
		p.noteFailure(T0 + 10_000)
		// Toujours 'ok' : le dernier contact reussi date de 10 s, soit moins que
		// FRESH_WITHIN_MS. Deux polls manques ne doivent pas alarmer une caisse
		// dont la liaison etait bonne il y a dix secondes.
		expect(p.snapshot(T0 + 10_000).level).toBe('ok')
		p.noteFailure(T0 + 15_000)
		// Au 3e echec consecutif, le compteur prime sur la fraicheur.
		expect(p.snapshot(T0 + 15_000).level).toBe('down')
	})

	it('un echec preserve la date du dernier contact reussi', () => {
		p.noteSuccess(T0)
		p.noteFailure(T0 + 9_000)
		expect(p.snapshot(T0 + 9_000).lastContactAt).toBe(T0)
	})

	it('noteUnconfigured ramene a off', () => {
		p.noteSuccess(T0)
		p.noteUnconfigured()
		expect(p.snapshot(T0).level).toBe('off')
	})
})

describe('snapshot', () => {
	it('expose l anciennete en secondes', () => {
		p.noteSuccess(T0)
		expect(p.snapshot(T0 + 12_400).secondsSince).toBe(12)
	})

	it('renvoie null quand aucun contact n a eu lieu', () => {
		expect(p.snapshot(T0).secondsSince).toBeNull()
	})
})
