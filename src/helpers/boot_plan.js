/**
 * Plan de demarrage : combien d'etapes le bootstrap va REELLEMENT franchir,
 * et quelles phases afficher.
 *
 * Jusqu'ici le loader affichait un total code en dur (10) dans
 * src/loader/helpers/get_total.ts. Or le nombre d'evenements terminaux depend
 * de la config : sans `update.on_start` il n'y en a que 9, donc la barre
 * plafonnait a 90 % avant de sauter d'un coup a « Ready ». Le main est le seul
 * a connaitre la config au moment du bootstrap : c'est donc lui qui calcule le
 * plan et l'envoie au loader.
 *
 * Fonction pure, sans dependance a Electron -> testable directement.
 */

// Phases affichees, dans l'ordre du bootstrap. `events` sert au loader a ranger
// chaque evenement recu dans la bonne phase ; `steps` est le nombre
// d'evenements terminaux (_done / _skip / finish) que la phase emet.
const PHASES = {
	config: {
		steps: 2, // get_conf_done, check_conf_done
		events: ['get_conf', 'get_conf_done', 'check_conf', 'check_conf_done'],
	},
	update: {
		steps: 1, // check_update_done | check_update_skip
		events: [
			'check_update', 'check_update_done', 'check_update_skip',
			'download_update', 'download_update_done', 'download_update_skip',
			'update_quit', 'update_error',
		],
	},
	hardware: {
		steps: 2, // get_screens_done, create_wpt_done | create_wpt_skip
		events: [
			'get_screens', 'get_screens_done',
			'create_wpt', 'create_wpt_done', 'create_wpt_skip',
			'get_wpt_pid', 'get_wpt_pid_done',
		],
	},
	devices: {
		// create_http_*, puis 3 evenements que WPT soit actif (connect_done,
		// wpt_infos_done, REQUEST_WPT_done) ou non (les trois _skip
		// correspondants) : le compte est le meme dans les deux cas.
		steps: 4,
		events: [
			'create_http', 'create_http_done', 'create_http_skip',
			'wpt_connect', 'wpt_connect_done', 'wpt_connect_skip',
			'wpt_version_done',
			'wpt_infos', 'wpt_infos_done', 'wpt_infos_skip',
			'plugins', 'REQUEST_WPT', 'REQUEST_WPT_done', 'REQUEST_WPT_skip',
		],
	},
	pos: {
		steps: 1, // finish
		events: ['finish'],
	},
	shutdown: {
		steps: 3,
		events: ['finish'],
	},
}

const PHASE_KEYS = Object.keys(PHASES)

// Evenements terminaux exclus du fil du loader par initcallback.js : les
// compter ferait deriver la barre au-dela de 100 %.
const NOT_COUNTED = ['get_wpt_pid_done', 'wpt_version_done']

// Index inverse evenement -> phase, construit une fois.
const EVENT_PHASE = {}
for (const key of PHASE_KEYS) {
	if (key === 'shutdown') continue // meme evenement que `pos`, ne pas ecraser
	for (const ev of PHASES[key].events) {
		EVENT_PHASE[ev] = key
	}
}

/**
 * Un evenement fait-il avancer la progression ?
 * Meme regle que le loader historique (_done / _skip / finish), moins les
 * evenements que initcallback filtre deja.
 */
function countsAsStep(action) {
	if (typeof action !== 'string') return false
	if (NOT_COUNTED.indexOf(action) >= 0) return false
	return action === 'finish' || /_(done|skip)$/.test(action)
}

/** Phase d'appartenance d'un evenement, ou null s'il est inconnu. */
function phaseOfEvent(action) {
	if (typeof action !== 'string') return null
	return EVENT_PHASE[action] || null
}

const ACTION_PHASES = {
	initialize: ['config', 'update', 'hardware', 'devices', 'pos'],
	// reload passe par reinitialize() avec keep_wpt/keep_http : ni mise a jour
	// ni relance du process WPT.
	reload: ['config', 'devices', 'pos'],
	update: ['update', 'pos'],
	close: ['shutdown'],
}

/**
 * Construit le plan envoye au loader.
 * @param {object|null} conf  config.ini parsee (tolere null/partielle)
 * @param {string} action     initialize | reload | update | close
 * @returns {{action: string, phases: string[], total: number}}
 */
function buildBootPlan(conf, action) {
	const act = ACTION_PHASES[action] ? action : 'initialize'
	const c = conf || {}

	const updateOnStart = !!(c.update && c.update.enable && c.update.on_start)

	const phases = ACTION_PHASES[act].filter((key) => {
		// La phase de mise a jour n'existe que si le bootstrap va reellement la
		// traverser. `update` demande explicitement l'action : on la garde.
		if (key === 'update' && act === 'initialize') return updateOnStart
		return true
	})

	// L'action `update` telecharge en plus de verifier -> une etape de plus.
	const total = phases.reduce((sum, key) => {
		const extra = key === 'update' && act === 'update' ? 1 : 0
		return sum + PHASES[key].steps + extra
	}, 0)

	return { action: act, phases: phases, total: total }
}

module.exports = {
	PHASES,
	PHASE_KEYS,
	buildBootPlan,
	phaseOfEvent,
	countsAsStep,
}
