import { readFile } from "node:fs/promises";

import { validateRelease } from "./release-assets.mjs";

export const releasePhases = Object.freeze({
  draft: "draft",
  completeDraft: "complete-draft",
  published: "published",
});

const phaseOptions = Object.freeze({
  [releasePhases.draft]: { complete: false, published: false },
  [releasePhases.completeDraft]: { complete: true, published: false },
  [releasePhases.published]: { complete: true, published: true },
});

export function requireConventionalCommitMessage(message) {
  const header =
    String(message ?? "")
      .trim()
      .split(/\r?\n/u, 1)[0] ?? "";
  if (!/^[a-z][a-z0-9-]*(?:\([^)\r\n]+\))?!?:\s+\S/iu.test(header)) {
    throw new Error("uncommitted work requires a Conventional Commit message");
  }
  return header;
}

export function releasePreparationHasChanges(stagedPaths) {
  return String(stagedPaths ?? "").trim().length > 0;
}

export function selectWorkflowRun(runs, { workflow, branch, revision }) {
  if (!Array.isArray(runs)) throw new Error(`${workflow} runs must be an array`);
  const match = runs.find((run) => run?.headBranch === branch);
  if (!match) return undefined;
  if (match.status === "completed" && match.conclusion !== "success") {
    throw new Error(`${workflow} failed for ${revision}: ${match.conclusion}`);
  }
  if (!Number.isInteger(Number(match.databaseId)) || Number(match.attempt) < 1) {
    throw new Error(`${workflow} returned an invalid run identity for ${revision}`);
  }
  return { id: String(match.databaseId), attempt: Number(match.attempt) };
}

export function validateReleasePhase(release, { phase, tag, notes }) {
  const options = phaseOptions[phase];
  if (!options) throw new Error(`unknown release phase ${JSON.stringify(phase)}`);
  return validateRelease(release, { tag, notes, ...options });
}

export function validateReleaseTransition(before, after, { from, to, tag, notes }) {
  const problems = [
    ...validateReleasePhase(before, { phase: from, tag, notes }).map(
      (problem) => `before: ${problem}`,
    ),
    ...validateReleasePhase(after, { phase: to, tag, notes }).map((problem) => `after: ${problem}`),
  ];
  if (before?.id !== after?.id) problems.push("release identity changed during transition");
  const beforeAssets = (before?.assets ?? []).map((asset) => asset?.name).sort();
  const afterAssets = (after?.assets ?? []).map((asset) => asset?.name).sort();
  if (JSON.stringify(beforeAssets) !== JSON.stringify(afterAssets)) {
    problems.push("release assets changed during transition");
  }
  return problems;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJSON(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const command = process.argv[2];
  const tag = option("--tag");
  const notesFile = option("--notes-file");
  if (!tag || !notesFile) throw new Error("tag and notes file are required");
  const notes = await readFile(notesFile, "utf8");
  let problems;
  if (command === "verify") {
    const releaseFile = option("--release-json");
    const phase = option("--phase");
    if (!releaseFile || !phase) throw new Error("release JSON and phase are required");
    problems = validateReleasePhase(await readJSON(releaseFile), {
      phase,
      tag,
      notes,
    });
  } else if (command === "transition") {
    const beforeFile = option("--before-json");
    const afterFile = option("--after-json");
    const from = option("--from");
    const to = option("--to");
    if (!beforeFile || !afterFile || !from || !to) {
      throw new Error("before, after, from, and to are required");
    }
    problems = validateReleaseTransition(await readJSON(beforeFile), await readJSON(afterFile), {
      from,
      to,
      tag,
      notes,
    });
  } else {
    throw new Error("usage: release-lifecycle.mjs verify|transition [options]");
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
  console.log(`Verified release lifecycle ${command} for ${tag}.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`release-lifecycle: ${error.message}`);
    process.exitCode = 1;
  });
}
