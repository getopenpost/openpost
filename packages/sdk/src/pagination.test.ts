import { describe, expect, it } from "vitest";
import { OpenPostError } from "./errors";
import { iterateOffsetPages } from "./pagination";

describe("iterateOffsetPages", () => {
  it("collects every item across pages", async () => {
    const seen: number[] = [];
    for await (const item of iterateOffsetPages(
      async (offset, limit) => [1, 2, 3, 4, 5].slice(offset, offset + limit),
      { limit: 2 },
    )) {
      seen.push(item);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at the first empty page", async () => {
    let calls = 0;
    const seen: number[] = [];
    for await (const item of iterateOffsetPages(async () => {
      calls += 1;
      return [];
    }, {})) {
      seen.push(item);
    }
    expect(seen).toEqual([]);
    expect(calls).toBe(1);
  });

  it("fails fast when maxItems is exceeded", async () => {
    const error = await (async () => {
      try {
        for await (const _ of iterateOffsetPages(
          async (offset, limit) => [1, 2, 3, 4, 5].slice(offset, offset + limit),
          { limit: 2, maxItems: 3 },
        )) {
          // drain
        }
      } catch (error: unknown) {
        return error;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(OpenPostError);
    expect((error as OpenPostError).code).toBe("validation");
  });

  it("fails fast when maxPages is exceeded", async () => {
    const error = await (async () => {
      try {
        for await (const _ of iterateOffsetPages(async () => [1, 2], {
          limit: 2,
          maxPages: 2,
        })) {
          // drain: every page is full, so the walk never terminates alone
        }
      } catch (error: unknown) {
        return error;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(OpenPostError);
  });

  it("rejects non-finite bounds before the first request", async () => {
    let calls = 0;
    const iterator = iterateOffsetPages(
      async () => {
        calls += 1;
        return [1];
      },
      { limit: Number.NaN },
    );
    await expect(iterator.next()).rejects.toBeInstanceOf(OpenPostError);
    expect(calls).toBe(0);
  });
});
