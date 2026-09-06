import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJSON(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireIncludes(value, expected, label) {
  requireCondition(
    String(value).includes(expected),
    `${label} must include ${JSON.stringify(expected)}`,
  );
}

const [rootPackage, frontendPackage, docsPackage, marketingPackage, rootTurbo, tasksSource] =
  await Promise.all([
    readJSON("package.json"),
    readJSON("apps/web/package.json"),
    readJSON("apps/docs/package.json"),
    readJSON("apps/marketing/package.json"),
    readJSON("turbo.json"),
    readFile(path.join(root, "scripts/tasks.mjs"), "utf8"),
  ]);

for (const [label, packageJSON] of [
  ["apps/web", frontendPackage],
  ["docs", docsPackage],
  ["marketing", marketingPackage],
]) {
  requireCondition(
    typeof packageJSON.scripts?.build === "string",
    `${label} must expose the canonical build task used by Turbo`,
  );
  requireCondition(
    !packageJSON.scripts.build.includes("apps/server/cmd/openpost/public"),
    `${label} build must not write directly into the backend embed tree`,
  );
}

requireIncludes(rootPackage.scripts?.build, "scripts/tasks.mjs build", "root build");
requireIncludes(tasksSource, "scripts/sync-docs-external.mjs", "root build registry");
requireIncludes(tasksSource, '"turbo", "run", "build"', "root build registry");
requireIncludes(tasksSource, '"@openpost/web", "package"', "root build registry");
requireIncludes(docsPackage.scripts?.build, "copy-docs-openapi.mjs", "docs package build");
requireIncludes(docsPackage.scripts?.dev, "copy-docs-openapi.mjs", "docs package dev server");
requireCondition(
  rootPackage.scripts?.["sync:assets"] === undefined,
  "all-surface asset sync must stay internal to the canonical build registry",
);
requireCondition(
  rootTurbo.tasks?.build?.outputs?.length === 0,
  "root Turbo build outputs must be package-owned",
);

const packageTurboPaths = [
  ["apps/web/turbo.json", ["build/**", "!build/image-editor-models/**"]],
  ["apps/docs/turbo.json", [".vitepress/dist/**"]],
  ["apps/marketing/turbo.json", ["dist/**", ".wrangler/functions/**"]],
];
for (const [relativePath, expectedOutputs] of packageTurboPaths) {
  const config = await readJSON(relativePath);
  requireCondition(
    JSON.stringify(config.tasks?.build?.outputs) === JSON.stringify(expectedOutputs),
    `${relativePath} must own exactly ${expectedOutputs.join(", ")}`,
  );
  requireCondition(
    !config.tasks.build.outputs.some((output) => output.includes("apps/server/")),
    `${relativePath} must not cache a sibling backend path`,
  );
}

const frontendTurbo = await readJSON("apps/web/turbo.json");
for (const task of ["check", "test"]) {
  requireCondition(
    frontendTurbo.tasks[task].inputs.includes("$TURBO_ROOT$/scripts/posthog-source-maps.ts"),
    `frontend ${task} hash is missing the shared Vite configuration input`,
  );
}
requireCondition(
  frontendTurbo.tasks.build.env.includes("NODE_OPTIONS"),
  "frontend build must pass and hash user NODE_OPTIONS",
);
for (const input of [
  "$TURBO_ROOT$/assets/**",
  "$TURBO_ROOT$/scripts/asset-surfaces.mjs",
  "$TURBO_ROOT$/scripts/asset-surfaces.ts",
  "$TURBO_ROOT$/scripts/sync-assets.mjs",
  "$TURBO_ROOT$/scripts/frontend-vite-build.mjs",
  "$TURBO_ROOT$/scripts/generate-app-route-manifest.mjs",
  "$TURBO_ROOT$/scripts/precompress-static.mjs",
]) {
  requireCondition(
    frontendTurbo.tasks.build.inputs.includes(input),
    `frontend build hash is missing ${input}`,
  );
}

for (const [label, turboConfig] of [
  ["docs", await readJSON("apps/docs/turbo.json")],
  ["marketing", await readJSON("apps/marketing/turbo.json")],
]) {
  for (const input of [
    "$TURBO_ROOT$/assets/**",
    "$TURBO_ROOT$/scripts/asset-surfaces.mjs",
    "$TURBO_ROOT$/scripts/asset-surfaces.ts",
    "$TURBO_ROOT$/scripts/check-public-telemetry-env.mjs",
    "$TURBO_ROOT$/scripts/sync-assets.mjs",
  ]) {
    requireCondition(
      turboConfig.tasks.build.inputs.includes(input),
      `${label} build hash is missing ${input}`,
    );
  }
  for (const environmentName of ["CF_PAGES", "CF_PAGES_BRANCH"]) {
    requireCondition(
      turboConfig.tasks.build.env?.includes(environmentName),
      `${label} build must pass ${environmentName} to the production telemetry guard`,
    );
  }
}

const docsTurbo = await readJSON("apps/docs/turbo.json");
for (const input of [
  "$TURBO_ROOT$/apps/web/openapi.json",
  "$TURBO_ROOT$/scripts/copy-docs-openapi.mjs",
]) {
  requireCondition(
    docsTurbo.tasks.build.inputs.includes(input),
    `docs build hash is missing canonical OpenAPI input ${input}`,
  );
}

const marketingTurbo = await readJSON("apps/marketing/turbo.json");
for (const transitionalInput of [
  "$TURBO_ROOT$/CHANGELOG.md",
  "$TURBO_ROOT$/apps/web/messages/**",
  "$TURBO_ROOT$/apps/web/project.inlang/settings.json",
  "$TURBO_ROOT$/apps/web/src/lib/**",
  "$TURBO_ROOT$/config/provider-certification/public-claims.json",
]) {
  requireCondition(
    marketingTurbo.tasks.build.inputs.includes(transitionalInput),
    `marketing build hash is missing current cross-package input ${transitionalInput}`,
  );
}
for (const checkInput of [
  "$TURBO_ROOT$/CHANGELOG.md",
  "$TURBO_ROOT$/apps/web/messages/**",
  "$TURBO_ROOT$/apps/web/project.inlang/settings.json",
  "$TURBO_ROOT$/apps/web/src/lib/**",
  "$TURBO_ROOT$/config/provider-certification/public-claims.json",
]) {
  requireCondition(
    marketingTurbo.tasks.check.inputs.includes(checkInput),
    `marketing check hash is missing current cross-package input ${checkInput}`,
  );
}

const [adapterConfig, assetSync, dockerfile, devenv, frontendDevenv, ci, appPlaywright] =
  await Promise.all(
    [
      "apps/web/svelte.config.js",
      "scripts/sync-assets.mjs",
      "deploy/docker/Dockerfile",
      "devenv.nix",
      "apps/web/devenv.nix",
      ".github/workflows/ci.yml",
      "tests/app/playwright.config.ts",
    ].map((relativePath) => readFile(path.join(root, relativePath), "utf8")),
  );
requireIncludes(adapterConfig, "pages: 'build'", "frontend adapter");
requireIncludes(adapterConfig, "assets: 'build'", "frontend adapter");
requireIncludes(
  adapterConfig,
  "assets: process.env.OPENPOST_BUILD_PUBLIC_DIR || 'static'",
  "frontend build asset input",
);
requireCondition(
  !assetSync.includes("generateSocialCatalog"),
  "package asset synchronization must not mutate the social-image package",
);
requireIncludes(
  dockerfile,
  "FROM frontend_artifact AS frontend-builder",
  "production image frontend artifact context",
);
requireIncludes(
  dockerfile,
  "COPY --from=frontend-builder / ./apps/server/cmd/openpost/public",
  "production image frontend artifact copy",
);
requireCondition(
  !dockerfile.includes("bun run --filter @openpost/web build"),
  "production image must not rebuild the canonical frontend artifact",
);
requireIncludes(
  frontendPackage.scripts.build,
  "node ../../scripts/frontend-vite-build.mjs",
  "frontend build memory contract",
);
requireCondition(
  !devenv.includes("    build.exec"),
  "Devenv must not duplicate the root build interface",
);
requireCondition(
  !frontendDevenv.includes("scripts ="),
  "frontend Devenv must provide tools without task aliases",
);
requireIncludes(ci, "bun run check -- policy", "CI quality contract");
requireIncludes(ci, 'OPENPOST_E2E_PREBUILT: "1"', "CI browser artifact reuse");
requireIncludes(
  appPlaywright,
  "OPENPOST_E2E_PREBUILT",
  "application browser prebuilt-artifact switch",
);

const dryRun = spawnSync("bunx", ["turbo", "run", "build", "--dry=json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (dryRun.status !== 0) {
  if (dryRun.stderr) process.stderr.write(dryRun.stderr);
  throw new Error("Turbo could not resolve the root build graph");
}
const graph = JSON.parse(dryRun.stdout);
const tasks = new Map(graph.tasks.map((task) => [task.taskId, task]));
for (const taskID of ["@openpost/web#build", "@openpost/docs#build", "@openpost/site#build"]) {
  const task = tasks.get(taskID);
  requireCondition(task?.command, `${taskID} is missing from the root build contract`);
  requireCondition(
    !task.outputs.some((output) => output.includes("apps/server/cmd/openpost/public")),
    `${taskID} still claims the backend embed tree as a cached output`,
  );
}

console.log(
  "Build graph owns frontend, docs, and marketing artifacts locally; backend packaging is explicit.",
);
