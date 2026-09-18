import type { HttpClient, QueryValue } from "../client.js";
import type {
  CreatePublicationInput,
  ListPublicationsQuery,
  Publication,
  PublicationAction,
  PublicationEvent,
  PublicationValidation,
  RenditionInput,
  UpdatePublicationInput,
  WaitOptions,
} from "../types.js";
import { OpenPostError } from "../errors.js";

const TERMINAL_STATUSES = new Set(["published", "failed"]);

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export class Publications {
  constructor(private readonly http: HttpClient) {}

  async list(query: ListPublicationsQuery = {}): Promise<Publication[]> {
    const params: Record<string, QueryValue> = {
      workspace_id: query.workspace_id,
      status: query.status,
      activity_bucket: query.activity_bucket,
      content_profile: query.content_profile,
      platform: query.platform,
      calendar_from: query.calendar_from,
      calendar_before: query.calendar_before,
      limit: query.limit,
      offset: query.offset,
    };
    return (await this.http.get("/api/v1/publications", { query: params })) as Publication[];
  }

  async get(id: string): Promise<Publication> {
    return (await this.http.get(`/api/v1/publications/${encodeId(id)}`)) as Publication;
  }

  async create(input: CreatePublicationInput): Promise<Publication> {
    return (await this.http.post("/api/v1/publications", input)) as Publication;
  }

  async update(id: string, input: UpdatePublicationInput): Promise<Publication> {
    return (await this.http.put(`/api/v1/publications/${encodeId(id)}`, input)) as Publication;
  }

  // Delete requires an explicit confirmation plus the revision the caller
  // saw, so a stale automation cannot remove a publication it never read.
  async remove(id: string, expectedRevision: number): Promise<PublicationAction> {
    return (await this.http.delete(
      `/api/v1/publications/${encodeId(id)}?confirm=true&expected_revision=${expectedRevision}`,
    )) as PublicationAction;
  }

  async validate(
    id: string,
    options: { throwOnInvalid?: boolean } = {},
  ): Promise<PublicationValidation> {
    const result = (await this.http.post(
      `/api/v1/publications/${encodeId(id)}/validate`,
      {},
    )) as PublicationValidation;
    if (options.throwOnInvalid && !result.valid) {
      const detail =
        result.issues.map((issue) => issue.message).join("; ") || "Publication is invalid";
      throw new OpenPostError(detail, { code: "validation", details: result });
    }
    return result;
  }

  async schedule(id: string, expectedRevision: number): Promise<PublicationAction> {
    return (await this.http.post(`/api/v1/publications/${encodeId(id)}/schedule`, {
      expected_revision: expectedRevision,
    })) as PublicationAction;
  }

  async publishNow(id: string, expectedRevision: number): Promise<PublicationAction> {
    return (await this.http.post(`/api/v1/publications/${encodeId(id)}/publish-now`, {
      expected_revision: expectedRevision,
    })) as PublicationAction;
  }

  async cancel(id: string, expectedRevision: number): Promise<PublicationAction> {
    return (await this.http.post(`/api/v1/publications/${encodeId(id)}/cancel`, {
      expected_revision: expectedRevision,
    })) as PublicationAction;
  }

  async retryFailed(id: string): Promise<PublicationAction> {
    return (await this.http.post(
      `/api/v1/publications/${encodeId(id)}/retry-failed`,
      {},
    )) as PublicationAction;
  }

  async events(id: string, limit?: number): Promise<PublicationEvent[]> {
    const params: Record<string, QueryValue> = { limit };
    return (await this.http.get(`/api/v1/publications/${encodeId(id)}/events`, {
      query: params,
    })) as PublicationEvent[];
  }

  async upsertRenditions(
    id: string,
    expectedRevision: number,
    renditions: RenditionInput[],
  ): Promise<Publication> {
    return (await this.http.put(`/api/v1/publications/${encodeId(id)}/renditions`, {
      expected_revision: expectedRevision,
      renditions,
    })) as Publication;
  }

  // targetKey selects the provider subdestination. The server answers 409
  // when an account has multiple destinations and none is given.
  async deleteRendition(
    id: string,
    accountId: string,
    expectedRevision: number,
    targetKey?: string,
  ): Promise<PublicationAction> {
    const params = new URLSearchParams({
      confirm: "true",
      expected_revision: String(expectedRevision),
    });
    if (targetKey) params.set("target_key", targetKey);
    return (await this.http.delete(
      `/api/v1/publications/${encodeId(id)}/renditions/${encodeId(accountId)}?${params}`,
    )) as PublicationAction;
  }

  async retryRendition(
    id: string,
    accountId: string,
    targetKey?: string,
  ): Promise<PublicationAction> {
    const params = new URLSearchParams();
    if (targetKey) params.set("target_key", targetKey);
    const suffix = params.size > 0 ? `?${params}` : "";
    return (await this.http.post(
      `/api/v1/publications/${encodeId(id)}/renditions/${encodeId(accountId)}/retry${suffix}`,
      {},
    )) as PublicationAction;
  }

  // wait polls the publication until it reaches a terminal status. Use it
  // after schedule or publishNow when the caller needs the outcome.
  async wait(id: string, options: WaitOptions = {}): Promise<Publication> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const publication = await this.get(id);
      if (TERMINAL_STATUSES.has(publication.status)) return publication;
      if (Date.now() >= deadline) {
        throw new OpenPostError(
          `Timed out waiting for publication ${id} (still ${publication.status})`,
          { code: "timeout", details: { status: publication.status } },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())),
      );
    }
  }
}
