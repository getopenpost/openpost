import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { capabilityStaleTime } from "./policies";
import {
  voiceProfileQueryKeys,
  voiceProfilesQueryOptions,
  type VoiceProfile,
  type VoiceProfileQueryAPI,
} from "./voice-profiles";

describe("Voice Profile query catalog", () => {
  it("scopes the list to its Workspace and deduplicates equal reads", async () => {
    const profile = { id: "voice-1", workspace_id: "workspace-1" } as VoiceProfile;
    const listVoiceProfiles = vi.fn(async (_workspaceId: string, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return [profile];
    });
    const api: Pick<VoiceProfileQueryAPI, "listVoiceProfiles"> = { listVoiceProfiles };
    const client = new QueryClient();
    const options = voiceProfilesQueryOptions(api, "workspace-1");

    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);

    expect(options.queryKey).toEqual(voiceProfileQueryKeys.list("workspace-1"));
    expect(options.staleTime).toBe(capabilityStaleTime);
    expect(first).toEqual([profile]);
    expect(second).toEqual([profile]);
    expect(listVoiceProfiles).toHaveBeenCalledTimes(1);
  });
});
