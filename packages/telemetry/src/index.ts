import posthog from "posthog-js";

export type TelemetrySurface = "app" | "marketing" | "docs";
export type TelemetryPreference = "persistent" | "cookieless" | "off";
export type TelemetryPreferenceStatus = TelemetryPreference | "undecided" | "unavailable";

export const telemetryPreferenceCookie = "openpost_analytics";
export const telemetryPreferencesEvent = "openpost:telemetry-preferences";

export interface BrowserTelemetryConfig {
  enabled: boolean;
  projectToken?: string;
  apiHost?: string;
  uiHost?: string;
  environment: string;
  edition: string;
  version?: string;
  revision?: string;
  surface: TelemetrySurface;
}

export interface TelemetryEventMap {
  "growth opened": { platform_count: number };
  "growth recommendation shown": {
    platform: string;
    rank_bucket: string;
    mutual_count_bucket: string;
    follows_viewer: boolean;
  };
  "growth profile opened": {
    platform: string;
    rank_bucket: string;
    mutual_count_bucket: string;
    follows_viewer: boolean;
  };
  "signup started": Record<string, never>;
  "publication publish requested": {
    account_count: number;
    is_thread: boolean;
  };
  "publication schedule requested": {
    account_count: number;
    is_thread: boolean;
  };
  "media uploaded": {
    count: number;
    source: "upload" | "camera" | "stock_import";
  };
  "image design created": {
    source: "custom" | "preset" | "template" | "media";
  };
  "image design exported": { mode: string; pages: number };
  "billing checkout opened": { billing_period: string; plan_id: string };
  "first composition started": { signal: "text" | "media" | "content_mode" };
  "video project created": {
    source: "openpost_media" | "files" | "blank" | "recording" | "stock";
    editing_mode?: string;
    file_count?: number;
  };
  "video export completed": { format: string; variant_count: number };
  "public editor opened": {
    editor: "image" | "video";
    source: "marketing_tool";
  };
  "public image editor viewed": Record<string, string | number | boolean>;
  "public image design started": Record<string, string | number | boolean>;
  "public image editor meaningful edit": Record<string, string | number | boolean>;
  "public image export completed": Record<string, string | number | boolean>;
  "public image editor signup clicked": Record<string, string | number | boolean>;
  "public image editor signup completed": Record<string, string | number | boolean>;
  "public image workspace import completed": Record<string, string | number | boolean>;
  "docs search used": { result_count?: number };
  "docs code copied": { language?: string };
}

export type TelemetryEventName = keyof TelemetryEventMap;

interface BrowserSDK {
  init(token: string, options: Record<string, unknown>): unknown;
  capture(event: string, properties?: Record<string, unknown>): unknown;
  captureException(error: Error, properties?: Record<string, unknown>): unknown;
  identify(distinctID: string): unknown;
  register(properties: Record<string, unknown>): unknown;
  reset(): unknown;
  opt_out_capturing(): unknown;
  get_distinct_id?(): string;
  get_session_id?(): string;
}

export interface TelemetryPreferenceStore {
  read(): TelemetryPreference | null;
  write(preference: TelemetryPreference): void;
  privacySignalEnabled(): boolean;
  clearSDKState(projectToken: string): void;
  reload(): void;
}

type PendingEvent = {
  name: TelemetryEventName;
  properties: Record<string, unknown>;
};

type PendingPageView = { pathname: string };
type PendingException = { error: Error; properties: Record<string, unknown> };
type BrowserCaptureEvent = {
  event: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

const maxPendingEvents = 100;
const maxRememberedRouteTemplates = 100;
const eventPropertyAllowlists: Record<TelemetryEventName, readonly string[]> = {
  "growth opened": ["platform_count"],
  "growth recommendation shown": [
    "platform",
    "rank_bucket",
    "mutual_count_bucket",
    "follows_viewer",
  ],
  "growth profile opened": ["platform", "rank_bucket", "mutual_count_bucket", "follows_viewer"],
  "signup started": [],
  "publication publish requested": ["account_count", "is_thread"],
  "publication schedule requested": ["account_count", "is_thread"],
  "media uploaded": ["count", "source"],
  "image design created": ["source"],
  "image design exported": ["mode", "pages"],
  "billing checkout opened": ["billing_period", "plan_id"],
  "first composition started": ["signal"],
  "video project created": ["source", "editing_mode", "file_count"],
  "video export completed": ["format", "variant_count"],
  "public editor opened": ["editor", "source"],
  "public image editor viewed": ["returning_guest"],
  "public image design started": ["entry", "preset", "template"],
  "public image editor meaningful edit": ["source"],
  "public image export completed": ["format", "pages"],
  "public image editor signup clicked": ["source"],
  "public image editor signup completed": ["source"],
  "public image workspace import completed": ["source"],
  "docs search used": ["result_count"],
  "docs code copied": ["language"],
};
const firstCompositionSignals = new Set(["text", "media", "content_mode"]);
const planIDs = new Set(["starter", "founder", "pro", "team", "agency"]);
const billingPeriods = new Set(["monthly", "annual"]);
const telemetryPreferenceVersion = "v1";
const telemetryPreferenceMaxAgeSeconds = 365 * 24 * 60 * 60;

const browserPreferenceStore: TelemetryPreferenceStore = {
  read: readBrowserTelemetryPreference,
  write: writeBrowserTelemetryPreference,
  privacySignalEnabled: browserPrivacySignalEnabled,
  clearSDKState: clearBrowserSDKState,
  reload: () => window.location.reload(),
};

export class BrowserTelemetry {
  private configured = false;
  private configResolved = false;
  private disabled = false;
  private config: BrowserTelemetryConfig | null = null;
  private preference: TelemetryPreferenceStatus = "unavailable";
  private preferenceListeners = new Set<(preference: TelemetryPreferenceStatus) => void>();
  private activeUserID: string | null = null;
  private pendingUserID: string | null = null;
  private pendingEvents: PendingEvent[] = [];
  private pendingPageViews: PendingPageView[] = [];
  private pendingExceptions: PendingException[] = [];
  private capturedErrors = new WeakSet<object>();
  private currentPagePath: string | null = null;
  private requestedPagePath: string | null = null;
  private previousPagePath: string | null = null;
  private routeTemplates = new Map<string, string>();

  constructor(
    private readonly sdk: BrowserSDK,
    private readonly runtimeAvailable: () => boolean = () => typeof window !== "undefined",
    private readonly preferenceStore: TelemetryPreferenceStore = browserPreferenceStore,
  ) {}

  configure(config: BrowserTelemetryConfig): void {
    if (!this.runtimeAvailable()) return;
    this.configResolved = true;
    this.config = config;
    if (!config.enabled || !config.projectToken?.trim() || !config.apiHost?.trim()) {
      this.disabled = true;
      this.setPreferenceStatus("unavailable");
      this.pendingEvents = [];
      this.pendingPageViews = [];
      this.pendingExceptions = [];
      if (this.configured) this.sdk.opt_out_capturing();
      return;
    }

    this.disabled = false;
    const preference = this.preferenceStore.privacySignalEnabled()
      ? "off"
      : (this.preferenceStore.read() ?? "undecided");
    this.setPreferenceStatus(preference);
    if (preference === "off") {
      this.preferenceStore.clearSDKState(config.projectToken.trim());
      this.clearPendingCapture();
      return;
    }
    if (preference === "undecided") {
      this.clearPendingCapture();
      return;
    }

    if (preference === "cookieless") {
      this.preferenceStore.clearSDKState(config.projectToken.trim());
    }

    this.initialize(config, preference);
  }

  private initialize(config: BrowserTelemetryConfig, preference: TelemetryPreference): void {
    if (preference === "off") return;

    this.sdk.init(config.projectToken!.trim(), {
      api_host: config.apiHost!.trim().replace(/\/+$/, ""),
      ...(config.uiHost?.trim() ? { ui_host: config.uiHost.trim().replace(/\/+$/, "") } : {}),
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_performance: {
        network_timing: false,
        web_vitals: true,
        web_vitals_allowed_metrics: ["CLS", "FCP", "INP", "LCP"],
        web_vitals_attribution: false,
      },
      before_send: (event: BrowserCaptureEvent | null) => this.sanitizeBrowserEvent(event),
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      enable_recording_console_log: false,
      logs: { captureConsoleLogs: false },
      disable_capture_url_hashes: true,
      opt_out_useragent_filter: false,
      cross_subdomain_cookie: preference === "persistent",
      cookieWinsOnConflict: preference === "persistent",
      persistence: preference === "persistent" ? "localStorage+cookie" : "memory",
      ...(preference === "cookieless" ? { cookieless_mode: "always" } : {}),
      person_profiles:
        preference === "persistent" && config.surface === "app" ? "identified_only" : "never",
      respect_dnt: true,
    });
    this.sdk.register(
      compactProperties({
        surface: config.surface,
        environment: config.environment,
        edition: config.edition,
        version: config.version,
        revision: config.revision,
        analytics_mode: preference,
      }),
    );
    this.configured = true;
    this.disabled = false;

    if (preference === "persistent" && this.pendingUserID) {
      this.identify(this.pendingUserID);
    }
    for (const event of this.pendingEvents.splice(0)) {
      this.sdk.capture(event.name, event.properties);
    }
    const pendingPageViews = this.pendingPageViews.splice(0);
    for (const pageView of pendingPageViews) {
      this.capturePageView(pageView.pathname);
    }
    for (const exception of this.pendingExceptions.splice(0)) {
      this.sdk.captureException(exception.error, exception.properties);
    }
    if (this.requestedPagePath && pendingPageViews.length === 0) {
      this.capturePageView(this.requestedPagePath);
    }
  }

  capture<Name extends TelemetryEventName>(
    name: Name,
    ...args: TelemetryEventMap[Name] extends Record<string, never>
      ? [properties?: TelemetryEventMap[Name]]
      : [properties: TelemetryEventMap[Name]]
  ): void {
    if (this.disabled) return;
    const properties = allowlistedEventProperties(name, (args[0] ?? {}) as Record<string, unknown>);
    if (properties === null) return;
    if (!this.configured) {
      if (!this.configResolved && this.pendingEvents.length < maxPendingEvents)
        this.pendingEvents.push({ name, properties });
      return;
    }
    this.sdk.capture(name, properties);
  }

  capturePageView(pathname: string, _title?: string): void {
    if (this.disabled || typeof window === "undefined") return;
    const path = cleanPath(pathname);
    this.requestedPagePath = pathname;
    this.rememberRouteTemplate(cleanPath(window.location.pathname), path);
    if (!this.configured) {
      if (!this.configResolved && this.pendingPageViews.length < maxPendingEvents) {
        this.pendingPageViews.push({ pathname });
      }
      return;
    }
    this.previousPagePath = this.currentPagePath;
    this.currentPagePath = path;
    this.sdk.capture("$pageview", {
      $current_url: `${window.location.origin}${path}`,
      path,
    });
  }

  private sanitizeBrowserEvent(event: BrowserCaptureEvent | null): BrowserCaptureEvent | null {
    if (!event?.properties) return event;
    const fallbackPath = this.currentPagePath ?? cleanPath(window.location.pathname);
    const currentPath = routeTemplateForEvent(event.properties, this.routeTemplates, fallbackPath);
    const previousPath = event.event === "$pageview" ? this.previousPagePath : this.currentPagePath;
    return {
      ...event,
      properties: sanitizeSDKProperties(
        event.properties,
        currentPath,
        previousPath,
        this.routeTemplates,
      ),
    };
  }

  private rememberRouteTemplate(rawPath: string, routeTemplate: string): void {
    this.routeTemplates.delete(rawPath);
    this.routeTemplates.set(rawPath, routeTemplate);
    this.routeTemplates.set(routeTemplate, routeTemplate);
    while (this.routeTemplates.size > maxRememberedRouteTemplates) {
      const oldest = this.routeTemplates.keys().next().value;
      if (typeof oldest !== "string") break;
      this.routeTemplates.delete(oldest);
    }
  }

  identify(userID: string): void {
    const normalized = userID.trim();
    if (!normalized || containsSensitiveValue(normalized)) {
      this.resetIdentity();
      return;
    }
    this.pendingUserID = normalized;
    if (
      !this.configured ||
      this.disabled ||
      this.preference !== "persistent" ||
      this.activeUserID === normalized
    )
      return;
    if (this.activeUserID !== null) this.sdk.reset();
    this.sdk.identify(normalized);
    this.activeUserID = normalized;
  }

  resetIdentity(): void {
    this.pendingUserID = null;
    this.activeUserID = null;
    if (this.configured) this.sdk.reset();
  }

  captureException(error: unknown, properties: Record<string, unknown> = {}): void {
    if (this.disabled) return;
    if (typeof error === "object" && error !== null) {
      if (this.capturedErrors.has(error)) return;
      this.capturedErrors.add(error);
    }
    const sanitized = sanitizeError(error);
    const compacted = compactProperties(properties);
    if (!this.configured) {
      if (!this.configResolved && this.pendingExceptions.length < maxPendingEvents) {
        this.pendingExceptions.push({
          error: sanitized,
          properties: compacted,
        });
      }
      return;
    }
    this.sdk.captureException(sanitized, compacted);
  }

  requestHeaders(): Record<string, string> {
    if (!this.configured || this.disabled || this.preference !== "persistent") return {};
    const distinctID = this.sdk.get_distinct_id?.();
    const sessionID = this.sdk.get_session_id?.();
    return compactProperties({
      "X-PostHog-Distinct-ID": distinctID,
      "X-PostHog-Session-ID": sessionID,
    }) as Record<string, string>;
  }

  preferenceStatus(): TelemetryPreferenceStatus {
    return this.preference;
  }

  setPreference(preference: TelemetryPreference): void {
    if (!this.runtimeAvailable() || this.preference === "unavailable") return;
    const nextPreference = this.preferenceStore.privacySignalEnabled() ? "off" : preference;
    this.preferenceStore.write(nextPreference);
    if (nextPreference === this.preference) return;

    if (this.configured) {
      this.disabled = true;
      this.sdk.reset();
      if (this.config?.projectToken) {
        this.preferenceStore.clearSDKState(this.config.projectToken.trim());
      }
      this.setPreferenceStatus(nextPreference);
      this.preferenceStore.reload();
      return;
    }

    this.setPreferenceStatus(nextPreference);
    if (nextPreference === "off") {
      this.clearPendingCapture();
      if (this.config?.projectToken) {
        this.preferenceStore.clearSDKState(this.config.projectToken.trim());
      }
      return;
    }
    if (this.config) this.initialize(this.config, nextPreference);
  }

  subscribePreference(listener: (preference: TelemetryPreferenceStatus) => void): () => void {
    this.preferenceListeners.add(listener);
    listener(this.preference);
    return () => this.preferenceListeners.delete(listener);
  }

  private setPreferenceStatus(preference: TelemetryPreferenceStatus): void {
    this.preference = preference;
    for (const listener of this.preferenceListeners) listener(preference);
  }

  private clearPendingCapture(): void {
    this.pendingEvents = [];
    this.pendingPageViews = [];
    this.pendingExceptions = [];
  }
}

const telemetry = new BrowserTelemetry(posthog as unknown as BrowserSDK);

export function configureTelemetry(config: BrowserTelemetryConfig): void {
  telemetry.configure(config);
}

export function captureTelemetryEvent<Name extends TelemetryEventName>(
  name: Name,
  ...args: TelemetryEventMap[Name] extends Record<string, never>
    ? [properties?: TelemetryEventMap[Name]]
    : [properties: TelemetryEventMap[Name]]
): void {
  telemetry.capture(name, ...(args as never));
}

export function captureTelemetryPageView(pathname: string, title?: string): void {
  telemetry.capturePageView(pathname, title);
}

export function identifyTelemetryUser(userID: string): void {
  telemetry.identify(userID);
}

export function resetTelemetryIdentity(): void {
  telemetry.resetIdentity();
}

export function getTelemetryPreference(): TelemetryPreferenceStatus {
  return telemetry.preferenceStatus();
}

export function setTelemetryPreference(preference: TelemetryPreference): void {
  telemetry.setPreference(preference);
}

export function subscribeTelemetryPreference(
  listener: (preference: TelemetryPreferenceStatus) => void,
): () => void {
  return telemetry.subscribePreference(listener);
}

export function openTelemetryPreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(telemetryPreferencesEvent));
}

export function captureClientException(
  error: unknown,
  properties: Record<string, unknown> = {},
): void {
  telemetry.captureException(error, properties);
}

export function telemetryRequestHeaders(): Record<string, string> {
  return telemetry.requestHeaders();
}

export function telemetryDistinctID(): string {
  return telemetry.requestHeaders()["X-PostHog-Distinct-ID"] ?? "";
}

export function applyTelemetryRequestHeaders(
  headers: Headers,
  requestHeaders: Record<string, string> = telemetryRequestHeaders(),
): Headers {
  for (const [name, value] of Object.entries(requestHeaders)) {
    headers.set(name, value);
  }
  return headers;
}

export function installGlobalErrorCapture(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onError = (event: ErrorEvent) => {
    if (event.defaultPrevented) return;
    captureClientException(event.error ?? new Error(event.message), {
      error_boundary: "window_error",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (event.defaultPrevented) return;
    captureClientException(event.reason, {
      error_boundary: "unhandled_rejection",
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function readBrowserTelemetryPreference(): TelemetryPreference | null {
  if (typeof document === "undefined") return null;
  const encoded = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${telemetryPreferenceCookie}=`))
    ?.slice(telemetryPreferenceCookie.length + 1);
  if (!encoded) return null;
  const value = decodeURIComponent(encoded);
  const [version, preference, ...extra] = value.split(":");
  if (
    version !== telemetryPreferenceVersion ||
    extra.length > 0 ||
    !isTelemetryPreference(preference)
  ) {
    return null;
  }
  return preference;
}

function writeBrowserTelemetryPreference(preference: TelemetryPreference): void {
  const attributes = [
    `${telemetryPreferenceCookie}=${encodeURIComponent(`${telemetryPreferenceVersion}:${preference}`)}`,
    "Path=/",
    `Max-Age=${telemetryPreferenceMaxAgeSeconds}`,
    "SameSite=Lax",
  ];
  if (window.location.protocol === "https:") attributes.push("Secure");
  if (isOpenPostHostedHostname(window.location.hostname)) attributes.push("Domain=.openpo.st");
  document.cookie = attributes.join("; ");
}

function browserPrivacySignalEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  const privacyNavigator = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  return (
    privacyNavigator.globalPrivacyControl === true ||
    [privacyNavigator.doNotTrack, privacyNavigator.msDoNotTrack].some((value) => value === "1")
  );
}

function clearBrowserSDKState(projectToken: string): void {
  if (!projectToken) return;
  const keys = [`ph_${projectToken}_posthog`, `__ph_opt_in_out_${projectToken}`];
  try {
    for (const key of keys) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable under strict browser policies. Cookie cleanup still applies.
  }
  for (const key of keys) {
    const cookieAttributes = [
      `${key}=`,
      "Path=/",
      "Max-Age=0",
      "SameSite=Lax",
      ...(window.location.protocol === "https:" ? ["Secure"] : []),
    ];
    document.cookie = cookieAttributes.join("; ");
    if (isOpenPostHostedHostname(window.location.hostname)) {
      document.cookie = [...cookieAttributes, "Domain=.openpo.st"].join("; ");
    }
  }
}

function isTelemetryPreference(value: string | undefined): value is TelemetryPreference {
  return value === "persistent" || value === "cookieless" || value === "off";
}

function isOpenPostHostedHostname(hostname: string): boolean {
  return hostname === "openpo.st" || hostname.endsWith(".openpo.st");
}

function compactProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizePropertyValue(value)]),
  );
}

function allowlistedEventProperties(
  name: TelemetryEventName,
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowlist = eventPropertyAllowlists[name];
  if (!allowlist) return null;
  if (Object.keys(properties).some((key) => !allowlist.includes(key))) {
    return null;
  }
  if (Object.values(properties).some(containsSensitiveValue)) return null;
  if (
    name === "first composition started" &&
    !firstCompositionSignals.has(String(properties.signal))
  ) {
    return null;
  }
  if (
    name === "billing checkout opened" &&
    (!planIDs.has(String(properties.plan_id)) ||
      !billingPeriods.has(String(properties.billing_period)))
  ) {
    return null;
  }
  const result = compactProperties(
    Object.fromEntries(allowlist.map((key) => [key, properties[key]])),
  );
  return result;
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:https?:\/\/|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:token|secret|password|authorization)=|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$)/iu.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsSensitiveValue);
  }
  return false;
}

function cleanPath(pathname: string): string {
  try {
    return new URL(pathname, "https://openpost.invalid").pathname;
  } catch {
    return "/";
  }
}

function sanitizeSDKProperties(
  properties: Record<string, unknown>,
  currentPath: string,
  previousPath: string | null,
  routeTemplates: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "title" || key === "$title" || key === "entries") continue;
    if (
      key === "$current_url" ||
      key === "$initial_current_url" ||
      key === "$session_entry_url" ||
      key === "navigationURL"
    ) {
      sanitized[key] = safeCurrentURL(value, currentPath, routeTemplates);
      continue;
    }
    if (key === "$pathname") {
      sanitized[key] = currentPath;
      continue;
    }
    if (key === "$initial_pathname" || key === "$session_entry_pathname") {
      sanitized[key] = routeTemplateForPath(value, routeTemplates, currentPath);
      continue;
    }
    if (key === "$prev_pageview_pathname") {
      sanitized[key] = routeTemplateForPath(value, routeTemplates, previousPath ?? currentPath);
      continue;
    }
    if (key === "$referrer" || key === "$initial_referrer" || key === "$session_entry_referrer") {
      sanitized[key] = safeReferrerOrigin(value);
      continue;
    }
    if (key === "url" && typeof value === "string") continue;
    if (key === "name" && typeof value === "string" && looksLikeURL(value)) continue;
    if (Array.isArray(value)) {
      sanitized[key] = value.map((entry) =>
        entry && typeof entry === "object"
          ? sanitizeSDKProperties(
              entry as Record<string, unknown>,
              currentPath,
              previousPath,
              routeTemplates,
            )
          : typeof entry === "string" && looksLikeURL(entry)
            ? "[redacted-url]"
            : entry,
      );
      continue;
    }
    if (value && typeof value === "object") {
      sanitized[key] = sanitizeSDKProperties(
        value as Record<string, unknown>,
        currentPath,
        previousPath,
        routeTemplates,
      );
      continue;
    }
    sanitized[key] = typeof value === "string" && looksLikeURL(value) ? "[redacted-url]" : value;
  }
  return sanitized;
}

function looksLikeURL(value: string): boolean {
  return /^(?:https?:)?\/\//iu.test(value.trim());
}

function routeTemplateForEvent(
  properties: Record<string, unknown>,
  routeTemplates: ReadonlyMap<string, string>,
  fallbackPath: string,
): string {
  for (const value of [properties.$current_url, properties.$pathname]) {
    const routeTemplate = routeTemplateForPath(value, routeTemplates);
    if (routeTemplate) return routeTemplate;
  }
  return fallbackPath;
}

function routeTemplateForPath(
  value: unknown,
  routeTemplates: ReadonlyMap<string, string>,
  fallbackPath?: string,
): string {
  if (typeof value !== "string") return fallbackPath ?? "";
  const path = cleanPath(value);
  return routeTemplates.get(path) ?? fallbackPath ?? "";
}

function safeCurrentURL(
  value: unknown,
  fallbackPath: string,
  routeTemplates: ReadonlyMap<string, string>,
): string {
  if (typeof value === "string") {
    try {
      const url = new URL(value, window.location.origin);
      const pathname = routeTemplates.get(url.pathname) ?? fallbackPath;
      return `${url.origin}${pathname}`;
    } catch {
      // Fall through to the current browser origin.
    }
  }
  return `${window.location.origin}${fallbackPath}`;
}

function safeReferrerOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "[redacted-url]";
  }
}

function sanitizeError(value: unknown): Error {
  const source =
    value instanceof Error
      ? value
      : typeof Event !== "undefined" && value instanceof Event
        ? new Error(`${value.constructor.name || "Event"}: ${value.type || "unknown"}`)
        : new Error(typeof value === "string" ? value : "Unknown client error");
  const result = new Error(scrubPropertyString(source.message || "Unknown client error"));
  result.name = source.name || "Error";
  if (source.stack) result.stack = scrubStack(source.stack);
  return result;
}

function sanitizePropertyValue(value: unknown): unknown {
  if (typeof value === "string") return scrubPropertyString(value);
  if (Array.isArray(value)) return value.map(sanitizePropertyValue);
  if (value && typeof value === "object") {
    return compactProperties(value as Record<string, unknown>);
  }
  return value;
}

function scrubPropertyString(value: string): string {
  return truncate(
    scrubSensitiveText(value).replace(/https?:\/\/[^\s)\]}]+/gi, "[redacted-url]"),
    200,
  );
}

function scrubStack(value: string): string {
  return scrubSensitiveText(value.replace(/https?:\/\/[^\s)\]}]+/gi, scrubStackURL));
}

function scrubStackURL(value: string): string {
  const withoutQueryOrFragment = value.replace(/[?#].*$/, "");
  try {
    const url = new URL(withoutQueryOrFragment);
    const pathname = url.pathname;
    if (
      /^\/(?:_app\/immutable|assets)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.m?js(?::\d+){0,2}$/.test(
        pathname,
      )
    ) {
      return `${url.origin}${pathname}`;
    }
  } catch {
    // Invalid absolute URLs are redacted below.
  }
  return "[redacted-url]";
}

function scrubSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:token|code|secret|key|signature|state)=)[^&\s)]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
