import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { capabilityStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";

export type MediaListResult = components["schemas"]["ListMediaOutputBody"];
export type MediaStorage = components["schemas"]["GetMediaStorageOutputBody"];
export type MediaTagList = components["schemas"]["ListMediaTagsOutputBody"];
export type MediaUsage = components["schemas"]["GetMediaUsageOutputBody"];
export type MemeTemplateList = components["schemas"]["ListMemeTemplatesOutputBody"];
export type StockProviderList = components["schemas"]["ListStockProvidersOutputBody"];
export type StockSearchPage = components["schemas"]["SearchPage"];

export interface MediaListFilters {
  readonly lifecycle?: "library" | "temporary" | "trash" | "all";
  readonly filter?: string;
  readonly sort?: string;
  readonly search?: string;
  readonly type?: string;
  readonly source?: string;
  readonly assetKind?: string;
  readonly aspect?: string;
  readonly tagId?: string;
  readonly tagIds?: readonly string[];
  readonly untagged?: boolean;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MemeTemplateFilters {
  readonly query?: string;
  readonly limit?: number;
}

export type StockProviderId = "pexels" | "unsplash" | "pixabay";

export interface StockMediaSearch {
  readonly provider: StockProviderId;
  readonly query: string;
  readonly kind?: "photo" | "video";
  readonly orientation?: "landscape" | "portrait" | "square";
  readonly size?: "small" | "medium" | "large";
  readonly color?: string;
  readonly locale?: string;
  readonly order?: "relevant" | "latest" | "popular";
  readonly contentFilter?: "low" | "high";
  readonly collections?: string;
  readonly category?: string;
  readonly mediaSubtype?: "all" | "photo" | "illustration" | "vector";
  readonly editorsChoice?: boolean;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly page?: number;
  readonly perPage?: number;
}

export interface MediaQueryAPI {
  listMedia(
    workspaceId: string,
    filters: NormalizedMediaListFilters,
    signal: AbortSignal,
  ): Promise<MediaListResult>;
  getMediaStorage(workspaceId: string, signal: AbortSignal): Promise<MediaStorage>;
  listMediaTags(workspaceId: string, signal: AbortSignal): Promise<MediaTagList>;
  getMediaUsage(workspaceId: string, mediaId: string, signal: AbortSignal): Promise<MediaUsage>;
  listMemeTemplates(
    workspaceId: string,
    filters: NormalizedMemeTemplateFilters,
    signal: AbortSignal,
  ): Promise<MemeTemplateList>;
  listStockProviders(signal: AbortSignal): Promise<StockProviderList>;
  searchStockMedia(
    filters: NormalizedStockMediaSearch,
    signal: AbortSignal,
  ): Promise<StockSearchPage>;
}

export const mediaQueryKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "media"),
  lists: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "media", "list"),
  list: (workspaceId: string, filters: MediaListFilters) =>
    openPostWorkspaceKey(workspaceId, "media", "list", normalizeMediaListFilters(filters)),
  storage: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "media", "storage"),
  tags: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "media", "tags"),
  usage: (workspaceId: string, mediaId: string) =>
    openPostWorkspaceKey(workspaceId, "media", "usage", mediaId),
  memeTemplates: (workspaceId: string, filters: MemeTemplateFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "media",
      "meme-templates",
      normalizeMemeTemplateFilters(filters),
    ),
  stockProviders: () => ["openpost", "v1", "stock-media", "providers"] as const,
  stockSearch: (filters: StockMediaSearch) =>
    ["openpost", "v1", "stock-media", "search", normalizeStockMediaSearch(filters)] as const,
};

export function mediaListQueryOptions(
  api: Pick<MediaQueryAPI, "listMedia">,
  workspaceId: string,
  filters: MediaListFilters,
) {
  const normalized = normalizeMediaListFilters(filters);
  const queryKey = mediaQueryKeys.list(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listMedia(workspaceId, normalized, signal),
  };
}

export function mediaStorageQueryOptions(
  api: Pick<MediaQueryAPI, "getMediaStorage">,
  workspaceId: string,
) {
  const queryKey = mediaQueryKeys.storage(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getMediaStorage(workspaceId, signal),
  };
}

export function mediaTagsQueryOptions(
  api: Pick<MediaQueryAPI, "listMediaTags">,
  workspaceId: string,
) {
  const queryKey = mediaQueryKeys.tags(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listMediaTags(workspaceId, signal),
  };
}

export function mediaUsageQueryOptions(
  api: Pick<MediaQueryAPI, "getMediaUsage">,
  workspaceId: string,
  mediaId: string,
) {
  const queryKey = mediaQueryKeys.usage(workspaceId, mediaId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && mediaId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getMediaUsage(workspaceId, mediaId, signal),
  };
}

export function memeTemplatesQueryOptions(
  api: Pick<MediaQueryAPI, "listMemeTemplates">,
  workspaceId: string,
  filters: MemeTemplateFilters,
) {
  const normalized = normalizeMemeTemplateFilters(filters);
  const queryKey = mediaQueryKeys.memeTemplates(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listMemeTemplates(workspaceId, normalized, signal),
  };
}

export function stockProvidersQueryOptions(api: Pick<MediaQueryAPI, "listStockProviders">) {
  const queryKey = mediaQueryKeys.stockProviders();
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listStockProviders(signal),
  };
}

export function stockSearchQueryOptions(
  api: Pick<MediaQueryAPI, "searchStockMedia">,
  filters: StockMediaSearch,
) {
  const normalized = normalizeStockMediaSearch(filters);
  const queryKey = mediaQueryKeys.stockSearch(filters);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(normalized.query),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.searchStockMedia(normalized, signal),
  };
}

export type NormalizedMediaListFilters = ReturnType<typeof normalizeMediaListFilters>;
export type NormalizedMemeTemplateFilters = ReturnType<typeof normalizeMemeTemplateFilters>;
export type NormalizedStockMediaSearch = ReturnType<typeof normalizeStockMediaSearch>;

export function normalizeMediaListFilters(filters: MediaListFilters) {
  return {
    lifecycle: filters.lifecycle ?? "library",
    filter: filters.filter?.trim() ?? "",
    sort: filters.sort?.trim() ?? "",
    search: filters.search?.trim() ?? "",
    type: filters.type?.trim() ?? "",
    source: filters.source?.trim() ?? "",
    assetKind: filters.assetKind?.trim() ?? "",
    aspect: filters.aspect?.trim() ?? "",
    tagId: filters.tagId?.trim() ?? "",
    tagIds: [...(filters.tagIds ?? [])].filter(Boolean).sort(),
    untagged: filters.untagged ?? false,
    minWidth: filters.minWidth ?? 0,
    minHeight: filters.minHeight ?? 0,
    maxWidth: filters.maxWidth ?? 0,
    maxHeight: filters.maxHeight ?? 0,
    dateFrom: filters.dateFrom?.trim() ?? "",
    dateTo: filters.dateTo?.trim() ?? "",
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  } as const;
}

export function normalizeMemeTemplateFilters(filters: MemeTemplateFilters) {
  return {
    query: filters.query?.trim() ?? "",
    limit: filters.limit ?? 40,
  } as const;
}

export function normalizeStockMediaSearch(filters: StockMediaSearch) {
  return {
    provider: filters.provider,
    query: filters.query.trim(),
    kind: filters.kind ?? "photo",
    orientation: filters.orientation ?? "",
    size: filters.size ?? "",
    color: filters.color?.trim() ?? "",
    locale: filters.locale?.trim() ?? "",
    order: filters.order ?? "",
    contentFilter: filters.contentFilter ?? "",
    collections: filters.collections?.trim() ?? "",
    category: filters.category?.trim() ?? "",
    mediaSubtype: filters.mediaSubtype ?? "",
    editorsChoice: filters.editorsChoice ?? false,
    minWidth: filters.minWidth ?? 0,
    minHeight: filters.minHeight ?? 0,
    page: filters.page ?? 1,
    perPage: filters.perPage ?? 24,
  } as const;
}
