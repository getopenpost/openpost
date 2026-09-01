import { shouldRetryQuery } from "./errors";

export const queryStaleTime = 30_000;
export const capabilityStaleTime = 5 * 60_000;
export const queryGarbageCollectionTime = 30 * 60_000;
export const queryRetryDelay = (attemptIndex: number) => Math.min(1_000 * 2 ** attemptIndex, 5_000);

export const openPostQueryDefaults = {
  queries: {
    staleTime: queryStaleTime,
    gcTime: queryGarbageCollectionTime,
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
    networkMode: "online" as const,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    throwOnError: false,
  },
  mutations: {
    retry: false as const,
    networkMode: "always" as const,
    throwOnError: false,
  },
};
