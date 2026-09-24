import { describe, expect, it } from "vitest";
import { MockOpenPost } from "./index";

const INPUT = {
  workspace_id: "ws-1",
  title: "Launch",
  content_profile: "short_text",
  source_text: "We shipped.",
  social_account_ids: ["acc-a", "acc-b"],
};

describe("MockOpenPost", () => {
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
});
