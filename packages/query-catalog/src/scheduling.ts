import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { capturePublicationListCacheContext, seedPublicationDetail } from "./cache";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type SchedulingPublication = components["schemas"]["PublicationResponse"];
export type PublicationHistoryEvent = components["schemas"]["PublicationLifecycleEventResponse"];
export type PostingSchedule = components["schemas"]["PostingScheduleResponse"];
export type RepostAutomationSettings = components["schemas"]["SettingsResponse"];
export type PublishingOptions = components["schemas"]["PublishingOptionsOutputBody"];

export interface PublicationFilters {
  readonly status?: string;
  readonly contentProfile?: string;
  readonly platform?: string;
  readonly search?: string;
  readonly createdFrom?: string;
  readonly createdBefore?: string;
  readonly calendarFrom?: string;
  readonly calendarBefore?: string;
  readonly limit?: number;
  readonly allPages?: boolean;
}

export interface PublicationHistoryPage {
  readonly limit: number;
  readonly cursor?: string;
}

export interface PublicationHistoryPageResult {
  readonly items: PublicationHistoryEvent[];
  readonly nextCursor: string;
}

export interface PublishingOptionsInput {
  readonly accountId: string;
  readonly source: string;
  readonly region: string;
  readonly locale: string;
  readonly limit: number;
  readonly search?: string;
  readonly cursor?: string;
  readonly context: string;
}

export interface SchedulingQueryAPI {
  listPublications(
    workspaceId: string,
    filters: NormalizedPublicationFilters,
    signal: AbortSignal,
  ): Promise<SchedulingPublication[]>;
  listPublicationEvents(
    workspaceId: string,
    publicationId: string,
    page: NormalizedPublicationHistoryPage,
    signal: AbortSignal,
  ): Promise<PublicationHistoryPageResult>;
  listPostingSchedules(workspaceId: string, signal: AbortSignal): Promise<PostingSchedule[]>;
  getRepostAutomation(workspaceId: string, signal: AbortSignal): Promise<RepostAutomationSettings>;
  getPublishingOptions(
    workspaceId: string,
    input: NormalizedPublishingOptionsInput,
    signal: AbortSignal,
  ): Promise<PublishingOptions>;
}

export const schedulingQueryKeys = {
  publicationLists: (workspaceId: string) =>
    openPostWorkspaceKey(workspaceId, "publications", "list", "scheduling"),
  publications: (workspaceId: string, filters: PublicationFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "publications",
      "list",
      "scheduling",
      normalizePublicationFilters(filters),
    ),
  publicationEventsRoot: (workspaceId: string, publicationId: string) =>
    openPostWorkspaceKey(workspaceId, "publications", "detail", publicationId, "events"),
  publicationEvents: (workspaceId: string, publicationId: string, page: PublicationHistoryPage) =>
    openPostWorkspaceKey(
      workspaceId,
      "publications",
      "detail",
      publicationId,
      "events",
      normalizePublicationHistoryPage(page),
    ),
  postingSchedules: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "posting-schedules"),
  repostAutomation: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "repost-automation"),
  publishingOptions: (workspaceId: string, input: PublishingOptionsInput) =>
    openPostWorkspaceKey(workspaceId, "publishing-options", normalizePublishingOptionsInput(input)),
};

export function schedulingPublicationsQueryOptions(
  api: Pick<SchedulingQueryAPI, "listPublications">,
  workspaceId: string,
  filters: PublicationFilters,
) {
  const normalized = normalizePublicationFilters(filters);
  const queryKey = schedulingQueryKeys.publications(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const publications = await api.listPublications(workspaceId, normalized, signal);
      signal.throwIfAborted();
      for (const publication of publications) {
        seedPublicationDetail(client, publication, workspaceId, listContext);
      }
      return publications;
    },
  };
}

export function publicationEventsQueryOptions(
  api: Pick<SchedulingQueryAPI, "listPublicationEvents">,
  workspaceId: string,
  publicationId: string,
  page: PublicationHistoryPage,
) {
  const normalized = normalizePublicationHistoryPage(page);
  const queryKey = schedulingQueryKeys.publicationEvents(workspaceId, publicationId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && publicationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listPublicationEvents(workspaceId, publicationId, normalized, signal),
  };
}

export function postingSchedulesQueryOptions(
  api: Pick<SchedulingQueryAPI, "listPostingSchedules">,
  workspaceId: string,
) {
  const queryKey = schedulingQueryKeys.postingSchedules(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listPostingSchedules(workspaceId, signal),
  };
}

export function repostAutomationQueryOptions(
  api: Pick<SchedulingQueryAPI, "getRepostAutomation">,
  workspaceId: string,
) {
  const queryKey = schedulingQueryKeys.repostAutomation(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getRepostAutomation(workspaceId, signal),
  };
}

export function publicationEventsInfiniteQueryOptions(
  api: Pick<SchedulingQueryAPI, "listPublicationEvents">,
  workspaceId: string,
  publicationId: string,
  page: Pick<PublicationHistoryPage, "limit">,
) {
  const queryKey = schedulingQueryKeys.publicationEvents(workspaceId, publicationId, {
    limit: page.limit,
    cursor: "",
  });
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && publicationId),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listPublicationEvents(
        workspaceId,
        publicationId,
        { limit: page.limit, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (lastPage: PublicationHistoryPageResult) => lastPage.nextCursor || undefined,
  };
}

export function publishingOptionsQueryOptions(
  api: Pick<SchedulingQueryAPI, "getPublishingOptions">,
  workspaceId: string,
  input: PublishingOptionsInput,
) {
  const normalized = normalizePublishingOptionsInput(input);
  const queryKey = schedulingQueryKeys.publishingOptions(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && normalized.accountId && normalized.source),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getPublishingOptions(workspaceId, normalized, signal),
  };
}

export type NormalizedPublicationFilters = ReturnType<typeof normalizePublicationFilters>;
export type NormalizedPublicationHistoryPage = ReturnType<typeof normalizePublicationHistoryPage>;
export type NormalizedPublishingOptionsInput = ReturnType<typeof normalizePublishingOptionsInput>;

export function normalizePublicationFilters(filters: PublicationFilters) {
  return {
    status: filters.status?.trim() ?? "",
    contentProfile: filters.contentProfile?.trim() ?? "",
    platform: filters.platform?.trim() ?? "",
    search: filters.search?.trim() ?? "",
    createdFrom: filters.createdFrom?.trim() ?? "",
    createdBefore: filters.createdBefore?.trim() ?? "",
    calendarFrom: filters.calendarFrom?.trim() ?? "",
    calendarBefore: filters.calendarBefore?.trim() ?? "",
    limit: filters.limit ?? 200,
    allPages: filters.allPages ?? false,
  } as const;
}

export function normalizePublicationHistoryPage(page: PublicationHistoryPage) {
  return { limit: page.limit, cursor: page.cursor ?? "" } as const;
}

export function normalizePublishingOptionsInput(input: PublishingOptionsInput) {
  return {
    accountId: input.accountId,
    source: input.source,
    region: input.region,
    locale: input.locale,
    limit: input.limit,
    search: input.search?.trim() ?? "",
    cursor: input.cursor ?? "",
    context: input.context,
  } as const;
}
