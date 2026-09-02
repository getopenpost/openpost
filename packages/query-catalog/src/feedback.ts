import type { paths } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, stableQueryStaleTime } from "./policies";

export type FeedbackConfig =
  paths["/feedback/config"]["get"]["responses"][200]["content"]["application/json"];

export interface FeedbackQueryAPI {
  getFeedbackConfig(signal: AbortSignal): Promise<FeedbackConfig>;
}

export const feedbackQueryKeys = {
  configuration: () => ["openpost", "v1", "feedback", "configuration"] as const,
};

export function feedbackConfigQueryOptions(api: Pick<FeedbackQueryAPI, "getFeedbackConfig">) {
  const queryKey = feedbackQueryKeys.configuration();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getFeedbackConfig(signal),
  };
}
