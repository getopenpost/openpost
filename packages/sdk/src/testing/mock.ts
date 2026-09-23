import { OpenPostError } from "../errors.js";
import type {
  CreatePublicationInput,
  Job,
  Publication,
  PublicationAction,
  PublicationEvent,
  PublicationValidation,
  Rendition,
  RenditionInput,
  UpdatePublicationInput,
  WaitOptions,
} from "../types.js";
import { resolveWaitOptions } from "../wait.js";

// Scenarios map one-to-one to the failure modes automation must handle:
// success, async processing, partial failure, throttling, expired auth,
// and a lost confirmation that must be reconciled instead of retried.
export type MockScenario =
  | "immediate-success"
  | "processing-then-success"
  | "mixed-success-failure"
  | "rate-limited"
  | "reconnect-required"
  | "ambiguous-accept";

export interface MockHistoryEntry {
  sequence: number;
  operation: string;
  publicationId?: string;
}

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

function mockRendition(publicationId: string, accountId: string, index: number): Rendition {
  return {
    id: `${publicationId}-r${index}`,
    social_account_id: accountId,
    platform: "mock",
    profile: "short_text",
    body: "",
    title: "",
    description: "",
    settings: {},
    status: "draft",
  };
}

function applyInputs(overrides: RenditionInput[], renditions: Rendition[]): void {
  for (const override of overrides) {
    const target = renditions.find(
      (rendition) => rendition.social_account_id === override.social_account_id,
    );
    if (!target) continue;
    if (override.body !== undefined) target.body = override.body;
    if (override.title !== undefined) target.title = override.title;
    if (override.description !== undefined) target.description = override.description;
    if (override.settings !== undefined) target.settings = override.settings;
  }
}

export class MockPublications {
  constructor(private readonly mock: MockOpenPost) {}

  async list(): Promise<Publication[]> {
    this.mock.record("publications.list");
    return [...this.mock.store.values()];
  }

  async get(id: string): Promise<Publication> {
    this.mock.record("publications.get", id);
    const found = this.mock.store.get(id);
    if (!found) {
      throw new OpenPostError(`Publication ${id} not found`, { code: "not_found" });
    }
    return structuredClone(found);
  }

  async create(input: CreatePublicationInput): Promise<Publication> {
    this.mock.record("publications.create");
    const id = `pub-${this.mock.nextPublication()}`;
    const accountIds =
      input.social_account_ids ??
      (input.renditions ?? []).map((rendition) => rendition.social_account_id);
    const publication: Publication = {
      id,
      workspace_id: input.workspace_id,
      created_by: "mock-user",
      creation_source: "sdk",
      title: input.title,
      intent: input.intent ?? "",
      content_profile: input.content_profile,
      source_text: input.source_text,
      ...(input.source_url !== undefined ? { source_url: input.source_url } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.audience !== undefined ? { audience: input.audience } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      status: "draft",
      revision: 1,
      ...(input.scheduled_at !== undefined ? { scheduled_at: input.scheduled_at } : {}),
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      renditions: (accountIds.length > 0 ? accountIds : ["acc_mock"]).map((accountId, index) =>
        mockRendition(id, accountId, index),
      ),
    };
    applyInputs(input.renditions ?? [], publication.renditions);
    this.mock.store.set(id, publication);
    return structuredClone(publication);
  }

  async update(id: string, input: UpdatePublicationInput): Promise<Publication> {
    const current = await this.get(id);
    this.mock.record("publications.update", id);
    if (input.expected_revision !== current.revision && !input.force) {
      throw new OpenPostError(`Revision conflict for publication ${id}`, {
        code: "conflict",
      });
    }
    const next: Publication = {
      ...current,
      title: input.title ?? current.title,
      revision: current.revision + 1,
      updated_at: FIXED_NOW,
    };
    this.mock.store.set(id, next);
    return structuredClone(next);
  }

  async remove(id: string, expectedRevision: number): Promise<PublicationAction> {
    const current = await this.get(id);
    this.mock.record("publications.remove", id);
    if (expectedRevision !== current.revision) {
      throw new OpenPostError(`Revision conflict for publication ${id}`, {
        code: "conflict",
      });
    }
    this.mock.store.delete(id);
    return { message: `Publication ${id} removed` };
  }

  async validate(id: string): Promise<PublicationValidation> {
    await this.get(id);
    this.mock.record("publications.validate", id);
    return { valid: true, issues: [] };
  }

  async schedule(id: string, expectedRevision: number): Promise<PublicationAction> {
    const current = await this.get(id);
    this.mock.record("publications.schedule", id);
    this.mock.checkRevision(current, expectedRevision);
    current.status = "scheduled";
    current.revision += 1;
    for (const rendition of current.renditions) rendition.status = "scheduled";
    this.mock.store.set(id, current);
    return { message: `Publication ${id} scheduled`, revision: current.revision };
  }

  async publishNow(id: string, expectedRevision: number): Promise<PublicationAction> {
    const current = await this.get(id);
    this.mock.record("publications.publishNow", id);
    this.mock.checkRevision(current, expectedRevision);
    switch (this.mock.scenario) {
      case "rate-limited":
        throw new OpenPostError("Mock rate limit exceeded", {
          code: "rate_limited",
          retryAfterMs: 1000,
        });
      case "reconnect-required":
        throw new OpenPostError("Mock account needs reconnect", { code: "unauthorized" });
      case "ambiguous-accept":
        throw new OpenPostError(
          `Publication ${id} may have been accepted; confirmation was lost. Re-read it before retrying.`,
          { code: "ambiguous" },
        );
      case "processing-then-success":
        current.status = "publishing";
        current.revision += 1;
        for (const rendition of current.renditions) rendition.status = "publishing";
        break;
      case "mixed-success-failure": {
        current.status = "failed";
        current.revision += 1;
        current.renditions.forEach((rendition, index) => {
          if (index === 0) {
            rendition.status = "published";
            rendition.external_id = `mock-post-${id}-0`;
            rendition.external_url = `https://mock.test/posts/mock-post-${id}-0`;
          } else {
            rendition.status = "failed";
            rendition.error_message = "Mock provider rejected the rendition";
            rendition.error_kind = "provider";
            rendition.error_retryable = true;
          }
        });
        break;
      }
      case "immediate-success":
        current.status = "published";
        current.revision += 1;
        current.renditions.forEach((rendition, index) => {
          rendition.status = "published";
          rendition.external_id = `mock-post-${id}-${index}`;
          rendition.external_url = `https://mock.test/posts/mock-post-${id}-${index}`;
        });
        break;
    }
    this.mock.store.set(id, current);
    const jobId = `job-${this.mock.nextJob()}`;
    const failed = current.status === "failed";
    this.mock.jobStore.set(jobId, {
      id: jobId,
      type: "publish_publication",
      status: failed ? "failed" : "completed",
      ...(failed ? { last_error: "One or more renditions failed" } : {}),
    });
    return { message: `Publication ${id} publishing`, job_id: jobId, revision: current.revision };
  }

  async cancel(id: string, expectedRevision: number): Promise<PublicationAction> {
    const current = await this.get(id);
    this.mock.record("publications.cancel", id);
    this.mock.checkRevision(current, expectedRevision);
    current.status = "draft";
    current.revision += 1;
    for (const rendition of current.renditions) {
      if (rendition.status !== "published") rendition.status = "draft";
    }
    this.mock.store.set(id, current);
    return { message: `Publication ${id} cancelled`, revision: current.revision };
  }

  async retryFailed(id: string): Promise<PublicationAction> {
    const current = await this.get(id);
    this.mock.record("publications.retryFailed", id);
    let retried = 0;
    current.renditions.forEach((rendition, index) => {
      if (rendition.status !== "failed") return;
      retried += 1;
      rendition.status = "published";
      rendition.external_id = `mock-post-${id}-${index}`;
      rendition.external_url = `https://mock.test/posts/mock-post-${id}-${index}`;
      delete rendition.error_message;
      delete rendition.error_retryable;
    });
    if (retried > 0) {
      current.status = current.renditions.every((rendition) => rendition.status === "published")
        ? "published"
        : "failed";
      current.revision += 1;
      this.mock.store.set(id, current);
    }
    return { message: `Retried ${retried} rendition(s)`, revision: current.revision };
  }

  async events(id: string): Promise<PublicationEvent[]> {
    await this.get(id);
    this.mock.record("publications.events", id);
    return [];
  }

  async upsertRenditions(
    id: string,
    expectedRevision: number,
    renditions: RenditionInput[],
  ): Promise<Publication> {
    const current = await this.get(id);
    this.mock.record("publications.upsertRenditions", id);
    this.mock.checkRevision(current, expectedRevision);
    applyInputs(renditions, current.renditions);
    current.revision += 1;
    this.mock.store.set(id, current);
    return structuredClone(current);
  }

  // wait polls the stored publication until it reaches a terminal status.
  // Only the processing scenario stays non-terminal until advance().
  async wait(id: string, options: WaitOptions = {}): Promise<Publication> {
    const { timeoutMs, intervalMs } = resolveWaitOptions(options);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const publication = await this.get(id);
      if (publication.status === "published" || publication.status === "failed") {
        return publication;
      }
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

export class MockJobs {
  constructor(private readonly mock: MockOpenPost) {}

  async list(): Promise<Job[]> {
    this.mock.record("jobs.list");
    return [...this.mock.jobStore.values()];
  }

  async get(id: string): Promise<Job> {
    this.mock.record("jobs.get", id);
    const found = this.mock.jobStore.get(id);
    if (!found) {
      throw new OpenPostError(`Job ${id} not found`, { code: "not_found" });
    }
    return structuredClone(found);
  }

  async wait(id: string, options: WaitOptions = {}): Promise<Job> {
    const { timeoutMs, intervalMs } = resolveWaitOptions(options);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.get(id);
      if (job.status === "completed") return job;
      if (job.status === "failed") {
        throw new OpenPostError(`Job ${id} failed${job.last_error ? `: ${job.last_error}` : ""}`, {
          code: "operation_failed",
          details: job,
        });
      }
      if (Date.now() >= deadline) {
        throw new OpenPostError(`Timed out waiting for job ${id} (still ${job.status})`, {
          code: "timeout",
          details: { status: job.status },
        });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())),
      );
    }
  }
}

// MockOpenPost is a deterministic fake of the OpenPost API surface used by
// automation. It runs no network, uses fixed ids and timestamps, and steers
// publish behavior through one scenario string plus the advance() latch.
export class MockOpenPost {
  readonly publications = new MockPublications(this);
  readonly jobs = new MockJobs(this);
  readonly store = new Map<string, Publication>();
  readonly jobStore = new Map<string, Job>();
  scenario: MockScenario;
  private publicationCounter = 0;
  private jobCounter = 0;
  private historyEntries: MockHistoryEntry[] = [];

  constructor(scenario: MockScenario = "immediate-success") {
    this.scenario = scenario;
  }

  history(): MockHistoryEntry[] {
    return [...this.historyEntries];
  }

  reset(): void {
    this.store.clear();
    this.jobStore.clear();
    this.historyEntries = [];
    this.publicationCounter = 0;
    this.jobCounter = 0;
  }

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  // advance completes pending processing work, modelling async provider
  // pipelines without timers.
  advance(): void {
    this.record("advance");
    for (const publication of this.store.values()) {
      if (publication.status !== "publishing") continue;
      publication.status = "published";
      publication.renditions.forEach((rendition, index) => {
        rendition.status = "published";
        rendition.external_id = `mock-post-${publication.id}-${index}`;
        rendition.external_url = `https://mock.test/posts/mock-post-${publication.id}-${index}`;
      });
    }
  }

  record(operation: string, publicationId?: string): void {
    this.historyEntries.push({
      sequence: this.historyEntries.length + 1,
      operation,
      ...(publicationId !== undefined ? { publicationId } : {}),
    });
  }

  nextPublication(): number {
    this.publicationCounter += 1;
    return this.publicationCounter;
  }

  nextJob(): number {
    this.jobCounter += 1;
    return this.jobCounter;
  }

  checkRevision(publication: Publication, expectedRevision: number): void {
    if (expectedRevision !== publication.revision) {
      throw new OpenPostError(`Revision conflict for publication ${publication.id}`, {
        code: "conflict",
      });
    }
  }
}
