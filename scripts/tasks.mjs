#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  formatPruneResult,
  pruneTurboCache,
  removeLegacyTurboCache,
  resolveTurboCacheDirectory,
  turboCacheMaxBytes,
  tryTurboCacheMaintenance,
  withTurboCacheDirectory,
  withTurboCacheLease,
  withTurboCacheLock,
} from "./turbo-cache.mjs";

const root = path.resolve(import.meta.dir, "..");
const [command, rawScope, ...flags] = process.argv.slice(2);
const scope = rawScope?.startsWith("--") ? undefined : rawScope;
const options = new Set(rawScope?.startsWith("--") ? [rawScope, ...flags] : flags);

const surfaceScopes = ["frontend", "backend", "cli", "marketing", "docs"];
const browserScopes = ["e2e", "e2e-app", "e2e-docs"];

const checks = {
  contracts: stage("generated contracts", [bun("scripts/check-contracts.mjs")]),
  "n8n-package": stage("n8n package", [
    bunTest("scripts/n8n-package-release.test.mjs"),
    bunTest("scripts/generate-selected-automation-contract.test.mjs"),
    bun("scripts/generate-selected-automation-contract.mjs", "--check"),
    commandStep("bun", "run", "check", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "test", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "lint", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "build", { cwd: "packages/n8n-nodes-openpost" }),
    bun("scripts/check-n8n-package-build.mjs"),
  ]),
  "build-graph": stage("build graph", [
    bunTest(
      "scripts/build-graph.test.mjs",
      "scripts/frontend-vite-build.test.mjs",
      "scripts/package-frontend.test.mjs",
      "scripts/precompress-static.test.mjs",
    ),
    bun("scripts/check-build-graph.mjs"),
  ]),
  assets: stage("asset surfaces", [
    bunTest("scripts/asset-surfaces.test.mjs"),
    bun("scripts/asset-surfaces.mjs"),
  ]),
  "image-policy": stage("image policy", [
    bunTest("scripts/check-image-policy.test.mjs", "scripts/image-evidence.test.mjs"),
    bun("scripts/check-image-policy.mjs"),
  ]),
  "mcp-registry": stage("MCP registry", [
    bunTest("scripts/check-mcp-registry.test.mjs"),
    bun("scripts/check-mcp-registry.mjs"),
  ]),
  docs: stage("documentation policy", [
    bunTest(
      "scripts/check-doc-links.test.mjs",
      "scripts/check-doc-telemetry.test.mjs",
      "scripts/sync-docs-external.test.mjs",
    ),
    bun("scripts/check-doc-links.mjs"),
  ]),
  "release-version": stage("release version", [
    bunTest(
      "scripts/next-release-version.test.mjs",
      "scripts/n8n-package-release.test.mjs",
      "scripts/mobile-release.test.mjs",
      "scripts/release-manifest.test.mjs",
      "scripts/release-assets.test.mjs",
      "scripts/release-lifecycle.test.mjs",
      "scripts/ci-artifacts.test.mjs",
      "scripts/ci-plan.test.mjs",
      "scripts/release-asset-upload.test.mjs",
      "scripts/release-ci-contract.test.mjs",
      "scripts/release-surfaces.test.mjs",
    ),
    bun("scripts/release-surfaces.mjs"),
  ]),
  "app-routes": stage("application routes", [
    bunTest("scripts/generate-app-route-manifest.test.mjs"),
    bun("scripts/generate-app-route-manifest.mjs", "--check"),
  ]),
  "public-routes": stage("public routes", [
    bunTest("scripts/cloudflare-edge-plan.test.mjs"),
    bunTest("scripts/check-marketing-route-manifest.test.mjs"),
    bunTest("scripts/marketing-agent-readiness.test.mjs"),
    bunTest("scripts/generate-agent-surfaces.test.mjs"),
    bunTest("scripts/public-deployment-proof.test.mjs"),
    bun("scripts/check-marketing-route-manifest.mjs"),
  ]),
  "legal-policy": stage("legal policy", [
    bunTest(
      "scripts/legal-policy-manifest.test.mjs",
      "scripts/check-browser-storage-inventory.test.mjs",
      "packages/legal-policy/src/index.test.mjs",
    ),
    bun("scripts/legal-policy-manifest.mjs", "check"),
    bun("scripts/check-browser-storage-inventory.mjs"),
  ]),
  "marketing-claims": stage("marketing claims", [
    bunTest("scripts/marketing-claims.test.mjs"),
    bun("scripts/marketing-claims.mjs"),
  ]),
  "provider-certification": stage("provider certification", [
    bunTest("scripts/provider-certification-manifest.test.mjs"),
    bun("scripts/provider-certification-manifest.mjs", "check"),
  ]),
  "provider-facts": stage("provider facts", [
    bunTest("scripts/provider-catalog-facts.test.mjs"),
    bun("scripts/provider-catalog-facts.mjs"),
  ]),
  "plan-catalog": stage("plan catalog", [
    bun("scripts/plan-catalog.mjs", "--check"),
    bunTest("packages/plan-catalog/src/index.test.ts"),
  ]),
  changelog: stage("changelog", [
    bun("scripts/check-changelog.mjs"),
    bunTest("packages/changelog/src/index.test.mjs"),
  ]),
  "social-images": stage("social images", [
    bun("scripts/social-images/catalog.mjs", "--check"),
    bunTest("packages/social-images/src/index.test.mjs"),
    commandStep("bunx", "tsc", "--noEmit", "-p", "tsconfig.functions.json", {
      cwd: "marketing-site",
    }),
    commandStep(
      "bunx",
      "wrangler",
      "pages",
      "functions",
      "build",
      "functions",
      "--outdir",
      ".wrangler/functions",
      "--project-directory",
      ".",
      { cwd: "marketing-site" },
    ),
  ]),
  reachability: stage("production reachability", [
    commandStep("scripts/check-go-deadcode.sh"),
    commandStep("bunx", "knip", "--production", "--include", "files", "--no-config-hints"),
  ]),
  "secret-scan": stage("secret scan", [commandStep("bash", "scripts/scan-secrets.sh")]),
  compatibility: stage("compatibility surfaces", [
    bunTest("scripts/compatibility-surfaces.test.mjs"),
    bun("scripts/compatibility-surfaces.mjs"),
  ]),
  "ui-consistency": stage("UI consistency", [bun("scripts/check-ui-consistency.mjs")]),
  agents: stage("agent instructions", [
    bunTest("scripts/agent-doctor.test.mjs"),
    bun("scripts/agent-doctor.mjs"),
  ]),
  tasks: stage("task interface", [
    bunTest(
      "scripts/tasks.test.mjs",
      "scripts/changed-files-check.test.mjs",
      "scripts/secret-scan-contract.test.mjs",
      "scripts/turbo-cache.test.mjs",
    ),
  ]),
  "frontend-build-cache": stage("frontend build cache", [
    bun("scripts/verify-frontend-build-cache.mjs"),
  ]),
};

const policyGroups = [
  [
    "build-graph",
    "assets",
    "image-policy",
    "mcp-registry",
    "docs",
    "release-version",
    "secret-scan",
  ],
  [
    "app-routes",
    "public-routes",
    "legal-policy",
    "marketing-claims",
    "provider-certification",
    "provider-facts",
  ],
  [
    "plan-catalog",
    "changelog",
    "social-images",
    "reachability",
    "compatibility",
    "ui-consistency",
    "tasks",
  ],
];

if (import.meta.main) {
  try {
    const plan = resolvePlan(command, scope, options);
    if (options.has("--plan")) {
      console.log(JSON.stringify(publicPlan(plan), null, 2));
    } else {
      const cacheDirectory = resolveTurboCacheDirectory({ repositoryRoot: root });
      if (process.env.OPENPOST_ROOT_TASK_LOCKED === "1") {
        await execute(plan, { cacheDirectory, enforceCacheLimit: false });
      } else {
        const worktreeLock = path.join(root, ".turbo", "root-task");
        if (plan.command === "dev") {
          await withTurboCacheLock({ directory: worktreeLock }, async () => {
            await removeLegacyTurboCache(path.join(root, ".turbo", "cache"));
          });
          await execute(plan, { cacheDirectory, enforceCacheLimit: false });
        } else {
          await withTurboCacheLock({ directory: worktreeLock }, async () => {
            await removeLegacyTurboCache(path.join(root, ".turbo", "cache"));
            await executeWithCacheLease(plan, cacheDirectory);
          });
        }
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export function resolvePlan(requestedCommand, requestedScope, requestedOptions = new Set()) {
  if (!requestedCommand) throw new Error(help());
  switch (requestedCommand) {
    case "dev":
      return devPlan(requestedScope);
    case "format":
    case "format:check":
      return formatPlan(requestedCommand, requestedScope);
    case "lint":
      return lintPlan(requestedScope);
    case "check":
      return checkPlan(requestedScope, requestedOptions);
    case "test":
      return testPlan(requestedScope, requestedOptions);
    case "build":
      return buildPlan(requestedScope);
    case "verify":
      if (requestedScope) throw unsupported("verify", requestedScope, []);
      return plan("verify", undefined, [
        [taskStage("static checks", "check")],
        [taskStage("format check", "format:check"), taskStage("lint", "lint")],
        [taskStage("tests", "test")],
        [taskStage("production builds", "build")],
      ]);
    default:
      throw new Error(`unknown task ${JSON.stringify(requestedCommand)}\n${help()}`);
  }
}

function devPlan(requestedScope) {
  const supported = ["frontend", "backend", "marketing", "docs"];
  if (requestedScope && !supported.includes(requestedScope)) {
    throw unsupported("dev", requestedScope, supported);
  }
  const stages = {
    frontend: stage("frontend development server", [bunRun("--filter", "@openpost/web", "dev")]),
    backend: stage("backend development server", [
      go("run", "-tags", "dev", "./cmd/openpost", { cwd: "backend" }),
    ]),
    marketing: stage("marketing development server", [bunRun("--filter", "@openpost/site", "dev")]),
    docs: stage("documentation development server", [bunRun("--filter", "@openpost/docs", "dev")]),
  };
  return plan("dev", requestedScope, [
    [...(requestedScope ? [stages[requestedScope]] : [stages.frontend, stages.backend])],
  ]);
}

function formatPlan(requestedCommand, requestedScope) {
  if (requestedScope && !surfaceScopes.includes(requestedScope)) {
    throw unsupported(requestedCommand, requestedScope, surfaceScopes);
  }
  const check = requestedCommand === "format:check";
  const oxfmt = (label, target, cwd, config) =>
    stage(label, [
      commandStep(
        "bunx",
        "oxfmt",
        ...(config ? ["--config", config] : []),
        check ? "--check" : "--write",
        target,
        cwd ? { cwd } : {},
      ),
    ]);
  const gofmt = (label, directory) =>
    stage(label, [
      {
        type: "gofmt",
        directory,
        check,
        display: `gofmt ${check ? "--check" : "--write"} ${directory}`,
      },
    ]);
  const stages = {
    frontend: oxfmt("frontend format", ".", "frontend"),
    backend: gofmt("backend format", "backend"),
    cli: gofmt("CLI format", "cli"),
    marketing: oxfmt("marketing format", ".", "marketing-site"),
    docs: oxfmt("documentation format", "docs-site"),
  };
  if (requestedScope) return plan(requestedCommand, requestedScope, [[stages[requestedScope]]]);
  return plan(requestedCommand, undefined, [
    [oxfmt("repository format", "."), stages.backend, stages.cli],
  ]);
}

function lintPlan(requestedScope) {
  if (requestedScope && !surfaceScopes.includes(requestedScope)) {
    throw unsupported("lint", requestedScope, surfaceScopes);
  }
  const frontend = stage("frontend lint", [
    commandStep("bunx", "turbo", "run", "lint:oxlint", "lint:svelte", "--filter", "@openpost/web"),
  ]);
  const backend = stage("backend lint", [
    commandStep("golangci-lint", "run", "--build-tags", "dev", "./...", {
      cwd: "backend",
      prepareEmbed: true,
    }),
  ]);
  const cli = stage("CLI lint", [commandStep("golangci-lint", "run", "./...", { cwd: "cli" })]);
  const marketing = stage("marketing lint", [
    commandStep("bunx", "oxlint", "--config", "frontend/.oxlintrc.json", "marketing-site"),
  ]);
  const docs = checks.docs;
  const byScope = { frontend, backend, cli, marketing, docs };
  if (requestedScope) return plan("lint", requestedScope, [[byScope[requestedScope]]]);
  return plan("lint", undefined, [
    [frontend, backend, marketing],
    [cli, stage("workflow lint", [commandStep("actionlint", "-color")])],
  ]);
}

function checkPlan(requestedScope, requestedOptions) {
  if (requestedScope && checks[requestedScope] && requestedScope !== "docs") {
    return plan("check", requestedScope, [[checks[requestedScope]]]);
  }
  const supported = [...surfaceScopes, "policy", ...Object.keys(checks)];
  if (requestedScope && !supported.includes(requestedScope)) {
    throw unsupported("check", requestedScope, supported);
  }

  const contracts = checks.contracts;
  const translations = stage("frontend translations", [
    bunRun("--filter", "@openpost/web", "generate:i18n"),
  ]);
  const frontend = stage("frontend types", [
    commandStep("bunx", "turbo", "run", "check", "--filter", "@openpost/web", {
      env: { OPENPOST_CHECK_PREPARED: "1" },
    }),
  ]);
  const marketing = stage("marketing types", [
    commandStep("bunx", "turbo", "run", "check", "--filter", "@openpost/site"),
  ]);
  const backend = stage("backend types", [
    go("test", "-tags", "dev", "-run", "^$", "./...", { cwd: "backend" }),
  ]);
  const cli = stage("CLI types", [go("test", "-run", "^$", "./...", { cwd: "cli" })]);
  const policy = stage("repository policy", [commandStep("bunx", "turbo", "run", "_policy")]);

  if (requestedScope === "frontend") {
    return plan("check", requestedScope, [[contracts], [translations], [frontend]]);
  }
  if (requestedScope === "backend") return plan("check", requestedScope, [[contracts], [backend]]);
  if (requestedScope === "cli") return plan("check", requestedScope, [[contracts], [cli]]);
  if (requestedScope === "marketing") return plan("check", requestedScope, [[marketing]]);
  if (requestedScope === "docs") return plan("check", requestedScope, [[checks.docs]]);

  const groups = policyGroups.map((group) => group.map((name) => checks[name]));
  if (requestedScope === "policy") {
    if (requestedOptions.has("--policy-only")) {
      return plan("check", requestedScope, groups);
    }
    return plan("check", requestedScope, [[contracts], [translations], [policy]]);
  }
  return plan("check", undefined, [
    [contracts],
    [translations],
    [frontend, marketing, backend, cli, policy],
  ]);
}

function testPlan(requestedScope, requestedOptions) {
  const supported = [...surfaceScopes, ...browserScopes];
  if (requestedScope && !supported.includes(requestedScope)) {
    throw unsupported("test", requestedScope, supported);
  }
  const backendArguments = ["test", "-tags", "dev"];
  if (process.env.OPENPOST_GO_TEST_RACE === "1") backendArguments.push("-race");
  if (process.env.OPENPOST_GO_COVERAGE_FILE) {
    backendArguments.push(`-coverprofile=${process.env.OPENPOST_GO_COVERAGE_FILE}`);
  }
  backendArguments.push("./...");
  const backend = stage("backend tests", [go(...backendArguments, { cwd: "backend" })]);
  const cli = stage("CLI tests", [go("test", "./...", { cwd: "cli" })]);
  const frontend = stage("frontend tests", [
    commandStep(
      "bunx",
      "turbo",
      "run",
      "test",
      "--filter",
      "@openpost/web",
      "--filter",
      "@openpost/telemetry",
      "--filter",
      "@openpost/social-preview",
    ),
  ]);
  const workspace = stage("workspace tests", [
    commandStep("bunx", "turbo", "run", "test", "--concurrency", "1"),
  ]);
  const repository = stage("repository tests", [bunTest("./scripts")]);
  const nonBrowserFrontend = stage("frontend server tests", [
    commandStep("bunx", "turbo", "run", "test:server", "--filter", "@openpost/web"),
  ]);
  const marketing = stage("marketing tests", [
    bunTest(
      "scripts/check-marketing-route-manifest.test.mjs",
      "scripts/marketing-agent-readiness.test.mjs",
      "scripts/marketing-claims.test.mjs",
      "scripts/legal-policy-manifest.test.mjs",
    ),
  ]);
  const docs = stage("documentation tests", [
    bunTest(
      "scripts/check-doc-links.test.mjs",
      "scripts/check-doc-telemetry.test.mjs",
      "scripts/sync-docs-external.test.mjs",
    ),
  ]);
  const browser = {
    e2e: stage("browser tests", [commandStep("bunx", "playwright", "test")]),
    "e2e-app": stage("application browser tests", [
      commandStep("bunx", "playwright", "test", "--config", "playwright.app.config.ts"),
    ]),
    "e2e-docs": stage("documentation browser tests", [
      commandStep("bunx", "playwright", "test", "--config", "playwright.docs.config.ts"),
    ]),
  };

  if (browserScopes.includes(requestedScope))
    return plan("test", requestedScope, [[browser[requestedScope]]]);
  if (requestedScope) {
    const byScope = { frontend, backend, cli, marketing, docs };
    return plan("test", requestedScope, [[byScope[requestedScope]]]);
  }
  if (requestedOptions.has("--non-browser")) {
    const nonBrowserWorkspace = stage("workspace tests", [
      commandStep(
        "bunx",
        "turbo",
        "run",
        "test",
        "--filter=!@openpost/web",
        "--filter=!@openpost/social-preview",
      ),
    ]);
    return plan("test", undefined, [[backend, cli, nonBrowserFrontend, nonBrowserWorkspace]]);
  }
  return plan("test", undefined, [[backend, cli, repository], [workspace]]);
}

function buildPlan(requestedScope) {
  if (requestedScope && !surfaceScopes.includes(requestedScope)) {
    throw unsupported("build", requestedScope, surfaceScopes);
  }
  const prepareDocs = stage("documentation inputs", [
    bun("scripts/sync-docs-external.mjs"),
    bun("scripts/sync-docs-openapi.mjs"),
    bun("scripts/social-images/catalog.mjs", "--check"),
  ]);
  const frontend = stage("frontend build", [
    commandStep("bunx", "turbo", "run", "build", "--filter", "@openpost/web"),
    bunRun("--filter", "@openpost/web", "package"),
  ]);
  const backend = stage("backend build", [{ type: "backend-build", display: "go build backend" }]);
  const cli = stage("CLI build", [go("build", "./...", { cwd: "cli" })]);
  const marketing = stage("marketing build", [
    commandStep("bunx", "turbo", "run", "build", "--filter", "@openpost/site"),
  ]);
  const docs = stage("documentation build", [
    commandStep("bunx", "turbo", "run", "build", "--filter", "@openpost/docs"),
  ]);
  const byScope = { frontend, backend, cli, marketing, docs };
  if (requestedScope === "docs") return plan("build", requestedScope, [[prepareDocs], [docs]]);
  if (requestedScope) return plan("build", requestedScope, [[byScope[requestedScope]]]);
  return plan("build", undefined, [
    [prepareDocs],
    [stage("workspace builds", [commandStep("bunx", "turbo", "run", "build")])],
    [stage("embedded frontend", [bunRun("--filter", "@openpost/web", "package")])],
    [backend, cli],
  ]);
}

async function execute(taskPlan, { cacheDirectory, enforceCacheLimit }) {
  if (enforceCacheLimit) await enforceTurboCacheLimit(cacheDirectory);
  try {
    for (const phase of taskPlan.phases) {
      const controller = new AbortController();
      const results = await Promise.all(
        phase.map((item) => runStage(item, controller, cacheDirectory)),
      );
      const failed = results.find((result) => result !== 0);
      if (failed)
        throw new Error(`${taskPlan.command}${taskPlan.scope ? ` ${taskPlan.scope}` : ""} failed`);
    }
  } finally {
    if (enforceCacheLimit) await enforceTurboCacheLimit(cacheDirectory);
  }
}

async function executeWithCacheLease(taskPlan, cacheDirectory) {
  let operationError;
  try {
    await withTurboCacheLease({ directory: cacheDirectory }, () =>
      execute(taskPlan, { cacheDirectory, enforceCacheLimit: false }),
    );
  } catch (error) {
    operationError = error;
  }
  let maintenanceError;
  try {
    await tryTurboCacheMaintenance({ directory: cacheDirectory }, () =>
      enforceTurboCacheLimit(cacheDirectory),
    );
  } catch (error) {
    maintenanceError = error;
  }
  if (operationError && maintenanceError) {
    throw new AggregateError(
      [operationError, maintenanceError],
      "Root task failed and the shared Turbo cache could not be pruned",
    );
  }
  if (operationError) throw operationError;
  if (maintenanceError) throw maintenanceError;
}

async function enforceTurboCacheLimit(cacheDirectory) {
  const maximum = turboCacheMaxBytes();
  const result = await pruneTurboCache({
    directory: cacheDirectory,
    maxBytes: maximum,
  });
  const message = formatPruneResult(result, maximum);
  if (message) console.log(message);
}

async function runStage(taskStage, controller, cacheDirectory) {
  const started = performance.now();
  console.log(`\n▶ ${taskStage.label}`);
  for (const step of taskStage.steps) {
    if (controller.signal.aborted) return 1;
    const status = await runStep(step, controller.signal, cacheDirectory);
    if (status !== 0) {
      controller.abort();
      console.error(`✗ ${taskStage.label}`);
      return status;
    }
  }
  console.log(`✓ ${taskStage.label} (${((performance.now() - started) / 1_000).toFixed(2)}s)`);
  return 0;
}

async function runStep(step, signal, cacheDirectory) {
  if (step.type === "task") {
    return spawn(
      ["bun", "scripts/tasks.mjs", step.task, ...(step.scope ? [step.scope] : [])],
      { env: { OPENPOST_ROOT_TASK_LOCKED: "1" } },
      signal,
    );
  }
  if (step.type === "gofmt") return runGofmt(step, signal);
  if (step.type === "backend-build") return runBackendBuild(signal);
  if (step.prepareEmbed) {
    const directory = path.join(root, "backend/cmd/openpost/public");
    await mkdir(directory, { recursive: true });
    await Bun.write(path.join(directory, ".gitkeep"), "");
  }
  return spawn(
    withTurboCacheDirectory(step.argv, cacheDirectory),
    { ...step, env: { ...step.env, OPENPOST_ROOT_TASK_LOCKED: "1" } },
    signal,
  );
}

async function runGofmt(step, signal) {
  const files = await gitFiles(step.directory, "*.go");
  if (files.length === 0) return 0;
  if (!step.check) return spawn(["gofmt", "-w", ...files], {}, signal);
  const result = await capture(["gofmt", "-l", ...files]);
  if (result.stdout.trim()) {
    process.stderr.write(result.stdout);
    return 1;
  }
  return result.status;
}

async function runBackendBuild(signal) {
  const revision = (await capture(["git", "rev-parse", "HEAD"])).stdout.trim();
  const dirty =
    (await capture(["git", "diff", "--quiet"])).status !== 0 ||
    (await capture(["git", "diff", "--cached", "--quiet"])).status !== 0;
  return spawn(
    [
      "go",
      "build",
      "-buildvcs=false",
      `-ldflags=-X main.commit=${revision}${dirty ? "-dirty" : ""}`,
      "-o",
      "openpost",
      "./cmd/openpost",
    ],
    { cwd: "backend" },
    signal,
  );
}

async function gitFiles(directory, pattern) {
  const result = await capture(["git", "ls-files", "-co", "--exclude-standard", "--", directory]);
  if (result.status !== 0) return [];
  const suffix = pattern.replace("*", "");
  return result.stdout.split("\n").filter((file) => file && file.endsWith(suffix));
}

async function spawn(argv, step = {}, signal) {
  if (signal?.aborted) return 1;
  const child = Bun.spawn(argv, {
    cwd: step.cwd ? path.join(root, step.cwd) : root,
    env: { ...process.env, ...step.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await child.exited;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function capture(argv) {
  const child = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

function plan(requestedCommand, requestedScope, phases) {
  return { command: requestedCommand, scope: requestedScope, phases };
}

export function publicPlan(taskPlan) {
  return {
    command: taskPlan.command,
    scope: taskPlan.scope ?? null,
    stages: taskPlan.phases.flatMap((items, phase) =>
      items.map((item) => ({
        phase,
        label: item.label,
        commands: item.steps.map((step) => step.display ?? step.argv?.join(" ") ?? step.type),
      })),
    ),
  };
}

function stage(label, steps) {
  return { label, steps };
}

function taskStage(label, task, scope) {
  return stage(label, [
    { type: "task", task, scope, display: `bun run ${task}${scope ? ` -- ${scope}` : ""}` },
  ]);
}

function commandStep(...values) {
  let options = {};
  if (typeof values.at(-1) === "object") options = values.pop();
  return { type: "command", argv: values, display: values.join(" "), ...options };
}

function bun(...args) {
  return commandStep("bun", ...args);
}

function bunRun(...args) {
  return commandStep("bun", "run", ...args);
}

function bunTest(...args) {
  const exactPaths = args.map((arg) =>
    arg.startsWith(".") || arg.startsWith("-") || path.isAbsolute(arg) ? arg : `./${arg}`,
  );
  return commandStep("bun", "test", ...exactPaths);
}

function go(...values) {
  return commandStep("go", ...values);
}

function unsupported(requestedCommand, requestedScope, supported) {
  return new Error(
    `unsupported ${requestedCommand} scope ${JSON.stringify(requestedScope)}; supported ${requestedCommand} scopes: ${supported.join(", ") || "none"}`,
  );
}

function help() {
  return [
    "Usage: bun scripts/tasks.mjs <command> [scope] [--plan]",
    "Commands: dev, format, format:check, lint, check, test, build, verify",
    `Surface scopes: ${surfaceScopes.join(", ")}`,
    `Browser test scopes: ${browserScopes.join(", ")}`,
    `Policy selectors: ${Object.keys(checks).join(", ")}`,
  ].join("\n");
}
