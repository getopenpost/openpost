export function runWithCallerAbort<Result>(
  signal: AbortSignal | undefined,
  run: () => Promise<Result>,
): Promise<Result> {
  if (!signal) return run();
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      complete();
    };
    const abort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener("abort", abort, { once: true });

    try {
      run().then(
        (result) => finish(() => resolve(result)),
        (cause: unknown) => finish(() => reject(cause)),
      );
    } catch (cause) {
      finish(() => reject(cause));
    }
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
