import assert from 'node:assert/strict';
import test from 'node:test';
import { readThemePreference, saveThemePreference } from '../src/theme.js';

test('theme preference reads and writes through browser storage', () => {
  let savedTheme = 'light';
  const getStorage = () => ({
    getItem: () => savedTheme,
    setItem: (_key, value) => { savedTheme = value; },
  });

  assert.equal(readThemePreference(getStorage), 'light');
  saveThemePreference('dark', getStorage);
  assert.equal(savedTheme, 'dark');
});

test('unavailable browser storage falls back without breaking the theme', () => {
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  const getStorage = () => {
    throw new Error('Storage access denied');
  };

  try {
    assert.equal(readThemePreference(getStorage), null);
    assert.doesNotThrow(() => saveThemePreference('dark', getStorage));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(errors.length, 2);
  assert.match(errors[0][0], /read saved theme preference/);
  assert.match(errors[1][0], /save theme preference/);
});
