// Zero-dependency tests for the pure OBD-II decoding helpers (SAE J1979).
// The app is plain browser scripts with no module system, so js/*.js are loaded
// into a vm context with a permissive DOM stub. No app code is modified.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const stub = () => new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : stub()),
  set: () => true,
  apply: () => stub(),
  construct: () => stub(),
});

const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Promise,
  document: stub(), navigator: { userAgent: '' }, location: { hash: '' }, indexedDB: {}, Notification: {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['config', 'engine', 'core']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
// JSON round-trip avoids cross-realm Array identity issues in deepEqual.
const run = (expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', ctx) ?? 'null');

test('mode 01 PID decoding', () => {
  assert.equal(run('fmtPid(0x0C, [0x1A, 0xF8])'), 1726);   // RPM = (A*256+B)/4
  assert.equal(run('fmtPid(0x0D, [0x3C])'), 60);           // speed km/h
  assert.equal(run('fmtPid(0x05, [0x7B])'), 83);           // coolant = A-40
  assert.equal(run('fmtPid(0x06, [0x80])'), '0.0');        // fuel trim neutral
  assert.equal(run('fmtPid(0x10, [0x01, 0x90])'), '4.00'); // MAF g/s
  assert.equal(run('fmtPid(0x42, [0x33, 0x90])'), '13.20'); // ECU voltage
  assert.equal(run('fmtPid(0x04, [0xFF])'), 100);          // engine load %
});

test('PID decoding rejects short or missing data', () => {
  assert.equal(run('fmtPid(0x0C, [0x1A])'), null);
  assert.equal(run('fmtPid(0x0C, null)'), null);
  assert.equal(run('fmtPid(0xFE, [0x00])'), null);
});

test('DTC decoding', () => {
  assert.equal(run('decodeDTC(0x01, 0x33)'), 'P0133');
  assert.equal(run('decodeDTC(0x41, 0x23)'), 'C0123');
  assert.equal(run('decodeDTC(0xC1, 0x00)'), 'U0100');
  assert.equal(run('decodeDTC(0x00, 0x00)'), null);        // padding, not a code
});

test('response line parsing', () => {
  assert.deepEqual(run("bytesOf('410C1AF8')"), [0x41, 0x0c, 0x1a, 0xf8]);
  assert.deepEqual(run("hexLines(['SEARCHING...', '41 0C 1A F8'])"), ['410C1AF8']);
});
