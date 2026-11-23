#!/usr/bin/env bun

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { shardRunPattern } from "./go-test-shards.mjs";
import { DEFAULT_STEP_TIMEOUT_MS, spawnTaskProcess } from "./task-process.mjs";

const root = path.resolve(import.meta.dir, "..");
const [command, rawScope, ...flags] = process.argv.slice(2);
const scope = rawScope?.startsWith("--") ? undefined : rawScope;
const options = new Set(rawScope?.startsWith("--") ? [rawScope, ...flags] : flags);

const surfaceScopes = ["frontend", "backend", "cli", "marketing", "docs"];
const browserScopes = ["e2e", "e2e-app"];

const checks = {
  contracts: stage("contracts", [
    bun("scripts/check-contracts.mjs"),
    bun("scripts/check-handwritten-contracts.mjs"),
  ]),
  // The payload assertions run after both builds because they inspect the
  // built dist output that clean checkouts only produce here.
  "npm-packages": stage("npm packages", [
    commandStep("bun", "run", "check", { cwd: "packages/sdk" }),
    commandStep("bun", "run", "test", { cwd: "packages/sdk" }),
    commandStep("bun", "run", "build", { cwd: "packages/sdk" }),
    commandStep("bun", "run", "check", { cwd: "packages/cli" }),
    commandStep("bun", "run", "test", { cwd: "packages/cli" }),
    commandStep("bun", "run", "build", { cwd: "packages/cli" }),
    bunTest("tests/build/npm-package-build.test.mjs"),
    bun("scripts/check-npm-package-build.mjs"),
  ]),
  "n8n-package": stage("n8n package", [
    bun("scripts/generate-selected-automation-contract.mjs", "--check"),
    commandStep("bun", "run", "check", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "test", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "lint", { cwd: "packages/n8n-nodes-openpost" }),
    commandStep("bun", "run", "build", { cwd: "packages/n8n-nodes-openpost" }),
    bunTest("tests/build/n8n-package-build.test.mjs"),
    bun("scripts/check-n8n-package-build.mjs"),
  ]),
  "build-graph": stage("build graph", [bun("scripts/check-build-graph.mjs")]),
  assets: stage("asset surfaces", [bun("scripts/asset-surfaces.mjs")]),
  workflows: stage("GitHub Actions workflows", [
    bun("scripts/check-automation-paths.mjs"),
    bun("scripts/check-release-workflows.mjs"),
    go("run", "github.com/rhysd/actionlint/cmd/actionlint@v1.7.12"),
  ]),
  "mcp-registry": stage("MCP registry", [bun("scripts/check-mcp-registry.mjs")]),
  docs: stage("documentation policy", [
    bunRun("--filter", "@openpost/docs", "prepare"),
    bunRun("--filter", "@openpost/docs", "check"),
    bunTest("apps/docs/lib/api-document.test.ts"),
    bun("scripts/check-doc-links.mjs"),
  ]),
  "release-version": stage("release version", [
    bunTest("tests/build/posthog-source-maps.test.ts"),
    bun("scripts/release-surfaces.mjs"),
  ]),
  "app-routes": stage("application routes", [
    bun("scripts/generate-app-route-manifest.mjs", "--check"),
  ]),
  "public-routes": stage("public routes", [
    commandStep("bunx", "turbo", "run", "_test:public-build"),
    bun("scripts/check-marketing-route-manifest.mjs"),
  ]),
  "legal-policy": stage("legal policy", [
    bun("scripts/legal-policy-manifest.mjs", "check"),
    bun("scripts/check-browser-storage-inventory.mjs"),
  ]),
  "provider-certification": stage("provider certification", [
    bun("scripts/provider-certification-manifest.mjs", "check"),
  ]),
  "provider-facts": stage("provider facts", [
    bun("scripts/provider-catalog-facts.mjs"),
    bun("scripts/check-platform-text-conformance.mjs"),
  ]),
  "plan-catalog": stage("plan catalog", [
    bun("scripts/plan-catalog.mjs", "--check"),
    bunTest("packages/plan-catalog/src/index.test.ts"),
  ]),
  changelog: stage("changelog", [
    bun("scripts/check-changelog.mjs"),
    bunTest("packages/changelog/src/index.test.mjs"),
  ]),
  "social-images": stage("social images", [bun("scripts/social-images/catalog.mjs", "--check")]),
  "go-reachability": stage("Go reachability", [commandStep("scripts/check-go-deadcode.sh")]),
  reachability: stage("production reachability", [
    commandStep(
      "bunx",
      "knip",
      "--config",
      "config/knip.jsonc",
      "--production",
      "--include",
      "files",
      "--no-config-hints",
    ),
  ]),
  "secret-scan": stage("secret scan", [commandStep("bash", "scripts/scan-secrets.sh")]),
  compatibility: stage("compatibility surfaces", [bun("scripts/compatibility-surfaces.mjs")]),
  "ui-consistency": stage("UI consistency", [
    bun("scripts/check-ui-consistency.mjs"),
    bun("scripts/sync-static-ui.mjs", "--check"),
    commandStep("bun", "scripts/sync-static-404.mjs", "--check", { cwd: "apps/marketing" }),
  ]),
  "query-migration": stage("Query migration", [
    bun("scripts/check-query-migration.mjs"),
    bun("scripts/check-query-effect-fetch.mjs"),
  ]),
  agents: stage("agent instructions", [bun("scripts/agent-doctor.mjs")]),
};

// Check stages inspect the checkout. Repository regression tests have one
// owner: `bun test ./scripts` (the `test` task and the CI repository job).
// Public routes build both production sites twice, so they stay out of the
// policy aggregate. CI proves them in a dedicated job; local `check` still
// runs them as their own phase. Go reachability belongs to the Go quality
// job in CI and to the full local check.
// The contract check generates into a snapshot and never writes the checkout,
// so read-only checks run beside it. The docs stage regenerates checked-in
// docs outputs, so it follows them; asset surfaces scan the docs tree and
// production reachability reads sources after it.
const policyIndependent = [
  "build-graph",
  "workflows",
  "mcp-registry",
  "release-version",
  "secret-scan",
  "app-routes",
  "legal-policy",
  "provider-certification",
  "provider-facts",
  "plan-catalog",
  "changelog",
  "social-images",
  "compatibility",
  "ui-consistency",
  "query-migration",
];
const policyGroups = [["docs"], ["assets", "reachability"]];

if (import.meta.main) {
  try {
    const plan =
      command === "check:affected"
        ? affectedPlan(
            (await import("./affected-checks.mjs")).affectedSelection(process.argv.slice(3), root),
          )
        : resolvePlan(command, scope);
    if (options.has("--plan")) {
      console.log(JSON.stringify(publicPlan(plan), null, 2));
    } else {
      if (plan.affected) console.log(JSON.stringify(publicPlan(plan), null, 2));
      await execute(plan);
      if (plan.command !== "dev") await pruneTurboCache();
      if (plan.affected) {
        console.log(
          plan.affected.files.length || plan.affected.fallback
            ? "check:affected: selected checks passed"
            : "check:affected: no local changes selected",
        );
        console.log(`Omitted: ${plan.affected.omitted.join("; ")}. ${plan.affected.proof}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export function resolvePlan(requestedCommand, requestedScope) {
  if (!requestedCommand) throw new Error(help());
  switch (requestedCommand) {
    case "dev":
      return devPlan(requestedScope);
    case "format":
    case "format:check":
      return formatPlan(requestedCommand, requestedScope);
    case "lint":
      return lintPlan(requestedScope);
    case "fallow":
      if (requestedScope) throw unsupported("fallow", requestedScope, []);
      return fallowPlan();
    case "check":
      return checkPlan(requestedScope);
    case "test":
      return testPlan(requestedScope);
    case "build":
      return buildPlan(requestedScope);
    case "preflight":
    case "verify":
      if (requestedScope) throw unsupported(requestedCommand, requestedScope, []);
      return plan(requestedCommand, undefined, [
        ...(requestedCommand === "preflight" ? [[taskStage("format check", "format:check")]] : []),
        [taskStage("static checks", "check")],
        [
          ...(requestedCommand === "verify" ? [taskStage("format check", "format:check")] : []),
          taskStage("lint", "lint"),
          taskStage("dead code", "fallow"),
          ...(requestedCommand === "preflight"
            ? [
                checks["npm-packages"],
                checks["n8n-package"],
                stage("mobile source checks", [
                  commandStep("bun", "run", "check:source", { cwd: "apps/mobile" }),
                ]),
              ]
            : []),
        ],
        [taskStage("tests", "test")],
        ...(requestedCommand === "verify" ? [[taskStage("production builds", "build")]] : []),
      ]);
    default:
      throw new Error(`unknown task ${JSON.stringify(requestedCommand)}\n${help()}`);
  }
}

function affectedPathPhases(selection) {
  if (!selection.files.length) return [];
  const phases = [];
  if (selection.mergeBase)
    phases.push([
      stage("committed whitespace", [
        commandStep("git", "diff", "--check", selection.mergeBase, selection.head),
      ]),
    ]);
  phases.push([
    stage("changed syntax and format", [
      commandStep("bash", "scripts/changed-files-check.sh", "--files0", {
        input: `${selection.files.join("\0")}\0`,
      }),
    ]),
  ]);
  return phases;
}

function affectedPlan(selection) {
  const phases = affectedPathPhases(selection);
  if (selection.fallback) {
    const full = resolvePlan("preflight");
    return {
      ...full,
      command: "check:affected",
      affected: selection,
      phases: [...phases, ...full.phases],
    };
  }
  const used = new Set();
  const commands = new Set();
  const append = (selected) => {
    for (const items of selected.phases) {
      const fresh = items.flatMap((item) => {
        if (used.has(item.label)) return [];
        used.add(item.label);
        const steps = item.steps.filter((step) => {
          const key = JSON.stringify(step);
          if (commands.has(key)) return false;
          commands.add(key);
          return true;
        });
        return steps.length ? [{ ...item, steps }] : [];
      });
      if (fresh.length) phases.push(fresh);
    }
  };
  if (selection.files.length) {
    for (const owner of selection.scopes) {
      if (owner !== "mobile") append(checkPlan(owner, new Set()));
    }
    for (const owner of selection.scopes) {
      if (owner === "mobile") {
        append(
          plan("check", "mobile", [
            [
              stage("mobile source checks", [
                commandStep("bun", "run", "check:source", { cwd: "apps/mobile" }),
              ]),
            ],
          ]),
        );
      } else append(testPlan(owner));
    }
  }
  return { ...plan("check:affected", undefined, phases), affected: selection };
}

function devPlan(requestedScope) {
  const supported = ["frontend", "backend", "marketing", "docs"];
  if (requestedScope && !supported.includes(requestedScope)) {
    throw unsupported("dev", requestedScope, supported);
  }
  const stages = {
    frontend: stage("frontend development server", [bunRun("--filter", "@openpost/web", "dev")]),
    backend: stage("backend development server", [
      go("run", "-tags", "dev", "./cmd/openpost", { cwd: "apps/server" }),
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
    frontend: oxfmt("frontend format", ".", "apps/web"),
    backend: gofmt("backend format", "apps/server"),
    cli: gofmt("CLI format", "apps/cli"),
    marketing: oxfmt("marketing format", ".", "apps/marketing"),
    docs: oxfmt("documentation format", "apps/docs"),
  };
  if (requestedScope) return plan(requestedCommand, requestedScope, [[stages[requestedScope]]]);
  return plan(requestedCommand, undefined, [
    [oxfmt("repository format", "."), stages.backend, stages.cli],
  ]);
}

function fallowPlan() {
  // Dead-code findings gate changed sources; complexity remains a separate
  // report. Fallow's combined audit enforces health thresholds even when
  // dead-code rules are warn, so it cannot implement the advisory health policy.
  const base = process.env.OPENPOST_FALLOW_BASE;
  const historyArgs = process.env.OPENPOST_FALLOW_CI === "1" ? [] : ["--hotspots", "--targets"];
  const auditArgs = [
    "audit",
    ...(base && !/^0+$/.test(base) ? ["--base", base] : []),
    "--max-crap",
    "400",
  ];
  return plan("fallow", undefined, [
    [
      stage("changed-code audit", [bun("scripts/fallow-dead-code-gate.mjs", ...auditArgs)]),
      stage("complexity and hotspots", [
        commandStep(
          "bunx",
          "fallow",
          "health",
          "--report-only",
          "--complexity",
          ...historyArgs,
          "--file-scores",
          "--score",
        ),
      ]),
      stage("mobile audit and health", [
        bun("scripts/fallow-dead-code-gate.mjs", "--root", "apps/mobile", ...auditArgs),
        commandStep(
          "bunx",
          "fallow",
          "--root",
          "apps/mobile",
          "health",
          "--report-only",
          "--complexity",
          ...historyArgs,
          "--file-scores",
          "--score",
        ),
      ]),
    ],
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
      cwd: "apps/server",
      prepareEmbed: true,
    }),
  ]);
  const cli = stage("CLI lint", [
    commandStep("golangci-lint", "run", "./...", { cwd: "apps/cli" }),
  ]);
  const marketing = stage("marketing lint", [
    commandStep("bunx", "oxlint", "--config", "apps/web/.oxlintrc.json", "apps/marketing"),
  ]);
  const docs = checks.docs;
  const byScope = { frontend, backend, cli, marketing, docs };
  if (requestedScope) return plan("lint", requestedScope, [[byScope[requestedScope]]]);
  return plan("lint", undefined, [[frontend, backend, marketing], [cli]]);
}

function checkPlan(requestedScope) {
  if (requestedScope && checks[requestedScope] && requestedScope !== "docs") {
    return plan("check", requestedScope, [[checks[requestedScope]]]);
  }
  const supported = [...surfaceScopes, "frontend-marketing", "policy", ...Object.keys(checks)];
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
    commandStep("bunx", "turbo", "run", "check", "--filter", "@openpost/site", {
      env: { OPENPOST_CHECK_PREPARED: "1" },
    }),
  ]);
  // One dependency graph builds shared UI output before either consumer reads it.
  // Separate Turbo processes can rebuild dist while the other checker is running.
  const frontendAndMarketing = stage("frontend and marketing types", [
    commandStep(
      "bunx",
      "turbo",
      "run",
      "check",
      "--filter",
      "@openpost/web",
      "--filter",
      "@openpost/site",
      { env: { OPENPOST_CHECK_PREPARED: "1" } },
    ),
  ]);
  const backend = stage("backend types", [
    go("test", "-tags", "dev", "-run", "^$", "./...", { cwd: "apps/server" }),
  ]);
  const cli = stage("CLI types", [go("test", "-run", "^$", "./...", { cwd: "apps/cli" })]);

  if (requestedScope === "frontend") {
    return plan("check", requestedScope, [[contracts], [translations], [frontend]]);
  }
  if (requestedScope === "frontend-marketing") {
    return plan("check", requestedScope, [[contracts], [translations], [frontendAndMarketing]]);
  }
  if (requestedScope === "backend") return plan("check", requestedScope, [[contracts], [backend]]);
  if (requestedScope === "cli") return plan("check", requestedScope, [[contracts], [cli]]);
  if (requestedScope === "marketing")
    return plan("check", requestedScope, [[translations], [marketing]]);
  if (requestedScope === "docs") return plan("check", requestedScope, [[checks.docs]]);

  const independent = policyIndependent.map((name) => checks[name]);
  const policy = policyGroups.map((group) => group.map((name) => checks[name]));
  if (requestedScope === "policy") {
    return plan("check", requestedScope, [[translations], [contracts, ...independent], ...policy]);
  }
  return plan("check", undefined, [
    [contracts],
    [translations],
    [frontendAndMarketing, backend, cli],
    // Policy checks rewrite Paraglide output, so they run after its readers.
    [...independent, checks["go-reachability"]],
    ...policy,
    // The production-artifact proof rebuilds both public sites, so it runs
    // after policy work instead of inside the policy aggregate.
    [checks["public-routes"]],
  ]);
}

function testPlan(requestedScope) {
  const supported = [...surfaceScopes, ...browserScopes];
  if (requestedScope && !supported.includes(requestedScope)) {
    throw unsupported("test", requestedScope, supported);
  }
  const backendArguments = ["test", "-tags", "dev"];
  if (process.env.OPENPOST_GO_TEST_RACE === "1") {
    backendArguments.push("-race", "-timeout=30m");
  }
  if (process.env.OPENPOST_GO_COVERAGE_FILE) {
    backendArguments.push(`-coverprofile=${process.env.OPENPOST_GO_COVERAGE_FILE}`);
  }
  if (process.env.OPENPOST_GO_TEST_SHARD) {
    backendArguments.push(
      "-run",
      shardRunPattern("apps/server", process.env.OPENPOST_GO_TEST_SHARD, root),
    );
  }
  backendArguments.push("./...");
  const backend = stage("backend tests", [go(...backendArguments, { cwd: "apps/server" })]);
  const cli = stage("CLI tests", [go("test", "./...", { cwd: "apps/cli" })]);
  const frontend = stage("frontend tests", [
    commandStep(
      "bunx",
      "turbo",
      "run",
      "test",
      "--filter",
      "@openpost/web",
      "--filter",
      "@openpost/query-catalog",
      "--filter",
      "@openpost/telemetry",
      "--filter",
      "@openpost/social-preview",
    ),
  ]);
  const workspace = stage("workspace tests", [
    commandStep("bunx", "turbo", "run", "test", "--concurrency", "1"),
  ]);
  // These tests spawn subprocesses and share the CPU with the Go suite.
  const repository = stage("repository tests", [bunTest("--timeout=30000", "./scripts")]);
  const marketing = stage("marketing tests", [
    commandStep("bun", "run", "test", { cwd: "apps/marketing" }),
    bunTest(
      "scripts/check-marketing-route-manifest.test.mjs",
      "scripts/marketing-agent-readiness.test.mjs",
      "scripts/legal-policy-manifest.test.mjs",
    ),
  ]);
  const docs = stage("documentation tests", [
    bunTest(
      "scripts/check-doc-links.test.mjs",
      "scripts/check-doc-telemetry.test.mjs",
      "scripts/docs-automation-examples.test.mjs",
      "scripts/sync-docs-external.test.mjs",
    ),
  ]);
  const browser = {
    e2e: stage("browser tests", [
      commandStep("bunx", "playwright", "test", "--config", "tests/marketing/playwright.config.ts"),
    ]),
    "e2e-app": stage("application browser tests", [
      commandStep("bunx", "playwright", "test", "--config", "tests/app/playwright.config.ts"),
    ]),
  };

  if (browserScopes.includes(requestedScope))
    return plan("test", requestedScope, [[browser[requestedScope]]]);
  if (requestedScope) {
    const byScope = { frontend, backend, cli, marketing, docs };
    return plan("test", requestedScope, [[byScope[requestedScope]]]);
  }
  return plan("test", undefined, [[backend, cli, repository], [workspace]]);
}

function buildPlan(requestedScope) {
  const buildScopes = [...surfaceScopes, "public-site"];
  if (requestedScope && !buildScopes.includes(requestedScope)) {
    throw unsupported("build", requestedScope, buildScopes);
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
  const cli = stage("CLI build", [go("build", "./...", { cwd: "apps/cli" })]);
  const marketing = stage("marketing build", [
    commandStep("bunx", "turbo", "run", "build", "--filter", "@openpost/site"),
  ]);
  const docs = stage("documentation build", [
    commandStep("bunx", "turbo", "run", "build", "--filter", "@openpost/docs"),
  ]);
  const composePublicSite = stage("public site composition", [
    bun("scripts/compose-public-site.mjs"),
  ]);
  const byScope = { frontend, backend, cli, marketing, docs };
  if (requestedScope === "docs") return plan("build", requestedScope, [[prepareDocs], [docs]]);
  if (requestedScope === "public-site") {
    return plan("build", requestedScope, [
      [prepareDocs],
      [
        stage("public builds", [
          commandStep(
            "bunx",
            "turbo",
            "run",
            "build",
            "--filter",
            "@openpost/site",
            "--filter",
            "@openpost/docs",
          ),
        ]),
      ],
      [composePublicSite],
    ]);
  }
  if (requestedScope) return plan("build", requestedScope, [[byScope[requestedScope]]]);
  return plan("build", undefined, [
    [prepareDocs],
    [stage("workspace builds", [commandStep("bunx", "turbo", "run", "build")])],
    [stage("embedded frontend", [bunRun("--filter", "@openpost/web", "package")])],
    [backend, cli],
  ]);
}

async function execute(taskPlan) {
  for (const phase of taskPlan.phases) {
    const controller = new AbortController();
    const results = await Promise.all(phase.map((item) => runStage(item, controller)));
    if (results.some((result) => result !== 0))
      throw new Error(`${taskPlan.command}${taskPlan.scope ? ` ${taskPlan.scope}` : ""} failed`);
  }
}

// Turbo keeps its cache in .turbo/cache per checkout. Drop entries nobody has
// read or written for two weeks so long-lived checkouts stay bounded.
async function pruneTurboCache() {
  const directory = path.join(root, ".turbo", "cache");
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(
    entries.map(async (name) => {
      const file = path.join(directory, name);
      const info = await stat(file).catch(() => undefined);
      if (info?.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true });
    }),
  );
}

async function runStage(taskStage, controller) {
  const started = performance.now();
  console.log(`\n▶ ${taskStage.label}`);
  for (const step of taskStage.steps) {
    if (controller.signal.aborted) return 1;
    const status = await runStep(step, controller.signal);
    if (status !== 0) {
      controller.abort();
      console.error(`✗ ${taskStage.label}`);
      return status;
    }
  }
  console.log(`✓ ${taskStage.label} (${((performance.now() - started) / 1_000).toFixed(2)}s)`);
  return 0;
}

async function runStep(step, signal) {
  if (step.type === "task") {
    return spawn(
      ["bun", "scripts/tasks.mjs", step.task, ...(step.scope ? [step.scope] : [])],
      {},
      signal,
    );
  }
  if (step.type === "gofmt") return runGofmt(step, signal);
  if (step.type === "backend-build") return runBackendBuild(signal);
  if (step.prepareEmbed) {
    const directory = path.join(root, "apps/server/cmd/openpost/public");
    await mkdir(directory, { recursive: true });
    await Bun.write(path.join(directory, ".gitkeep"), "");
  }
  return spawn(step.argv, step, signal);
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
    { cwd: "apps/server" },
    signal,
  );
}

async function gitFiles(directory, pattern) {
  const result = await capture(["git", "ls-files", "-co", "--exclude-standard", "--", directory]);
  if (result.status !== 0) return [];
  const suffix = pattern.replace("*", "");
  return result.stdout
    .split("\n")
    .filter((file) => file.endsWith(suffix) && existsSync(path.join(root, file)));
}

// Never attach stdin unless a step explicitly supplies input, so a missing
// binary cannot sit on an install prompt.
async function spawn(argv, step = {}, signal) {
  return spawnTaskProcess(
    argv,
    {
      cwd: step.cwd ? path.join(root, step.cwd) : root,
      env: { ...process.env, ...step.env },
      input: step.input,
      timeoutMs: step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
    },
    signal,
  );
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
  const result = {
    command: taskPlan.command,
    scope: taskPlan.scope ?? null,
    stages: taskPlan.phases.flatMap((items, phase) =>
      items.map((item) => {
        const entry = {
          phase,
          label: item.label,
          commands: item.steps.map((step) => step.display ?? step.argv?.join(" ") ?? step.type),
        };
        if (taskPlan.affected) entry.steps = item.steps.map(publicAffectedStep);
        return entry;
      }),
    ),
  };
  if (taskPlan.affected) result.affected = taskPlan.affected;
  return result;
}

function publicAffectedStep(step) {
  const result = {
    type: step.type,
    cwd: step.cwd ? path.join(root, step.cwd) : root,
    argv: step.argv ?? null,
    env: { ...step.env },
  };
  if (step.type === "task") {
    result.task = step.task;
    result.scope = step.scope ?? null;
    result.argv = ["bun", "scripts/tasks.mjs", step.task, ...(step.scope ? [step.scope] : [])];
    result.cwd = root;
    result.env = {};
  }
  return result;
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
    "Commands: dev, format, format:check, lint, fallow, check, test, build, preflight, verify, check:affected",
    "Affected: bun run check:affected [--base REV] [--plan]",
    `Surface scopes: ${surfaceScopes.join(", ")}`,
    `Browser test scopes: ${browserScopes.join(", ")}`,
    `Policy selectors: ${Object.keys(checks).join(", ")}`,
  ].join("\n");
}
