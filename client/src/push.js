export function applicationServerKeyFromBase64Url(value) {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const base64 = padded.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function removeCurrentPushSubscription(serviceWorkerContainer, removeSubscription) {
  const registration = await serviceWorkerContainer.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;

  await removeSubscription(subscription.endpoint);
  return subscription.unsubscribe();
}
