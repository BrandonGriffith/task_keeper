import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationServerKeyFromBase64Url } from '../src/push.js';

test('VAPID public keys decode from unpadded base64url', () => {
  assert.deepEqual(
    applicationServerKeyFromBase64Url('AQIDBA'),
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.deepEqual(
    applicationServerKeyFromBase64Url('-_8'),
    new Uint8Array([0xfb, 0xff]),
  );
});
