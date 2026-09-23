import { describe, expect, it } from "vitest";
import * as root from "../index";
import { MockOpenPost } from "./index";
import { OpenPostError } from "../errors";

const INPUT = {
  workspace_id: "ws-1",
  title: "Launch",
  content_profile: "short_text",
  source_text: "We shipped.",
  social_account_ids: ["acc-a", "acc-b"],
};

describe("MockOpenPost", () => {
  it("stays out of the package root so browser bundles never carry it", () => {
    expect("MockOpenPost" in root).toBe(false);
  });

  it("publishes immediately and records history", async () => {
    const mock = new MockOpenPost("immediate-success");
    const draft = await mock.publications.create({ ...INPUT });
    expect(draft.id).toBe("pub-1");
    expect(draft.renditions).toHaveLength(2);
    const action = await mock.publications.publishNow(draft.id, draft.revision);
    expect(action.job_id).toBe("job-1");
    const done = await mock.publications.wait(draft.id, { timeoutMs: 1000, intervalMs: 10 });
    expect(done.status).toBe("published");
    expect(done.renditions.every((rendition) => rendition.external_id)).toBe(true);
    const job = await mock.jobs.wait(action.job_id!, { timeoutMs: 1000, intervalMs: 10 });
    expect(job.status).toBe("completed");
    const operations = mock.history().map((entry) => entry.operation);
    expect(operations).toContain("publications.publishNow");
    expect(mock.history()[0]?.sequence).toBe(1);
  });

  it("holds processing work until advance", async () => {
    const mock = new MockOpenPost("processing-then-success");
    const draft = await mock.publications.create({ ...INPUT });
    await mock.publications.publishNow(draft.id, draft.revision);
    await expect(
      mock.publications.wait(draft.id, { timeoutMs: 30, intervalMs: 5 }),
    ).rejects.toMatchObject({ code: "timeout" });
    mock.advance();
    const done = await mock.publications.wait(draft.id, { timeoutMs: 1000, intervalMs: 5 });
    expect(done.status).toBe("published");
  });

  it("models partial failure and recovery through retryFailed", async () => {
    const mock = new MockOpenPost("mixed-success-failure");
    const draft = await mock.publications.create({ ...INPUT });
    await mock.publications.publishNow(draft.id, draft.revision);
    const done = await mock.publications.wait(draft.id, { timeoutMs: 1000, intervalMs: 5 });
    expect(done.status).toBe("failed");
    expect(done.renditions[0]?.status).toBe("published");
    expect(done.renditions[1]?.status).toBe("failed");
    const retried = await mock.publications.retryFailed(done.id);
    expect(retried.revision).toBeGreaterThan(done.revision);
    const recovered = await mock.publications.get(done.id);
    expect(recovered.status).toBe("published");
  });

  it("surfaces rate limits, expired auth, and lost confirmations distinctly", async () => {
    const limited = new MockOpenPost("rate-limited");
    const draft = await limited.publications.create({ ...INPUT });
    const rateError = await limited.publications
      .publishNow(draft.id, draft.revision)
      .catch((error: unknown) => error);
    expect(rateError).toBeInstanceOf(OpenPostError);
    expect((rateError as OpenPostError).code).toBe("rate_limited");
    expect((rateError as OpenPostError).disposition).toBe("after-delay");
    expect((rateError as OpenPostError).retryAfterMs).toBe(1000);

    const expired = new MockOpenPost("reconnect-required");
    const stale = await expired.publications.create({ ...INPUT });
    const authError = await expired.publications
      .publishNow(stale.id, stale.revision)
      .catch((error: unknown) => error);
    expect((authError as OpenPostError).code).toBe("unauthorized");
    expect((authError as OpenPostError).disposition).toBe("after-reconnect");

    const ambiguous = new MockOpenPost("ambiguous-accept");
    const lost = await ambiguous.publications.create({ ...INPUT });
    const lostError = await ambiguous.publications
      .publishNow(lost.id, lost.revision)
      .catch((error: unknown) => error);
    expect((lostError as OpenPostError).code).toBe("ambiguous");
    expect((lostError as OpenPostError).disposition).toBe("reconcile-first");
    expect((lostError as OpenPostError).retryable).toBe(false);
  });

  it("resets counters and history", async () => {
    const mock = new MockOpenPost();
    await mock.publications.create({ ...INPUT });
    mock.reset();
    expect(mock.history()).toEqual([]);
    const draft = await mock.publications.create({ ...INPUT });
    expect(draft.id).toBe("pub-1");
  });

  it("rejects stale revisions with a conflict", async () => {
    const mock = new MockOpenPost();
    const draft = await mock.publications.create({ ...INPUT });
    await expect(mock.publications.publishNow(draft.id, draft.revision + 1)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
