import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type ScreenshotDocument = components["schemas"]["ScreenshotTemplateDocument"];
export type ScreenshotDesign = components["schemas"]["ScreenshotTemplateDesignResponse"];
export type ScreenshotDesignList = components["schemas"]["ListScreenshotTemplateDesignsOutputBody"];
export type ScreenshotRecipe = components["schemas"]["ScreenshotTemplateRecipeOutputBody"];
export interface ScreenshotTemplateQueryAPI {
  list(workspaceId: string, offset: number, signal: AbortSignal): Promise<ScreenshotDesignList>;
  detail(workspaceId: string, id: string, signal: AbortSignal): Promise<ScreenshotDesign>;
  recipe(workspaceId: string, mediaId: string, signal: AbortSignal): Promise<ScreenshotRecipe>;
}
export const screenshotTemplateKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "screenshot-templates"),
  lists: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "screenshot-templates", "list"),
  list: (workspaceId: string, offset: number) =>
    openPostWorkspaceKey(workspaceId, "screenshot-templates", "list", offset),
  detail: (workspaceId: string, id: string) =>
    openPostWorkspaceKey(workspaceId, "screenshot-templates", "detail", id),
  recipe: (workspaceId: string, mediaId: string) =>
    openPostWorkspaceKey(workspaceId, "screenshot-templates", "recipe", mediaId),
};
export function screenshotTemplateListOptions(
  api: ScreenshotTemplateQueryAPI,
  workspaceId: string,
  offset = 0,
) {
  const queryKey = screenshotTemplateKeys.list(workspaceId, offset);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.list(workspaceId, offset, signal),
  };
}
export function screenshotTemplateDetailOptions(
  api: ScreenshotTemplateQueryAPI,
  workspaceId: string,
  id: string,
) {
  const queryKey = screenshotTemplateKeys.detail(workspaceId, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && id),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.detail(workspaceId, id, signal),
  };
}
export function screenshotTemplateRecipeOptions(
  api: ScreenshotTemplateQueryAPI,
  workspaceId: string,
  mediaId: string,
) {
  const queryKey = screenshotTemplateKeys.recipe(workspaceId, mediaId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && mediaId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.recipe(workspaceId, mediaId, signal),
  };
}
