/**
 * Résolution de la configuration de trace continue.
 *
 * Trois niveaux, par précédence décroissante :
 *
 *   1. Variables d'env  (EL_TRACE*)   — override dev/debug, gagne sur tout.
 *   2. Ordre distant    (poll BO)     — activation à la demande depuis le
 *                                       dashboard, sans toucher la caisse.
 *   3. config.ini       ([trace])     — baseline posée au déploiement.
 *
 * Garde-fous NON contournables à distance :
 *
 *   - `allow_remote=0` dans config.ini bloque en dur tout ordre distant.
 *   - Les réglages de masquage (mask_all_inputs / mask_text_class /
 *     block_class) ne viennent JAMAIS du distant : un opérateur BO ne doit
 *     pas pouvoir affaiblir l'anonymisation d'une caisse.
 *   - Un ordre distant DOIT porter un `until` (ISO) : une activation oubliée
 *     s'éteint d'elle-même. Sans `until`, l'ordre est refusé.
 *
 * Module pur (aucun accès fs/electron) → testable directement.
 */

const DEFAULTS = Object.freeze({
  chunkSeconds: 300,
  spoolMaxMb: 500,
  idlePauseSeconds: 60,
  mousemoveMs: 150, // écrans tactiles : le touchmove suit ce même réglage
  maskAllInputs: true,
  maskTextClass: "el-mask",
  blockClass: "el-norec",
  captureNet: true,
  captureRedux: true,
  // Corps des trames WebSocket. OFF par defaut : avec un POS bavard, c'est le
  // poste de volume le plus lourd de la trace, et les trames transportent des
  // donnees metier. S'active en « gestion de crise », quand c'est le CONTENU
  // d'un message qui fait planter la caisse et qu'un compteur ne suffit plus.
  captureWsFrames: false,
});

// Bornes dures : un ordre distant (ou un config.ini fautif) ne peut pas
// pousser la caisse hors de ces plages.
const LIMITS = Object.freeze({
  chunkSeconds: [30, 1800],
  spoolMaxMb: [10, 5000],
  idlePauseSeconds: [0, 3600],
  mousemoveMs: [0, 1000],
});

function clamp(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

// config.ini est déjà coercé en booléens par le validator ; l'env arrive en
// string ; le distant en JSON. On accepte les trois formes.
function toBool(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return undefined;
}

function toInt(value, limits) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return clamp(Math.round(n), limits);
}

// Premier candidat défini, dans l'ordre fourni.
function pick(...candidates) {
  for (const c of candidates) {
    if (c !== undefined) return c;
  }
  return undefined;
}

/**
 * Un ordre distant est-il exploitable ?
 * @returns {{ok: true, remote: object} | {ok: false, why: string}}
 */
function validateRemote(remote, allowRemote, now) {
  if (!remote || typeof remote !== "object") return { ok: false, why: "none" };
  if (!allowRemote) return { ok: false, why: "blocked_by_config" };
  if (!remote.until) return { ok: false, why: "missing_until" };
  const until = Date.parse(remote.until);
  if (!Number.isFinite(until)) return { ok: false, why: "bad_until" };
  if (until <= now) return { ok: false, why: "expired" };
  return { ok: true, remote };
}

/**
 * @param {object}  args
 * @param {object} [args.conf]    config.ini parsée (on lit `conf.trace`)
 * @param {object} [args.env]     process.env
 * @param {object} [args.remote]  bloc `trace` renvoyé par le poll BO
 * @param {number} [args.now]     horloge (ms) — injectable pour les tests
 * @returns {object} config gelée
 */
function resolveTraceConfig({ conf, env = {}, remote, now = Date.now() } = {}) {
  const base = (conf && conf.trace) || {};

  // Défaut à true : une caisse dont le config.ini ne dit rien reste pilotable
  // depuis le BO. Un magasin qui refuse pose explicitement allow_remote=0.
  const allowRemote = toBool(base.allow_remote) !== false;
  const remoteCheck = validateRemote(remote, allowRemote, now);
  const r = remoteCheck.ok ? remoteCheck.remote : null;

  const envEnable = toBool(env.EL_TRACE);
  const remoteEnable = r ? toBool(r.enable) : undefined;
  const confEnable = toBool(base.enable);

  const enable = pick(envEnable, remoteEnable, confEnable, false);

  let source = "default";
  if (envEnable !== undefined) source = "env";
  else if (remoteEnable !== undefined) source = "remote";
  else if (confEnable !== undefined) source = "config";

  return Object.freeze({
    enable,
    source,
    // Traçabilité : qui a demandé quoi, jusqu'à quand. Repris dans le meta du
    // bundle uploadé pour que le dashboard sache pourquoi la trace existe.
    reason: r && r.reason ? String(r.reason) : undefined,
    until: r ? r.until : undefined,
    remoteRejected: remoteCheck.ok ? undefined : remoteCheck.why,

    chunkSeconds: pick(
      toInt(env.EL_TRACE_CHUNK_SECONDS, LIMITS.chunkSeconds),
      r ? toInt(r.chunkSeconds, LIMITS.chunkSeconds) : undefined,
      toInt(base.chunk_seconds, LIMITS.chunkSeconds),
      DEFAULTS.chunkSeconds,
    ),
    spoolMaxMb: pick(
      toInt(env.EL_TRACE_SPOOL_MB, LIMITS.spoolMaxMb),
      toInt(base.spool_max_mb, LIMITS.spoolMaxMb),
      DEFAULTS.spoolMaxMb,
    ),
    idlePauseSeconds: pick(
      toInt(env.EL_TRACE_IDLE_PAUSE, LIMITS.idlePauseSeconds),
      r ? toInt(r.idlePauseSeconds, LIMITS.idlePauseSeconds) : undefined,
      toInt(base.idle_pause_seconds, LIMITS.idlePauseSeconds),
      DEFAULTS.idlePauseSeconds,
    ),
    mousemoveMs: pick(
      toInt(env.EL_TRACE_MOUSEMOVE_MS, LIMITS.mousemoveMs),
      toInt(base.mousemove_ms, LIMITS.mousemoveMs),
      DEFAULTS.mousemoveMs,
    ),

    // --- Masquage : config.ini / env UNIQUEMENT (jamais le distant) --------
    maskAllInputs: pick(
      toBool(env.EL_TRACE_MASK_INPUTS),
      toBool(base.mask_all_inputs),
      DEFAULTS.maskAllInputs,
    ),
    maskTextClass: pick(
      base.mask_text_class ? String(base.mask_text_class) : undefined,
      DEFAULTS.maskTextClass,
    ),
    blockClass: pick(
      base.block_class ? String(base.block_class) : undefined,
      DEFAULTS.blockClass,
    ),

    captureNet: pick(toBool(base.capture_net), DEFAULTS.captureNet),
    captureRedux: pick(toBool(base.capture_redux), DEFAULTS.captureRedux),

    // Pilotable a distance comme les autres parametres de capture : un ordre BO
    // porte obligatoirement un `until`, donc une activation de crise s'eteint
    // d'elle-meme. Reste bloque si `allow_remote=0`.
    captureWsFrames: pick(
      toBool(env.EL_TRACE_WS_FRAMES),
      r ? toBool(r.wsFrames) : undefined,
      toBool(base.capture_ws_frames),
      DEFAULTS.captureWsFrames,
    ),
  });
}

module.exports = { resolveTraceConfig, DEFAULTS, LIMITS };
