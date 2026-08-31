import { describe, expect, it } from "bun:test";

import { drawerBottomPadding } from "./bottom-drawer-layout";

describe("bottom drawer keyboard avoidance", () => {
  it("reserves keyboard space below drawer content", () => {
    expect(drawerBottomPadding(36, 0)).toBe(36);
    expect(drawerBottomPadding(36, -312)).toBe(348);
  });
});
