export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Could not connect to Task Keeper. Check your connection and try again.');
  }

  if (response.status === 204) return null;
  let data;
  try {
    const body = await response.json();
    data = body && typeof body === 'object' ? body : {};
  } catch {
    if (response.ok) {
      throw new Error('The server returned an invalid response. Please try again.');
    }
    data = {};
  }
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
