import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  mediaQueryKeys,
  normalizeMediaListFilters,
  normalizePublicationHistoryPage,
  normalizePublicationFilters,
  normalizePublishingOptionsInput,
  openPostQueryDefaults,
  openPostQueryKeys,
  promptQueryKeys,
  promptsQueryOptions,
  schedulingPublicationsQueryOptions,
  schedulingQueryKeys,
  stockSearchQueryOptions,
  type MediaQueryAPI,
  type Prompt,
  type PromptQueryAPI,
  type SchedulingPublication,
  type SchedulingQueryAPI,
} from "./index";

describe("content and scheduling query catalog", () => {
  it("normalizes every result-changing filter into a stable Workspace key", () => {
    const mediaFilters = normalizeMediaListFilters({
      lifecycle: "trash",
      search: "  launch  ",
      tagIds: ["tag-b", "tag-a"],
      minWidth: 1080,
      limit: 40,
      offset: 80,
    });
    expect(mediaQueryKeys.list("workspace-1", mediaFilters)).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "media",
      "list",
      expect.objectContaining({
        lifecycle: "trash",
        search: "launch",
        tagIds: ["tag-a", "tag-b"],
        minWidth: 1080,
        limit: 40,
        offset: 80,
      }),
    ]);
    expect(
      schedulingQueryKeys.publications(
        "workspace-2",
        normalizePublicationFilters({
          status: "draft",
          calendarFrom: "2026-09-01T00:00:00Z",
          calendarBefore: "2026-10-01T00:00:00Z",
        }),
      ),
    ).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-2",
      "publications",
      "list",
      "scheduling",
      expect.objectContaining({
        status: "draft",
        calendarFrom: "2026-09-01T00:00:00Z",
        calendarBefore: "2026-10-01T00:00:00Z",
      }),
    ]);
    expect(promptQueryKeys.list("workspace-1", " launches ")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "prompts",
      "list",
      { category: "launches" },
    ]);
    expect(
      schedulingQueryKeys.publications("workspace-2", { status: "draft", allPages: true }),
    ).not.toEqual(
      schedulingQueryKeys.publications("workspace-2", { status: "draft", allPages: false }),
    );
    expect(normalizePublicationHistoryPage({ limit: 30, cursor: " opaque cursor " }).cursor).toBe(
      " opaque cursor ",
    );
    expect(
      normalizePublishingOptionsInput({
        accountId: "account-1",
        source: "boards",
        region: "US",
        locale: "en-US",
        limit: 25,
        cursor: " opaque cursor ",
        context: "{}",
      }).cursor,
    ).toBe(" opaque cursor ");
  });

  it("deduplicates equal scheduling reads, forwards cancellation, and seeds publication detail", async () => {
    const publication = {
      id: "publication-1",
      workspace_id: "workspace-1",
    } as SchedulingPublication;
    const listPublications = vi.fn(
      async (_workspaceId: string, _filters: unknown, signal: AbortSignal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return [publication];
      },
    );
    const api = { listPublications } as Pick<SchedulingQueryAPI, "listPublications">;
    const client = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const options = schedulingPublicationsQueryOptions(api, "workspace-1", {
      calendarFrom: "2026-09-01T00:00:00Z",
      calendarBefore: "2026-10-01T00:00:00Z",
    });

    const [first, second] = await Promise.all([client.query(options), client.query(options)]);

    expect(first).toEqual([publication]);
    expect(second).toEqual([publication]);
    expect(listPublications).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryData(openPostQueryKeys.publications.detail("workspace-1", publication.id)),
    ).toBe(publication);
  });

  it("keeps prompt and stock searches independently keyed without credentials", async () => {
    const promptAPI: Pick<PromptQueryAPI, "listPrompts"> = {
      listPrompts: vi.fn(async () => [] as Prompt[]),
    };
    const stockAPI: Pick<MediaQueryAPI, "searchStockMedia"> = {
      searchStockMedia: vi.fn(async () => ({
        has_more: false,
        items: [],
        page: 1,
        per_page: 24,
        provider: "pexels",
        provider_url: "https://www.pexels.com",
        total: 0,
      })),
    };
    const promptOptions = promptsQueryOptions(promptAPI, "workspace-1", "launches");
    const stockOptions = stockSearchQueryOptions(stockAPI, {
      provider: "pexels",
      query: " launch day ",
      kind: "photo",
      page: 2,
    });

    expect(promptOptions.queryKey).toContain("workspace-1");
    expect(stockOptions.queryKey).toEqual([
      "openpost",
      "v1",
      "stock-media",
      "search",
      expect.objectContaining({ provider: "pexels", query: "launch day", page: 2 }),
    ]);
    expect(JSON.stringify(stockOptions.queryKey)).not.toContain("token");
  });
});
