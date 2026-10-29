import posthogRollupPlugin from "@posthog/rollup-plugin";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Plugin, PluginOption } from "vite";

function sourceMapOptions(surface: "app" | "marketing" | "docs") {
  const enabled = process.env.POSTHOG_SOURCEMAPS_ENABLED === "1";
  if (!enabled) return;

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
  return {
    personalApiKey,
    projectId,
    host: uiHost,
    logLevel: "info" as const,
    sourcemaps: {
      enabled: true,
      releaseName: `openpost-${surface}`,
      releaseVersion,
      build: process.env.GITHUB_RUN_ID?.trim(),
      deleteAfterUpload: true,
    },
  };
}

// Vite emits worker bundles and their maps as assets, which the upstream
// plugin's chunk-only writeBundle hook cannot process. Run its owned CLI on
// the final worker directory, after adapter output and before compression.
export async function uploadPostHogWorkerSourceMaps(directory: string) {
  const options = sourceMapOptions("app");
  if (!options) return;
  const requireFromPlugin = createRequire(import.meta.resolve("@posthog/rollup-plugin"));
  const cli = requireFromPlugin.resolve("@posthog/cli/run-posthog-cli.js");
  const args = [
    cli,
    "sourcemap",
    "process",
    "--directory",
    directory,
    "--release-name",
    options.sourcemaps.releaseName,
    "--release-version",
    options.sourcemaps.releaseVersion,
    ...(options.sourcemaps.build ? ["--build", options.sourcemaps.build] : []),
    "--delete-after",
  ];
  const result = spawnSync(process.execPath, args, {
    timeout: 120_000,
    stdio: "inherit",
    env: {
      ...process.env,
      RUST_LOG: `posthog_cli=${options.logLevel}`,
      POSTHOG_CLI_HOST: options.host,
      POSTHOG_CLI_API_KEY: options.personalApiKey,
      POSTHOG_CLI_PROJECT_ID: options.projectId,
    },
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`PostHog worker source-map upload failed (${result.signal ?? result.status})`);
  }
  const files = await readdir(directory, { recursive: true });
  const maps = files.filter((file) => file.endsWith(".map"));
  if (maps.length) {
    throw new Error(`PostHog worker source maps remain after upload: ${maps.join(", ")}`);
  }
}

export function postHogSourceMaps(surface: "app" | "marketing" | "docs") {
  const options = sourceMapOptions(surface);
  if (!options) return { enabled: false, plugins: [] as PluginOption[] };
  const plugin = posthogRollupPlugin(options);
  // These adapter-static surfaces ship only browser assets. Their SSR output
  // exists for prerendering/builds, whose failures stay in the build log.
  // Filter before the upstream config hook can enable maps or writeBundle can
  // invoke the CLI. Vite 8 supplies isSsrBuild in ConfigEnv (not `ssrBuild`).
  const vitePlugin = plugin as unknown as Plugin;
  const plugins: PluginOption[] = [vitePlugin];
  if (surface === "app" || surface === "marketing") {
    // SvelteKit can set build.ssr after the initial config callback. Enforce
    // map scope after its config hook, including inherited sourcemap settings.
    plugins.unshift({
      name: "openpost-static-source-map-scope",
      enforce: "post",
      config(config, { isSsrBuild }) {
        if (isSsrBuild || config.build?.ssr) return { build: { sourcemap: false } };
      },
    });
    vitePlugin.apply = (config, { command, isSsrBuild }) =>
      command === "build" && !isSsrBuild && !config.build?.ssr;
  }
  return { enabled: true, plugins };
}
