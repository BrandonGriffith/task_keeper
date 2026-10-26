export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw new Error('Could not connect to Taskeeper. Check your connection and try again.');
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status >= 500
      ? 'Something went wrong. Please try again.'
      : data.error || 'The request could not be completed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function base64UrlToBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
