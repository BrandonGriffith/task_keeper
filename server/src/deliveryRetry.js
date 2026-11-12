const minuteMs = 60_000;
const configurationRetryDelayMs = 5 * minuteMs;
const maximumRetryDelayMs = 60 * minuteMs;

export const maxDeliveryAttempts = 5;

export function buildDeliveryFailureUpdate({
  attempts,
  errorMessage,
  missingConfiguration,
  now = new Date(),
}) {
  const updatedAt = new Date(now);
  const retryDelayMs = missingConfiguration
    ? configurationRetryDelayMs
    : Math.min(minuteMs * (2 ** Math.max(0, attempts - 1)), maximumRetryDelayMs);

  return {
    $set: {
      status: missingConfiguration ? 'waiting_for_configuration' : 'failed',
      retryAfter: new Date(updatedAt.getTime() + retryDelayMs),
      lastError: errorMessage.slice(0, 1000),
      updatedAt,
    },
    ...(missingConfiguration ? { $inc: { attempts: -1 } } : {}),
  };
}
