import { describe, expect, it, vi } from "vitest";
import {
  BrowserTelemetry,
  configureTelemetry,
  installConsoleErrorBridge,
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
  it("downloads only after consent and preserves capture while loading", async () => {
    const sdk = new FakeSDK();
    const preference = new FakePreferenceStore(null);
    let finish!: (sdk: FakeSDK) => void;
    let loads = 0;
    const subject = new BrowserTelemetry(
      () => {
        loads++;
        return new Promise<FakeSDK>((resolve) => {
          finish = resolve;
        });
      },
      () => true,
      preference,
    );
    subject.configure({ ...configuredApp, enabled: false });
    subject.configure(configuredApp);
    expect(loads).toBe(0);
    subject.setPreference("persistent");
    subject.configure(configuredApp);
    expect(loads).toBe(1);
    subject.identify("user-late");
    subject.capture("signup started");
    subject.captureException(new Error("loading failure"));
    expect(sdk.events).toEqual([]);
    finish(sdk);
    await vi.waitFor(() => expect(sdk.initialized).toHaveLength(1));
    expect(sdk.identified).toEqual(["user-late"]);
    expect(sdk.events.map((event) => event.event)).toEqual(["signup started"]);
    expect(sdk.exceptions.map((event) => event.error.message)).toEqual(["loading failure"]);
  });

  it.each(["off", "disabled", "privacy"])(
    "respects %s changes during SDK loading",
    async (change) => {
      const sdk = new FakeSDK();
      const preference = new FakePreferenceStore();
      let finish!: (sdk: FakeSDK) => void;
      const subject = new BrowserTelemetry(
        () =>
          new Promise<FakeSDK>((resolve) => {
            finish = resolve;
          }),
        () => true,
        preference,
      );
      subject.configure(configuredApp);
      subject.capture("signup started");
      if (change === "off") subject.setPreference("off");
      if (change === "disabled") subject.configure({ ...configuredApp, enabled: false });
      if (change === "privacy") preference.privacySignal = true;
      finish(sdk);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sdk.initialized).toEqual([]);
      expect(sdk.events).toEqual([]);
    },
  );

  it("recovers from a failed download without replaying its queued events", async () => {
    const sdk = new FakeSDK();
    let loads = 0;
    const subject = new BrowserTelemetry(
      () => (++loads === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(sdk)),
      () => true,
      new FakePreferenceStore(),
    );
    subject.configure(configuredApp);
    subject.capture("signup started");
    await new Promise((resolve) => setTimeout(resolve, 0));
    subject.configure(configuredApp);
    await vi.waitFor(() => expect(sdk.initialized).toHaveLength(1));
    expect(sdk.events).toEqual([]);
  });

  it("uses private browser defaults and flushes queued identity and events", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.identify("user-1");
    subject.capture("signup started");
    subject.configure(configuredApp);

    // Private defaults only: every key below has a privacy consequence, so a
    // PostHog option change that weakens them must break this test on purpose.
    expect(sdk.initialized[0]?.options).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_performance: {
        network_timing: false,
        web_vitals_attribution: false,
      },
      persistence: "localStorage+cookie",
      person_profiles: "identified_only",
      disable_session_recording: true,
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
    const store = new FakePreferenceStore("cookieless");
    const subject = new BrowserTelemetry(sdk, () => true, store);
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
    expect(store.clearedTokens).toEqual(["phc_test"]);
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

    // Revocation must discard buffered SDK requests, not just reset identity.
    expect(sdk.optOutCount).toBe(1);
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

  it("retains public Svelte error codes without collecting URL parameters", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    subject.captureException(new Error("https://svelte.dev/e/each_key_duplicate?token=secret"));
    expect(sdk.exceptions[0]?.error.message).toBe("Svelte error: each_key_duplicate");
  });

  it("retains source-map asset locations through the SDK before_send boundary", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.openpo.st", pathname: "/" } });
    try {
      const sdk = new FakeSDK();
      const subject = configuredTelemetry(sdk);
      subject.configure(configuredApp);
      const beforeSend = sdk.initialized[0]!.options.before_send as (event: {
        event: string;
        properties: Record<string, unknown>;
      }) => { properties: Record<string, unknown> };
      const event = beforeSend({
        event: "$exception",
        properties: {
          $exception_list: [
            {
              stacktrace: {
                frames: [
                  {
                    filename:
                      "https://app.openpo.st/_app/immutable/chunks/editor.ABC123.js?token=secret",
                    lineno: 12,
                    colno: 3,
                  },
                  {
                    filename: "https://private.example/assets/customer-file.js?token=secret",
                    lineno: 4,
                  },
                ],
              },
            },
          ],
        },
      });
      expect(event.properties.$exception_list).toEqual([
        {
          stacktrace: {
            frames: [
              {
                filename: "https://app.openpo.st/_app/immutable/chunks/editor.ABC123.js",
                lineno: 12,
                colno: 3,
              },
              { filename: "[redacted-url]", lineno: 4 },
            ],
          },
        },
      ]);
      expect(JSON.stringify(event)).not.toContain("secret");
      expect(JSON.stringify(event)).not.toContain("customer-file");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redacts foreign stack URLs while retaining source-map asset URLs", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.openpo.st", pathname: "/" } });
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
    vi.unstubAllGlobals();
  });

  it("strips advertising click identifiers from the outgoing SDK payload", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.openpo.st", pathname: "/settings" },
    });
    try {
      const sdk = new FakeSDK();
      const subject = configuredTelemetry(sdk);
      subject.configure(configuredApp);
      const beforeSend = sdk.initialized[0]?.options.before_send as (event: {
        event: string;
        properties: Record<string, unknown>;
      }) => { properties: Record<string, unknown> };
      const event = beforeSend({
        event: "$pageview",
        properties: {
          $current_url: "https://app.openpo.st/settings",
          fbclid: "ad-click-id",
          gclid: "ad-click-id",
          gclsrc: "ad-click-id",
          dclid: "ad-click-id",
          gbraid: "ad-click-id",
          wbraid: "ad-click-id",
          msclkid: "ad-click-id",
          ttclid: "ad-click-id",
          twclid: "ad-click-id",
          li_fat_id: "ad-click-id",
          igshid: "ad-click-id",
          mc_cid: "ad-click-id",
          rdt_cid: "ad-click-id",
          epik: "ad-click-id",
          qclid: "ad-click-id",
          sccid: "ad-click-id",
          irclid: "ad-click-id",
          _kx: "ad-click-id",
          $set: { fbclid: "ad-click-id", gclid: "ad-click-id" },
          $set_once: {
            $initial_fbclid: "ad-click-id",
            $initial_gclid: "ad-click-id",
            $initial_kx: "ad-click-id",
          },
          $initial_fbclid: "ad-click-id",
          $initial_msclkid: "ad-click-id",
          $exception_list: [{ fbclid: "ad-click-id", lineno: 12 }],
          distinct_id: "browser-user-1",
          $session_id: "session-1",
          surface: "app",
        },
      });
      const serialized = JSON.stringify(event.properties);
      for (const key of [
        "fbclid",
        "gclid",
        "gclsrc",
        "dclid",
        "gbraid",
        "wbraid",
        "msclkid",
        "ttclid",
        "twclid",
        "li_fat_id",
        "igshid",
        "mc_cid",
        "rdt_cid",
        "epik",
        "qclid",
        "sccid",
        "irclid",
        "_kx",
        "$initial_fbclid",
        "$initial_msclkid",
        "$initial_kx",
      ]) {
        expect(event.properties).not.toHaveProperty(key);
      }
      expect(serialized).not.toContain("ad-click-id");
      // Protocol and application identifiers keep their own policies.
      expect(event.properties).toMatchObject({
        distinct_id: "browser-user-1",
        $session_id: "session-1",
        surface: "app",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes click identifiers to the SDK property denylist", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    const denylist = sdk.initialized[0]?.options.property_denylist as unknown;
    expect(Array.isArray(denylist)).toBe(true);
    for (const key of ["fbclid", "gclid", "msclkid", "$initial_fbclid"]) {
      expect(denylist).toContain(key);
    }
  });
});

describe("installGlobalErrorCapture", () => {
  it("ignores a ResizeObserver delivery warning but captures a real window error", async () => {
    const runtime = Object.assign(new EventTarget(), {
      location: { origin: "https://app.openpo.st", pathname: "/image-editor/[id]" },
    });
    vi.stubGlobal("window", runtime);
    vi.stubGlobal("document", { cookie: "openpost_analytics=v1:persistent" });
    vi.stubGlobal("navigator", {});
    globalSDK.captureException.mockClear();
    try {
      configureTelemetry(configuredApp);
      await vi.waitFor(() => expect(globalSDK.init).toHaveBeenCalled());
      const removeCapture = installGlobalErrorCapture();
      runtime.dispatchEvent(
        Object.assign(new Event("error"), {
          error: null,
          message: "ResizeObserver loop completed with undelivered notifications.",
        }),
      );
      runtime.dispatchEvent(
        Object.assign(new Event("error"), {
          error: null,
          message: "ResizeObserver loop limit exceeded",
        }),
      );
      expect(globalSDK.captureException).not.toHaveBeenCalled();

      // Contentless cross-origin "Script error." carries no stack and only
      // fuses unrelated routes into one noisy issue, so it is dropped. A
      // real error object with the same text is still captured.
      runtime.dispatchEvent(
        Object.assign(new Event("error"), { error: null, message: "Script error." }),
      );
      expect(globalSDK.captureException).not.toHaveBeenCalled();

      const scriptFailure = new Error("Script error.");
      runtime.dispatchEvent(
        Object.assign(new Event("error"), {
          error: scriptFailure,
          message: scriptFailure.message,
        }),
      );
      expect(globalSDK.captureException).toHaveBeenCalledOnce();
      const capturedScriptError = globalSDK.captureException.mock.calls[0]?.[0] as Error;
      expect(capturedScriptError.message).toBe("Script error.");

      const failure = new Error("Canvas failed");
      runtime.dispatchEvent(
        Object.assign(new Event("error"), { error: failure, message: failure.message }),
      );
      expect(globalSDK.captureException).toHaveBeenCalledTimes(2);
      expect(globalSDK.captureException.mock.calls[1]?.[0].message).toBe("Canvas failed");
      removeCapture();
    } finally {
      globalSDK.captureException.mockClear();
      vi.unstubAllGlobals();
    }
  });

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

describe("deployment context", () => {
  it("restores deployment super-properties after identity resets", () => {
    const sdk = new FakeSDK();
    const subject = configuredTelemetry(sdk);
    subject.configure(configuredApp);
    const initialRegisters = sdk.registered.length;

    subject.identify("user-1");
    subject.identify("user-2");
    subject.resetIdentity();

    expect(sdk.resetCount).toBe(2);
    // One restore per identify plus one per explicit reset.
    expect(sdk.registered.length).toBe(initialRegisters + 3);
    expect(sdk.registered.at(-1)).toMatchObject({
      surface: "app",
      environment: "test",
      revision: "abc123",
    });
    // The previous user identity is never restored, only safe deployment context.
    expect(JSON.stringify(sdk.registered.at(-1))).not.toContain("user-");
  });

  it("attaches deployment context to immediate and buffered exceptions", async () => {
    const immediateSDK = new FakeSDK();
    const immediate = configuredTelemetry(immediateSDK);
    immediate.configure(configuredApp);
    immediate.captureException(new Error("immediate failure"), { error_boundary: "window_error" });
    expect(immediateSDK.exceptions[0]?.properties).toMatchObject({
      error_boundary: "window_error",
      surface: "app",
      environment: "test",
      revision: "abc123",
    });

    const sdk = new FakeSDK();
    let finish!: (sdk: FakeSDK) => void;
    const subject = new BrowserTelemetry(
      () =>
        new Promise<FakeSDK>((resolve) => {
          finish = resolve;
        }),
      () => true,
      new FakePreferenceStore("persistent"),
    );
    subject.configure(configuredApp);
    subject.captureException(new Error("loading failure"));
    finish(sdk);
    await vi.waitFor(() => expect(sdk.exceptions).toHaveLength(1));
    // Buffered exceptions captured before configuration still carry the
    // deployment context once the SDK loads.
    expect(sdk.exceptions[0]?.properties).toMatchObject({
      surface: "app",
      revision: "abc123",
    });
  });
});

describe("installConsoleErrorBridge", () => {
  it("forwards logged failures while preserving console output", () => {
    const capture = vi.fn();
    const original = vi.fn();
    const target = { error: original };
    const uninstall = installConsoleErrorBridge(capture, target);

    const failure = new Error("Failed to load workspaces");
    target.error(failure);
    target.error("Failed to save draft:", { draft: 1 });

    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenNthCalledWith(1, failure);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, failure, { error_boundary: "console_error" });
    const synthetic = capture.mock.calls[1]?.[0] as Error;
    expect(synthetic).toBeInstanceOf(Error);
    expect(synthetic.message).toBe('Failed to save draft: {"draft":1}');
    expect(capture.mock.calls[1]?.[1]).toEqual({ error_boundary: "console_error" });

    uninstall();
    expect(target.error).toBe(original);
  });

  it("preserves the source exception when a logger adds context", () => {
    const capture = vi.fn();
    const target = { error: vi.fn() };
    installConsoleErrorBridge(capture, target);
    const failure = new DOMException("The cached file changed", "InvalidStateError");
    target.error("[video-editor:WorkspaceFS]", "createProject failed", failure);
    expect(capture).toHaveBeenCalledWith(failure, {
      error_boundary: "console_error",
    });
  });

  it("drops benign browser delivery noise but keeps real failures", () => {
    const capture = vi.fn();
    const original = vi.fn();
    const target = { error: original };
    installConsoleErrorBridge(capture, target);

    target.error("ResizeObserver loop completed with undelivered notifications.");
    target.error("Script error.");
    target.error(new Error("ResizeObserver loop completed with undelivered notifications."));
    expect(capture).not.toHaveBeenCalled();
    // Console output is always preserved.
    expect(original).toHaveBeenCalledTimes(3);

    const failure = new Error("Canvas failed");
    target.error(failure);
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(failure, { error_boundary: "console_error" });
  });

  it("never loops when telemetry logging itself fails", () => {
    const seen: unknown[][] = [];
    const target = {
      error: (...args: unknown[]) => {
        seen.push(args);
      },
    };
    installConsoleErrorBridge((error) => {
      target.error("telemetry failed", error);
    }, target);
    target.error("original failure");
    expect(seen).toHaveLength(2);
  });
});
