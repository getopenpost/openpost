import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { seedPublicationDetail } from "./cache";
import { openPostWorkspaceKey } from "./keys";
import { liveQueryStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";

export type EngagementPage = components["schemas"]["EngagementPage"];
export type ConversationPage = components["schemas"]["ConversationPage"];
export type MessagePage = components["schemas"]["MessagePage"];
export type InboxPublication = components["schemas"]["PublicationResponse"];

export interface EngagementFilters {
  readonly platform?: string;
  readonly accountId?: string;
  readonly publicationId?: string;
  readonly unreadOnly?: boolean;
  readonly archived?: boolean;
  readonly limit?: number;
}

export interface ConversationFilters {
  readonly platform?: string;
  readonly accountId?: string;
  readonly archived?: boolean;
  readonly limit?: number;
}

export interface MessageFilters {
  readonly limit?: number;
}

export interface InboxPublicationSearch {
  readonly search?: string;
  readonly limit?: number;
}

export interface InboxPublicationPage {
  readonly items: InboxPublication[];
  readonly nextCursor: string;
}

export interface InboxQueryAPI {
  listEngagement(
    workspaceId: string,
    filters: NormalizedEngagementFilters,
    cursor: string,
    signal: AbortSignal,
  ): Promise<EngagementPage>;
  listConversations(
    workspaceId: string,
    filters: NormalizedConversationFilters,
    cursor: string,
    signal: AbortSignal,
  ): Promise<ConversationPage>;
  listMessages(
    workspaceId: string,
    conversationId: string,
    filters: NormalizedMessageFilters,
    cursor: string,
    signal: AbortSignal,
  ): Promise<MessagePage>;
  listPublications(
    workspaceId: string,
    filters: NormalizedInboxPublicationSearch,
    cursor: string,
    signal: AbortSignal,
  ): Promise<InboxPublicationPage>;
}

export const inboxQueryKeys = {
  engagementRoot: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "engagement"),
  engagement: (workspaceId: string, filters: EngagementFilters) =>
    openPostWorkspaceKey(workspaceId, "engagement", normalizeEngagementFilters(filters)),
  conversationsRoot: (workspaceId: string) =>
    openPostWorkspaceKey(workspaceId, "messages", "conversations"),
  conversations: (workspaceId: string, filters: ConversationFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "messages",
      "conversations",
      normalizeConversationFilters(filters),
    ),
  messagesRoot: (workspaceId: string, conversationId: string) =>
    openPostWorkspaceKey(workspaceId, "messages", "conversation", conversationId),
  messages: (workspaceId: string, conversationId: string, filters: MessageFilters) =>
    openPostWorkspaceKey(
      workspaceId,
      "messages",
      "conversation",
      conversationId,
      normalizeMessageFilters(filters),
    ),
  publicationSearch: (workspaceId: string, filters: InboxPublicationSearch) =>
    openPostWorkspaceKey(
      workspaceId,
      "publications",
      "list",
      "inbox-search",
      normalizeInboxPublicationSearch(filters),
    ),
};

export function engagementQueryOptions(
  api: Pick<InboxQueryAPI, "listEngagement">,
  workspaceId: string,
  filters: EngagementFilters,
) {
  const normalized = normalizeEngagementFilters(filters);
  const queryKey = inboxQueryKeys.engagement(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    refetchOnWindowFocus: true,
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listEngagement(workspaceId, normalized, pageParam, signal),
    getNextPageParam: (lastPage: EngagementPage) => lastPage.next_cursor || undefined,
  };
}

export function conversationsQueryOptions(
  api: Pick<InboxQueryAPI, "listConversations">,
  workspaceId: string,
  filters: ConversationFilters,
) {
  const normalized = normalizeConversationFilters(filters);
  const queryKey = inboxQueryKeys.conversations(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    refetchOnWindowFocus: true,
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listConversations(workspaceId, normalized, pageParam, signal),
    getNextPageParam: (lastPage: ConversationPage) => lastPage.next_cursor || undefined,
  };
}

export function messagesQueryOptions(
  api: Pick<InboxQueryAPI, "listMessages">,
  workspaceId: string,
  conversationId: string,
  filters: MessageFilters,
) {
  const normalized = normalizeMessageFilters(filters);
  const queryKey = inboxQueryKeys.messages(workspaceId, conversationId, normalized);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && conversationId),
    initialPageParam: "",
    refetchOnWindowFocus: true,
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listMessages(workspaceId, conversationId, normalized, pageParam, signal),
    getNextPageParam: (lastPage: MessagePage) => lastPage.next_cursor || undefined,
  };
}

export function inboxPublicationsQueryOptions(
  api: Pick<InboxQueryAPI, "listPublications">,
  workspaceId: string,
  filters: InboxPublicationSearch,
) {
  const normalized = normalizeInboxPublicationSearch(filters);
  const queryKey = inboxQueryKeys.publicationSearch(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    queryFn: async ({
      client,
      pageParam,
      signal,
    }: QueryFunctionContext<typeof queryKey, string>) => {
      const result = await api.listPublications(workspaceId, normalized, pageParam, signal);
      signal.throwIfAborted();
      for (const publication of result.items) {
        seedPublicationDetail(client, publication, workspaceId);
      }
      return result;
    },
    getNextPageParam: (lastPage: InboxPublicationPage) => lastPage.nextCursor || undefined,
  };
}

export type NormalizedEngagementFilters = ReturnType<typeof normalizeEngagementFilters>;
export type NormalizedConversationFilters = ReturnType<typeof normalizeConversationFilters>;
export type NormalizedMessageFilters = ReturnType<typeof normalizeMessageFilters>;
export type NormalizedInboxPublicationSearch = ReturnType<typeof normalizeInboxPublicationSearch>;

export function normalizeEngagementFilters(filters: EngagementFilters) {
  return {
    platform: filters.platform?.trim() ?? "",
    accountId: filters.accountId?.trim() ?? "",
    publicationId: filters.publicationId?.trim() ?? "",
    unreadOnly: filters.unreadOnly ?? false,
    archived: filters.archived ?? false,
    limit: filters.limit ?? 100,
  } as const;
}

export function normalizeConversationFilters(filters: ConversationFilters) {
  return {
    platform: filters.platform?.trim() ?? "",
    accountId: filters.accountId?.trim() ?? "",
    archived: filters.archived ?? false,
    limit: filters.limit ?? 100,
  } as const;
}

export function normalizeMessageFilters(filters: MessageFilters) {
  return { limit: filters.limit ?? 200 } as const;
}

export function normalizeInboxPublicationSearch(filters: InboxPublicationSearch) {
  return { search: filters.search?.trim() ?? "", limit: filters.limit ?? 50 } as const;
}
