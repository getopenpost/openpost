import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type VideoProject = components["schemas"]["VideoProjectResponse"];
export type VideoProjectRevision = components["schemas"]["VideoProjectRevisionResponse"];
export type VideoProjectConflict = components["schemas"]["VideoProjectConflictResponse"];
export type VideoProjectAsset = components["schemas"]["ProjectAssetResponse"];

export interface VideoProjectQueryAPI {
  listVideoProjects(
    workspaceId: string,
    includeTrash: boolean,
    signal: AbortSignal,
  ): Promise<VideoProject[]>;
  getVideoProject(
    workspaceId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<VideoProject>;
  listVideoProjectRevisions(
    workspaceId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<VideoProjectRevision[]>;
  listVideoProjectConflicts(
    workspaceId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<VideoProjectConflict[]>;
  listVideoProjectAssets(
    workspaceId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<VideoProjectAsset[]>;
}

export const videoProjectQueryKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "video-projects"),
  lists: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "video-projects", "list"),
  list: (workspaceId: string, includeTrash: boolean) =>
    openPostWorkspaceKey(workspaceId, "video-projects", "list", { includeTrash }),
  detail: (workspaceId: string, projectId: string) =>
    openPostWorkspaceKey(workspaceId, "video-projects", "detail", projectId),
  revisions: (workspaceId: string, projectId: string) =>
    openPostWorkspaceKey(workspaceId, "video-projects", "detail", projectId, "revisions"),
  conflicts: (workspaceId: string, projectId: string) =>
    openPostWorkspaceKey(workspaceId, "video-projects", "detail", projectId, "conflicts"),
  assets: (workspaceId: string, projectId: string) =>
    openPostWorkspaceKey(workspaceId, "video-projects", "detail", projectId, "assets"),
};

export function videoProjectListQueryOptions(
  api: Pick<VideoProjectQueryAPI, "listVideoProjects">,
  workspaceId: string,
  includeTrash = false,
) {
  const queryKey = videoProjectQueryKeys.list(workspaceId, includeTrash);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listVideoProjects(workspaceId, includeTrash, signal),
  };
}

export function videoProjectDetailQueryOptions(
  api: Pick<VideoProjectQueryAPI, "getVideoProject">,
  workspaceId: string,
  projectId: string,
) {
  const queryKey = videoProjectQueryKeys.detail(workspaceId, projectId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && projectId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getVideoProject(workspaceId, projectId, signal),
  };
}

export function videoProjectRevisionsQueryOptions(
  api: Pick<VideoProjectQueryAPI, "listVideoProjectRevisions">,
  workspaceId: string,
  projectId: string,
) {
  const queryKey = videoProjectQueryKeys.revisions(workspaceId, projectId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && projectId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listVideoProjectRevisions(workspaceId, projectId, signal),
  };
}

export function videoProjectConflictsQueryOptions(
  api: Pick<VideoProjectQueryAPI, "listVideoProjectConflicts">,
  workspaceId: string,
  projectId: string,
) {
  const queryKey = videoProjectQueryKeys.conflicts(workspaceId, projectId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && projectId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listVideoProjectConflicts(workspaceId, projectId, signal),
  };
}

export function videoProjectAssetsQueryOptions(
  api: Pick<VideoProjectQueryAPI, "listVideoProjectAssets">,
  workspaceId: string,
  projectId: string,
) {
  const queryKey = videoProjectQueryKeys.assets(workspaceId, projectId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && projectId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listVideoProjectAssets(workspaceId, projectId, signal),
  };
}
