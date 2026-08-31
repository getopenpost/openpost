const managedAPIHost = "https://cool.openpost.social";
const managedUIHost = "https://eu.posthog.com";

export function productionConfigurationError(environment) {
  const isProductionPublicBuild =
    environment.VITE_OPENPOST_ENVIRONMENT === "production" ||
    (environment.CF_PAGES === "1" && environment.CF_PAGES_BRANCH === "main");
  if (!isProductionPublicBuild) return null;

  const required = ["VITE_POSTHOG_PROJECT_TOKEN", "VITE_POSTHOG_API_HOST", "VITE_POSTHOG_UI_HOST"];
  const missing = required.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    return `Production public-site telemetry is missing: ${missing.join(", ")}`;
  }

  const apiHost = new URL(environment.VITE_POSTHOG_API_HOST);
  if (apiHost.href.replace(/\/$/u, "") !== managedAPIHost) {
    return `VITE_POSTHOG_API_HOST must be ${managedAPIHost} in production`;
  }

  const uiHost = new URL(environment.VITE_POSTHOG_UI_HOST);
  if (uiHost.href.replace(/\/$/u, "") !== managedUIHost) {
    return `VITE_POSTHOG_UI_HOST must be ${managedUIHost} in production`;
  }

  return null;
}

if (import.meta.main) {
  const configurationError = productionConfigurationError(process.env);
  if (configurationError) throw new Error(configurationError);
}
