import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import type { Job, OpenPostQueryAPI, Publication, QueryPageResult } from "./api";
import { openPostQueryKeys } from "./keys";
import {
  activityPublicationsInfiniteQueryOptions,
  failedJobsInfiniteQueryOptions,
} from "./options";

function activityPage(ids: string[], nextCursor = ""): QueryPageResult<Publication> {
  return {
    items: ids.map((id) => ({ id, workspace_id: "workspace-1" }) as Publication),
    total: ids.length,
    nextCursor,
  };
}

function jobsPage(ids: string[], nextCursor = ""): QueryPageResult<Job> {
  return {
    items: ids.map((id) => ({ id }) as Job),
    total: ids.length,
    nextCursor,
  };
}

describe("infinite publication options", () => {
  it("shares the first-page key and threads the cursor through pages", async () => {
    const listActivityPublications = vi.fn(
      async (_workspaceId: string, _bucket: string, page: { limit: number; cursor: string }) =>
        activityPage([`post-${page.cursor || "first"}`], page.cursor ? "" : "cursor-2"),
    );
    const api = { listActivityPublications } as Pick<OpenPostQueryAPI, "listActivityPublications">;
    const options = activityPublicationsInfiniteQueryOptions(api, "workspace-1", "scheduled", {
      limit: 40,
    });

    expect(options.queryKey).toEqual(
      openPostQueryKeys.publications.activity("workspace-1", "scheduled", {
        limit: 40,
        cursor: "",
      }),
    );
    expect(options.initialPageParam).toBe("");

    const client = new QueryClient();
    const signal = new AbortController().signal;
    const first = await options.queryFn({ client, pageParam: "", signal } as never);
    expect(listActivityPublications).toHaveBeenCalledWith(
      "workspace-1",
      "scheduled",
      { limit: 40, cursor: "" },
      signal,
    );
    expect(options.getNextPageParam?.(first)).toBe("cursor-2");

    const second = await options.queryFn({ client, pageParam: "cursor-2", signal } as never);
    expect(listActivityPublications).toHaveBeenCalledWith(
      "workspace-1",
      "scheduled",
      { limit: 40, cursor: "cursor-2" },
      signal,
    );
    expect(options.getNextPageParam?.(second)).toBeUndefined();
  });

  it("pages failed jobs with the same key shape as the first page", async () => {
    const listFailedJobs = vi.fn(
      async (_workspaceId: string, page: { limit: number; cursor: string }) =>
        jobsPage([`job-${page.cursor || "first"}`], page.cursor ? "" : "cursor-2"),
    );
    const api = { listFailedJobs } as Pick<OpenPostQueryAPI, "listFailedJobs">;
    const options = failedJobsInfiniteQueryOptions(api, "workspace-1", { limit: 50 });

    expect(options.queryKey).toEqual(
      openPostQueryKeys.jobs.failedPage("workspace-1", { limit: 50, cursor: "" }),
    );
    expect(options.initialPageParam).toBe("");

    const client = new QueryClient();
    const signal = new AbortController().signal;
    const first = await options.queryFn({ client, pageParam: "", signal } as never);
    expect(options.getNextPageParam?.(first)).toBe("cursor-2");
    const second = await options.queryFn({ client, pageParam: "cursor-2", signal } as never);
    expect(listFailedJobs).toHaveBeenLastCalledWith(
      "workspace-1",
      { limit: 50, cursor: "cursor-2" },
      signal,
    );
    expect(options.getNextPageParam?.(second)).toBeUndefined();
  });
});
