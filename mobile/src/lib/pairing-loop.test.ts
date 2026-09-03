import { describe, expect, mock, test } from "bun:test";

import { waitForPairingResult } from "./pairing-loop";

describe("pairing poll loop", () => {
  test("stops immediately when the sign-in identity changes", async () => {
    const abort = new DOMException("The sign-in session changed", "AbortError");
    const poll = mock(async () => {
      throw abort;
    });
    const pause = mock(async () => {
      throw new Error("obsolete pairing was retried");
    });

    await expect(
      waitForPairingResult({
        deviceCode: "obsolete-code",
        isCancelled: () => false,
        poll,
        pause,
      }),
    ).rejects.toBe(abort);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  test("retries transient failures and pending responses", async () => {
    let attempt = 0;
    const poll = mock(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network unavailable");
      if (attempt === 2) return { status: "pending" as const, intervalMs: 1200 };
      return { status: "approved" as const };
    });
    const pause = mock(async () => undefined);

    await expect(
      waitForPairingResult({
        deviceCode: "current-code",
        isCancelled: () => false,
        poll,
        pause,
      }),
    ).resolves.toEqual({ status: "approved" });
    expect(poll).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenNthCalledWith(1, 3000);
    expect(pause).toHaveBeenNthCalledWith(2, 1200);
  });
});
