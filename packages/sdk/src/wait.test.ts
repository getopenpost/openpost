import { describe, expect, it } from "vitest";
import { OpenPostError } from "./errors";
import { resolveWaitOptions } from "./wait";

describe("resolveWaitOptions", () => {
  it("applies defaults", () => {
    expect(resolveWaitOptions()).toEqual({ timeoutMs: 120_000, intervalMs: 3_000 });
  });

  it("rejects non-finite and out-of-range bounds before polling", () => {
    for (const options of [
      { timeoutMs: Number.NaN },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { timeoutMs: -1 },
      { intervalMs: 0 },
      { intervalMs: -5 },
      { intervalMs: Number.NaN },
    ]) {
      const error = (() => {
        try {
          resolveWaitOptions(options);
        } catch (error: unknown) {
          return error;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(OpenPostError);
      expect((error as OpenPostError).code).toBe("validation");
    }
  });
});
