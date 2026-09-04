import { MutationObserver, onlineManager, QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  activityPublicationsQueryOptions,
  capabilityStaleTime,
  failedJobsQueryOptions,
  isOpenPostActivityQueryKey,
  isOpenPostDraftActivityQueryKey,
  liveQueryStaleTime,
  OpenPostQueryError,
  openPostQueryDefaults,
  openPostQueryKeys,
  openPostQueryPolicy,
  openPostWorkspaceKey,
  queryGarbageCollectionTime,
  publicationDetailQueryOptions,
  seedPublicationDetail,
  shouldRetryQuery,
  type Publication,
  type QueryPage,
  type QueryPageResult,
  queryStaleTime,
  stableQueryStaleTime,
} from "./index";

describe("OpenPost query catalogue", () => {
  it("applies the shared query policy to domain catalogues", () => {
    expect(openPostQueryPolicy(liveQueryStaleTime)).toMatchObject({
      gcTime: 1_800_000,
      networkMode: "online",
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
      staleTime: 15_000,
      throwOnError: false,
    });
  });

  it("uses live freshness only for changing Activity state", () => {
    const api = {
      listActivityPublications: vi.fn(),
      listFailedJobs: vi.fn(),
    };
    const scheduled = activityPublicationsQueryOptions(api, "workspace-1", "scheduled", {
      limit: 40,
    });
    const published = activityPublicationsQueryOptions(api, "workspace-1", "published", {
      limit: 40,
    });
    const failedJobs = failedJobsQueryOptions(api, "workspace-1", { limit: 50 });

    expect(scheduled).toMatchObject({
      staleTime: liveQueryStaleTime,
      refetchOnWindowFocus: true,
    });
    expect(failedJobs).toMatchObject({
      staleTime: liveQueryStaleTime,
      refetchOnWindowFocus: true,
    });
    expect(published).toMatchObject({
      staleTime: queryStaleTime,
      refetchOnWindowFocus: false,
    });
  });

  it("retries one transient failure and never retries client or cancelled requests", () => {
    expect(shouldRetryQuery(0, new TypeError("network unavailable"))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("busy", { status: 503 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("timeout", { status: 408 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("early", { status: 425 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("limited", { status: 429 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("server failure", { status: 599 }))).toBe(
      true,
    );
    expect(shouldRetryQuery(1, new OpenPostQueryError("busy", { status: 503 }))).toBe(false);
    expect(shouldRetryQuery(0, new OpenPostQueryError("invalid", { status: 400 }))).toBe(false);
    expect(shouldRetryQuery(0, new OpenPostQueryError("invalid status", { status: 600 }))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new Error("programmer failure"))).toBe(false);
    expect(shouldRetryQuery(0, "not an error")).toBe(false);
    expect(shouldRetryQuery(0, new DOMException("cancelled", "AbortError"))).toBe(false);
    expect(openPostQueryDefaults).toMatchObject({
      queries: {
        gcTime: 1_800_000,
        networkMode: "online",
        refetchOnMount: true,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        throwOnError: false,
      },
      mutations: {
        networkMode: "always",
        retry: false,
        throwOnError: false,
      },
    });
  });

  it("runs an offline mutation once instead of pausing it for reconnect", async () => {
    const previousOnlineState = onlineManager.isOnline();
    const mutationFn = vi.fn(async () => "saved");
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const mutation = new MutationObserver(queryClient, { mutationFn });

    onlineManager.setOnline(false);
    try {
      await expect(mutation.mutate()).resolves.toBe("saved");
      expect(mutation.getCurrentResult().isPaused).toBe(false);
      onlineManager.setOnline(true);
      await Promise.resolve();
      expect(mutationFn).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(previousOnlineState);
      queryClient.clear();
    }
  });

  it("aborts and discards an active Activity request when its Workspace and bucket change", async () => {
    let requestSignal: AbortSignal | undefined;
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    const stalePublication = {
      id: "stale-publication",
      workspace_id: "workspace-1",
    } as Publication;
    const currentPublication = {
      id: "current-publication",
      workspace_id: "workspace-2",
    } as Publication;
    const listActivityPublications = vi.fn(
      (workspaceId: string, _bucket: string, _page: QueryPage, signal: AbortSignal) => {
        if (workspaceId === "workspace-2") {
          return Promise.resolve({ items: [currentPublication], total: 1, nextCursor: "" });
        }
        return new Promise<QueryPageResult<Publication>>((resolve) => {
          requestSignal = signal;
          signal.addEventListener(
            "abort",
            () => {
              resolveAbort();
              resolve({ items: [stalePublication], total: 1, nextCursor: "" });
            },
            { once: true },
          );
        });
      },
    );
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const firstOptions = activityPublicationsQueryOptions(
      { listActivityPublications },
      "workspace-1",
      "scheduled",
      { limit: 40 },
    );
    const observer = new QueryObserver(queryClient, firstOptions);
    const appliedPublicationIds: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      for (const publication of result.data?.items ?? []) {
        appliedPublicationIds.push(publication.id);
      }
    });

    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    observer.setOptions(
      activityPublicationsQueryOptions({ listActivityPublications }, "workspace-2", "published", {
        limit: 40,
      }),
    );
    await aborted;
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.items).toEqual([currentPublication]),
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(appliedPublicationIds).not.toContain("stale-publication");
    expect(
      queryClient.getQueryData(
        openPostQueryKeys.publications.detail("workspace-1", "stale-publication"),
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(
        openPostQueryKeys.publications.detail("workspace-2", "current-publication"),
      ),
    ).toBe(currentPublication);
    expect(listActivityPublications).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("seeds detail queries from full Activity publications", async () => {
    const publication = {
      id: "publication-1",
      workspace_id: "workspace-1",
    } as Publication;
    const listActivityPublications = vi.fn(async () => ({
      items: [publication],
      total: 1,
      nextCursor: "",
    }));
    const getPublication = vi.fn(async () => publication);
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });

    await queryClient.query(
      activityPublicationsQueryOptions({ listActivityPublications }, "workspace-1", "published", {
        limit: 40,
      }),
    );
    const detail = await queryClient.query(
      publicationDetailQueryOptions({ getPublication }, "workspace-1", "publication-1"),
    );

    expect(detail).toBe(publication);
    expect(getPublication).not.toHaveBeenCalled();
  });

  it("seeds a full create response before detail navigation without another GET", async () => {
    const publication = {
      id: "publication-copy",
      workspace_id: "workspace-1",
    } as Publication;
    const getPublication = vi.fn(async () => publication);
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });

    seedPublicationDetail(queryClient, publication, "workspace-1");
    const detail = await queryClient.query(
      publicationDetailQueryOptions({ getPublication }, "workspace-1", "publication-copy"),
    );

    expect(detail).toBe(publication);
    expect(getPublication).not.toHaveBeenCalled();
  });

  it("retains cached Activity data when a background refresh fails", async () => {
    const cachedPage = {
      items: [{ id: "publication-1", workspace_id: "workspace-1" } as Publication],
      total: 1,
      nextCursor: "",
    };
    const listActivityPublications = vi
      .fn()
      .mockResolvedValueOnce(cachedPage)
      .mockRejectedValueOnce(new OpenPostQueryError("refresh failed", { status: 400 }));
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const options = activityPublicationsQueryOptions(
      { listActivityPublications },
      "workspace-1",
      "scheduled",
      { limit: 40 },
    );

    await queryClient.query(options);
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    const result = observer.getCurrentResult();
    unsubscribe();

    expect(result.isError).toBe(true);
    expect(result.data).toBe(cachedPage);
    expect(result.error).toEqual(
      expect.objectContaining({ message: "refresh failed", status: 400 }),
    );
  });
});
