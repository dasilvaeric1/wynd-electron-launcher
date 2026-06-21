/* Tap Redux pour la capture de trace. Injecté dans le MAIN world de la page
   POS avant la création du store. Zéro dépendance, zéro modif du POS.
   RTK (configureStore({devTools:{name}})) appelle __REDUX_DEVTOOLS_EXTENSION_COMPOSE__. */
(function (window) {
  if (window.__elReduxInstalled) return;
  window.__elReduxInstalled = true;

  var MAX_EVENTS = 5000; // ring buffer
  var ACTION_CAP = 8000; // chars JSON max par action
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

  // diff par slice top-level (state = { sliceA, sliceB, ... })
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
            window.__elRedux.push({
              ts: Date.now(),
              store: name,
              actionType: (action && action.type) || 'action',
              action: cap(action),
              diff: diff,
            });
            if (window.__elRedux.length > MAX_EVENTS)
              window.__elRedux.splice(0, window.__elRedux.length - MAX_EVENTS);
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
      // tap OUTERMOST : il wrappe le store déjà enrichi (middlewares/sagas)
      return compose.apply(undefined, [tapEnhancer(name)].concat(enhancers));
    };
  };

  // Stub minimal pour les chemins qui testent l'existence de l'extension.
  window.__REDUX_DEVTOOLS_EXTENSION__ = window.__REDUX_DEVTOOLS_EXTENSION__ || {
    connect: function () {
      return {
        init: function () {}, send: function () {},
        subscribe: function () { return function () {}; },
        unsubscribe: function () {}, error: function () {},
      };
    },
  };
})(window);
