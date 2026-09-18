import {
  OpenPostError,
  errorMessageFromBody,
  inferCode,
  retryAfterMsFromHeaders,
} from "./errors.js";
import { SDK_VERSION } from "./version.js";

export interface OpenPostClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  // Allow bearer credentials over cleartext HTTP. Default is HTTPS-only:
  // self-hosted HTTP origins need this explicit opt-in per call site.
  allowInsecureHttp?: boolean;
}

export type QueryValue = string | number | boolean | undefined | null;

interface RequestOptions {
  method?: string;
  path?: string;
  url?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  // Storage upload targets may live on another host; those requests must not
  // carry the API bearer token.
  auth?: boolean;
  rawBody?: BodyInit;
  contentType?: string;
}

function env(name: string): string | undefined {
  try {
    const value = globalThis.process?.env?.[name];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function byteSize(body: Uint8Array | ArrayBuffer | Blob): number {
  if (body instanceof Blob) return body.size;
  if (body instanceof Uint8Array) return body.byteLength;
  return body.byteLength;
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  private readonly allowInsecureHttp: boolean;

  constructor(options: OpenPostClientOptions = {}) {
    const baseUrl =
      options.baseUrl ?? env("OPENPOST_URL") ?? env("OPENPOST_INSTANCE") ?? "https://app.openpo.st";
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = options.token ?? env("OPENPOST_TOKEN");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
  }

  requireToken(): string {
    if (!this.token) {
      throw new OpenPostError(
        "Missing API token. Pass token or set OPENPOST_TOKEN (mint one under API tokens in OpenPost).",
        { code: "missing_config" },
      );
    }
    return this.token;
  }

  get(path: string, options: Omit<RequestOptions, "method" | "path"> = {}): Promise<unknown> {
    return this.request({ ...options, method: "GET", path });
  }

  post(
    path: string,
    body: unknown,
    options: Omit<RequestOptions, "method" | "path" | "body"> = {},
  ): Promise<unknown> {
    return this.request({ ...options, method: "POST", path, body });
  }

  put(
    path: string,
    body: unknown,
    options: Omit<RequestOptions, "method" | "path" | "body"> = {},
  ): Promise<unknown> {
    return this.request({ ...options, method: "PUT", path, body });
  }

  patch(
    path: string,
    body: unknown,
    options: Omit<RequestOptions, "method" | "path" | "body"> = {},
  ): Promise<unknown> {
    return this.request({ ...options, method: "PATCH", path, body });
  }

  delete(path: string, options: Omit<RequestOptions, "method" | "path"> = {}): Promise<unknown> {
    return this.request({ ...options, method: "DELETE", path });
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  // Origin of the configured API. Bearer credentials are only ever sent to
  // this origin; anything else fails closed before the token leaves.
  private apiOrigin(): string {
    return new URL(this.baseUrl).origin;
  }

  // requireSameOrigin keeps server-provided URLs honest: a completion or API
  // target on another origin never receives this client's bearer token.
  private requireSameOrigin(url: string): void {
    if (new URL(url).origin !== this.apiOrigin()) {
      throw new OpenPostError(
        `Refusing to send credentials to ${new URL(url).origin}: outside the configured API origin.`,
        { code: "missing_config" },
      );
    }
  }

  // requireSecureTarget rejects cleartext HTTP for credentialed requests
  // unless the caller opted in. Self-hosted HTTP origins stay possible, but
  // never by accident.
  private requireSecureTarget(url: string): void {
    const target = new URL(url);
    if (target.protocol === "http:" && !this.allowInsecureHttp) {
      throw new OpenPostError(
        `Refusing to send credentials over cleartext HTTP to ${target.host}. ` +
          `Use an HTTPS origin or pass allowInsecureHttp for self-hosted HTTP.`,
        { code: "missing_config" },
      );
    }
  }

  // putBytes uploads raw bytes to a storage target. External targets receive
  // only the caller-supplied headers; the API token never leaves the API
  // origin. Internal API targets opt into the bearer token explicitly,
  // because the session content route requires authentication.
  async putBytes(
    url: string,
    body: Uint8Array | ArrayBuffer | Blob,
    options: {
      method?: string;
      headers?: Record<string, string>;
      mimeType?: string;
      auth?: boolean;
    } = {},
  ): Promise<void> {
    // Absolute storage targets are validated even without credentials: an
    // http: presigned URL would otherwise carry user bytes over cleartext.
    if (url.startsWith("http")) this.requireSecureTarget(url);
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.auth) {
      this.requireSameOrigin(url);
      this.requireSecureTarget(url);
      headers["Authorization"] = `Bearer ${this.requireToken()}`;
    }
    if (options.mimeType && !headers["Content-Type"]) headers["Content-Type"] = options.mimeType;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: options.method ?? "PUT",
        headers,
        body: body as BodyInit,
      });
    } catch (error) {
      throw new OpenPostError(`Upload failed: ${messageOf(error)}`, {
        code: "network",
        details: { cause: String(error) },
      });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenPostError(
        `Upload failed with HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        { status: response.status, code: inferCode(response.status, text) },
      );
    }
  }

  // Byte size helper for upload-session size declarations.
  static sizeOf(body: Uint8Array | ArrayBuffer | Blob): number {
    return byteSize(body);
  }

  private async request(options: RequestOptions, attempt = 0): Promise<unknown> {
    const method = options.method ?? "GET";
    const url = options.url ?? this.buildUrl(options.path ?? "/", options.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `openpost-sdk/${SDK_VERSION}`,
      ...(options.headers ?? {}),
    };
    if (options.auth !== false) {
      this.requireSameOrigin(url);
      this.requireSecureTarget(url);
      headers["Authorization"] = `Bearer ${this.requireToken()}`;
    }

    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      if (options.contentType) headers["Content-Type"] = options.contentType;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      response = await this.fetchWithTimeout(url, init);
    } catch (error) {
      if (error instanceof OpenPostError) throw error;
      throw new OpenPostError(`Network error: ${messageOf(error)}`, {
        code: "network",
        details: { cause: String(error) },
      });
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const details = parsed ?? { status: response.status, body: text.slice(0, 300) };
      const code = inferCode(response.status, parsed);
      const retryAfterMs = retryAfterMsFromHeaders(response.headers);
      if (this.shouldRetry(response.status, attempt, method)) {
        await sleep(retryAfterMs ?? (attempt === 0 ? 400 : 1200));
        return this.request(options, attempt + 1);
      }
      throw new OpenPostError(
        errorMessageFromBody(parsed, text ? text.slice(0, 300) : `HTTP ${response.status}`),
        {
          status: response.status,
          code,
          details,
          retryAfterMs,
        },
      );
    }
    return parsed;
  }

  // Only idempotent reads are retried. Replaying a mutation (create,
  // schedule, publish) after a 5xx or 429 could execute it twice, and not
  // every mutation endpoint accepts an Idempotency-Key.
  private shouldRetry(status: number, attempt: number, method: string): boolean {
    if (method !== "GET" || attempt >= 1) return false;
    return status === 429 || status >= 500;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenPostError(`Request timed out after ${this.timeoutMs}ms`, { code: "timeout" });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
