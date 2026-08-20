import { describe, expect, it } from "vitest";
import { BrowserTelemetry, type BrowserTelemetryConfig } from "./index";

class FakeSDK {
  events: Array<{ event: string; properties: Record<string, unknown> | undefined }> = [];
  init() {}
  capture(event: string, properties?: Record<string, unknown>) {
    this.events.push({ event, properties });
  }
  captureException() {}
  identify() {}
  register() {}
  reset() {}
  opt_out_capturing() {}
  get_distinct_id() {
    return "id";
  }
  get_session_id() {
    return "sess";
  }
}

const cfg: BrowserTelemetryConfig = {
  enabled: true,
  projectToken: "phc_test",
  apiHost: "https://e.example.com/",
  environment: "test",
  edition: "cloud",
  surface: "app",
};

describe("growth telemetry allowlisting", () => {
  it("allows only privacy-safe growth properties and drops IDs/handles", () => {
    const sdk = new FakeSDK();
    const t = new BrowserTelemetry(sdk as never, () => true);
    t.configure(cfg);

    t.capture("growth opened", { platform_count: 2 });
    expect(sdk.events[0]).toEqual({ event: "growth opened", properties: { platform_count: 2 } });

    t.capture("growth recommendation shown", {
      platform: "bluesky",
      rank_bucket: "1-3",
      mutual_count_bucket: "2-3",
      follows_viewer: true,
    });
    expect(sdk.events[1]?.properties).toEqual({
      platform: "bluesky",
      rank_bucket: "1-3",
      mutual_count_bucket: "2-3",
      follows_viewer: true,
    });

    // try to sneak sensitive fields: should be rejected (allowlist mismatch -> null)
    const before = sdk.events.length;
    // SAFETY: Negative test intentionally sends disallowed properties to verify allowlist rejection.
    (t.capture as unknown as (name: string, props: Record<string, unknown>) => void)(
      "growth recommendation shown",
      {
        platform: "bluesky",
        rank_bucket: "1-3",
        mutual_count_bucket: "2-3",
        follows_viewer: true,
        handle: "@jane",
        account_id: "acc-123",
        recommendation_id: "rec-1",
        bio: "secret bio",
        workspace_id: "ws-1",
      },
    );
    expect(sdk.events.length).toBe(before);

    // profile opened
    t.capture("growth profile opened", {
      platform: "mastodon",
      rank_bucket: "4-6",
      mutual_count_bucket: "0",
      follows_viewer: false,
    });
    expect(sdk.events[before]?.event).toBe("growth profile opened");
  });

  it("rejects growth events containing URLs or emails in property values", () => {
    const sdk = new FakeSDK();
    const t = new BrowserTelemetry(sdk as never, () => true);
    t.configure(cfg);
    // SAFETY: Negative test intentionally sends disallowed property to verify allowlist rejection.
    (t.capture as unknown as (name: string, props: Record<string, unknown>) => void)(
      "growth opened",
      {
        platform_count: 2,
        workspace_id: "ws-1",
      },
    );
    expect(sdk.events.length).toBe(0);

    t.capture("growth recommendation shown", {
      platform: "https://bsky.app/profile/jane",
      rank_bucket: "1-3",
      mutual_count_bucket: "2-3",
      follows_viewer: true,
    });
    expect(sdk.events.length).toBe(0);
  });
});
