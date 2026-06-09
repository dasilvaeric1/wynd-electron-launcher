const requestWPT = require("./request_wpt")

/**
 * Vérifie qu'un plugin WPT (par nom, ex. "FastPrinter") est présent et activé.
 * Résout avec le descripteur du plugin, rejette avec {code,message} sinon.
 *
 * NB historique : l'ancienne version shadowait le paramètre `plugin` dans le
 * filter (→ comparaison toujours fausse) puis déréférencait foundPlugin[0]
 * (undefined) → throw systématique, ce qui bloquait toutes les requêtes
 * fastprinter. Corrigé ici.
 */
module.exports = function checkWptPlugin(socket, pluginName) {
	return requestWPT(socket, { emit: "plugins", datas: null }).then(
		(plugins) => {
			const found = (plugins || []).find((p) => p && p.name === pluginName)
			if (!found) {
				return Promise.reject({
					code: `NO_${pluginName}_PLUGIN_FOUND`,
					message: `No ${pluginName.toLowerCase()} plugin found`,
				})
			}
			if (!found.enabled) {
				return Promise.reject({
					code: `${pluginName}_PLUGIN_DISABLED`,
					message: `${pluginName.toLowerCase()} plugin is disabled`,
				})
			}
			return found
		}
	)
}
