import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLoopbackHost } from '../src/backend/localRequestGuard.js';

test('server bind guard accepts loopback hosts only', () => {
  assert.equal(assertLoopbackHost('127.0.0.1'), '127.0.0.1');
  assert.equal(assertLoopbackHost('localhost'), 'localhost');
  assert.equal(assertLoopbackHost('::1'), '::1');
  assert.throws(
    () => assertLoopbackHost('0.0.0.0'),
    (error) => error.code === 'NON_LOOPBACK_BIND_BLOCKED'
  );
  assert.throws(
    () => assertLoopbackHost('192.168.0.10'),
    (error) => error.code === 'NON_LOOPBACK_BIND_BLOCKED'
  );
});
