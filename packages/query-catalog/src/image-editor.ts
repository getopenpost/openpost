import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime, stableQueryStaleTime } from "./policies";

export type ImageEditorConfig = Omit<
  components["schemas"]["ImageEditorPresetOutputBody"],
  "presets"
> & {
  presets: Array<
    Omit<components["schemas"]["ImageEditorPreset"], "profiles"> & { profiles: string[] }
  >;
};

export interface ImageEditorQueryData {
  design: object;
  designSummary: object;
  template: object;
  brandKit: object;
  revision: object;
  revisionSummary: object;
}

export interface ImageEditorContractQueryData extends ImageEditorQueryData {
  design: components["schemas"]["ImageEditorDocumentResponse"];
  designSummary: components["schemas"]["ImageEditorDesignSummary"];
  template: components["schemas"]["ImageEditorTemplateResponse"];
  brandKit: components["schemas"]["ImageEditorBrandKitResponse"];
  revision: components["schemas"]["ImageEditorRevisionResponse"];
  revisionSummary: components["schemas"]["ImageEditorRevisionSummary"];
}

export interface ImageEditorDesignFilters {
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ImageEditorDesignCatalogFilters {
  readonly search?: string;
  readonly limit?: number;
}

export interface ImageEditorRevisionPage {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ImageEditorDesignPage<Summary extends object> {
  readonly designs: Summary[];
  readonly total: number;
  readonly canEdit: boolean;
}

export interface ImageEditorRevisionPageResult<Summary extends object> {
  readonly revisions: Summary[];
  readonly nextCursor: string;
}

export interface ImageEditorQueryAPI<
  Data extends ImageEditorQueryData = ImageEditorContractQueryData,
> {
  getConfig(signal: AbortSignal): Promise<ImageEditorConfig>;
  getDesign(workspaceId: string, designId: string, signal: AbortSignal): Promise<Data["design"]>;
  listDesigns(
    workspaceId: string,
    filters: NormalizedImageEditorDesignFilters,
    signal: AbortSignal,
  ): Promise<ImageEditorDesignPage<Data["designSummary"]>>;
  listTemplates(workspaceId: string, signal: AbortSignal): Promise<Data["template"][]>;
  listPublicTemplates(signal: AbortSignal): Promise<Data["template"][]>;
  getBrandKit(workspaceId: string, signal: AbortSignal): Promise<Data["brandKit"]>;
  listRevisions(
    workspaceId: string,
    designId: string,
    page: NormalizedImageEditorRevisionPage,
    signal: AbortSignal,
  ): Promise<ImageEditorRevisionPageResult<Data["revisionSummary"]>>;
  getRevision(
    workspaceId: string,
    designId: string,
    revisionId: string,
    signal: AbortSignal,
  ): Promise<Data["revision"]>;
}

const imageEditorRootKey = ["openpost", "v1", "image-editor"] as const;

export const imageEditorQueryKeys = {
  all: imageEditorRootKey,
  config: () => [...imageEditorRootKey, "config"] as const,
  publicTemplates: () => [...imageEditorRootKey, "public-templates"] as const,
  workspace: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "image-editor"),
  designs: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "image-editor", "designs"),
  designLists: (workspaceId: string) =>
    openPostWorkspaceKey(workspaceId, "image-editor", "designs", "list"),
  designList: (workspaceId: string, filters: ImageEditorDesignFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "image-editor",
      "designs",
      "list",
      normalizeImageEditorDesignFilters(filters),
    ),
  designCatalogs: (workspaceId: string) =>
    openPostWorkspaceKey(workspaceId, "image-editor", "designs", "list", "catalog"),
  designCatalog: (workspaceId: string, filters: ImageEditorDesignCatalogFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "image-editor",
      "designs",
      "list",
      "catalog",
      normalizeImageEditorDesignCatalogFilters(filters),
    ),
  design: (workspaceId: string, designId: string) =>
    openPostWorkspaceKey(workspaceId, "image-editor", "designs", "detail", designId),
  templates: (workspaceId: string) =>
    openPostWorkspaceKey(workspaceId, "image-editor", "templates"),
  brandKit: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "image-editor", "brand-kit"),
  revisionLists: (workspaceId: string, designId: string) =>
    openPostWorkspaceKey(
      workspaceId,
      "image-editor",
      "designs",
      "detail",
      designId,
      "revisions",
      "list",
    ),
  revisions: (workspaceId: string, designId: string, page: ImageEditorRevisionPage) =>
    openPostWorkspaceKey(
      workspaceId,
      "image-editor",
      "designs",
      "detail",
      designId,
      "revisions",
      "list",
      normalizeImageEditorRevisionPage(page),
    ),
  revision: (workspaceId: string, designId: string, revisionId: string) =>
    openPostWorkspaceKey(
      workspaceId,
      "image-editor",
      "designs",
      "detail",
      designId,
      "revisions",
      "detail",
      revisionId,
    ),
};

export function imageEditorConfigQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "getConfig">,
) {
  const queryKey = imageEditorQueryKeys.config();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getConfig(signal),
  };
}

export function imageEditorDesignQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "getDesign">,
  workspaceId: string,
  designId: string,
) {
  const queryKey = imageEditorQueryKeys.design(workspaceId, designId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && designId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getDesign(workspaceId, designId, signal),
  };
}

export function imageEditorDesignsQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "listDesigns">,
  workspaceId: string,
  filters: ImageEditorDesignFilters,
) {
  const normalized = normalizeImageEditorDesignFilters(filters);
  const queryKey = imageEditorQueryKeys.designList(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listDesigns(workspaceId, normalized, signal),
  };
}

export function imageEditorDesignCatalogQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "listDesigns">,
  workspaceId: string,
  filters: ImageEditorDesignCatalogFilters,
) {
  const normalized = normalizeImageEditorDesignCatalogFilters(filters);
  const queryKey = imageEditorQueryKeys.designCatalog(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, number>) =>
      api.listDesigns(workspaceId, { ...normalized, offset: pageParam }, signal),
    getNextPageParam: (
      lastPage: ImageEditorDesignPage<Data["designSummary"]>,
      pages: Array<ImageEditorDesignPage<Data["designSummary"]>>,
    ) => {
      const loaded = pages.reduce((total, page) => total + page.designs.length, 0);
      return lastPage.designs.length > 0 && loaded < lastPage.total ? loaded : undefined;
    },
  };
}

export function imageEditorTemplatesQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "listTemplates">,
  workspaceId: string,
) {
  const queryKey = imageEditorQueryKeys.templates(workspaceId);
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listTemplates(workspaceId, signal),
  };
}

export function imageEditorPublicTemplatesQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "listPublicTemplates">,
) {
  const queryKey = imageEditorQueryKeys.publicTemplates();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listPublicTemplates(signal),
  };
}

export function imageEditorBrandKitQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "getBrandKit">,
  workspaceId: string,
) {
  const queryKey = imageEditorQueryKeys.brandKit(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getBrandKit(workspaceId, signal),
  };
}

export function imageEditorRevisionsQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "listRevisions">,
  workspaceId: string,
  designId: string,
  page: ImageEditorRevisionPage,
) {
  const normalized = normalizeImageEditorRevisionPage(page);
  const queryKey = imageEditorQueryKeys.revisions(workspaceId, designId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && designId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listRevisions(workspaceId, designId, normalized, signal),
  };
}

export function imageEditorRevisionQueryOptions<Data extends ImageEditorQueryData>(
  api: Pick<ImageEditorQueryAPI<Data>, "getRevision">,
  workspaceId: string,
  designId: string,
  revisionId: string,
) {
  const queryKey = imageEditorQueryKeys.revision(workspaceId, designId, revisionId);
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && designId && revisionId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getRevision(workspaceId, designId, revisionId, signal),
  };
}

export type NormalizedImageEditorDesignFilters = ReturnType<
  typeof normalizeImageEditorDesignFilters
>;
export type NormalizedImageEditorDesignCatalogFilters = ReturnType<
  typeof normalizeImageEditorDesignCatalogFilters
>;
export type NormalizedImageEditorRevisionPage = ReturnType<typeof normalizeImageEditorRevisionPage>;

export function normalizeImageEditorDesignFilters(filters: ImageEditorDesignFilters) {
  return {
    search: filters.search?.trim() ?? "",
    limit: filters.limit ?? 100,
    offset: filters.offset ?? 0,
  } as const;
}

export function normalizeImageEditorDesignCatalogFilters(filters: ImageEditorDesignCatalogFilters) {
  return {
    search: filters.search?.trim() ?? "",
    limit: filters.limit ?? 50,
  } as const;
}

export function normalizeImageEditorRevisionPage(page: ImageEditorRevisionPage) {
  return {
    cursor: page.cursor?.trim() ?? "",
    limit: page.limit ?? 50,
  } as const;
}
