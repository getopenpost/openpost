import posthogRollupPlugin from "@posthog/rollup-plugin";
import type { Plugin, PluginOption } from "vite";

export function postHogSourceMaps(surface: "app" | "marketing" | "docs") {
  const enabled = process.env.POSTHOG_SOURCEMAPS_ENABLED === "1";
  if (!enabled) return { enabled: false, plugins: [] as PluginOption[] };

  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!personalApiKey || !projectId) {
    throw new Error(
      "POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required when PostHog source-map upload is enabled",
    );
  }
  const releaseVersion =
    process.env.OPENPOST_RELEASE_VERSION?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.CF_PAGES_COMMIT_SHA?.trim() ||
    process.env.VITE_OPENPOST_REVISION?.trim();
  if (!releaseVersion) {
    throw new Error(
      "OPENPOST_RELEASE_VERSION, GITHUB_SHA, CF_PAGES_COMMIT_SHA, or VITE_OPENPOST_REVISION is required when PostHog source-map upload is enabled",
    );
  }

  // The UI host selects the region the symbols are uploaded to. There is no
  // silent default: uploading EU project symbols to the US host (or vice
  // versa) leaves production errors unsymbolicated with no build-time signal.
  const uiHost = process.env.POSTHOG_UI_HOST?.trim();
  if (!uiHost) {
    throw new Error("POSTHOG_UI_HOST is required when PostHog source-map upload is enabled");
  }
  const plugin = posthogRollupPlugin({
    personalApiKey,
    projectId,
    host: uiHost,
    logLevel: "info",
    sourcemaps: {
      enabled: true,
      releaseName: `openpost-${surface}`,
      releaseVersion,
      build: process.env.GITHUB_RUN_ID?.trim(),
      deleteAfterUpload: true,
    },
  });
  // These adapter-static surfaces ship only browser assets. Their SSR output
  // exists for prerendering/builds, whose failures stay in the build log.
  // Filter before the upstream config hook can enable maps or writeBundle can
  // invoke the CLI. Vite 8 supplies isSsrBuild in ConfigEnv (not `ssrBuild`).
  const vitePlugin = plugin as unknown as Plugin;
  if (surface === "app" || surface === "marketing") {
    vitePlugin.apply = (config, { command, isSsrBuild }) =>
      command === "build" && !isSsrBuild && !config.build?.ssr;
  }
  return { enabled: true, plugins: [vitePlugin] };
}
