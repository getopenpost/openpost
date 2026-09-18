import { OpenPostError } from "./errors.js";
import type { WaitOptions } from "./types.js";

export interface ResolvedWait {
  timeoutMs: number;
  intervalMs: number;
}

// resolveWaitOptions validates polling bounds before the first request.
// Non-finite values would disable the deadline or spin a zero-delay loop,
// so they fail fast with a validation error instead.
export function resolveWaitOptions(options: WaitOptions = {}): ResolvedWait {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new OpenPostError(`Invalid wait timeoutMs: ${String(options.timeoutMs)}`, {
      code: "validation",
    });
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new OpenPostError(`Invalid wait intervalMs: ${String(options.intervalMs)}`, {
      code: "validation",
    });
  }
  return { timeoutMs, intervalMs };
}
