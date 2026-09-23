import { OpenPostError } from "./errors.js";

export interface OffsetPageOptions {
  limit?: number;
  maxPages?: number;
  maxItems?: number;
}

// iterateOffsetPages walks an offset-paged list with bounded effort. The
// walk stops at the first empty or short page and fails fast when the
// caller-supplied bounds are exceeded, so a growing collection can never
// turn automation into an unbounded loop.
export async function* iterateOffsetPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  options: OffsetPageOptions = {},
): AsyncGenerator<T, void, void> {
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 100;
  const maxItems = options.maxItems ?? 10_000;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new OpenPostError(`Invalid page limit: ${String(options.limit)}`, {
      code: "validation",
    });
  }
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    throw new OpenPostError(`Invalid maxPages: ${String(options.maxPages)}`, {
      code: "validation",
    });
  }
  if (!Number.isFinite(maxItems) || maxItems <= 0) {
    throw new OpenPostError(`Invalid maxItems: ${String(options.maxItems)}`, {
      code: "validation",
    });
  }
  let yielded = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const items = await fetchPage(page * limit, limit);
    if (items.length === 0) return;
    for (const item of items) {
      if (yielded >= maxItems) {
        throw new OpenPostError(
          `Stopped after ${maxItems} items: narrow the query or raise maxItems`,
          { code: "validation" },
        );
      }
      yielded += 1;
      yield item;
    }
    if (items.length < limit) return;
  }
  throw new OpenPostError(`Stopped after ${maxPages} pages: narrow the query or raise maxPages`, {
    code: "validation",
  });
}
