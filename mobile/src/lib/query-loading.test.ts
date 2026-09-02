import { describe, expect, test } from "bun:test";

import { initialQueryBoundaryPending } from "./query-loading";

describe("combined initial query boundary", () => {
  test("stays pending until asymmetric cold reads have both settled", () => {
    const pending = { hasData: false, isError: false, isPending: true };
    const settled = { hasData: true, isError: false, isPending: false };

    expect(initialQueryBoundaryPending([pending, pending])).toBe(true);
    expect(initialQueryBoundaryPending([settled, pending])).toBe(true);
    expect(initialQueryBoundaryPending([pending, settled])).toBe(true);
    expect(initialQueryBoundaryPending([settled, settled])).toBe(false);
  });

  test("treats a cold error as settled while preserving another pending read", () => {
    const failed = { hasData: false, isError: true, isPending: false };
    const pending = { hasData: false, isError: false, isPending: true };

    expect(initialQueryBoundaryPending([failed])).toBe(false);
    expect(initialQueryBoundaryPending([failed, pending])).toBe(true);
  });
});
