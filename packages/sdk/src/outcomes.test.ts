import { describe, expect, it } from "vitest";
import { describeRendition, summarizePublication } from "./outcomes";
import type { Publication, Rendition } from "./types";

function rendition(overrides: Partial<Rendition> = {}): Rendition {
  return {
    id: "r1",
    social_account_id: "acc_1",
    platform: "x",
    profile: "short_text",
    body: "hello",
    title: "",
    description: "",
    settings: {},
    status: "draft",
    ...overrides,
  };
}

function publication(statuses: Array<Rendition["status"]>): Publication {
  return {
    id: "pub-1",
    workspace_id: "ws-1",
    created_by: "u-1",
    creation_source: "sdk",
    title: "t",
    intent: "",
    content_profile: "short_text",
    source_text: "hello",
    status: "publishing",
    revision: 2,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    renditions: statuses.map((status, index) => {
      const row = rendition({ id: `r${index}`, status });
      if (status === "published") {
        row.external_id = `post-${index}`;
        row.external_url = `https://mock.test/posts/post-${index}`;
      }
      if (status === "failed") row.error_message = "rejected";
      return row;
    }),
  };
}

describe("describeRendition", () => {
  it("passes draft, ready, scheduled, and publishing through untouched", () => {
    for (const status of ["draft", "ready", "scheduled", "publishing"] as const) {
      const outcome = describeRendition(rendition({ status }));
      expect(outcome.state).toBe(status);
      expect(outcome.disposition).toBe("never");
      expect(outcome.retryable).toBe(false);
    }
  });

  it("requires a native id before reporting published", () => {
    expect(
      describeRendition(
        rendition({ status: "published", external_id: "post-1", external_url: "https://x.test/1" }),
      ).state,
    ).toBe("published");
    const unknown = describeRendition(rendition({ status: "published" }));
    expect(unknown.state).toBe("unknown");
    expect(unknown.disposition).toBe("reconcile-first");
  });

  it("maps failed renditions to dispositions", () => {
    const retryable = describeRendition(
      rendition({ status: "failed", error_message: "boom", error_retryable: true }),
    );
    expect(retryable.state).toBe("failed");
    expect(retryable.disposition).toBe("after-delay");
    expect(retryable.retryable).toBe(true);

    const auth = describeRendition(
      rendition({ status: "failed", error_message: "expired", error_http_status: 401 }),
    );
    expect(auth.disposition).toBe("after-reconnect");

    const terminal = describeRendition(rendition({ status: "failed", error_message: "rejected" }));
    expect(terminal.disposition).toBe("never");
  });

  it("treats a failed rendition with no error detail as unknown", () => {
    const outcome = describeRendition(rendition({ status: "failed" }));
    expect(outcome.state).toBe("unknown");
    expect(outcome.disposition).toBe("reconcile-first");
  });
});

describe("summarizePublication", () => {
  it("reports complete only when every rendition is published", () => {
    const summary = summarizePublication(publication(["published", "published"]));
    expect(summary.outcomes.every((outcome) => outcome.state === "published")).toBe(true);
    expect(summary.status).toBe("complete");
  });

  it("reports partial when destinations disagree", () => {
    const summary = summarizePublication(publication(["published", "failed", "draft"]));
    expect(summary.status).toBe("partial");
    expect(summary.published).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.unknown).toBe(0);
    expect(summary.pending).toBe(1);
  });

  it("reports pending when nothing has settled", () => {
    expect(summarizePublication(publication(["draft", "ready"])).status).toBe("pending");
    expect(summarizePublication(publication([])).status).toBe("pending");
  });
});
