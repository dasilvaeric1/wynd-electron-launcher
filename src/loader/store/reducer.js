const { phaseOfEvent, countsAsStep } = require('../../helpers/boot_plan')

/**
 * Etat du loader, reduit de facon PURE.
 *
 * L'ancien App.tsx rendait depuis un `useRef` et n'appelait `setState` que sur
 * `current_status`. Trois handlers sur cinq (download_progress, app_infos,
 * loader.action) ne declenchaient donc AUCUN rendu : la barre de
 * telechargement d'une mise a jour ne bougeait jamais, et le message d'erreur
 * n'apparaissait que si un statut arrivait derriere. Tout passe desormais par
 * ce reducteur, donc tout repeint.
 *
 * Aucune dependance a React ni a Electron : testable directement.
 */

/**
 * @typedef {'config'|'update'|'hardware'|'devices'|'pos'|'shutdown'} TPhaseKey
 * @typedef {'pending'|'active'|'done'|'failed'} TPhaseState
 * @typedef {'initialize'|'reload'|'update'|'close'} TBootAction
 *
 * @typedef {Object} IBootError
 * @property {string} code
 * @property {string} message
 * @property {string|null} detail
 * @property {number|null} status
 *
 * @typedef {Object} IBootPlan
 * @property {TBootAction} action
 * @property {TPhaseKey[]} phases
 * @property {number} total
 *
 * @typedef {Object} ILoaderState
 * @property {TBootAction} action
 * @property {TPhaseKey[]} phases
 * @property {Record<string, TPhaseState>} phaseState
 * @property {number} current
 * @property {number} total
 * @property {string} detail
 * @property {string} title
 * @property {string} version
 * @property {boolean} download
 * @property {number} progress
 * @property {IBootError|null} error
 * @property {boolean} slow
 */

/** Intitule de chaque phase, cote caissier. */
const PHASE_LABELS = {
	config: 'Configuration',
	update: 'Mise à jour',
	hardware: 'Écrans & matériel',
	devices: 'Connexion aux périphériques',
	pos: 'Point de vente',
	shutdown: 'Fermeture',
}

/** Intitule de l'action en cours. */
const ACTION_LABELS = {
	initialize: 'Démarrage en cours',
	reload: 'Rechargement',
	update: 'Mise à jour',
	close: 'Fermeture',
}

/**
 * Detail technique, en francais. Remplace l'enum EStatus, qui etait en anglais
 * et ne couvrait pas 'plugins' -> le statut devenait `undefined` et la ligne
 * restait vide.
 */
const EVENT_LABELS = {
	get_conf: 'Lecture de la configuration',
	get_conf_done: 'Configuration lue',
	check_conf: 'Vérification de la configuration',
	check_conf_done: 'Configuration validée',

	check_update: 'Recherche d’une mise à jour',
	check_update_done: 'Recherche de mise à jour terminée',
	check_update_skip: 'Recherche de mise à jour ignorée',
	download_update: 'Téléchargement de la mise à jour',
	download_update_done: 'Mise à jour téléchargée',
	download_update_skip: 'Aucune mise à jour à télécharger',
	update_quit: 'Installation puis redémarrage…',
	update_error: 'Échec de la mise à jour',

	get_screens: 'Détection des écrans',
	get_screens_done: 'Écrans détectés',
	create_wpt: 'Démarrage du service WPT',
	create_wpt_done: 'Service WPT démarré',
	create_wpt_skip: 'Service WPT non requis',
	get_wpt_pid: 'Service WPT',
	get_wpt_pid_done: 'Service WPT identifié',

	create_http: 'Démarrage du serveur local',
	create_http_done: 'Serveur local démarré',
	create_http_skip: 'Serveur local non requis',
	wpt_connect: 'Connexion au service WPT',
	wpt_connect_done: 'Service WPT connecté',
	wpt_connect_skip: 'Connexion au service WPT ignorée',
	wpt_infos: 'Lecture des périphériques',
	wpt_infos_done: 'Périphériques identifiés',
	wpt_infos_skip: 'Lecture des périphériques ignorée',
	plugins: 'Lecture des modules',
	REQUEST_WPT: 'Lecture des modules',
	REQUEST_WPT_done: 'Modules chargés',
	REQUEST_WPT_skip: 'Modules ignorés',

	finish: 'Prêt',
}

const DEFAULT_PHASES = ['config', 'hardware', 'devices', 'pos']

/** @returns {ILoaderState} */
function initialState(over) {
	return {
		action: 'initialize',
		phases: DEFAULT_PHASES.slice(),
		phaseState: markPhases(DEFAULT_PHASES, 'config'),
		current: 0,
		// Valeur d'attente : remplacee des l'arrivee du plan calcule par le main.
		total: 9,
		detail: '',
		title: '',
		version: '',
		download: false,
		progress: 0,
		error: null,
		slow: false,
		...(over || {}),
	}
}

/**
 * Etat de chaque phase sachant celle en cours.
 * @param {string[]} phases
 * @param {string|null} activeKey  null => toutes terminees
 * @param {boolean} [failed]       la phase en cours a echoue
 * @returns {Record<string, TPhaseState>}
 */
function markPhases(phases, activeKey, failed) {
	const at = activeKey === null ? phases.length : phases.indexOf(activeKey)
	const out = {}
	phases.forEach((key, i) => {
		if (at < 0) {
			out[key] = 'pending'
		} else if (i < at) {
			out[key] = 'done'
		} else if (i === at) {
			out[key] = failed ? 'failed' : 'active'
		} else {
			out[key] = 'pending'
		}
	})
	return out
}

/** Phase actuellement active (ou en echec), sinon null. */
function activePhase(state) {
	return state.phases.find((k) => state.phaseState[k] === 'active' || state.phaseState[k] === 'failed') || null
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/** Detail lisible pour un evenement et sa donnee eventuelle. */
function detailFor(event, data) {
	// Certains evenements portent leur propre message (echec de recherche de
	// mise a jour, erreur non bloquante) : il est plus utile que le libelle.
	if (data && typeof data === 'object' && typeof data.message === 'string' && data.message) {
		return data.message
	}
	if (event === 'get_wpt_pid' && data) {
		return `${EVENT_LABELS[event]} ${data}`
	}
	return EVENT_LABELS[event] || event
}

/**
 * @param {ILoaderState} state
 * @param {Object} event
 * @returns {ILoaderState}
 */
function reduce(state, event) {
	switch (event.type) {
		case 'plan': {
			const plan = event.plan || {}
			const phases = Array.isArray(plan.phases) && plan.phases.length ? plan.phases : state.phases
			return {
				...state,
				action: plan.action || state.action,
				phases: phases.slice(),
				phaseState: markPhases(phases, phases[0]),
				current: 0,
				total: typeof plan.total === 'number' && plan.total > 0 ? plan.total : state.total,
				error: null,
				slow: false,
				download: false,
				progress: 0,
			}
		}

		case 'retry':
			return {
				...state,
				phaseState: markPhases(state.phases, state.phases[0]),
				current: 0,
				detail: '',
				error: null,
				slow: false,
				download: false,
				progress: 0,
			}

		case 'status': {
			const phase = phaseOfEvent(event.event)
			// wpt_connect_done est aussi emis avec `false` sur 'disconnect' :
			// le compter ferait avancer la barre sur un echec.
			const negative = event.event === 'wpt_connect_done' && event.data === false
			const advance = countsAsStep(event.event) && !negative

			const next = {
				...state,
				current: advance ? clamp(state.current + 1, 0, state.total) : state.current,
				detail: detailFor(event.event, event.data),
				// Toute transition invalide l'alerte de lenteur.
				slow: false,
			}

			if (event.event === 'download_update') {
				next.download = true
				next.progress = 0
			}
			if (event.event === 'finish') {
				next.phaseState = markPhases(state.phases, null)
				next.download = false
				return next
			}
			if (phase && state.phases.indexOf(phase) >= 0) {
				next.phaseState = markPhases(state.phases, phase)
			}
			return next
		}

		case 'progress':
			return { ...state, progress: clamp(Math.round(event.percent), 0, 100) }

		case 'infos': {
			const infos = event.infos || {}
			return {
				...state,
				title: infos.title || infos.name || state.title,
				version: infos.version || state.version,
			}
		}

		case 'error': {
			const failing = activePhase(state)
			return {
				...state,
				error: event.error || null,
				slow: false,
				phaseState: failing ? markPhases(state.phases, failing, true) : state.phaseState,
			}
		}

		case 'slow':
			return { ...state, slow: true }

		default:
			return state
	}
}

module.exports = {
	initialState,
	reduce,
	markPhases,
	detailFor,
	PHASE_LABELS,
	ACTION_LABELS,
	EVENT_LABELS,
}
