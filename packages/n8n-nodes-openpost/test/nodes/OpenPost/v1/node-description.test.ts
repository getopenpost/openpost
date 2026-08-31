import { describe, expect, test } from "bun:test";

import { OpenPostV1 } from "../../../../nodes/OpenPost/v1/OpenPostV1.node";

describe("OpenPostV1 description", () => {
  test("keeps write-capable operations out of AI tool execution", () => {
    expect(new OpenPostV1().description).toHaveProperty("usableAsTool", undefined);
  });
});
