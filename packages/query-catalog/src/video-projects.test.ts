import { QueryClient } from "@tanstack/query-core";
import { expect, test } from "vitest";
import {
  videoProjectListQueryOptions,
  videoProjectQueryKeys,
  type VideoProjectQueryAPI,
} from "./video-projects";

test("Video Project lists are Workspace-partitioned and coalesce equal reads", async () => {
  let requests = 0;
  const api = {
    async listVideoProjects() {
      requests += 1;
      return [];
    },
  } satisfies Pick<VideoProjectQueryAPI, "listVideoProjects">;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = videoProjectListQueryOptions(api, "workspace-1", false);

  await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);

  expect(requests).toBe(1);
  expect(options.queryKey).toEqual(videoProjectQueryKeys.list("workspace-1", false));
  expect(options.queryKey).not.toEqual(videoProjectQueryKeys.list("workspace-2", false));
  expect(options.queryKey).not.toEqual(videoProjectQueryKeys.list("workspace-1", true));
});
