/**
 * Presence de la caisse aupres du dashboard central.
 *
 * Le signal existe deja : screen_session.js interroge
 * /api/screen-sessions/pending toutes les 5 s avec un heartbeat portant
 * launcherVersion / platform / uptime. Il n'etait simplement jamais remonte a
 * l'ecran : un magasin ne pouvait pas savoir que sa caisse avait cesse de
 * remonter au siege.
 *
 * `level` est calcule de facon PURE a partir de l'etat + de l'heure courante,
 * donc testable sans reseau ni minuterie.
 */

/** Au-dela, le dernier contact n'est plus considere comme frais. */
const FRESH_WITHIN_MS = 30_000
/** Nombre d'echecs consecutifs a partir duquel on declare la liaison rompue. */
const DOWN_AFTER_FAILURES = 3

/**
 * @typedef {'off'|'ok'|'warn'|'down'} TPresenceLevel
 * 'off'  : screen-session non configure (pas d'appsettings) -> rien a afficher
 * 'ok'   : contact il y a moins de 30 s
 * 'warn' : contact plus ancien, mais pas encore assez d'echecs pour conclure
 * 'down' : 3 echecs consecutifs
 *
 * @typedef {Object} IPresenceState
 * @property {boolean} configured
 * @property {number|null} lastContactAt
 * @property {number} consecutiveFailures
 */

/** @returns {IPresenceState} */
function emptyState() {
	return { configured: false, lastContactAt: null, consecutiveFailures: 0 }
}

let state = emptyState()

/**
 * Niveau de presence. Fonction pure.
 * @param {IPresenceState} current
 * @param {number} now
 * @returns {TPresenceLevel}
 */
function presenceLevel(current, now) {
	if (!current || !current.configured) {
		return 'off'
	}
	if (current.consecutiveFailures >= DOWN_AFTER_FAILURES) {
		return 'down'
	}
	if (current.lastContactAt === null) {
		return 'warn'
	}
	return now - current.lastContactAt <= FRESH_WITHIN_MS ? 'ok' : 'warn'
}

/** Poll abouti. */
function noteSuccess(now) {
	state = { configured: true, lastContactAt: now, consecutiveFailures: 0 }
	return state
}

/** Poll parti mais en echec (reseau, 5xx, auth refusee). */
function noteFailure(now) {
	state = {
		configured: true,
		lastContactAt: state.lastContactAt,
		consecutiveFailures: state.consecutiveFailures + 1,
	}
	return state
}

/** Pas d'appsettings : la caisse n'est pas enrolee, il n'y a rien a afficher. */
function noteUnconfigured() {
	state = emptyState()
	return state
}

/**
 * Instantane destine au renderer.
 * @param {number} [now]
 */
function snapshot(now) {
	const at = typeof now === 'number' ? now : Date.now()
	return {
		level: presenceLevel(state, at),
		lastContactAt: state.lastContactAt,
		secondsSince: state.lastContactAt === null ? null : Math.max(0, Math.round((at - state.lastContactAt) / 1000)),
	}
}

function reset() {
	state = emptyState()
}

module.exports = {
	FRESH_WITHIN_MS,
	DOWN_AFTER_FAILURES,
	presenceLevel,
	noteSuccess,
	noteFailure,
	noteUnconfigured,
	snapshot,
	reset,
}
