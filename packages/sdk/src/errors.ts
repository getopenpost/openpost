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
  | "ambiguous"
  | "timeout"
  | "network";

// Retry dispositions tell automation what to do next. `reconcile-first`
// means the request may have executed (for example the response was lost
// after dispatch): re-read state before retrying, never blind-retry.

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

export type OpenPostRetryDisposition =
  | "never"
  | "after-delay"
  | "after-reconnect"
  | "reconcile-first";

// dispositionFor maps an error code to structured retry guidance. HTTP
// mutations are never auto-retried by the client, so `timeout` and
// `network` mean after-delay only when the caller can prove idempotency
// (for example a read, or a write guarded by an idempotency key).
export function dispositionFor(code: OpenPostErrorCode): OpenPostRetryDisposition {
  switch (code) {
    case "rate_limited":
    case "server":
    case "timeout":
    case "network":
      return "after-delay";
    case "unauthorized":
      return "after-reconnect";
    case "ambiguous":
      return "reconcile-first";
    case "missing_config":
    case "forbidden":
    case "not_found":
    case "conflict":
    case "validation":
    case "operation_failed":
      return "never";
  }
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

  // Structured retry guidance derived from the code. `ambiguous` is never
  // retryable: reconcile first, then decide.
  get disposition(): OpenPostRetryDisposition {
    return dispositionFor(this.code);
  }

  toJSON(): {
    name: string;
    message: string;
    code: OpenPostErrorCode;
    status: number | undefined;
    retryAfterMs: number | undefined;
    disposition: OpenPostRetryDisposition;
    details: unknown;
  } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      retryAfterMs: this.retryAfterMs,
      disposition: this.disposition,
      details: this.details,
    };
  }
}
