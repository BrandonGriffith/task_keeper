export async function runCleanupSteps(steps, onError) {
  let succeeded = true;

  for (const { name, run } of steps) {
    try {
      await run();
    } catch (error) {
      succeeded = false;
      onError(name, error);
    }
  }

  return succeeded;
}
