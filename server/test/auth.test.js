import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../src/auth.js';

const testSecret = 'test-secret-with-at-least-thirty-two-characters';

async function authenticate(token) {
  const request = { cookies: token ? { task_keeper_session: token } : {} };
  let nextError;
  await requireAuth(request, {}, (error) => {
    nextError = error;
  });
  return { request, nextError };
}

async function withJwtSecret(callback) {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = testSecret;
  try {
    await callback();
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
}

test('authentication rejects requests without a session cookie', async () => {
  await withJwtSecret(async () => {
    const { nextError } = await authenticate();

    assert.equal(nextError.statusCode, 401);
    assert.equal(nextError.message, 'Sign in to continue');
  });
});

test('authentication attaches verified user claims to the request', async () => {
  await withJwtSecret(async () => {
    const token = jwt.sign(
      { sub: 'user-123', email: 'user@example.com' },
      testSecret,
    );
    const { request, nextError } = await authenticate(token);

    assert.equal(nextError, undefined);
    assert.deepEqual(request.user, {
      id: 'user-123',
      email: 'user@example.com',
    });
  });
});

test('authentication rejects malformed and expired session tokens', async () => {
  await withJwtSecret(async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-123', email: 'user@example.com' },
      testSecret,
      { expiresIn: -1 },
    );

    for (const token of ['not-a-jwt', expiredToken]) {
      const { nextError } = await authenticate(token);

      assert.equal(nextError.statusCode, 401);
      assert.equal(nextError.message, 'Your session has expired; sign in again');
    }
  });
});

test('authentication rejects tokens signed with a different secret', async () => {
  await withJwtSecret(async () => {
    const token = jwt.sign(
      { sub: 'user-123', email: 'user@example.com' },
      'a-different-secret',
    );
    const { nextError } = await authenticate(token);

    assert.equal(nextError.statusCode, 401);
    assert.equal(nextError.message, 'Your session has expired; sign in again');
  });
});
