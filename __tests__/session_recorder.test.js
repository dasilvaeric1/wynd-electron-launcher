jest.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}));

const rec = require('../src/main/helpers/session_recorder');
test('addNet is a no-op before start', () => {
  expect(rec.isRecording()).toBe(false);
  expect(() => rec.addNet({ url: 'x' })).not.toThrow();
});
