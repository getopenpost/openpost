import {
  createOpenPostQueryError,
  type OpenPostQueryAPI,
  type AppBrandingQueryAPI,
  type QueryPageResult,
  type VideoProjectQueryAPI,
  type AnalyticsQueryAPI,
  type PublicationBuild,
  type VoiceProfileQueryAPI,
  type PublicationReview,
  type WorkspaceSetup,
  type WorkspaceSettingsQueryAPI,
} from "@openpost/query-catalog";

import { api, captureApiRequestIdentity, settleApiUnauthorized, type Api } from "./api/client";

type QueryTransport = Pick<Api, "GET">;
type MobileQueryAPI = AppBrandingQueryAPI &
  Pick<
    OpenPostQueryAPI,
    | "getPublication"
    | "listAccounts"
    | "listActivityPublications"
    | "listCalendarPublications"
    | "listFailedJobs"
    | "listSocialSets"
    | "listWorkspaces"
  > &
  Pick<WorkspaceSettingsQueryAPI, "getWorkspaceSetup"> &
  Pick<VideoProjectQueryAPI, "listVideoProjectSummaries"> &
  AnalyticsQueryAPI &
  VoiceProfileQueryAPI & {
    listPublicationReviews(
      workspaceId: string,
      publicationId: string,
      signal: AbortSignal,
    ): Promise<PublicationReview[]>;
    getPublicationBuild(
      workspaceId: string,
      id: string,
      signal: AbortSignal,
    ): Promise<PublicationBuild>;
  };

type QueryTransportResponse<T> = {
  data?: T | null;
  error?: unknown;
  response: Response;
};

export async function mobileQueryTransportRequest<T>(
  signal: AbortSignal,
  request: (signal: AbortSignal) => Promise<QueryTransportResponse<T>>,
): Promise<QueryTransportResponse<T>> {
  const identity = captureApiRequestIdentity();
  const result = await request(signal);
  await settleApiUnauthorized(identity, result.response);
  return result;
}

export function createMobileQueryAPI(getTransport: () => QueryTransport): MobileQueryAPI {
  return {
    async getAppBranding(workspaceId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load app branding",
        request: (signal) =>
          getTransport().GET("/app-branding/{workspace_id}", {
            signal,
            params: { path: { workspace_id: workspaceId } },
          }),
      });
      return data;
    },
    async listPublicationReviews(workspaceId, publicationId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load client reviews",
        request: (requestSignal) =>
          getTransport().GET("/publications/{id}/reviews", {
            signal: requestSignal,
            params: { path: { id: publicationId } },
          }),
      });
      if (
        data.some((row) => row.workspace_id !== workspaceId || row.publication_id !== publicationId)
      )
        throw new Error("Review workspace does not match this post.");
      return data;
    },
    async getPublicationBuild(workspaceId, id, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load these posts",
        request: (requestSignal) =>
          getTransport().GET("/publication-builds/{id}", {
            signal: requestSignal,
            params: { path: { id } },
          }),
      });
      if (data.workspace_id !== workspaceId)
        throw new Error("These posts belong to another Workspace.");
      return data;
    },
    async listVoiceProfiles(workspaceId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load voices",
        request: (requestSignal) =>
          getTransport().GET("/voice-profiles", {
            signal: requestSignal,
            params: { query: { workspace_id: workspaceId } },
          }),
      });
      return data;
    },
    async getAnalyticsOverview(workspaceId, filters, cursor, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load analytics",
        request: (requestSignal) =>
          getTransport().GET("/analytics", {
            signal: requestSignal,
            params: {
              query: {
                workspace_id: workspaceId,
                days: filters.days,
                from: filters.from || undefined,
                to: filters.to || undefined,
                account_id: filters.accountId || undefined,
                account_ids: filters.accountIds.join(",") || undefined,
                sort: filters.sort,
                cursor: cursor || undefined,
                limit: filters.limit,
              },
            },
          }),
      });
      return data;
    },
    async listWorkspaces(signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load workspaces",
        request: (requestSignal) => getTransport().GET("/workspaces", { signal: requestSignal }),
      });
      return data;
    },
    async getPublication(_workspaceId, publicationId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load post",
        request: (requestSignal) =>
          getTransport().GET("/publications/{id}", {
            signal: requestSignal,
            params: { path: { id: publicationId } },
          }),
      });
      return data;
    },
    async listActivityPublications(workspaceId, activity, page, signal) {
      const { data, response } = await queryGET({
        signal,
        fallback: "Could not load posts",
        request: (requestSignal) =>
          getTransport().GET("/publications", {
            signal: requestSignal,
            params: {
              query: {
                workspace_id: workspaceId,
                activity_bucket: activity,
                search: page.search?.trim() || undefined,
                limit: page.limit,
                cursor: page.cursor || undefined,
              },
            },
          }),
      });
      return queryPage(data, response);
    },
    async listCalendarPublications(workspaceId, range, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load calendar",
        request: (requestSignal) =>
          getTransport().GET("/publications", {
            signal: requestSignal,
            params: {
              query: {
                workspace_id: workspaceId,
                calendar_from: range.from,
                calendar_before: range.before,
                limit: range.limit,
              },
            },
          }),
      });
      return data;
    },
    async listAccounts(workspaceId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load accounts",
        request: (requestSignal) =>
          getTransport().GET("/accounts", {
            signal: requestSignal,
            params: { query: { workspace_id: workspaceId } },
          }),
      });
      return data;
    },
    async listFailedJobs(workspaceId, page, signal) {
      const { data, response } = await queryGET({
        signal,
        fallback: "Could not load failed posts",
        request: (requestSignal) =>
          getTransport().GET("/jobs", {
            signal: requestSignal,
            params: {
              query: {
                workspace_id: workspaceId,
                status: "failed",
                category: "publishing",
                limit: page.limit,
                cursor: page.cursor || undefined,
              },
            },
          }),
      });
      return queryPage(data, response);
    },
    async getWorkspaceSetup(workspaceId, signal): Promise<WorkspaceSetup> {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load workspace setup",
        request: (requestSignal) =>
          getTransport().GET("/workspaces/{id}/setup", {
            signal: requestSignal,
            params: { path: { id: workspaceId } },
          }),
      });
      return data;
    },
    async listSocialSets(workspaceId, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load social sets",
        request: (requestSignal) =>
          getTransport().GET("/social-sets", {
            signal: requestSignal,
            params: { query: { workspace_id: workspaceId } },
          }),
      });
      return data;
    },
    async listVideoProjectSummaries(workspaceId, includeTrash, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load Video Projects",
        request: async (requestSignal) => {
          const transport = getTransport();
          const options = {
            signal: requestSignal,
            params: { query: { workspace_id: workspaceId, include_trash: includeTrash } },
          };
          const summaries = await transport.GET("/video-project-summaries", options);
          if (summaries.response.status !== 404) return summaries;
          // Native clients may connect to self-hosted servers predating summary reads.
          const legacy = await transport.GET("/video-projects", options);
          return {
            ...legacy,
            data: legacy.data?.map(({ document, ...metadata }) => ({
              ...metadata,
              schema_family:
                typeof document?.schemaFamily === "string" ? document.schemaFamily : "",
            })),
          };
        },
      });
      return data;
    },
  };
}

async function queryGET<T>({
  signal,
  fallback,
  request,
}: {
  signal: AbortSignal;
  fallback: string;
  request: (signal: AbortSignal) => Promise<QueryTransportResponse<T>>;
}): Promise<{ data: T; response: Response }> {
  const { data, error, response } = await mobileQueryTransportRequest(signal, request);
  if (error || data === null || data === undefined) {
    throw createOpenPostQueryError(response?.status, error, fallback);
  }
  return { data, response };
}

function queryPage<T>(items: T[], response: Response): QueryPageResult<T> {
  const total = Number(response.headers.get("X-Total-Count") ?? items.length);
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    nextCursor: response.headers.get("X-Next-Cursor") ?? "",
  };
}

export const mobileQueryAPI = createMobileQueryAPI(api);
