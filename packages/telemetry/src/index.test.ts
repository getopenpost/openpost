import { describe, expect, it, vi } from "vitest";
import {
  applyTelemetryRequestHeaders,
  BrowserTelemetry,
  configureTelemetry,
  installGlobalErrorCapture,
  type BrowserTelemetryConfig,
  type TelemetryPreference,
} from "./index";

const globalSDK = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  opt_out_capturing: vi.fn(),
  get_distinct_id: vi.fn(() => "browser-user-1"),
  get_session_id: vi.fn(() => "session-1"),
}));

vi.mock("posthog-js", () => ({ default: globalSDK }));

class FakeSDK {
  initialized: Array<{ token: string; options: Record<string, unknown> }> = [];
  events: Array<{
    event: string;
    properties: Record<string, unknown> | undefined;
  }> = [];
  exceptions: Array<{
    error: Error;
    properties: Record<string, unknown> | undefined;
  }> = [];
  identified: string[] = [];
  registered: Record<string, unknown>[] = [];
  resetCount = 0;
  optOutCount = 0;
  distinctID = "browser-user-1";
  sessionID = "session-1";

  init(token: string, options: Record<string, unknown>) {
    this.initialized.push({ token, options });
  }
  capture(event: string, properties?: Record<string, unknown>) {
    this.events.push({ event, properties });
  }
  captureException(error: Error, properties?: Record<string, unknown>) {
    this.exceptions.push({ error, properties });
  }
  identify(id: string) {
    this.identified.push(id);
  }
  register(properties: Record<string, unknown>) {
    this.registered.push(properties);
  }
  reset() {
    this.resetCount += 1;
  }
  opt_out_capturing() {
    this.optOutCount += 1;
  }
  get_distinct_id() {
    return this.distinctID;
  }
  get_session_id() {
    return this.sessionID;
  }
}

class FakePreferenceStore {
  preference: TelemetryPreference | null;
  privacySignal = false;
  writes: TelemetryPreference[] = [];
  clearedTokens: string[] = [];
  reloadCount = 0;

  constructor(preference: TelemetryPreference | null = "persistent") {
    this.preference = preference;
  }

  read() {
    return this.preference;
  }
  write(preference: TelemetryPreference) {
    this.preference = preference;
    this.writes.push(preference);
  }
  privacySignalEnabled() {
    return this.privacySignal;
  }
  clearSDKState(projectToken: string) {
    this.clearedTokens.push(projectToken);
  }
  reload() {
    this.reloadCount += 1;
  }
}

function configuredTelemetry(sdk: FakeSDK, preference: TelemetryPreference | null = "persistent") {
  return new BrowserTelemetry(sdk, () => true, new FakePreferenceStore(preference));
}

const configuredApp: BrowserTelemetryConfig = {
  enabled: true,
  projectToken: "phc_test",
  apiHost: "https://e.example.com/",
  uiHost: "https://eu.posthog.com/",
  environment: "test",
  edition: "cloud",
  version: "1.2.3",
  revision: "abc123",
  surface: "app",
};

describe("BrowserTelemetry", () => {
  it("uses private browser defaults and flushes queued identity and events", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.identify("user-1");
    subject.capture("signup started");
    subject.configure(configuredApp);

    expect(sdk.initialized[0]?.options).toMatchObject({
      api_host: "https://e.example.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      capture_performance: {
        network_timing: false,
        web_vitals: true,
        web_vitals_allowed_metrics: ["CLS", "FCP", "INP", "LCP"],
        web_vitals_attribution: false,
      },
      capture_dead_clicks: false,
      persistence: "localStorage+cookie",
      cross_subdomain_cookie: true,
      cookieWinsOnConflict: true,
      person_profiles: "identified_only",
      disable_session_recording: true,
      enable_recording_console_log: false,
      logs: { captureConsoleLogs: false },
      disable_capture_url_hashes: true,
      opt_out_useragent_filter: false,
    });
    expect(sdk.registered[0]).toMatchObject({ analytics_mode: "persistent" });
    expect(sdk.identified).toEqual(["user-1"]);
    expect(sdk.events[0]?.event).toBe("signup started");
  });

  it("sends nothing while the visitor has not chosen an analytics mode", () => {
    const sdk = new FakeSDK();
    const store = new FakePreferenceStore(null);
    const subject = new BrowserTelemetry(sdk, () => true, store);
    subject.identify("user-1");
    subject.capture("signup started");

    subject.configure(configuredApp);
    subject.capture("signup started");
    subject.captureException(new Error("not sent"));

    expect(subject.preferenceStatus()).toBe("undecided");
    expect(sdk.initialized).toHaveLength(0);
    expect(sdk.events).toHaveLength(0);
    expect(sdk.exceptions).toHaveLength(0);
    expect(subject.requestHeaders()).toEqual({});
  });

  it("starts persistent analytics at consent without replaying pre-consent events", () => {
    const sdk = new FakeSDK();
    const store = new FakePreferenceStore(null);
    const subject = new BrowserTelemetry(sdk, () => true, store);
    subject.capture("signup started");
    subject.configure(configuredApp);

    subject.setPreference("persistent");

    expect(store.writes).toEqual(["persistent"]);
    expect(sdk.initialized).toHaveLength(1);
    expect(sdk.events).toHaveLength(0);
    subject.capture("signup started");
    expect(sdk.events).toEqual([{ event: "signup started", properties: {} }]);
  });

  it("keeps cookieless analytics personless and omits correlation headers", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk, "cookieless");
    subject.identify("user-1");
    subject.configure(configuredApp);

    expect(sdk.initialized[0]?.options).toMatchObject({
      persistence: "memory",
      cookieless_mode: "always",
      cross_subdomain_cookie: false,
      person_profiles: "never",
    });
    expect(sdk.registered[0]).toMatchObject({ analytics_mode: "cookieless" });
    expect(sdk.identified).toHaveLength(0);
    expect(subject.requestHeaders()).toEqual({});
  });

  it("honors browser privacy signals as a complete analytics opt-out", () => {
    const sdk = new FakeSDK();
    const store = new FakePreferenceStore("persistent");
    store.privacySignal = true;
    const subject = new BrowserTelemetry(sdk, () => true, store);

    subject.configure(configuredApp);
    subject.setPreference("persistent");

    expect(subject.preferenceStatus()).toBe("off");
    expect(sdk.initialized).toHaveLength(0);
    expect(store.writes).toEqual(["off"]);
    expect(store.clearedTokens).toEqual(["phc_test"]);
  });

  it("clears SDK state and reloads when an initialized mode changes", () => {
    const sdk = new FakeSDK();
    const store = new FakePreferenceStore("persistent");
    const subject = new BrowserTelemetry(sdk, () => true, store);
    subject.configure(configuredApp);

    subject.setPreference("off");

    expect(sdk.optOutCount).toBe(0);
    expect(sdk.resetCount).toBe(1);
    expect(store.clearedTokens).toEqual(["phc_test"]);
    expect(store.reloadCount).toBe(1);
  });

  it("resets before switching identified users and on logout", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    subject.identify("user-1");
    subject.identify("user-2");
    subject.resetIdentity();

    expect(sdk.identified).toEqual(["user-1", "user-2"]);
    expect(sdk.resetCount).toBe(2);
  });

  it("uses the originating route template for SDK-owned lifecycle and Web Vitals URLs", () => {
    const location = {
      origin: "https://app.openpo.st",
      pathname: "/publications/private-publication-id",
    };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { title: "Publications" });
    try {
      const sdk = new FakeSDK();
      const subject = configuredTelemetry(sdk);
      subject.configure(configuredApp);
      subject.capturePageView("/publications/[id]");

      location.pathname = "/settings";
      subject.capturePageView("/settings");

      const beforeSend = sdk.initialized[0]?.options.before_send as
        | ((event: {
            event: string;
            properties?: Record<string, unknown>;
          }) => { event: string; properties?: Record<string, unknown> } | null)
        | undefined;
      const event = beforeSend?.({
        event: "$web_vitals",
        properties: {
          $current_url:
            "https://app.openpo.st/publications/private-publication-id?token=secret#private",
          $pathname: "/publications/private-publication-id",
          $initial_pathname: "/publications/private-publication-id",
          $session_entry_pathname: "/publications/private-publication-id",
          $session_entry_url:
            "https://app.openpo.st/publications/private-publication-id?token=secret#private",
          $referrer: "https://search.example/private/path?query=secret",
          $session_entry_referrer: "https://search.example/private/path?query=secret",
          title: "Private launch artwork",
          $title: "Private launch artwork",
          $web_vitals_LCP_event: {
            name: "LCP",
            value: 123,
            $current_url: "https://app.openpo.st/publications/private-publication-id?token=secret",
            navigationURL: "https://app.openpo.st/publications/private-publication-id?token=secret",
            entries: [
              {
                name: "https://cdn.example/private-project-name.png?token=secret",
                url: "https://cdn.example/private-project-name.png?token=secret",
              },
            ],
          },
        },
      });

      expect(event?.properties).toMatchObject({
        $current_url: "https://app.openpo.st/publications/[id]",
        $pathname: "/publications/[id]",
        $initial_pathname: "/publications/[id]",
        $session_entry_pathname: "/publications/[id]",
        $session_entry_url: "https://app.openpo.st/publications/[id]",
        $referrer: "https://search.example",
        $session_entry_referrer: "https://search.example",
        $web_vitals_LCP_event: {
          $current_url: "https://app.openpo.st/publications/[id]",
          navigationURL: "https://app.openpo.st/publications/[id]",
        },
      });
      expect(event?.properties).not.toHaveProperty("title");
      expect(event?.properties).not.toHaveProperty("$title");
      expect(event?.properties?.$web_vitals_LCP_event).not.toHaveProperty("entries");
      expect(JSON.stringify(event)).not.toContain("private-project-name");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects direct identity values instead of identifying them", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);

    subject.identify("person@example.com");
    subject.identify("https://provider.example/users/raw-id");

    expect(sdk.identified).toHaveLength(0);
  });

  it("does not expose credentials or capture events when disabled", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure({ ...configuredApp, enabled: false });
    subject.capture("signup started");

    expect(sdk.initialized).toHaveLength(0);
    expect(sdk.events).toHaveLength(0);
  });

  it("rejects non-allowlisted first composition properties at runtime", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);

    subject.capture("first composition started", {
      signal: "text",
      content: "private draft",
      media_url: "https://example.com/private.jpg",
      workspace_id: "ws-secret",
    } as never);

    expect(sdk.events).toHaveLength(0);

    subject.capture("first composition started", { signal: "text" });
    expect(sdk.events).toEqual([
      { event: "first composition started", properties: { signal: "text" } },
    ]);

    subject.capture("first composition started", {
      signal: "https://example.com/private?token=secret",
    } as never);
    expect(sdk.events).toHaveLength(1);
  });

  it("rejects unknown events and properties at runtime", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);

    const captureUnchecked = subject.capture.bind(subject) as (
      name: string,
      properties: Record<string, unknown>,
    ) => void;
    captureUnchecked("unknown event", {});
    for (const properties of [
      { content: "private draft" },
      { email: "person@example.com" },
      { access_token: "provider-token" },
      { return_url: "https://example.test/callback?code=secret" },
      { provider_account_id: "provider-user-123" },
    ]) {
      captureUnchecked("signup started", properties);
    }

    expect(sdk.events).toHaveLength(0);
  });

  it("rejects sensitive values even when the property name is allowed", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);

    subject.capture("billing checkout opened", {
      billing_period: "monthly",
      plan_id: "https://example.com/checkout?token=secret",
    });
    subject.capture("billing checkout opened", {
      billing_period: "monthly",
      plan_id: "private draft",
    });
    subject.capture("billing checkout opened", {
      billing_period: "monthly",
      plan_id: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
    });

    expect(sdk.events).toHaveLength(0);
  });

  it("scrubs common secrets and captures the same error object once", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    const error = new Error("Failed https://example.com/callback?code=secret user@example.com");
    subject.captureException(error);
    subject.captureException(error);

    expect(sdk.exceptions).toHaveLength(1);
    expect(sdk.exceptions[0]?.error.message).not.toContain("secret");
    expect(sdk.exceptions[0]?.error.message).not.toContain("user@example.com");
    expect(sdk.exceptions[0]?.error.message).not.toContain("https://example.com");
  });

  it("keeps the browser event type when a rejection is not an Error", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);

    subject.captureException(new Event("error"));

    expect(sdk.exceptions[0]?.error.message).toBe("Event: error");
  });

  it("redacts foreign stack URLs while retaining source-map asset URLs", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    const error = new Error("Navigation failed");
    error.stack = [
      "Error: Navigation failed",
      "    at load (https://app.openpo.st/_app/immutable/chunks/app.ABC123.js:12:3?token=secret)",
      "    at reset (https://example.com/reset/path-secret:4:2)",
    ].join("\n");

    subject.captureException(error);

    const stack = sdk.exceptions[0]?.error.stack ?? "";
    expect(stack).toContain("https://app.openpo.st/_app/immutable/chunks/app.ABC123.js:12:3");
    expect(stack).toContain("[redacted-url]");
    expect(stack).not.toContain("path-secret");
    expect(stack).not.toContain("token=secret");
  });

  it("applies browser correlation headers to shared request transports", () => {
    const headers = applyTelemetryRequestHeaders(new Headers({ Authorization: "Bearer token" }), {
      "X-PostHog-Distinct-ID": "browser-user-1",
      "X-PostHog-Session-ID": "session-1",
    });

    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("X-PostHog-Distinct-ID")).toBe("browser-user-1");
    expect(headers.get("X-PostHog-Session-ID")).toBe("session-1");
  });
});

describe("installGlobalErrorCapture", () => {
  it("does not report an error already handled by an earlier listener", () => {
    const runtime = new EventTarget();
    vi.stubGlobal("window", runtime);
    try {
      configureTelemetry(configuredApp);
      runtime.addEventListener("error", (event) => event.preventDefault());
      const removeCapture = installGlobalErrorCapture();
      const event = new Event("error", { cancelable: true }) as Event & {
        error: Error;
        message: string;
      };
      event.error = new Error("Importing a module script failed.");
      event.message = event.error.message;

      runtime.dispatchEvent(event);

      expect(globalSDK.captureException).not.toHaveBeenCalled();
      removeCapture();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
