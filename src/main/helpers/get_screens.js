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

	const idPrimaire = primaire?.id ?? null

	// Rang, plutot qu'une garde sur `idPrimaire`.
	//
	// L'ancienne version testait `idPrimaire !== null` avant de comparer, pour
	// eviter qu'en l'absence d'ecran principal identifiable TOUS les ecrans se
	// declarent principaux — le comparateur affirmait alors a la fois a<b et
	// b<a, ce dont `sort` ne garantit rien.
	//
	// Exprime en rang, le probleme disparait par construction : si personne ne
	// correspond, tout le monde vaut 1 ; si plusieurs correspondent, tous
	// valent 0. Dans les deux cas on retombe sur le tri par position, qui est
	// total et deterministe. Plus besoin de garde — et plus de comparaison que
	// les types jugent morte.
	const rang = (ecran) => (ecran.id === idPrimaire ? 0 : 1)

	// Copie avant tri : `sort` trie en place, et le tableau rendu par Electron ne
	// nous appartient pas.
	const screens = [...screen.getAllDisplays()].sort((a, b) => {
		return rang(a) - rang(b)
			|| a.bounds.x - b.bounds.x
			|| a.bounds.y - b.bounds.y
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
