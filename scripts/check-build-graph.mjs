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

const [rootPackage, frontendPackage, docsPackage, marketingPackage, rootTurbo] =
  await Promise.all([
    readJSON("package.json"),
    readJSON("frontend/package.json"),
    readJSON("docs-site/package.json"),
    readJSON("marketing-site/package.json"),
    readJSON("turbo.json"),
  ]);

for (const [label, packageJSON] of [
  ["frontend", frontendPackage],
  ["docs", docsPackage],
  ["marketing", marketingPackage],
]) {
  requireCondition(
    typeof packageJSON.scripts?.build === "string",
    `${label} must expose the canonical build task used by Turbo`,
  );
  requireCondition(
    !packageJSON.scripts.build.includes("backend/cmd/openpost/public"),
    `${label} build must not write directly into the backend embed tree`,
  );
}

requireIncludes(
  rootPackage.scripts?.build,
  "bun run prepare:docs",
  "root build",
);
requireIncludes(rootPackage.scripts?.build, "turbo run build", "root build");
requireIncludes(
  rootPackage.scripts?.build,
  "bun run package:frontend",
  "root build",
);
requireIncludes(
  rootPackage.scripts?.["sync:assets"],
  "generate:social-catalog",
  "explicit all-surface asset sync",
);
requireIncludes(
  docsPackage.scripts?.["prepare:openapi"],
  "copy-docs-openapi.mjs",
  "docs package OpenAPI preparation",
);
requireIncludes(
  docsPackage.scripts?.["docs:build"],
  "bun run prepare:openapi",
  "docs package build",
);
requireIncludes(
  docsPackage.scripts?.["docs:dev"],
  "bun run prepare:openapi",
  "docs package dev server",
);
requireCondition(
  rootTurbo.tasks?.build?.outputs?.length === 0,
  "root Turbo build outputs must be package-owned",
);

const packageTurboPaths = [
  ["frontend/turbo.json", ["build/**"]],
  ["docs-site/turbo.json", [".vitepress/dist/**"]],
  ["marketing-site/turbo.json", ["dist/**", ".wrangler/functions/**"]],
];
for (const [relativePath, expectedOutputs] of packageTurboPaths) {
  const config = await readJSON(relativePath);
  requireCondition(
    JSON.stringify(config.tasks?.build?.outputs) ===
      JSON.stringify(expectedOutputs),
    `${relativePath} must own exactly ${expectedOutputs.join(", ")}`,
  );
  requireCondition(
    !config.tasks.build.outputs.some((output) => output.includes("backend/")),
    `${relativePath} must not cache a sibling backend path`,
  );
}

const frontendTurbo = await readJSON("frontend/turbo.json");
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
  ["docs", await readJSON("docs-site/turbo.json")],
  ["marketing", await readJSON("marketing-site/turbo.json")],
]) {
  for (const input of [
    "$TURBO_ROOT$/assets/**",
    "$TURBO_ROOT$/scripts/asset-surfaces.mjs",
    "$TURBO_ROOT$/scripts/asset-surfaces.ts",
    "$TURBO_ROOT$/scripts/sync-assets.mjs",
  ]) {
    requireCondition(
      turboConfig.tasks.build.inputs.includes(input),
      `${label} build hash is missing ${input}`,
    );
  }
}

const docsTurbo = await readJSON("docs-site/turbo.json");
for (const input of [
  "$TURBO_ROOT$/frontend/openapi.json",
  "$TURBO_ROOT$/scripts/copy-docs-openapi.mjs",
]) {
  requireCondition(
    docsTurbo.tasks.build.inputs.includes(input),
    `docs build hash is missing canonical OpenAPI input ${input}`,
  );
}

const marketingTurbo = await readJSON("marketing-site/turbo.json");
for (const transitionalInput of [
  "$TURBO_ROOT$/CHANGELOG.md",
  "$TURBO_ROOT$/frontend/messages/**",
  "$TURBO_ROOT$/frontend/project.inlang/settings.json",
  "$TURBO_ROOT$/frontend/src/lib/**",
  "$TURBO_ROOT$/provider-certification/public-claims.json",
]) {
  requireCondition(
    marketingTurbo.tasks.build.inputs.includes(transitionalInput),
    `marketing build hash is missing current cross-package input ${transitionalInput}`,
  );
}

const [
  adapterConfig,
  capacitorConfig,
  assetSync,
  dockerfile,
  devenv,
  frontendDevenv,
  ci,
  appPlaywright,
] = await Promise.all(
  [
    "frontend/svelte.config.js",
    "frontend/capacitor.config.ts",
    "scripts/sync-assets.mjs",
    "docker/Dockerfile",
    "devenv.nix",
    "frontend/devenv.nix",
    ".github/workflows/ci.yml",
    "playwright.app.config.ts",
  ].map((relativePath) => readFile(path.join(root, relativePath), "utf8")),
);
requireIncludes(adapterConfig, "pages: 'build'", "frontend adapter");
requireIncludes(adapterConfig, "assets: 'build'", "frontend adapter");
requireIncludes(capacitorConfig, "webDir: 'build'", "Capacitor config");
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
  "COPY --from=frontend-builder / ./backend/cmd/openpost/public",
  "production image frontend artifact copy",
);
requireCondition(
  !dockerfile.includes("bun run --filter @openpost/web build"),
  "production image must not rebuild the canonical frontend artifact",
);
requireIncludes(
  frontendPackage.scripts.build,
  "node ../scripts/frontend-vite-build.mjs",
  "frontend build memory contract",
);
requireIncludes(devenv, "bun run docs:build", "Devenv docs build");
requireIncludes(
  frontendDevenv,
  "bun run frontend:build",
  "Devenv frontend build",
);
requireIncludes(ci, "bun run check:build-graph", "CI quality contract");
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
for (const taskID of [
  "@openpost/web#build",
  "@openpost/docs#build",
  "@openpost/site#build",
]) {
  const task = tasks.get(taskID);
  requireCondition(
    task?.command,
    `${taskID} is missing from the root build contract`,
  );
  requireCondition(
    !task.outputs.some((output) =>
      output.includes("backend/cmd/openpost/public"),
    ),
    `${taskID} still claims the backend embed tree as a cached output`,
  );
}

console.log(
  "Build graph owns frontend, docs, and marketing artifacts locally; backend packaging is explicit.",
);
