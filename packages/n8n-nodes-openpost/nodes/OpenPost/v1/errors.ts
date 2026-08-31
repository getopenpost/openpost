import type { INode } from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

export type OpenPostFullResponse = {
  body?: unknown;
  headers?: Record<string, unknown>;
  statusCode?: number;
  statusMessage?: string;
};

export function requestIdFromHeaders(headers: Record<string, unknown> | undefined): string {
  if (!headers) return "";
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-request-id")
      return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }
  return "";
}

export function formatOpenPostError(error: unknown): string {
  const response = errorResponse(error);
  const body = response?.body;
  const requestId = requestIdFromHeaders(response?.headers);
  const status = response?.statusCode ? `HTTP ${response.statusCode}` : "OpenPost request failed";
  const detail =
    body && typeof body === "object" && "detail" in body
      ? String((body as { detail?: unknown }).detail ?? "")
      : "";
  const title =
    body && typeof body === "object" && "title" in body
      ? String((body as { title?: unknown }).title ?? "")
      : "";
  const message = detail || title || (error instanceof Error ? error.message : String(error));
  return requestId ? `${status}: ${message} (X-Request-ID: ${requestId})` : `${status}: ${message}`;
}

export function toOpenPostNodeError(
  node: INode,
  error: unknown,
): NodeApiError | NodeOperationError {
  const response = errorResponse(error);
  if (response) {
    return new NodeApiError(node, response as never, { message: formatOpenPostError(error) });
  }
  return new NodeOperationError(node, formatOpenPostError(error));
}

function errorResponse(error: unknown): OpenPostFullResponse | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    response?: OpenPostFullResponse;
    cause?: { response?: OpenPostFullResponse };
  };
  return candidate.response ?? candidate.cause?.response;
}
