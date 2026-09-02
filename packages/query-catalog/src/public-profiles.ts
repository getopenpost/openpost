import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type PublicProfile = components["schemas"]["PublicProfileOutputBody"];

export interface PublicProfileQueryAPI {
  getPublicProfile(username: string, signal: AbortSignal): Promise<PublicProfile>;
}

export function normalizePublicProfileUsername(username: string): string {
  const trimmed = username.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

export const publicProfileQueryKeys = {
  all: () => ["openpost", "v1", "public-profile"] as const,
  detail: (username: string) =>
    [...publicProfileQueryKeys.all(), normalizePublicProfileUsername(username)] as const,
};

export function publicProfileQueryOptions(
  api: Pick<PublicProfileQueryAPI, "getPublicProfile">,
  username: string,
) {
  const normalizedUsername = normalizePublicProfileUsername(username);
  const queryKey = publicProfileQueryKeys.detail(normalizedUsername);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(normalizedUsername),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getPublicProfile(normalizedUsername, signal),
  };
}
