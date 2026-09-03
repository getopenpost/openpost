export interface OpenPostQueryErrorOptions {
  status?: number;
  detail?: string;
  cause?: unknown;
}

export class OpenPostQueryError extends Error {
  readonly status: number | undefined;
  readonly detail: string;

  constructor(message: string, options: OpenPostQueryErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenPostQueryError";
    this.status = options.status;
    this.detail = options.detail?.trim() || message;
  }
}

export function createOpenPostQueryError(
  status: number | undefined,
  problem: unknown,
  fallback: string,
): OpenPostQueryError {
  const detail = problemDetail(problem) || fallback;
  return new OpenPostQueryError(detail, {
    ...(status === undefined ? {} : { status }),
    detail,
    cause: problem,
  });
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || isAbortError(error)) return false;
  if (error instanceof TypeError) return true;
  if (!(error instanceof OpenPostQueryError) || error.status === undefined) return false;
  return [408, 425, 429].includes(error.status) || (error.status >= 500 && error.status <= 599);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function problemDetail(problem: unknown): string {
  if (!problem || typeof problem !== "object" || !("detail" in problem)) return "";
  return typeof problem.detail === "string" ? problem.detail.trim() : "";
}
