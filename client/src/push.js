export function applicationServerKeyFromBase64Url(value) {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const base64 = padded.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
