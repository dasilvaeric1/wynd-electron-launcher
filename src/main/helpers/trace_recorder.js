/**
 * Capture rrweb continue, découpée en chunks indépendamment rejouables.
 *
 * ── Pourquoi le découpage est piloté depuis le main ────────────────────────
 * On n'utilise PAS `checkoutEveryNms` de rrweb : le shim du bundle vendoré
 * fait `record.bind(...)`, ce qui perd les propriétés statiques (dont
 * `takeFullSnapshot`), et la sémantique du flag `isCheckout` sur le tout
 * premier snapshot n'est pas garantie. À la place, le main orchestre :
 *
 *     stop() → take() → start()      (en UN SEUL executeJavaScript, atomique)
 *
 * Le `start()` qui suit réémet mécaniquement un snapshot complet, donc chaque
 * chunk commence par un snapshot et se rejoue seul. Aucune dépendance à la
 * sémantique interne de rrweb.
 *
 * ── Pause sur inactivité ──────────────────────────────────────────────────
 * C'est le premier levier de volume. Sur un POS qui anime en permanence
 * (horloge, carrousel), rrweb émet des mutations même caisse au repos. On
 * arrête donc le recorder après `idlePauseSeconds` sans interaction, et on le
 * redémarre au premier contact — le redémarrage réémettant un snapshot
 * complet, il n'y a AUCUNE perte de fidélité (contrairement à un simple
 * filtrage d'events, qui laisserait le DOM du replay divergent).
 *
 * L'activité est suivie côté page par des listeners indépendants de rrweb,
 * qui continuent donc de rapporter pendant la pause.
 *
 * ── Écrans tactiles ───────────────────────────────────────────────────────
 * `sampling.mousemove` gouverne aussi les `touchmove` : c'est le réglage
 * `mousemoveMs`. `mouseInteraction` reste à `true` — les taps sont le signal
 * qui a le plus de valeur pour comprendre ce que le caissier a fait.
 */

const fs = require("fs");
const log = require("./electron_log");
const getAssetPath = require("./get_asset");

const DRAIN_MS = 2_000;
// Plafond du tampon en page : au-delà on compte les events perdus plutôt que
// de faire gonfler la heap du renderer POS.
const MAX_BUFFERED_EVENTS = 20_000;

/**
 * Script injecté dans le webContents du POS. Expose `window.__elTrace`.
 * Idempotent (garde sur `window.__elTrace`).
 */
function buildInstallSrc(rrwebSrc) {
  return `(function () {
  if (window.__elTrace) return 'already';
  ${rrwebSrc}
  if (typeof window.rrwebRecord !== 'function') return 'no-rrweb';

  var T = {
    buf: [],
    rec: null,
    dropped: 0,
    lastAct: Date.now(),
    opts: null,
    startedAt: null
  };

  // Activité utilisateur — listeners INDÉPENDANTS de rrweb, donc toujours
  // actifs pendant une pause (c'est ce qui permet de détecter la reprise).
  ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (t) {
    window.addEventListener(t, function () { T.lastAct = Date.now(); },
      { capture: true, passive: true });
  });

  T.start = function (opts) {
    if (opts) T.opts = opts;
    if (T.rec) return 'running';
    var o = T.opts || {};
    try {
      T.rec = window.rrwebRecord({
        emit: function (e) {
          if (T.buf.length >= ${MAX_BUFFERED_EVENTS}) { T.dropped++; return; }
          T.buf.push(e);
        },
        sampling: {
          // Ecrans tactiles : gouverne aussi les touchmove.
          mousemove: o.mousemoveMs,
          // Les taps/clics sont conservés intégralement.
          mouseInteraction: true,
          scroll: 150,
          media: 800,
          input: 'last'
        },
        slimDOMOptions: 'all',
        collectFonts: false,
        recordCanvas: false,
        inlineImages: false,
        maskAllInputs: o.maskAllInputs !== false,
        maskTextClass: o.maskTextClass,
        blockClass: o.blockClass,
        plugins: window.rrwebConsolePlugin ? [window.rrwebConsolePlugin()] : []
      });
      T.startedAt = Date.now();
      return 'ok';
    } catch (e) {
      return 'err:' + (e && e.message);
    }
  };

  T.stop = function () {
    try { if (T.rec) T.rec(); } catch (e) { /* noop */ }
    T.rec = null;
    return 'ok';
  };

  // Vide le tampon rrweb ET le tampon Redux (posé par le tap du preload) en
  // un seul aller-retour IPC.
  T.take = function () {
    var events = T.buf; T.buf = [];
    var dropped = T.dropped; T.dropped = 0;
    var redux = [];
    try {
      if (Array.isArray(window.__elRedux)) {
        redux = window.__elRedux; window.__elRedux = [];
      }
    } catch (e) { /* noop */ }
    return { events: events, redux: redux, dropped: dropped, lastAct: T.lastAct, running: !!T.rec };
  };

  T.peek = function () {
    return { n: T.buf.length, lastAct: T.lastAct, running: !!T.rec };
  };

  window.__elTrace = T;
  return 'ok';
})();`;
}

// Rotation atomique : stop → take → restart. Le nouveau start réémet un
// snapshot complet, qui atterrit dans le tampon vidé = tête du chunk suivant.
const ROTATE_SRC = `(function () {
  var T = window.__elTrace;
  if (!T) return null;
  T.stop();
  var r = T.take();
  T.start();
  return r;
})();`;

const PAUSE_SRC = `(function () {
  var T = window.__elTrace;
  if (!T) return null;
  T.stop();
  return T.take();
})();`;

/**
 * @param {object}   args
 * @param {object}   args.cfg          config résolue (trace_config)
 * @param {function} args.getWebContents  () => webContents POS ou null
 * @param {function} args.onChunk      ({events, redux, dropped, startedAtMs, stoppedAtMs, reason}) => void
 * @param {function} args.onPartial    ({events, redux}) => void
 */
function createRecorder({ cfg, getWebContents, onChunk, onPartial }) {
  let rrwebSrc = null;
  let drainTimer = null;
  let running = false;
  let paused = false;
  let installedOn = null; // id du webContents où le hook est posé
  let chunkStartedAt = null;
  let lastActSeen = 0;

  function loadRrweb() {
    if (rrwebSrc) return rrwebSrc;
    try {
      rrwebSrc = fs.readFileSync(
        getAssetPath("rrweb/recorder.iife.js"),
        "utf8",
      );
    } catch (err) {
      log.error(`[TRACE] lecture bundle rrweb KO: ${err.message}`);
      rrwebSrc = null;
    }
    return rrwebSrc;
  }

  function wc() {
    const c = getWebContents();
    return c && !c.isDestroyed() ? c : null;
  }

  async function run(src) {
    const c = wc();
    if (!c) return null;
    try {
      return await c.executeJavaScript(src, true);
    } catch (err) {
      log.debug(`[TRACE] executeJavaScript KO: ${err.message}`);
      return null;
    }
  }

  const startOpts = () => ({
    mousemoveMs: cfg.mousemoveMs,
    maskAllInputs: cfg.maskAllInputs,
    maskTextClass: cfg.maskTextClass,
    blockClass: cfg.blockClass,
  });

  /** Pose le hook et démarre la capture. Idempotent. */
  async function install() {
    const c = wc();
    const src = loadRrweb();
    if (!c || !src) return false;
    const res = await run(buildInstallSrc(src));
    if (res === "no-rrweb") {
      log.error("[TRACE] bundle rrweb chargé mais window.rrwebRecord absent");
      return false;
    }
    if (res === null) return false;
    installedOn = c.id;
    const started = await run(
      `window.__elTrace && window.__elTrace.start(${JSON.stringify(startOpts())});`,
    );
    if (typeof started === "string" && started.startsWith("err:")) {
      log.error(`[TRACE] rrweb start KO: ${started}`);
      return false;
    }
    chunkStartedAt = Date.now();
    paused = false;
    log.info(
      `[TRACE] capture démarrée (chunk=${cfg.chunkSeconds}s, mousemove=${cfg.mousemoveMs}ms, idle=${cfg.idlePauseSeconds}s)`,
    );
    return true;
  }

  function emitChunk(payload, reason) {
    const stoppedAtMs = Date.now();
    onChunk({
      events: payload?.events || [],
      redux: payload?.redux || [],
      dropped: payload?.dropped || 0,
      startedAtMs: chunkStartedAt || stoppedAtMs,
      stoppedAtMs,
      reason,
    });
  }

  /** Ferme le chunk courant et en ouvre un nouveau. */
  async function rotate(reason = "interval") {
    const payload = await run(ROTATE_SRC);
    if (!payload) return;
    emitChunk(payload, reason);
    chunkStartedAt = Date.now();
  }

  async function pause() {
    if (paused) return;
    const payload = await run(PAUSE_SRC);
    paused = true;
    if (payload) emitChunk(payload, "idle");
    chunkStartedAt = null;
    log.debug(`[TRACE] pause (inactivité > ${cfg.idlePauseSeconds}s)`);
  }

  async function resume() {
    if (!paused) return;
    // Le restart réémet un snapshot complet → reprise sans perte de fidélité.
    await run(
      `window.__elTrace && window.__elTrace.start(${JSON.stringify(startOpts())});`,
    );
    paused = false;
    chunkStartedAt = Date.now();
    log.debug("[TRACE] reprise (interaction détectée)");
  }

  async function tick() {
    if (!running) return;
    const c = wc();
    if (!c) return;

    // Le POS a rechargé / navigué → le hook a disparu avec la page. On ferme
    // le chunk (son snapshot décrit l'ancienne page) et on réinstalle.
    const alive = await run("!!window.__elTrace");
    if (!alive || installedOn !== c.id) {
      if (chunkStartedAt) emitChunk(null, "reload");
      await install();
      return;
    }

    const state = await run("window.__elTrace.peek();");
    if (!state) return;
    if (state.lastAct) lastActSeen = state.lastAct;

    const idleMs = cfg.idlePauseSeconds * 1000;
    const now = Date.now();

    if (paused) {
      if (idleMs > 0 && now - lastActSeen < idleMs) await resume();
      return;
    }

    if (idleMs > 0 && now - lastActSeen >= idleMs) {
      await pause();
      return;
    }

    // Rotation à échéance. Le contrôle est à l'horloge murale et non sur le
    // flux d'events : une caisse au repos doit voir son chunk se fermer quand
    // même, sinon il resterait ouvert indéfiniment.
    if (chunkStartedAt && now - chunkStartedAt >= cfg.chunkSeconds * 1000) {
      await rotate("interval");
      return;
    }

    // Drain incrémental : le chunk en cours est écrit au fil de l'eau, donc un
    // crash ne coûte que les 2 dernières secondes.
    if (state.n > 0) {
      const payload = await run("window.__elTrace.take();");
      if (payload) {
        onPartial({
          events: payload.events || [],
          redux: payload.redux || [],
          startedAtMs: chunkStartedAt,
        });
      }
    }
  }

  async function start() {
    if (running) return;
    running = true;
    const ok = await install();
    if (!ok) log.warn("[TRACE] install différé (POS pas encore prêt)");
    drainTimer = setInterval(() => {
      tick().catch((err) => log.debug(`[TRACE] tick: ${err.message}`));
    }, DRAIN_MS);
  }

  async function stop() {
    if (!running) return;
    running = false;
    if (drainTimer) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
    const payload = await run(PAUSE_SRC);
    if (payload && chunkStartedAt) emitChunk(payload, "stop");
    chunkStartedAt = null;
    installedOn = null;
    log.info("[TRACE] capture arrêtée");
  }

  return {
    start,
    stop,
    rotate,
    // Exposé pour permettre un drain forcé (et pour piloter la logique dans
    // les tests sans dépendre des timers).
    tick,
    isRunning: () => running,
    isPaused: () => paused,
  };
}

module.exports = { createRecorder, DRAIN_MS, MAX_BUFFERED_EVENTS };
