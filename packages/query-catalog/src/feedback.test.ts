import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { feedbackConfigQueryOptions, feedbackQueryKeys } from "./index";

describe("feedback query catalogue", () => {
  it("deduplicates the stable global configuration read", async () => {
    const configuration = { enabled: true } as never;
    const getFeedbackConfig = vi.fn(async () => configuration);
    const client = new QueryClient();
    const options = feedbackConfigQueryOptions({ getFeedbackConfig });

    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);

    expect(feedbackQueryKeys.configuration()).toEqual([
      "openpost",
      "v1",
      "feedback",
      "configuration",
    ]);
    expect(getFeedbackConfig).toHaveBeenCalledTimes(1);
    expect(getFeedbackConfig).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
});
