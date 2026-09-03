import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  imageEditorDesignQueryOptions,
  imageEditorDesignCatalogQueryOptions,
  imageEditorDesignsQueryOptions,
  imageEditorQueryKeys,
  imageEditorRevisionQueryOptions,
  imageEditorRevisionsQueryOptions,
  normalizeImageEditorDesignFilters,
  normalizeImageEditorRevisionPage,
  type ImageEditorContractQueryData,
  type ImageEditorDesignPage,
  type ImageEditorQueryData,
} from "./image-editor";
import { openPostQueryDefaults } from "./policies";

describe("Image Editor query catalogue", () => {
  interface TestQueryData extends ImageEditorQueryData {
    design: { id: string };
    designSummary: { id: string };
    template: { id: string };
    brandKit: { id: string };
    revision: { id: string };
    revisionSummary: { id: string };
  }

  it("partitions Workspace reads and normalizes every result-changing parameter", () => {
    expect(
      imageEditorQueryKeys.designList("workspace-1", {
        search: "  launch  ",
        limit: 50,
        offset: 100,
      }),
    ).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "image-editor",
      "designs",
      "list",
      { limit: 50, offset: 100, search: "launch" },
    ]);
    expect(imageEditorQueryKeys.design("workspace-1", "design-1")).not.toEqual(
      imageEditorQueryKeys.design("workspace-2", "design-1"),
    );
    expect(imageEditorQueryKeys.templates("workspace-1")).not.toEqual(
      imageEditorQueryKeys.templates("workspace-2"),
    );
    expect(imageEditorQueryKeys.brandKit("workspace-1")).not.toEqual(
      imageEditorQueryKeys.brandKit("workspace-2"),
    );
    expect(imageEditorQueryKeys.config()).toEqual(["openpost", "v1", "image-editor", "config"]);
    expect(imageEditorQueryKeys.publicTemplates()).toEqual([
      "openpost",
      "v1",
      "image-editor",
      "public-templates",
    ]);
    expect(normalizeImageEditorDesignFilters({})).toEqual({
      search: "",
      limit: 100,
      offset: 0,
    });
    expect(normalizeImageEditorRevisionPage({})).toEqual({ cursor: "", limit: 50 });

    const catalog = imageEditorDesignCatalogQueryOptions<TestQueryData>(
      { listDesigns: vi.fn() },
      "workspace-1",
      { search: " launch ", limit: 50 },
    );
    expect(catalog.queryKey).toEqual(
      imageEditorQueryKeys.designCatalog("workspace-1", { search: "launch", limit: 50 }),
    );
    expect(catalog.queryKey.slice(0, -1)).toEqual(
      imageEditorQueryKeys.designCatalogs("workspace-1"),
    );
    expect(
      catalog.getNextPageParam({ designs: [{ id: "design-2" }], total: 3, canEdit: true }, [
        {
          designs: [{ id: "design-1" }, { id: "design-2" }],
          total: 3,
          canEdit: true,
        },
      ]),
    ).toBe(2);
  });

  it("deduplicates equal design reads and reuses the fresh result", async () => {
    const design = { id: "design-1" };
    const getDesign = vi.fn(async () => design);
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const options = imageEditorDesignQueryOptions({ getDesign }, "workspace-1", "design-1");

    const [first, second] = await Promise.all([
      queryClient.fetchQuery(options),
      queryClient.fetchQuery(options),
    ]);
    const revisit = await queryClient.fetchQuery(options);

    expect(first).toBe(design);
    expect(second).toBe(design);
    expect(revisit).toBe(design);
    expect(getDesign).toHaveBeenCalledTimes(1);
    expect(getDesign).toHaveBeenCalledWith("workspace-1", "design-1", expect.any(AbortSignal));
  });

  it("aborts a superseded design list without applying it to the next Workspace", async () => {
    let staleSignal: AbortSignal | undefined;
    const listDesigns = vi.fn(
      (
        workspaceId: string,
        _filters: { search: string; limit: number; offset: number },
        signal: AbortSignal,
      ) => {
        if (workspaceId === "workspace-2") {
          return Promise.resolve({ designs: [{ id: "current" }], total: 1, canEdit: true });
        }
        staleSignal = signal;
        return new Promise<ImageEditorDesignPage<{ id: string }>>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ designs: [{ id: "stale" }], total: 1, canEdit: true }),
            { once: true },
          );
        });
      },
    );
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const first = imageEditorDesignsQueryOptions<TestQueryData>({ listDesigns }, "workspace-1", {});
    const observer = new QueryObserver(queryClient, first);
    const appliedIds: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      for (const design of result.data?.designs ?? []) appliedIds.push(design.id);
    });

    await vi.waitFor(() => expect(staleSignal).toBeDefined());
    observer.setOptions(
      imageEditorDesignsQueryOptions<TestQueryData>({ listDesigns }, "workspace-2", {}),
    );
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.designs).toEqual([{ id: "current" }]),
    );

    expect(staleSignal?.aborted).toBe(true);
    expect(appliedIds).not.toContain("stale");
    unsubscribe();
  });

  it("keeps revision pages and immutable details on separate keys", () => {
    const list = imageEditorRevisionsQueryOptions<ImageEditorContractQueryData>(
      { listRevisions: vi.fn() },
      "workspace-1",
      "design-1",
      { cursor: "next", limit: 25 },
    );
    const detail = imageEditorRevisionQueryOptions<ImageEditorContractQueryData>(
      { getRevision: vi.fn() },
      "workspace-1",
      "design-1",
      "revision-1",
    );

    expect(list.queryKey).toEqual(
      imageEditorQueryKeys.revisions("workspace-1", "design-1", {
        cursor: "next",
        limit: 25,
      }),
    );
    expect(detail.queryKey).toEqual(
      imageEditorQueryKeys.revision("workspace-1", "design-1", "revision-1"),
    );
  });
});
