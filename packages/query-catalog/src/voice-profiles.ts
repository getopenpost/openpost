import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { capabilityStaleTime, openPostQueryPolicy } from "./policies";

export type VoiceProfile = components["schemas"]["VoiceProfile"];

export interface VoiceProfileQueryAPI {
  listVoiceProfiles(workspaceId: string, signal: AbortSignal): Promise<VoiceProfile[]>;
}

export const voiceProfileQueryKeys = {
  list: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "voice-profiles", "list"),
};

export function voiceProfilesQueryOptions(
  api: Pick<VoiceProfileQueryAPI, "listVoiceProfiles">,
  workspaceId: string,
) {
  const queryKey = voiceProfileQueryKeys.list(workspaceId);
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listVoiceProfiles(workspaceId, signal),
  };
}
