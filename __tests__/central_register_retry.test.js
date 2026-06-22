/**
 * Regression test for the "orange / not registered" bug.
 *
 * When the central rejects an application (`central.register.error`), the
 * launcher is supposed to re-arm a registration retry ~10s later via
 * `tryToRegister`. A typo (`central.timeoutRegister` instead of
 * `centralState.timeoutRegister`) made the handler throw a ReferenceError,
 * so the retry was NEVER scheduled and the device stayed orange until a
 * full WyndPosTools restart.
 *
 * This test reproduces that: after a register.error, advancing the clock by
 * 10s must trigger a fresh `central.register` emission.
 */

// on_socket pulls electron-ecosystem deps transitively — mock them.
jest.mock('../src/main/helpers/auto_updater', () => ({ logger: null }));
jest.mock('../src/main/helpers/update_download_install', () => jest.fn());
jest.mock('../src/main/helpers/reinitialize', () => jest.fn());
jest.mock('../src/main/helpers/electron_log', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), success: jest.fn() }));
jest.mock('../src/main/helpers/request_wpt', () => jest.fn());
jest.mock('../src/main/helpers/reload_wpt', () => jest.fn());
jest.mock('../src/main/helpers/request_container', () => jest.fn());
jest.mock('../src/main/helpers/config/get_config', () => jest.fn());
jest.mock('../src/main/helpers/config/set_config', () => jest.fn());
jest.mock('../src/main/helpers/config/check_config', () => jest.fn());

const EventEmitter = require('events');
const onSocket = require('../src/main/helpers/on_socket');

function makeStore(socket) {
  return {
    infos: { name: 'caisse-01', version: '2.6.15', stack: 'pos', app_versions: {} },
    conf: { display_plugin_state: { enable: false }, http: { enable: false } },
    logs: { main: '/tmp/main.log', app: '/tmp/app.log' },
    path: { conf: '/tmp/config.ini' },
    central: {
      status: 'READY',
      ready: true,
      registered: false,
      registering: false,
      pending_messages: [],
      timeoutRegister: null,
    },
    wpt: { plugins_state: {}, socket },
  };
}

test('central.register.error re-arms a registration retry ~10s later (no ReferenceError)', () => {
  jest.useFakeTimers();

  const socket = new EventEmitter();
  const store = makeStore(socket);

  onSocket(store, socket, null);

  // grab the handler the central plugin would invoke on rejection
  const errHandler = socket.listeners('central.register.error')[0];
  expect(typeof errHandler).toBe('function');

  // capture OUTGOING emits (replace after listeners are wired so we don't
  // re-trigger on() handlers through the shared EventEmitter channel)
  const outgoing = [];
  socket.emit = jest.fn((event, ...args) => { outgoing.push([event, ...args]); return true; });

  // 1) the handler itself must not throw (the typo made it throw)
  expect(() => errHandler({ message: 'over capacity' })).not.toThrow();

  // 2) before the delay, no re-registration yet
  expect(outgoing.some(([e]) => e === 'central.register')).toBe(false);

  // 3) after ~10s, a fresh register attempt must be emitted
  jest.advanceTimersByTime(10 * 1000);
  const reRegister = outgoing.find(([e]) => e === 'central.register');
  expect(reRegister).toBeDefined();
  expect(reRegister[1]).toMatchObject({ name: 'caisse-01', version: '2.6.15' });
  expect(store.central.registering).toBe(true);

  jest.useRealTimers();
});
