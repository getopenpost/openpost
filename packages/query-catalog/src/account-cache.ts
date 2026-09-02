import { adminQueryKeys } from "./admin";
import type { QueryCachePlan } from "./cache-plan";
import { featureQueryKeys } from "./features";
import { openPostQueryKeys } from "./keys";
import { publicProfileQueryKeys } from "./public-profiles";
import { workspaceSettingsQueryKeys } from "./workspace-settings";

export function accountMutationCachePlan(workspaceId: string): QueryCachePlan {
  return {
    remove: [{ queryKey: publicProfileQueryKeys.all() }],
    invalidate: [
      { queryKey: openPostQueryKeys.accounts(workspaceId), exact: true },
      { queryKey: openPostQueryKeys.socialSets(workspaceId), exact: true },
      { queryKey: featureQueryKeys.all(workspaceId) },
      { queryKey: adminQueryKeys.usersRoot() },
      { queryKey: workspaceSettingsQueryKeys.setup(workspaceId), exact: true },
    ],
  };
}
