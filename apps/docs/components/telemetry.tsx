"use client";
import { ChevronRight } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  captureTelemetryPageView,
  configureTelemetry,
  getTelemetryPreference,
  installGlobalErrorCapture,
  setTelemetryPreference,
  subscribeTelemetryPreference,
  type TelemetryPreference,
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
      environment: process.env.NEXT_PUBLIC_OPENPOST_ENVIRONMENT ?? "development",
      revision: process.env.NEXT_PUBLIC_OPENPOST_REVISION,
      edition: "public",
      surface: "docs",
    });
    return installGlobalErrorCapture();
  }, []);
  useEffect(() => {
    captureTelemetryPageView(pathname);
  }, [pathname]);
  return null;
}

export function AnalyticsChoices() {
  const preference = useSyncExternalStore(
    subscribeTelemetryPreference,
    getTelemetryPreference,
    () => "undecided",
  );
  const choices: { value: TelemetryPreference; label: string }[] = [
    { value: "cookieless", label: "Without cookies" },
    { value: "persistent", label: "With cookies" },
    { value: "off", label: "Off" },
  ];
  return (
    <details className="analytics-choices">
      <summary>
        <ChevronRight size={12} aria-hidden="true" />
        Analytics choices
      </summary>
      <p>Choose how OpenPost measures visits to its public pages.</p>
      <div role="group" aria-label="Analytics preference">
        {choices.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={preference === value}
            onClick={() => setTelemetryPreference(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <a href="https://openpo.st/privacy">Privacy policy</a>
    </details>
  );
}
