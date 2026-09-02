import { expect, test } from "bun:test";

import { withAlpha } from "./freeze";

test("applies opacity to both built-in and adapted native colors", () => {
  expect(withAlpha("#123456", 0.15)).toBe("rgba(18, 52, 86, 0.15)");
  expect(withAlpha("#123456ff", 0.15)).toBe("rgba(18, 52, 86, 0.15)");
});
