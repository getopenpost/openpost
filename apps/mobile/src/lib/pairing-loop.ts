import type { PairPoll } from "./auth";

const TRANSIENT_RETRY_DELAY_MS = 3000;

type PairingLoopOptions = {
  deviceCode: string;
  isCancelled: () => boolean;
  poll: (deviceCode: string) => Promise<PairPoll>;
  pause?: (milliseconds: number) => Promise<void>;
};

export async function waitForPairingResult({
  deviceCode,
  isCancelled,
  poll,
  pause = sleep,
}: PairingLoopOptions): Promise<Exclude<PairPoll, { status: "pending" }> | null> {
  while (!isCancelled()) {
    let result: PairPoll;
    try {
      result = await poll(deviceCode);
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      await pause(TRANSIENT_RETRY_DELAY_MS);
      continue;
    }
    if (isCancelled()) return null;
    if (result.status !== "pending") return result;
    await pause(result.intervalMs);
  }
  return null;
}

export function isAbortError(cause: unknown): cause is Error {
  return cause instanceof Error && cause.name === "AbortError";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
