import {
  createOpenPostQueryError,
  type OpenPostQueryAPI,
  type QueryPageResult,
  type VideoProjectQueryAPI,
} from "@openpost/query-catalog";

import { api, captureApiRequestIdentity, settleApiUnauthorized, type Api } from "./api/client";

type QueryTransport = Pick<Api, "GET">;
type MobileQueryAPI = Pick<
  OpenPostQueryAPI,
  | "getPublication"
  | "listAccounts"
  | "listActivityPublications"
  | "listCalendarPublications"
  | "listSocialSets"
  | "listWorkspaces"
> &
  Pick<VideoProjectQueryAPI, "listVideoProjects">;

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
    async listVideoProjects(workspaceId, includeTrash, signal) {
      const { data } = await queryGET({
        signal,
        fallback: "Could not load Video Projects",
        request: (requestSignal) =>
          getTransport().GET("/video-projects", {
            signal: requestSignal,
            params: { query: { workspace_id: workspaceId, include_trash: includeTrash } },
          }),
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
