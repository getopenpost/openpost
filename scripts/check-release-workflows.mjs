#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

// Release-path workflow contracts that actionlint cannot see. Each one has
// failed a real tag run after main CI was already green.
//
// - Reading or writing an unpublished draft release needs `contents: write`.
// - Every artifact a job resolves by prefix must be uploaded upstream: in the
//   job's own needs graph, or, for release.yml, by main CI.
// - `needs.<job>.outputs.<key>` must name a direct need that declares <key>.
// - No macOS runner gates release publication.

const draftReleaseAccess = [
  /\bgh release (?:view|create|edit|upload|download)\b/u,
  /\bgh api\b[^\n]*\/releases\b/u,
  /api\.github\.com\/repos\/[^\n]*\/releases\//u,
  /\brelease-asset-upload\.sh\b/u,
];

export function releaseWorkflowProblems({ ci, release }) {
  const problems = [];
  const ciUploads = uploadNames(ci);
  for (const [label, workflow] of [
    ["ci.yml", ci],
    ["release.yml", release],
  ]) {
    problems.push(...needsOutputProblems(label, workflow));
    problems.push(...artifactProblems(label, workflow, label === "release.yml" ? ciUploads : []));
  }
  problems.push(...draftPermissionProblems(release));
  problems.push(...publicationRunnerProblems(release));
  return problems;
}

function jobsOf(workflow) {
  return Object.entries(workflow?.jobs ?? {});
}

function needsOf(job) {
  if (!job?.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

function ancestors(workflow, name) {
  const seen = new Set();
  const pending = [...needsOf(workflow.jobs[name])];
  while (pending.length > 0) {
    const next = pending.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...needsOf(workflow.jobs[next]));
  }
  return seen;
}

function scripts(job) {
  return (job.steps ?? []).map((step) => step.run ?? "").join("\n");
}

// Everything a job declares, including `if:` conditions, env and step inputs.
function text(value) {
  return JSON.stringify(value ?? "");
}

function needsOutputProblems(label, workflow) {
  const problems = [];
  for (const [name, job] of jobsOf(workflow)) {
    const direct = new Set(needsOf(job));
    for (const [, need, key] of text(job).matchAll(/\bneeds\.([\w-]+)\.outputs\.([\w-]+)/gu)) {
      if (!direct.has(need)) {
        problems.push(
          `${label} ${name} reads needs.${need}.outputs.${key} without needing ${need}`,
        );
      } else if (!Object.hasOwn(workflow.jobs[need]?.outputs ?? {}, key)) {
        problems.push(
          `${label} ${name} reads needs.${need}.outputs.${key}, which ${need} does not declare`,
        );
      }
    }
  }
  return problems;
}

// Expressions become a stable SHA token or a wildcard, so shell and workflow
// spellings of one artifact name compare equal.
function normalizeArtifactName(value) {
  return String(value)
    .replace(/\$\{\{\s*github\.sha\s*\}\}|\$\{?GITHUB_SHA\}?|\$\{?revision\}?/gu, "<sha>")
    .replace(/\$\{\{[^}]*\}\}|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/gu, "*");
}

function uploadNames(workflow, jobNames) {
  const names = [];
  for (const [name, job] of jobsOf(workflow)) {
    if (jobNames && !jobNames.has(name)) continue;
    for (const step of job.steps ?? []) {
      if (String(step.uses ?? "").startsWith("actions/upload-artifact@") && step.with?.name) {
        names.push(normalizeArtifactName(step.with.name));
      }
    }
  }
  return names;
}

function resolvedPrefixes(script) {
  const prefixes = [];
  for (const match of script.matchAll(/ci-artifacts\.mjs resolve[^\n]*--prefix\s+"([^"]+)"/gu)) {
    prefixes.push(match[1]);
  }
  // A shell helper may forward its first argument as the prefix.
  for (const [, helper] of script.matchAll(
    /(\w+)\(\)\s*\{[^}]*ci-artifacts\.mjs resolve[^}]*--prefix\s+"\$1"/gu,
  )) {
    for (const call of script.matchAll(new RegExp(`\\b${helper}\\s+"([^"]+)"`, "gu"))) {
      prefixes.push(call[1]);
    }
  }
  return prefixes.filter((prefix) => prefix !== "$1").map(normalizeArtifactName);
}

function prefixMatches(prefix, name) {
  // A wildcard in the prefix stands for one expression in the upload name.
  const pattern = prefix
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[^-]*");
  return new RegExp(`^${pattern}`, "u").test(name);
}

function artifactProblems(label, workflow, externalUploads) {
  const problems = [];
  for (const [name, job] of jobsOf(workflow)) {
    const prefixes = resolvedPrefixes(scripts(job));
    if (prefixes.length === 0) continue;
    const available = [...uploadNames(workflow, ancestors(workflow, name)), ...externalUploads];
    for (const prefix of prefixes) {
      if (!available.some((upload) => prefixMatches(prefix, upload))) {
        problems.push(
          `${label} ${name} resolves artifact prefix ${prefix}, which no upstream job uploads`,
        );
      }
    }
  }
  return problems;
}

function permissionsOf(workflow, job) {
  return job.permissions ?? workflow.permissions ?? {};
}

function draftPermissionProblems(release) {
  const problems = [];
  if (!release.jobs?.["publish-release"]) return ["release.yml has no publish-release job"];
  const published = new Set(["publish-release"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, job] of jobsOf(release)) {
      if (!published.has(name) && needsOf(job).some((need) => published.has(need))) {
        published.add(name);
        grew = true;
      }
    }
  }
  published.delete("publish-release");
  for (const [name, job] of jobsOf(release)) {
    if (published.has(name)) continue;
    const script = scripts(job);
    if (!draftReleaseAccess.some((pattern) => pattern.test(script))) continue;
    const permissions = permissionsOf(release, job);
    if (permissions !== "write-all" && permissions.contents !== "write") {
      problems.push(
        `release.yml ${name} reads or writes the draft release before publication without contents: write`,
      );
    }
  }
  return problems;
}

function runnerLabels(job) {
  const runsOn = job["runs-on"];
  const labels = [runsOn].flat().map(String);
  if (labels.some((label) => label.includes("matrix."))) {
    for (const entry of job.strategy?.matrix?.include ?? []) {
      labels.push(...Object.values(entry).map(String));
    }
    for (const values of Object.values(job.strategy?.matrix ?? {})) {
      if (Array.isArray(values)) labels.push(...values.map(String));
    }
  }
  return labels;
}

function publicationRunnerProblems(release) {
  const problems = [];
  const gates = ancestors(release, "publish-release");
  for (const name of gates) {
    const job = release.jobs[name];
    if (job && runnerLabels(job).some((label) => /\bmacos\b/u.test(label))) {
      problems.push(`release.yml ${name} puts a macOS runner on the publication path`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  const read = (file) => load(readFileSync(path.join(root, ".github/workflows", file), "utf8"));
  const problems = releaseWorkflowProblems({ ci: read("ci.yml"), release: read("release.yml") });
  if (problems.length > 0) {
    console.error(`Release workflow contracts failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Release workflow permissions, artifacts, outputs, and runners are consistent.");
}
