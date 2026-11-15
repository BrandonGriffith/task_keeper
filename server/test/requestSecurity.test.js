import assert from 'node:assert/strict';
import test from 'node:test';
import { hasTrustedMutationOrigin } from '../src/requestSecurity.js';

test('safe methods do not require an Origin header', () => {
  assert.equal(hasTrustedMutationOrigin('GET', undefined, 'taskkeeper.example'), true);
  assert.equal(hasTrustedMutationOrigin('OPTIONS', undefined, 'taskkeeper.example'), true);
});

test('mutations accept the same origin including its host and port', () => {
  assert.equal(
    hasTrustedMutationOrigin('POST', 'https://taskkeeper.example', 'taskkeeper.example'),
    true,
  );
  assert.equal(
    hasTrustedMutationOrigin('PATCH', 'http://localhost:5173', 'localhost:5173'),
    true,
  );
});

test('mutations accept a forwarded frontend host when the upstream host differs', () => {
  assert.equal(
    hasTrustedMutationOrigin(
      'POST',
      'http://127.0.0.1:5173',
      'localhost:3001',
      '127.0.0.1:5173',
    ),
    true,
  );
  assert.equal(
    hasTrustedMutationOrigin(
      'POST',
      'https://taskkeeper.example',
      'api.internal:3001',
      'taskkeeper.example, proxy.internal',
    ),
    true,
  );
  assert.equal(
    hasTrustedMutationOrigin(
      'POST',
      'https://attacker.example',
      'api.internal:3001',
      'taskkeeper.example',
    ),
    false,
  );
});

test('mutations reject missing, malformed, or different-host origins', () => {
  for (const origin of [
    undefined,
    'null',
    'https://attacker.example',
    'https://taskkeeper.example.attacker.example',
    'https://taskkeeper.example/path',
    'https://taskkeeper.example:8443',
  ]) {
    assert.equal(
      hasTrustedMutationOrigin('POST', origin, 'taskkeeper.example'),
      false,
      `Origin ${String(origin)} should not be trusted`,
    );
  }
});
