#!/usr/bin/env bun

// Turns a failed CI job log into the failing tests and the local commands
// that reproduce them, so release failures are fixed locally instead of by
// another CI round trip.

import { stripVTControlCharacters } from "node:util";

const devenv = (command) => `devenv shell -- bash -c ${JSON.stringify(command)}`;

// Every CI job name maps to the local command that runs the same gate.
// scripts/release-failures.test.mjs keeps this table in step with ci.yml.
const jobCommands = [
  [/^Contracts and policy$/u, () => "bun run format:check && bun run check -- policy"],
  [/^Public artifact contract$/u, () => "bun run check -- public-routes"],
  [/^Backend and CLI lint$/u, () => "bun run lint -- backend && bun run lint -- cli"],
  [
    /^Svelte lint and checks$/u,
    () => "bun run lint -- frontend && bun run check -- frontend && bun run check -- marketing",
  ],
  [
    /^Backend tests \((\d+\/\d+)\)$/u,
    ([, shard]) =>
      `OPENPOST_GO_TEST_RACE=1 OPENPOST_GO_TEST_SHARD=${shard} bun run test -- backend`,
  ],
  [/^Hosted PostgreSQL and object storage$/u, () => "bun run test -- backend"],
  [
    /^Frontend tests \(server\)$/u,
    () => "cd apps/web && bun run sync && bunx vitest run --project server",
  ],
  [
    /^Frontend tests \((\d+\/\d+)\)$/u,
    ([, shard]) => `cd apps/web && bun run sync && bun run test:browser ${shard}`,
  ],
  [
    /^Frontend tests \(packages\)$/u,
    () =>
      "bunx turbo run test --filter @openpost/query-catalog --filter @openpost/telemetry --filter @openpost/social-preview",
  ],
  [/^Canonical frontend build$/u, () => "bun run build -- frontend"],
  [/^Marketing build$/u, () => "bun run build -- marketing"],
  [/^Documentation build$/u, () => "bun run build -- docs"],
  [
    /^Application browser suite \((\d+)\/(\d+)\)$/u,
    ([, index, count]) => `OPENPOST_APP_E2E_SHARD=${index}/${count} bun run test -- e2e-app`,
  ],
  [/^Marketing browser suite$/u, () => "bun run test -- e2e"],
  [/^Frontend cache contract$/u, () => "bun run check -- frontend-build-cache"],
  [/^npm SDK and CLI packages$/u, () => "bun scripts/tasks.mjs check npm-packages"],
  [/^n8n community package$/u, () => "bun run check:n8n"],
  [/^Security$/u, () => "scripts/security-check.sh"],
  [/^CLI$/u, () => "bun run build -- cli && bun run test -- cli"],
  [/^Native mobile Android candidate$/u, () => "cd apps/mobile && bun run check"],
  [/^Production image \(linux\/\w+\)$/u, () => "bun run release -- check-full"],
];

export function localJobCommand(jobName) {
  for (const [pattern, command] of jobCommands) {
    const match = pattern.exec(jobName);
    if (match) return devenv(command(match));
  }
  return undefined;
}

// `gh run view --log-failed` prefixes each line with job, step, and timestamp.
function logLines(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      if (fields.length >= 3) fields[2] = fields[2].replace(/^\uFEFF/u, "");
      const prefixed = fields.length >= 3 && /^\d{4}-\d\d-\d\dT/u.test(fields[2]);
      const content = prefixed ? fields.slice(2).join("\t") : line;
      return (
        stripVTControlCharacters(content)
          .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/u, "")
          // gh renders terminal colors as literal `^[[...m` text.
          .replace(/\^\[\[[0-9;]*[A-Za-z]/gu, "")
      );
    });
}

function playwrightConfig(file) {
  for (const suite of ["app", "marketing", "docs"]) {
    if (file.startsWith(`tests/${suite}/`)) return `tests/${suite}/playwright.config.ts`;
  }
  return undefined;
}

// Drops the step headers and environment dumps GitHub prints in groups.
function commandOutput(lines) {
  const output = [];
  let grouped = false;
  for (const line of lines) {
    if (line.startsWith("##[group]")) grouped = true;
    else if (line.startsWith("##[endgroup]")) grouped = false;
    else if (!grouped && line.trim() !== "" && !line.startsWith("Cleaning up orphan")) {
      output.push(line);
    }
  }
  return output;
}

export function parseFailureLog(text) {
  const lines = logLines(text);
  const playwright = new Map();
  const vitest = new Map();
  const goPackages = [];
  const advisories = [];
  let pendingGoTests = [];
  let hungTests = false;
  let library = "";

  for (const line of lines) {
    // Playwright titles keep raw colons and commas, so the message starts at
    // the first `::` that is followed by whitespace.
    const annotation = /::error file=([^,]+),title=(.+?)(?:,line=\d+,col=\d+)?::\s(.*)$/u.exec(
      line,
    );
    if (annotation) {
      const [, file, title, message] = annotation;
      const location = new RegExp(
        `${file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:(\\d+)`,
        "u",
      ).exec(title);
      const key = `${file}:${location?.[1] ?? ""}:${title}`;
      if (!playwright.has(key)) {
        const error = message
          .replaceAll("%0A", "\n")
          .replaceAll("%0D", "")
          .replaceAll("%25", "%")
          .split("\n")
          .map((part) => part.trim())
          .find((part) => /^(Error|Test timeout|expect)/u.test(part));
        playwright.set(key, {
          file,
          line: location ? Number(location[1]) : undefined,
          title: title.split(" › ").slice(2).join(" › ") || title,
          error,
        });
      }
      continue;
    }

    const vitestFailure =
      /^\s*FAIL\s+(?:(\w+)(?: \([^)]*\))?\s+)?(\S+\.test\.[cm]?[jt]s)\s+>\s+(.+)$/u.exec(line);
    if (vitestFailure) {
      const [, project, file, name] = vitestFailure;
      vitest.set(`${file} > ${name}`, { project, file, name: name.trim() });
      continue;
    }

    const goFailure = /^\s*--- FAIL: (Test[A-Za-z0-9_]*)\b/u.exec(line);
    if (goFailure) {
      pendingGoTests.push(goFailure[1]);
      continue;
    }
    if (/^panic: test timed out/u.test(line)) {
      hungTests = true;
      continue;
    }
    if (hungTests) {
      const running = /^\s+(Test[A-Za-z0-9_]*) \(/u.exec(line);
      if (running) {
        pendingGoTests.push(running[1]);
        continue;
      }
      if (line.trim() === "" || /^goroutine /u.test(line)) hungTests = false;
    }
    const goPackage = /^FAIL\s+github\.com\/openpost\/backend\/(\S+)\s/u.exec(line);
    if (goPackage) {
      goPackages.push({ package: goPackage[1], tests: [...new Set(pendingGoTests)] });
      pendingGoTests = [];
      continue;
    }

    const row = /^│(.*)│$/u.exec(line.trim());
    if (row) {
      const cells = row[1].split("│").map((cell) => cell.trim());
      if (cells[0]) library = cells[0];
      if (/^(CVE|GHSA)-/u.test(cells[1] ?? "")) {
        advisories.push({
          library,
          id: cells[1],
          installed: cells[4] || undefined,
          fixed: cells[5] || undefined,
        });
      }
    }
  }

  return {
    playwright: [...playwright.values()],
    vitest: [...vitest.values()],
    go: goPackages,
    advisories,
    tail: commandOutput(lines).slice(-20),
  };
}

export function focusedCommands(parsed) {
  const commands = [];
  for (const failure of parsed.playwright) {
    const config = playwrightConfig(failure.file);
    if (!config) continue;
    const target = failure.line ? `${failure.file}:${failure.line}` : failure.file;
    commands.push(devenv(`bunx playwright test --config ${config} ${target}`));
  }
  const vitestFiles = new Map();
  for (const failure of parsed.vitest) {
    const project = failure.project ?? "client";
    vitestFiles.set(`${project} ${failure.file}`, { project, file: failure.file });
  }
  for (const { project, file } of vitestFiles.values()) {
    commands.push(
      devenv(`cd apps/web && bun run sync && bunx vitest run --project ${project} ${file}`),
    );
  }
  for (const { package: name, tests } of parsed.go) {
    const run = tests.length ? ` -run '^(?:${tests.join("|")})$'` : "";
    commands.push(devenv(`cd apps/server && go test -tags dev -race${run} ./${name}`));
  }
  return [...new Set(commands)];
}

export function formatFailureDigest(jobName, logText, { url } = {}) {
  const parsed = parseFailureLog(logText);
  const out = [`✗ ${jobName}${url ? `  ${url}` : ""}`];
  for (const failure of parsed.playwright) {
    out.push(
      `  ${failure.file}${failure.line ? `:${failure.line}` : ""} ${failure.title}${failure.error ? `\n    ${failure.error}` : ""}`,
    );
  }
  for (const failure of parsed.vitest) out.push(`  ${failure.file} > ${failure.name}`);
  for (const { package: name, tests } of parsed.go) {
    out.push(`  ${name}${tests.length ? `: ${tests.join(", ")}` : ""}`);
  }
  const fixes = new Map();
  for (const advisory of parsed.advisories) {
    const key = `${advisory.library}`;
    const entry = fixes.get(key) ?? { ...advisory, ids: [] };
    if (!entry.ids.includes(advisory.id)) entry.ids.push(advisory.id);
    entry.fixed ??= advisory.fixed;
    fixes.set(key, entry);
  }
  for (const fix of fixes.values()) {
    out.push(
      `  ${fix.library}${fix.installed ? ` ${fix.installed}` : ""} → ${fix.fixed ?? "no fix listed"}: ${fix.ids.join(", ")}`,
    );
  }
  const structured =
    parsed.playwright.length + parsed.vitest.length + parsed.go.length + parsed.advisories.length;
  if (structured === 0) {
    out.push("  Last log lines:");
    for (const line of parsed.tail) out.push(`    ${line}`);
  }
  const commands = focusedCommands(parsed);
  const job = localJobCommand(jobName);
  if (commands.length || job) {
    out.push("  Reproduce locally:");
    for (const command of commands) out.push(`    ${command}`);
    if (job) out.push(`    ${job}${commands.length ? "   # whole job" : ""}`);
  }
  return out.join("\n");
}
