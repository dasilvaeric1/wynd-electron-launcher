const fs = require("fs");
const JSZip = require("jszip");
const axios = require("axios");
const log = require("./electron_log");
const getAssetPath = require("./get_asset");

const DRAIN_MS = 2000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_EVENTS = 200000; // hard cap → auto-stop
const MAX_REDUX_EVENTS = 20000; // hard cap for redux actions → auto-stop

let active = null; // { posWc, cfg, posUrl, clientHint, startedAt, events:[], net:[], timer, onStatus }

function isRecording() {
  return !!active;
}

const INJECT = (src) => `(() => {
  if (window.__elRec) return 'already';
  ${src}
  window.__rrwebEvents = [];
  window.__elRec = window.rrwebRecord({
    emit: (e) => { window.__rrwebEvents.push(e); },
    plugins: window.rrwebConsolePlugin ? [window.rrwebConsolePlugin()] : [],
    recordCanvas: false,
  });
  return 'ok';
})()`;

async function inject(posWc) {
  if (!posWc || posWc.isDestroyed()) return false;
  const src = fs.readFileSync(getAssetPath("rrweb/recorder.iife.js"), "utf8");
  try {
    await posWc.executeJavaScript(INJECT(src), true);
    return true;
  } catch (e) {
    log.warn(`[REC] inject KO: ${e.message}`);
    return false;
  }
}

async function drain() {
  if (!active?.posWc || active.posWc.isDestroyed()) return;
  try {
    const batch = await active.posWc.executeJavaScript(
      "(()=>{const e=window.__rrwebEvents||[];window.__rrwebEvents=[];return e})()",
      true,
    );
    if (Array.isArray(batch) && batch.length) active.events.push(...batch);
  } catch (e) {
    log.debug(`[REC] drain err: ${e.message}`);
  }
  try {
    const rbatch = await active.posWc.executeJavaScript(
      "(()=>{const e=window.__elRedux||[];window.__elRedux=[];return e})()",
      true,
    );
    if (Array.isArray(rbatch) && rbatch.length) active.redux.push(...rbatch);
  } catch (e) {
    log.debug(`[REC] redux drain err: ${e.message}`);
  }
  if (
    active.events.length > MAX_EVENTS ||
    active.redux.length > MAX_REDUX_EVENTS ||
    Date.now() - active.startedAt >= MAX_DURATION_MS
  ) {
    log.info("[REC] auto-stop (cap atteint)");
    stop().catch(() => {});
  }
}

function start({ posWc, cfg, posUrl, clientHint, onStatus }) {
  if (active) return;
  active = {
    posWc,
    cfg,
    posUrl,
    clientHint,
    startedAt: Date.now(),
    events: [],
    net: [],
    timer: null,
    onStatus,
  };
  active.reduxInitial = {};
  active.redux = [];
  active.reduxDiag = null;
  posWc
    ?.executeJavaScript?.(
      "(()=>{try{return JSON.parse(JSON.stringify(window.__elReduxState||{}))}catch(e){return {}}})()",
      true,
    )
    .then((snap) => {
      if (active) active.reduxInitial = snap || {};
    })
    .catch(() => {});
  // Diagnostic embarqué (lisible depuis le bundle, sans console) : permet de
  // savoir pourquoi le state est vide (shim absent ? compose pas appelé ?).
  posWc
    ?.executeJavaScript?.(
      "(()=>{try{return {installed:!!window.__elReduxInstalled,composeType:typeof window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__,extType:typeof window.__REDUX_DEVTOOLS_EXTENSION__,stores:Object.keys(window.__elReduxState||{}),bufLen:(window.__elRedux||[]).length,href:location&&location.href}}catch(e){return {err:String(e&&e.message)}}})()",
      true,
    )
    .then((d) => {
      if (active) active.reduxDiag = d || null;
    })
    .catch(() => {});
  inject(posWc).then((ok) => {
    if (ok && onStatus) onStatus({ state: "recording" });
  });
  active.timer = setInterval(drain, DRAIN_MS);
}

function addNet(msg) {
  if (active) active.net.push({ ...msg, ts: Date.now() });
}

function injectIfRecording(posWc) {
  if (active) inject(posWc);
}

async function stop() {
  if (!active) return null;
  const a = active;
  active = null;
  if (a.timer) clearInterval(a.timer);
  a.onStatus?.({ state: "uploading" });
  // final drain
  try {
    const batch = await a.posWc?.executeJavaScript?.(
      "(()=>{const e=window.__rrwebEvents||[];window.__rrwebEvents=[];if(window.__elRec)window.__elRec();window.__elRec=null;return e})()",
      true,
    );
    if (Array.isArray(batch)) a.events.push(...batch);
  } catch (_) {}
  const startedAt = new Date(a.startedAt).toISOString();
  const stoppedAt = new Date().toISOString();
  const meta = {
    clientId: a.clientHint,
    caisseSerial: a.cfg.serial,
    startedAt,
    stoppedAt,
    launcherVersion: require("../../../package.json").version,
    posUrl: a.posUrl,
  };
  const zip = new JSZip();
  zip.file("events.json", JSON.stringify(a.events));
  zip.file("network.json", JSON.stringify(a.net));
  zip.file("meta.json", JSON.stringify(meta));
  zip.file(
    "redux.json",
    JSON.stringify({
      initial: a.reduxInitial || {},
      events: a.redux || [],
      diag: a.reduxDiag || null,
    }),
  );
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  try {
    const pres = await axios.post(
      `${a.cfg.baseUrl}/api/traces/presign`,
      { caisseSerial: a.cfg.serial, startedAt },
      { headers: { "x-api-key": a.cfg.apiKey }, timeout: 15000 },
    );
    const { traceId, uploadUrl } = pres.data;
    await axios.put(uploadUrl, buf, {
      headers: { "content-type": "application/zip" },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    await axios.post(
      `${a.cfg.baseUrl}/api/traces/${traceId}/complete`,
      {
        sizeBytes: buf.length,
        stoppedAt,
        durationMs: a.startedAt ? Date.now() - a.startedAt : 0,
        meta,
      },
      { headers: { "x-api-key": a.cfg.apiKey }, timeout: 15000 },
    );
    a.onStatus?.({ state: "ready", traceId });
    return { traceId };
  } catch (e) {
    log.error(`[REC] upload KO: ${e.message}`);
    a.onStatus?.({ state: "error", error: e.message });
    return null;
  }
}

module.exports = { start, stop, addNet, isRecording, injectIfRecording };
