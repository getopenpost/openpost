"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  captureTelemetryPageView,
  configureTelemetry,
  getTelemetryPreference,
  installGlobalErrorCapture,
  setTelemetryPreference,
  subscribeTelemetryPreference,
  telemetryConsentCopy,
  telemetryPreferencesEvent,
  openTelemetryPreferences,
} from "@openpost/telemetry";

export function Telemetry() {
  const pathname = usePathname();
  useEffect(() => {
    configureTelemetry({
      enabled: Boolean(
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
      ),
      projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      apiHost: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
      uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
      environment: process.env.NEXT_PUBLIC_OPENPOST_ENVIRONMENT ?? "development",
      version: process.env.NEXT_PUBLIC_OPENPOST_VERSION,
      revision: process.env.NEXT_PUBLIC_OPENPOST_REVISION,
      edition: "public",
      surface: "docs",
    });
    return installGlobalErrorCapture();
  }, []);
  useEffect(() => {
    captureTelemetryPageView(pathname);
  }, [pathname]);
  return <CookieBanner />;
}

function CookieBanner() {
  const preference = useSyncExternalStore(
    subscribeTelemetryPreference,
    getTelemetryPreference,
    () => "unavailable",
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const banner = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const open = () => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPreferencesOpen(true);
    };
    window.addEventListener(telemetryPreferencesEvent, open);
    return () => window.removeEventListener(telemetryPreferencesEvent, open);
  }, []);
  useEffect(() => {
    if (preferencesOpen) banner.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [preferencesOpen]);
  if (preference !== "undecided" && !preferencesOpen) return null;
  const copy = telemetryConsentCopy;
  const close = () => {
    setPreferencesOpen(false);
    returnFocus.current?.focus();
    returnFocus.current = null;
  };
  const choose = (next: "persistent" | "cookieless" | "off") => {
    setTelemetryPreference(next);
    close();
  };
  return (
    <section
      ref={banner}
      className="cookie-banner"
      aria-labelledby="cookie-banner-title"
      aria-live={preference === "undecided" ? "polite" : "off"}
      data-testid="telemetry-consent"
    >
      <div className="cookie-banner-heading">
        <h2 id="cookie-banner-title">{copy.title}</h2>
        {preference !== "undecided" && (
          <button type="button" onClick={close}>
            {copy.closeLabel}
          </button>
        )}
      </div>
      <p>{copy.description}</p>
      <a href="https://openpo.st/privacy">{copy.privacyLabel}</a>
      <div className="cookie-banner-actions">
        <button type="button" aria-pressed={preference === "off"} onClick={() => choose("off")}>
          {copy.offLabel}
        </button>
        <button
          type="button"
          className="cookie-banner-accept"
          aria-pressed={preference === "persistent"}
          onClick={() => choose("persistent")}
        >
          {copy.allowLabel}
        </button>
      </div>
      <details>
        <summary>
          {copy.optionsLabel}
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <p>{copy.cookielessDescription}</p>
        <button
          type="button"
          aria-pressed={preference === "cookieless"}
          onClick={() => choose("cookieless")}
        >
          {copy.cookielessLabel}
        </button>
      </details>
    </section>
  );
}

export function AnalyticsChoices() {
  return (
    <button type="button" className="analytics-choices" onClick={openTelemetryPreferences}>
      <ChevronRight size={12} aria-hidden="true" />
      Cookie preferences
    </button>
  );
}
