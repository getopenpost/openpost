import { describe, expect, it } from "vitest";
import { errorMessageFromBody, inferCode, OpenPostError } from "./errors";

describe("OpenPostError", () => {
  it("prefers the server detail sentence over the title", () => {
    expect(
      errorMessageFromBody({ title: "Bad Request", detail: "Source text is empty" }, "fallback"),
    ).toBe("Source text is empty");
  });

  it("accepts the legacy error and message shapes", () => {
    expect(errorMessageFromBody({ error: "boom" }, "fallback")).toBe("boom");
    expect(errorMessageFromBody({ message: "kaput" }, "fallback")).toBe("kaput");
    expect(errorMessageFromBody("raw text", "fallback")).toBe("raw text");
    expect(errorMessageFromBody(null, "fallback")).toBe("fallback");
  });

  it("infers conflict for revision races and validation for bad input", () => {
    expect(inferCode(409, {})).toBe("conflict");
    expect(inferCode(400, {})).toBe("validation");
    expect(inferCode(422, {})).toBe("validation");
    expect(inferCode(429, {})).toBe("rate_limited");
  });

  it("marks only retryable failures as retryable", () => {
    expect(new OpenPostError("slow", { code: "timeout" }).retryable).toBe(true);
    expect(new OpenPostError("gone", { code: "not_found" }).retryable).toBe(false);
    expect(new OpenPostError("stale", { code: "conflict" }).retryable).toBe(false);
  });
});
