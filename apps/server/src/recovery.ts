const IDLE_RECHECK_MS = 60 * 60_000;
const RETRY_MS = 15_000;
const listeners = new Set<() => void>();

/** Signal only after a request or game mutation has committed durable work. */
export function wakeRecovery() {
  for (const wake of listeners) wake();
}

export function startRecovery(options: {
  run: () => Promise<void>;
  hasPending: () => Promise<boolean>;
  onError: (error: unknown) => void;
}) {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledAt = Infinity;
  let lastStartedAt = -Infinity;
  let wakeRequested = false;

  function schedule(at: number) {
    if (stopped || at >= scheduledAt) return;
    clearTimeout(timer);
    scheduledAt = at;
    timer = setTimeout(recover, Math.max(0, at - Date.now()));
    timer.unref();
  }
  function wake() {
    if (stopped) return;
    if (inFlight) wakeRequested = true;
    else schedule(Math.max(Date.now(), lastStartedAt + RETRY_MS));
  }
  function recover() {
    scheduledAt = Infinity;
    if (stopped || inFlight) return;
    lastStartedAt = Date.now();
    inFlight = (async () => {
      let nextAt = Date.now() + RETRY_MS;
      try {
        await options.run();
        if (!(await options.hasPending()))
          nextAt = (Math.floor(Date.now() / IDLE_RECHECK_MS) + 1) * IDLE_RECHECK_MS;
      } catch (error) {
        options.onError(error);
      } finally {
        inFlight = undefined;
        if (wakeRequested) nextAt = Date.now();
        wakeRequested = false;
        schedule(Math.max(nextAt, lastStartedAt + RETRY_MS));
      }
    })();
  }
  listeners.add(wake);
  schedule(Date.now());
  return async () => {
    stopped = true;
    listeners.delete(wake);
    clearTimeout(timer);
    await inFlight;
  };
}
