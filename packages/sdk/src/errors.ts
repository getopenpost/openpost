export type OpenPostErrorCode =
  | "missing_config"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server"
  | "operation_failed"
  | "timeout"
  | "network";

export interface OpenPostErrorOptions {
  status?: number | undefined;
  code?: OpenPostErrorCode | undefined;
  details?: unknown;
  retryAfterMs?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

// The server speaks Huma problem details ({ title, detail }) on most routes
// while a few automation routes use { error, message }. Accept both shapes so
// callers get the human sentence instead of a bare HTTP status.
export function errorMessageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string") return body.slice(0, 300) || fallback;
  if (isRecord(body)) {
    const message = firstString(body, ["detail", "message", "error", "title"]);
    if (message !== "") return message;
  }
  return fallback;
}

export function inferCode(status: number | undefined, body: unknown): OpenPostErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 400) {
    if (isRecord(body) && Array.isArray(body["issues"])) return "validation";
    return "validation";
  }
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500) return "server";
  return "network";
}

export function retryAfterMsFromHeaders(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter === null) return undefined;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds, 60) * 1000;
}

export class OpenPostError extends Error {
  readonly status: number | undefined;
  readonly code: OpenPostErrorCode;
  readonly details: unknown;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: OpenPostErrorOptions = {}) {
    super(message);
    this.name = "OpenPostError";
    this.status = options.status;
    this.code = options.code ?? inferCode(options.status, options.details);
    this.details = options.details;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "server" ||
      this.code === "timeout" ||
      this.code === "network"
    );
  }
}
