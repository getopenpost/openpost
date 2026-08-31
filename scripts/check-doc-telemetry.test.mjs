import { describe, expect, test } from "bun:test";
import { productionConfigurationError } from "./check-public-telemetry-env.mjs";

describe("documentation telemetry", () => {
  test("rejects production Cloudflare builds without public telemetry configuration", () => {
    const error = productionConfigurationError({
      CF_PAGES: "1",
      CF_PAGES_BRANCH: "main",
      VITE_POSTHOG_PROJECT_TOKEN: "",
      VITE_POSTHOG_API_HOST: "",
      VITE_POSTHOG_UI_HOST: "",
    });

    expect(error).toContain("VITE_POSTHOG_PROJECT_TOKEN");
    expect(error).toContain("VITE_POSTHOG_API_HOST");
    expect(error).toContain("VITE_POSTHOG_UI_HOST");
  });

  test("requires the managed PostHog proxy and EU interface for canonical production builds", () => {
    const error = productionConfigurationError({
      CF_PAGES: "",
      CF_PAGES_BRANCH: "",
      VITE_OPENPOST_ENVIRONMENT: "production",
      VITE_POSTHOG_PROJECT_TOKEN: "phc_test",
      VITE_POSTHOG_API_HOST: "https://example.com",
      VITE_POSTHOG_UI_HOST: "https://us.posthog.com",
    });

    expect(error).toContain("https://cool.openpost.social");
  });

  test("allows local development without public telemetry configuration", () => {
    const error = productionConfigurationError({
      CF_PAGES: "",
      CF_PAGES_BRANCH: "",
      VITE_OPENPOST_ENVIRONMENT: "",
      VITE_POSTHOG_PROJECT_TOKEN: "",
      VITE_POSTHOG_API_HOST: "",
      VITE_POSTHOG_UI_HOST: "",
    });
    expect(error).toBeNull();
  });
});
