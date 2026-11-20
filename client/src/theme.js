export function readThemePreference(getStorage = () => window.localStorage) {
  try {
    return getStorage().getItem('theme');
  } catch (error) {
    console.error('Could not read saved theme preference.', error);
    return null;
  }
}

export function saveThemePreference(theme, getStorage = () => window.localStorage) {
  try {
    getStorage().setItem('theme', theme);
  } catch (error) {
    console.error('Could not save theme preference.', error);
  }
}
