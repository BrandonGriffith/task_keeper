const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function hasTrustedMutationOrigin(method, origin, requestHost) {
  if (safeMethods.has(method)) return true;
  if (typeof origin !== 'string') return false;

  try {
    const parsedOrigin = new URL(origin);
    const expectedHost = new URL(`http://${requestHost}`).host;
    return ['http:', 'https:'].includes(parsedOrigin.protocol)
      && parsedOrigin.origin === origin
      && parsedOrigin.host === expectedHost;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}
