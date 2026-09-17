const { screen } = require('electron')

/**
 * Liste des ecrans, dans un ordre STABLE : l'ecran principal d'abord, les autres
 * ensuite par position (gauche a droite, puis haut en bas).
 *
 * Pourquoi trier : `chooseScreen` indexe positionnellement dans cette liste et
 * `config.ini` dit `screen=0`. Or `getAllDisplays()` ne garantit aucun ordre — sur
 * une caisse Dell avec ecran externe, il depend de l'instant du branchement :
 *
 *   branche AVANT le demarrage : [{1280x800 @1920,0}, {1920x1080 @0,0}]
 *   branche APRES              : [{1920x1080 @0,0}, {1280x800 @1920,0}]
 *
 * « Ecran 0 » designait donc la dalle un jour et l'ecran externe le lendemain, a
 * configuration identique. Le POS partait sur le petit ecran, et l'afficheur client
 * — qui prend l'ecran *autre* que celui du POS — subissait le symptome miroir.
 *
 * Le tri rend son sens a `screen=0` : l'ecran principal, celui que le systeme
 * considere comme tel. Aucune migration de configuration n'est necessaire.
 *
 * La forme rendue est volontairement inchangee ({ width, height, x, y }) : les
 * appelants y ajoutent ensuite un `id` qui est l'INDEX dans ce tableau, et non
 * l'identifiant Electron (cf. `choose_screen.js` et `customer_manager.js`).
 */
module.exports =  function getScreens() {
	const primaire = screen.getPrimaryDisplay()

	// Un Display Electron porte toujours un `id`. On exige quand meme qu'il soit
	// defini : sans cette garde, deux `undefined` se valent, TOUT ecran se declare
	// principal, et le comparateur devient incoherent — il affirmerait a la fois
	// a<b et b<a, ce dont `sort` ne garantit rien. A defaut d'ecran principal
	// identifiable, le tri par position suffit et reste deterministe.
	const idPrimaire = primaire && undefined !== primaire.id ? primaire.id : null

	// Copie avant tri : `sort` trie en place, et le tableau rendu par Electron ne
	// nous appartient pas.
	const screens = [...screen.getAllDisplays()].sort((a, b) => {
		if (null !== idPrimaire) {
			if (a.id === idPrimaire) { return -1 }
			if (b.id === idPrimaire) { return 1 }
		}

		return a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
	})

	return screens.map((aScreen) => {
		return {
			width: aScreen.size.width,
			height: aScreen.size.height,
			x: aScreen.bounds.x,
			y: aScreen.bounds.y
		}
	})
}
