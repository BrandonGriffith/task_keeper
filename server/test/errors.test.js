import assert from 'node:assert/strict';
import test from 'node:test';
import { errorHandler, HttpError } from '../src/errors.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function handle(error) {
  const response = responseRecorder();
  errorHandler(error, {}, response, () => {});
  return response;
}

test('validation failures return a generic client-safe message', () => {
  const response = handle({
    name: 'ZodError',
    message: 'Sensitive field details',
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'Request validation failed' });
});

test('HTTP errors preserve their status and friendly message', () => {
  const response = handle(new HttpError(409, 'Task is no longer available'));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'Task is no longer available' });
});

test('malformed and oversized request bodies have distinct responses', () => {
  const malformed = handle({ type: 'entity.parse.failed' });
  const oversized = handle({ type: 'entity.too.large' });

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, { error: 'Request body must contain valid JSON' });
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(oversized.body, { error: 'Request body is too large' });
});

test('unexpected server errors do not expose internal messages', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = handle(new Error('database connection details'));
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: 'An unexpected server error occurred' });
  } finally {
    console.error = originalConsoleError;
  }
});
