const fs = require('fs');
const path = require('path');
const { createStore, applyMiddleware, combineReducers } = require('redux');

// Charge le shim dans un faux "window" (main world simulé)
function loadShim() {
  const win = {};
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'redux', 'redux_tap.js'),
    'utf8'
  );
  // le shim s'attache à `window` ; on exécute avec window = notre objet
  new Function('window', src)(win);
  return win;
}

test('le shim capture actions + diff par slice via composeWithDevTools', () => {
  const win = loadShim();
  const reducer = combineReducers({
    cart: (s = { items: 0 }, a) => (a.type === 'ADD' ? { items: s.items + 1 } : s),
    user: (s = { name: 'x' }, a) => s,
  });
  const composeEnhancers = win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'pos' });
  const store = createStore(reducer, composeEnhancers(applyMiddleware()));

  // baseline présente
  expect(win.__elReduxState.pos).toEqual({ cart: { items: 0 }, user: { name: 'x' } });

  store.dispatch({ type: 'ADD' });

  const evts = win.__elRedux.filter((e) => e.store === 'pos' && e.actionType === 'ADD');
  expect(evts.length).toBe(1);
  // diff ne contient que la slice changée
  expect(evts[0].diff).toEqual({ cart: { items: 1 } });
  expect(evts[0].diff.user).toBeUndefined();
  // state courant à jour
  expect(win.__elReduxState.pos.cart.items).toBe(1);
});

test('ring buffer borné', () => {
  const win = loadShim();
  const reducer = (s = 0, a) => (a.type === 'I' ? s + 1 : s);
  const compose = win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 's' });
  const store = createStore(reducer, compose(applyMiddleware()));
  for (let i = 0; i < 6000; i++) store.dispatch({ type: 'I' });
  expect(win.__elRedux.length).toBeLessThanOrEqual(5000);
});
