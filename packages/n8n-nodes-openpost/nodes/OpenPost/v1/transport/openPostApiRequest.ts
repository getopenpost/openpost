import type { IExecuteFunctions, IHttpRequestOptions, IN8nHttpFullResponse } from "n8n-workflow";
import { sleep } from "n8n-workflow";

import { shouldRetryOpenPost } from "../actions/mapper";
import { toOpenPostNodeError } from "../errors";

const credentialsType = "openPostApi";

export async function openPostApiRequest(
  context: IExecuteFunctions,
  options: IHttpRequestOptions,
  retry: { idempotency: string; maxAttempts?: number } = { idempotency: "none" },
): Promise<IN8nHttpFullResponse> {
  const maxAttempts = retry.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return (await context.helpers.httpRequestWithAuthentication.call(
        context,
        credentialsType,
        options,
      )) as IN8nHttpFullResponse;
    } catch (error) {
      lastError = error;
      const statusCode = responseStatus(error);
      if (
        attempt >= maxAttempts ||
        !shouldRetryOpenPost({
          method: options.method ?? "GET",
          statusCode,
          error,
          idempotency: retry.idempotency,
        })
      ) {
        throw toOpenPostNodeError(context.getNode(), error);
      }
      await delay(retryDelayMs(error, attempt));
    }
  }
  throw toOpenPostNodeError(context.getNode(), lastError);
}

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { statusCode?: number; status?: number } }).response;
  return response?.statusCode ?? response?.status;
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfter = retryAfterHeader(error);
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(250 * 2 ** (attempt - 1), 2000);
}

function retryAfterHeader(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const headers = (error as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  if (!headers) return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after");
  if (!entry) return "";
  return Array.isArray(entry[1]) ? String(entry[1][0] ?? "") : String(entry[1] ?? "");
}

function delay(ms: number) {
  return sleep(ms);
}
