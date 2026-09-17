/**
 * get_screens — ordre déterministe des écrans.
 *
 * `chooseScreen` indexe positionnellement dans cette liste, et `config.ini` dit
 * `screen=0`. Or l'ordre de `screen.getAllDisplays()` n'est PAS garanti : sur une
 * caisse Dell avec un écran externe, il dépend de l'instant du branchement.
 * Constaté en exploitation, deux jours de suite, sans changement de configuration :
 *
 *   écran branché AVANT le démarrage :
 *     [{1280x800 @1920,0}, {1920x1080 @0,0}]   -> index 0 = écran externe
 *   écran branché APRÈS :
 *     [{1920x1080 @0,0}, {1280x800 @1920,0}]   -> index 0 = dalle
 *
 * Le POS partait donc sur le petit écran externe un jour sur deux, et l'afficheur
 * client — qui prend l'écran *autre* que celui du POS — subissait le symptôme
 * miroir. Ce test verrouille l'ordre : l'écran principal d'abord, le reste trié
 * par position, pour que `screen=0` signifie enfin quelque chose de stable.
 */

jest.mock('electron', () => ({
	screen: {
		getAllDisplays: jest.fn(),
		getPrimaryDisplay: jest.fn(),
	},
}))

const { screen } = require('electron')
const getScreens = require('../src/main/helpers/get_screens')

// Fabrique un Display Electron minimal — seuls size/bounds/id sont lus ici.
const display = (id, width, height, x, y) => ({
	id,
	size: { width, height },
	bounds: { x, y, width, height },
})

const DALLE = display(1, 1920, 1080, 0, 0) // eDP-1, écran principal
const EXTERNE = display(2, 1280, 800, 1920, 0) // DP-2

describe('get_screens', () => {
	describe("ordre stable quel que soit l'ordre rendu par le système", () => {
		it("place l'écran principal en premier quand il est listé en second", () => {
			// L'ordre exact observé le 2026-09-17, écran branché avant le démarrage.
			screen.getAllDisplays.mockReturnValue([EXTERNE, DALLE])
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			expect(getScreens()).toStrictEqual([
				{ width: 1920, height: 1080, x: 0, y: 0 },
				{ width: 1280, height: 800, x: 1920, y: 0 },
			])
		})

		it("laisse l'écran principal en tête quand il y est déjà", () => {
			// L'ordre observé le 2026-09-16, écran branché après le démarrage : le
			// résultat doit être IDENTIQUE au cas précédent.
			screen.getAllDisplays.mockReturnValue([DALLE, EXTERNE])
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			expect(getScreens()).toStrictEqual([
				{ width: 1920, height: 1080, x: 0, y: 0 },
				{ width: 1280, height: 800, x: 1920, y: 0 },
			])
		})

		it('ordonne les écrans secondaires par position, pas par hasard', () => {
			const gauche = display(3, 1024, 768, -1024, 0)
			const droite = display(4, 1024, 768, 1920, 0)
			const bas = display(5, 1024, 768, 1920, 1080)

			screen.getAllDisplays.mockReturnValue([bas, droite, gauche, DALLE])
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			expect(getScreens().map((e) => [e.x, e.y])).toStrictEqual([
				[0, 0], // principal, quelle que soit sa position
				[-1024, 0],
				[1920, 0],
				[1920, 1080],
			])
		})
	})

	describe('écran principal non identifiable', () => {
		it("retombe sur un tri par position quand les écrans n'ont pas d'id", () => {
			// Un Display Electron porte toujours un `id`, mais pas les doublures des
			// tests voisins. Sans garde, `a.id === primaire.id` compare undefined à
			// undefined : TOUT écran se déclare principal et le tri perd son sens.
			const sansId = (w, h, x, y) => ({
				size: { width: w, height: h },
				bounds: { x, y },
			})
			const droite = sansId(1280, 800, 1920, 0)
			const gauche = sansId(1920, 1080, 0, 0)
			const loin = sansId(1024, 768, 3840, 0)

			// Trois écrans et non deux : sur deux éléments, un comparateur incohérent
			// peut tomber juste par hasard selon l'implémentation de `sort`.
			screen.getAllDisplays.mockReturnValue([loin, droite, gauche])
			screen.getPrimaryDisplay.mockReturnValue(gauche)

			expect(getScreens().map((e) => e.x)).toStrictEqual([0, 1920, 3840])
		})

		it('ne casse pas si getPrimaryDisplay ne rend rien', () => {
			screen.getAllDisplays.mockReturnValue([EXTERNE, DALLE])
			screen.getPrimaryDisplay.mockReturnValue(undefined)

			expect(getScreens().map((e) => e.x)).toStrictEqual([0, 1920])
		})
	})

	describe('contrat inchangé', () => {
		it('ne renvoie que width, height, x et y', () => {
			screen.getAllDisplays.mockReturnValue([DALLE])
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			expect(Object.keys(getScreens()[0]).sort()).toStrictEqual([
				'height',
				'width',
				'x',
				'y',
			])
		})

		it('ne modifie pas le tableau rendu par getAllDisplays', () => {
			const rendu = [EXTERNE, DALLE]
			screen.getAllDisplays.mockReturnValue(rendu)
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			getScreens()

			expect(rendu).toStrictEqual([EXTERNE, DALLE])
		})

		it('supporte un écran unique', () => {
			screen.getAllDisplays.mockReturnValue([DALLE])
			screen.getPrimaryDisplay.mockReturnValue(DALLE)

			expect(getScreens()).toStrictEqual([
				{ width: 1920, height: 1080, x: 0, y: 0 },
			])
		})
	})
})
