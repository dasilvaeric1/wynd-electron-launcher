const { ipcRenderer, contextBridge, webFrame } = require("electron");

// Tap Redux — shim INLINE (pas de readFileSync : robuste en packagé/asar, qui
// était la cause du tap absent). Exécuté dans le MAIN world via
// webFrame.executeJavaScript (≠ <script> DOM, refusé par la CSP du POS) AVANT
// la création du store. DOIT rester identique à assets/redux/redux_tap.js
// (la logique est testée par __tests__/redux_tap.test.js).
const REDUX_TAP_SRC = `
(function (window) {
  if (window.__elReduxInstalled) return;
  window.__elReduxInstalled = true;
  var MAX_EVENTS = 5000;
  var ACTION_CAP = 8000;
  window.__elReduxState = window.__elReduxState || {};
  window.__elRedux = window.__elRedux || [];
  function compose() {
    var funcs = Array.prototype.slice.call(arguments);
    if (funcs.length === 0) return function (x) { return x; };
    if (funcs.length === 1) return funcs[0];
    return funcs.reduce(function (a, b) {
      return function () { return a(b.apply(undefined, arguments)); };
    });
  }
  function sliceDiff(prev, next) {
    var d = {};
    if (!next || typeof next !== 'object') return d;
    var keys = Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!prev || prev[k] !== next[k]) d[k] = next[k];
    }
    return d;
  }
  function cap(v) {
    try {
      var s = JSON.stringify(v);
      if (s && s.length > ACTION_CAP) return { __truncated: true, type: v && v.type };
      return v;
    } catch (e) { return { __unserializable: true, type: v && v.type }; }
  }
  function tapEnhancer(name) {
    return function (createStore) {
      return function (reducer, preloadedState) {
        var store = createStore(reducer, preloadedState);
        try { window.__elReduxState[name] = store.getState(); } catch (e) {}
        var origDispatch = store.dispatch;
        store.dispatch = function (action) {
          var res = origDispatch(action);
          try {
            var prev = window.__elReduxState[name];
            var next = store.getState();
            var diff = sliceDiff(prev, next);
            window.__elReduxState[name] = next;
            window.__elRedux.push({ ts: Date.now(), store: name, actionType: (action && action.type) || 'action', action: cap(action), diff: diff });
            if (window.__elRedux.length > MAX_EVENTS) window.__elRedux.splice(0, window.__elRedux.length - MAX_EVENTS);
          } catch (e) {}
          return res;
        };
        return store;
      };
    };
  }
  window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = function (options) {
    var name = (options && options.name) || 'store';
    return function () {
      var enhancers = Array.prototype.slice.call(arguments);
      return compose.apply(undefined, [tapEnhancer(name)].concat(enhancers));
    };
  };
  window.__REDUX_DEVTOOLS_EXTENSION__ = window.__REDUX_DEVTOOLS_EXTENSION__ || {
    connect: function () {
      return { init: function () {}, send: function () {}, subscribe: function () { return function () {}; }, unsubscribe: function () {}, error: function () {} };
    },
  };
})(window);
`;

// Statut d'injection exposé au MAIN world via contextBridge (lisible par le
// recorder même si webFrame échoue) → diagnostic sans console DevTools.
const __elReduxStatus = {
  ts: Date.now(),
  hasWebFrame: !!(webFrame && typeof webFrame.executeJavaScript === "function"),
  method: null,
  err: null,
};
try {
  if (__elReduxStatus.hasWebFrame) {
    webFrame
      .executeJavaScript(REDUX_TAP_SRC)
      .catch((e) => {
        try {
          console.error("[el-redux-tap] exec KO", e && e.message);
        } catch (_) {
          /* noop */
        }
      });
    __elReduxStatus.method = "webFrame.called";
  } else {
    __elReduxStatus.err = "webFrame indisponible";
  }
} catch (e) {
  __elReduxStatus.err = String(e && e.message);
}
try {
  contextBridge.exposeInMainWorld("__elReduxPreloadStatus", __elReduxStatus);
} catch (e) {
  /* contextBridge indispo */
}

ipcRenderer.on("parent.action", (event, data) => {
  data.origin = window.origin;
  window.postMessage(data, window.origin);
});

contextBridge.exposeInMainWorld("electron", {
  sendToHost: (data) => ipcRenderer.sendToHost("app.action", data),
});
