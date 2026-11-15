const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizedHost(host) {
  if (typeof host !== 'string') return null;
  try {
    const parsedHost = new URL(`http://${host}`);
    if (parsedHost.username || parsedHost.password || parsedHost.pathname !== '/'
      || parsedHost.search || parsedHost.hash) {
      return null;
    }
    return parsedHost.host;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function hasTrustedMutationOrigin(method, origin, requestHost, forwardedHost) {
  if (safeMethods.has(method)) return true;
  if (typeof origin !== 'string') return false;

  try {
    const parsedOrigin = new URL(origin);
    return ['http:', 'https:'].includes(parsedOrigin.protocol)
      && parsedOrigin.origin === origin
      && [requestHost, forwardedHost?.split(',')[0].trim()]
        .some((host) => normalizedHost(host) === parsedOrigin.host);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}
