import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { capabilityStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";

export type Prompt = components["schemas"]["PromptResponse"];

export interface PromptQueryAPI {
  listPrompts(workspaceId: string, category: string, signal: AbortSignal): Promise<Prompt[]>;
  listPromptCategories(signal: AbortSignal): Promise<string[]>;
}

export const promptQueryKeys = {
  lists: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "prompts", "list"),
  list: (workspaceId: string, category = "") =>
    openPostWorkspaceKey(workspaceId, "prompts", "list", { category: category.trim() }),
  categories: () => ["openpost", "v1", "prompts", "categories"] as const,
};

export function promptsQueryOptions(
  api: Pick<PromptQueryAPI, "listPrompts">,
  workspaceId: string,
  category = "",
) {
  const normalizedCategory = category.trim();
  const queryKey = promptQueryKeys.list(workspaceId, normalizedCategory);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listPrompts(workspaceId, normalizedCategory, signal),
  };
}

export function promptCategoriesQueryOptions(api: Pick<PromptQueryAPI, "listPromptCategories">) {
  const queryKey = promptQueryKeys.categories();
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listPromptCategories(signal),
  };
}
