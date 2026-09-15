const {
	RAISON,
	MODE,
	describeScreens,
	resolveCustomerScreen,
	buildCustomerState,
} = require('../../src/helpers/customer_display')

const ecran = (over = {}) => ({ width: 1920, height: 1080, x: 0, y: 0, id: null, ...over })

const UN = [ecran()]
const DEUX = [ecran({ id: 10 }), ecran({ id: 20, x: 1920 })]

describe('resolveCustomerScreen', () => {
	it('refuse si la section est desactivee', () => {
		const r = resolveCustomerScreen({ enable: false, url: 'http://c' }, DEUX, 0)
		expect(r.ok).toBe(false)
		expect(r.raison).toBe(RAISON.DISABLED)
	})

	it('ouvre sans url, en mode ecran d attente', () => {
		// Un ecran noir face au public est pire qu une attente de marque.
		const r = resolveCustomerScreen({ enable: true }, DEUX, 0)
		expect(r.ok).toBe(true)
		expect(r.mode).toBe(MODE.IDLE)
	})

	it('passe en mode page des qu une url est configuree', () => {
		const r = resolveCustomerScreen({ enable: true, url: 'http://c' }, DEUX, 0)
		expect(r.mode).toBe(MODE.PAGE)
	})

	it('refuse sur un seul ecran', () => {
		const r = resolveCustomerScreen({ enable: true, url: 'http://c' }, UN, 0)
		expect(r.raison).toBe(RAISON.SINGLE_SCREEN)
	})

	it('prend le premier ecran libre quand rien n est demande', () => {
		// Cas de loin le plus frequent : une caisse a deux ecrans ne doit pas
		// exiger de reglage.
		const r = resolveCustomerScreen({ enable: true, url: 'http://c' }, DEUX, 0)
		expect(r.ok).toBe(true)
		expect(r.index).toBe(1)
	})

	it('respecte un index explicite', () => {
		const trois = [...DEUX, ecran({ id: 30, x: 3840 })]
		const r = resolveCustomerScreen({ enable: true, url: 'http://c', screen: 2 }, trois, 0)
		expect(r.index).toBe(2)
	})

	it('accepte screen=0 quand la caisse est ailleurs', () => {
		// 0 est une valeur, pas une absence : un `||` l aurait traite comme vide.
		const r = resolveCustomerScreen({ enable: true, url: 'http://c', screen: 0 }, DEUX, 1)
		expect(r.ok).toBe(true)
		expect(r.index).toBe(0)
	})

	it('n ouvre PAS sur l ecran de la caisse', () => {
		// Un repli silencieux poserait la page client par-dessus le POS.
		const r = resolveCustomerScreen({ enable: true, url: 'http://c', screen: 0 }, DEUX, 0)
		expect(r.ok).toBe(false)
		expect(r.raison).toBe(RAISON.SAME_AS_POS)
	})

	it('n ouvre PAS sur un ecran debranche, au lieu de retomber sur 0', () => {
		const r = resolveCustomerScreen({ enable: true, url: 'http://c', screen: 5 }, DEUX, 0)
		expect(r.ok).toBe(false)
		expect(r.raison).toBe(RAISON.SCREEN_MISSING)
	})

	it('porte un libelle lisible pour chaque refus', () => {
		for (const screen of [5, 0]) {
			const r = resolveCustomerScreen({ enable: true, url: 'http://c', screen }, DEUX, 0)
			expect(typeof r.libelle).toBe('string')
			expect(r.libelle.length).toBeGreaterThan(0)
		}
	})
})

describe('describeScreens', () => {
	it('etiquette les roles', () => {
		const out = describeScreens(DEUX, 0, 1)
		expect(out.map((e) => e.role)).toEqual(['pos', 'client'])
	})

	it('marque l ecran principal a l origine', () => {
		const out = describeScreens(DEUX, 0, 1)
		expect(out[0].principal).toBe(true)
		expect(out[1].principal).toBe(false)
	})

	it('laisse libre un ecran non attribue', () => {
		const trois = [...DEUX, ecran({ id: 30, x: 3840 })]
		expect(describeScreens(trois, 0, 1)[2].role).toBe('libre')
	})

	it('ne jette pas sur une entree absente', () => {
		expect(describeScreens(null, 0, 1)).toEqual([])
	})
})

describe('buildCustomerState', () => {
	it('expose la liste meme quand l ecran client est refuse', () => {
		// C est exactement le moment ou l operateur a besoin de voir les ecrans
		// pour en choisir un autre.
		const s = buildCustomerState({ enable: true, url: 'http://c' }, UN, 0)
		expect(s.ok).toBe(false)
		expect(s.screens).toHaveLength(1)
	})

	it('donne les deux index quand tout va bien', () => {
		const s = buildCustomerState({ enable: true, url: 'http://c' }, DEUX, 0)
		expect(s).toMatchObject({ ok: true, posIndex: 0, clientIndex: 1 })
	})
})
