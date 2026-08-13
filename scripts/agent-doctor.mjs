import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const REQUIRED_ARTIFACTS = [
  "CONTEXT.md",
  "docs/agents/repository-map.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  ".agents/skills/agent-workflow/SKILL.md",
  ...[
    "grilling",
    "to-spec",
    "to-tickets",
    "implement",
    "tdd",
    "code-review",
    "triage",
    "handoff",
    "codebase-design",
  ].map((name) => `.agents/skills/${name}/SKILL.md`),
];

export function findMissingArtifacts(root, required = REQUIRED_ARTIFACTS) {
  return required.filter((path) => !existsSync(resolve(root, path)));
}

export function parseTriageLabels(markdown) {
  const labels = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (
      cells.length !== 4 ||
      !/^`?[a-z0-9-]+`?$/.test(line.split("|")[1]?.trim() ?? "")
    )
      continue;
    const [role, name, description, color] = cells;
    if (!/^#[0-9a-f]{6}$/i.test(`#${color}`)) continue;
    labels.push({ role, name, description, color: color.toLowerCase() });
  }
  return labels;
}

export function parseLiveLabels(json) {
  const value = JSON.parse(json);
  if (!Array.isArray(value))
    throw new TypeError("GitHub label response must be an array");
  return new Set(
    value
      .map((label) => (typeof label === "string" ? label : label?.name))
      .filter(Boolean),
  );
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function diagnoseLiveLabels(configured, liveLabels) {
  return configured
    .filter((label) => !liveLabels.has(label.name))
    .map((label) => ({
      ...label,
      command: `gh label create ${shellQuote(label.name)} --description ${shellQuote(label.description)} --color ${shellQuote(label.color)}`,
    }));
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

export async function main({ root = process.cwd(), output = console } = {}) {
  const missingArtifacts = findMissingArtifacts(root);
  if (missingArtifacts.length > 0) {
    output.error("Agent doctor: missing required local artifacts:");
    for (const path of missingArtifacts) output.error(`  - ${path}`);
    return 1;
  }

  const triagePath = resolve(root, "docs/agents/triage-labels.md");
  const configured = parseTriageLabels(await readFile(triagePath, "utf8"));
  if (configured.length !== 5) {
    output.error(
      `Agent doctor: expected 5 configured triage labels, found ${configured.length}.`,
    );
    return 1;
  }
  output.log("Agent doctor: local workflow artifacts are present.");

  const remote = run("git", ["remote", "get-url", "origin"], root);
  if (
    remote.status !== 0 ||
    !/(^|[.@/:])github\.com[/:]/i.test(remote.stdout.trim())
  ) {
    output.warn(
      "Agent doctor: live label validation skipped (origin is not a GitHub remote).",
    );
    return 0;
  }

  const auth = run("gh", ["auth", "status"], root);
  if (auth.error?.code === "ENOENT" || auth.status !== 0) {
    output.warn(
      "Agent doctor: live label validation skipped (gh is unavailable or not authenticated).",
    );
    return 0;
  }

  const live = run(
    "gh",
    ["label", "list", "--limit", "1000", "--json", "name"],
    root,
  );
  if (live.status !== 0) {
    output.warn(
      "Agent doctor: live label validation skipped (GitHub could not be reached).",
    );
    return 0;
  }

  let liveLabels;
  try {
    liveLabels = parseLiveLabels(live.stdout);
  } catch (error) {
    output.warn(
      `Agent doctor: live label validation skipped (invalid gh response: ${error.message}).`,
    );
    return 0;
  }
  const missingLabels = diagnoseLiveLabels(configured, liveLabels);
  if (missingLabels.length === 0) {
    output.log("Agent doctor: all configured triage labels exist on GitHub.");
    return 0;
  }

  output.error("Agent doctor: configured triage labels missing on GitHub:");
  for (const label of missingLabels) {
    output.error(`  - ${label.name}`);
    output.error(`    ${label.command}`);
  }
  output.error(
    "Review and run the commands above to create labels; this doctor never changes GitHub state.",
  );
  return 1;
}

if (import.meta.main) process.exitCode = await main();
