/**
 * Trace continue de la caisse — orchestrateur.
 *
 *   rrweb (continu) ─┐
 *   actions Redux    ─┼─→ chunk de X min ─→ ZIP ─→ spool disque ─→ upload FIFO
 *   réseau (méta)    ─┘      (snapshot en tête)     (plafond Mo)   /api/traces
 *
 * Activation : voir helpers/trace_config.js (env > BO distant > config.ini,
 * avec `allow_remote` et les réglages de masquage non contournables à
 * distance).
 *
 * Reprise après crash : un chunk partiel laissé sur disque par un run
 * précédent est finalisé au démarrage puis uploadé — c'est précisément le cas
 * qu'on veut pouvoir diagnostiquer, il ne doit pas être perdu.
 */

const { join } = require("path");
const { app } = require("electron");

const log = require("./helpers/electron_log");
const { resolveTraceConfig } = require("./helpers/trace_config");
const { createSpool } = require("./helpers/trace_spool");
const { createRecorder } = require("./helpers/trace_recorder");
const { createUploader } = require("./helpers/trace_uploader");
const { buildChunkZip } = require("./helpers/trace_chunk");
const { getPosWebContents } = require("./helpers/pos_web_contents");
const netCapture = require("./helpers/net_capture");

const UPLOAD_TICK_MS = 30_000;
// Les events réseau et actions Redux du chunk courant restent en mémoire (du
// texte, quelques dizaines de Ko) ; seuls les events rrweb, qui portent le
// volume, sont écrits au fil de l'eau sur disque.
const MAX_NET_PER_CHUNK = 5_000;
const MAX_REDUX_PER_CHUNK = 20_000;
// Le webview POS est monté après la container window : on retente l'attache
// réseau le temps qu'il apparaisse (~1 min au total).
const NET_ATTACH_RETRY_MS = 5_000;
const NET_ATTACH_MAX_TRIES = 12;

let state = null;

/** Métadonnées réseau seulement : pas de corps dans une trace continue. */
function slimNet(msg) {
  return {
    ts: Date.now(),
    method: msg.method,
    url: msg.url,
    status: msg.status,
    statusText: msg.statusText,
    error: msg.error,
    durationMs: msg.durationMs,
    resourceType: msg.resourceType,
  };
}

function spoolDir() {
  return join(app.getPath("userData"), "logs", "trace");
}

function buildMeta(s, chunk) {
  return {
    kind: "continuous",
    caisseSerial: s.centralCfg?.serial,
    startedAt: new Date(chunk.startedAtMs).toISOString(),
    stoppedAt: new Date(chunk.stoppedAtMs).toISOString(),
    durationMs: chunk.stoppedAtMs - chunk.startedAtMs,
    closedBy: chunk.reason,
    droppedEvents: chunk.dropped,
    launcherVersion: s.launcherInfo.version,
    platform: s.launcherInfo.platform,
    posUrl: s.store?.conf?.url?.href,
    chunkSeconds: s.cfg.chunkSeconds,
    // Provenance de l'activation — le dashboard peut afficher pourquoi cette
    // trace existe et jusqu'à quand elle est censée tourner.
    activation: {
      source: s.cfg.source,
      reason: s.cfg.reason,
      until: s.cfg.until,
    },
  };
}

async function finalizeChunk(chunk) {
  const s = state;
  if (!s) return;

  // Le reliquat d'events du dernier take() rejoint le fichier partiel.
  if (chunk.events.length > 0) {
    if (!s.partialOpen) openPartial(chunk.startedAtMs);
    s.spool.appendPartial(chunk.events);
  }
  if (chunk.redux.length > 0) s.redux.push(...chunk.redux);

  const partial = s.spool.readPartial();
  const events = partial ? partial.events : [];
  if (events.length === 0) {
    // Chunk vide (caisse au repos) → rien à uploader, on repart propre.
    s.spool.dropPartial();
    resetChunkBuffers();
    return;
  }

  const redux = s.redux;
  const net = s.net;
  resetChunkBuffers();

  try {
    const buf = await buildChunkZip({
      events,
      net,
      redux,
      meta: buildMeta(s, chunk),
    });
    const name = s.spool.putChunk(chunk.startedAtMs, buf);
    s.spool.dropPartial();
    if (name) {
      log.info(
        `[TRACE] chunk ${name} fermé (${events.length} events, ${Math.round(buf.length / 1024)} Ko, ${chunk.reason})`,
      );
    }
  } catch (err) {
    log.error(`[TRACE] finalisation chunk KO: ${err.message}`);
    s.spool.dropPartial();
  }
}

function openPartial(startedAtMs) {
  const s = state;
  if (!s) return;
  s.spool.openPartial({ startedAtMs });
  s.partialOpen = true;
}

function resetChunkBuffers() {
  const s = state;
  if (!s) return;
  s.net = [];
  s.redux = [];
  s.partialOpen = false;
}

function onPartial({ events, redux, startedAtMs }) {
  const s = state;
  if (!s) return;
  if (!s.partialOpen) openPartial(startedAtMs || Date.now());
  if (events.length > 0) s.spool.appendPartial(events);
  if (redux.length > 0 && s.redux.length < MAX_REDUX_PER_CHUNK) {
    s.redux.push(...redux);
  }
}

/** Finalise un chunk partiel laissé par un run précédent (crash / kill). */
async function recoverPartial(spool, launcherInfo, store) {
  const partial = spool.readPartial();
  if (!partial || partial.events.length === 0) {
    spool.dropPartial();
    return;
  }
  const startedAtMs = partial.meta?.startedAtMs || Date.now();
  try {
    const buf = await buildChunkZip({
      events: partial.events,
      net: [],
      redux: [],
      meta: {
        kind: "continuous",
        startedAt: new Date(startedAtMs).toISOString(),
        stoppedAt: new Date().toISOString(),
        closedBy: "recovered",
        launcherVersion: launcherInfo.version,
        platform: launcherInfo.platform,
        posUrl: store?.conf?.url?.href,
      },
    });
    const name = spool.putChunk(startedAtMs, buf);
    log.warn(
      `[TRACE] chunk partiel récupéré après arrêt brutal → ${name} (${partial.events.length} events)`,
    );
  } catch (err) {
    log.error(`[TRACE] récupération chunk partiel KO: ${err.message}`);
  }
  spool.dropPartial();
}

function startCapture() {
  const s = state;
  if (!s || s.recorder) return;

  s.recorder = createRecorder({
    cfg: s.cfg,
    getWebContents: () => getPosWebContents(s.store),
    onChunk: (chunk) =>
      finalizeChunk(chunk).catch((err) =>
        log.error(`[TRACE] onChunk: ${err.message}`),
      ),
    onPartial,
  });
  s.recorder.start().catch((err) => log.error(`[TRACE] start: ${err.message}`));

  if (s.cfg.captureNet) {
    s.netUnsub = netCapture.subscribe((msg) => {
      if (!msg || msg.type !== "net") return;
      if (s.net.length >= MAX_NET_PER_CHUNK) return;
      s.net.push(slimNet(msg));
    });
    // Le webview POS peut être monté tardivement : on retente l'attache
    // jusqu'à l'obtenir. `attachDebugger` est idempotent (garde sur la liste
    // des webContents déjà attachés), donc une relance ne double rien.
    let tries = 0;
    const tryAttach = () => {
      const wc = getPosWebContents(s.store);
      if (wc) {
        netCapture.attachWebContents(wc);
        clearInterval(s.netAttachTimer);
        s.netAttachTimer = null;
        return;
      }
      if (++tries >= NET_ATTACH_MAX_TRIES) {
        clearInterval(s.netAttachTimer);
        s.netAttachTimer = null;
        log.warn("[TRACE] webContents POS introuvable → capture réseau inactive");
      }
    };
    tryAttach();
    if (!s.netAttachTimer && tries > 0) {
      s.netAttachTimer = setInterval(tryAttach, NET_ATTACH_RETRY_MS);
    }
  }
}

async function stopCapture() {
  const s = state;
  if (!s) return;
  if (s.netAttachTimer) {
    clearInterval(s.netAttachTimer);
    s.netAttachTimer = null;
  }
  if (s.netUnsub) {
    s.netUnsub();
    s.netUnsub = null;
  }
  if (s.recorder) {
    await s.recorder.stop();
    s.recorder = null;
  }
}

/**
 * (Re)calcule la config et applique la décision. Appelé au boot puis à chaque
 * poll BO porteur d'un bloc `trace`.
 * @param {object} [remote] bloc `trace` du poll
 */
async function applyTraceConfig(remote) {
  const s = state;
  if (!s) return;

  if (remote !== undefined) s.remote = remote;
  const next = resolveTraceConfig({
    conf: s.store.conf,
    env: process.env,
    remote: s.remote,
  });
  const was = s.cfg;
  s.cfg = next;

  if (next.enable === was.enable) {
    // Changement de paramètres à chaud (durée de chunk, idle…) → on redémarre
    // la capture pour que le recorder reparte avec la nouvelle config.
    const changed =
      next.chunkSeconds !== was.chunkSeconds ||
      next.idlePauseSeconds !== was.idlePauseSeconds ||
      next.mousemoveMs !== was.mousemoveMs;
    if (next.enable && changed) {
      await stopCapture();
      startCapture();
    }
    return;
  }

  if (next.enable) {
    log.info(
      `[TRACE] activation (source=${next.source}${next.reason ? `, reason=${next.reason}` : ""}${next.until ? `, until=${next.until}` : ""})`,
    );
    startCapture();
  } else {
    log.info(`[TRACE] désactivation (source=${next.source})`);
    await stopCapture();
  }
}

/**
 * @param {object}   store
 * @param {object}   deps
 * @param {function} deps.getCentralConfig  () => Promise<{baseUrl, apiKey, serial}|null>
 */
function initTrace(store, { getCentralConfig }) {
  if (state) return;

  const launcherInfo = {
    version: app.getVersion(),
    platform: process.platform,
  };

  const bootCfg = resolveTraceConfig({
    conf: store.conf,
    env: process.env,
  });

  const spool = createSpool({
    dir: spoolDir(),
    maxBytes: bootCfg.spoolMaxMb * 1024 * 1024,
    logger: log,
  });
  spool.ensureDir();

  state = {
    store,
    cfg: Object.freeze({ ...bootCfg, enable: false }), // applyTraceConfig décide
    remote: undefined,
    spool,
    launcherInfo,
    centralCfg: null,
    recorder: null,
    netUnsub: null,
    netAttachTimer: null,
    net: [],
    redux: [],
    partialOpen: false,
    uploadTimer: null,
  };

  const uploader = createUploader({
    spool,
    launcherInfo,
    getConfig: async () => {
      const cfg = await getCentralConfig();
      state.centralCfg = cfg;
      return cfg;
    },
  });

  recoverPartial(spool, launcherInfo, store)
    .then(() => applyTraceConfig(undefined))
    .catch((err) => log.error(`[TRACE] init: ${err.message}`));

  // L'uploader tourne en permanence : même trace désactivée, un spool résiduel
  // (fin de session, panne réseau passée) doit finir de partir.
  state.uploadTimer = setInterval(() => {
    uploader.tick().catch((err) => log.debug(`[TRACE] upload tick: ${err.message}`));
  }, UPLOAD_TICK_MS);

  log.info(
    `[TRACE] module prêt (spool=${spoolDir()}, plafond=${bootCfg.spoolMaxMb} Mo)`,
  );
}

async function teardownTrace() {
  if (!state) return;
  if (state.uploadTimer) clearInterval(state.uploadTimer);
  await stopCapture();
  state = null;
}

module.exports = { initTrace, applyTraceConfig, teardownTrace };
