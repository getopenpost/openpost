import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const evidenceKeys = [
  "digest",
  "release_manifest_sha256",
  "repository",
  "revision",
  "sbom_sha256",
  "schema_version",
  "tag",
  "vulnerability_report_sha256",
];

const sha256Pattern = /^[a-f0-9]{64}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const repositoryPattern = /^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._-]+$/u;

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function validateImageEvidence(evidence) {
  const problems = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["evidence must be a JSON object"];
  }
  const actualKeys = Object.keys(evidence).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(evidenceKeys)) {
    problems.push("evidence fields do not match the strict schema");
  }
  if (evidence.schema_version !== 1) {
    problems.push("schema_version must be 1");
  }
  if (!repositoryPattern.test(evidence.repository ?? "")) {
    problems.push("repository must be a lowercase GHCR repository");
  }
  if (!revisionPattern.test(evidence.revision ?? "")) {
    problems.push("revision must be a full lowercase Git SHA");
  }
  if (evidence.tag !== `sha-${evidence.revision}`) {
    problems.push("tag must be sha-<revision>");
  }
  if (!digestPattern.test(evidence.digest ?? "")) {
    problems.push("digest must be a sha256 registry digest");
  }
  for (const field of [
    "release_manifest_sha256",
    "sbom_sha256",
    "vulnerability_report_sha256",
  ]) {
    if (!sha256Pattern.test(evidence[field] ?? "")) {
      problems.push(`${field} must be a sha256 file hash`);
    }
  }
  return problems;
}

function requireValidEvidence(evidence) {
  const problems = validateImageEvidence(evidence);
  if (problems.length > 0) {
    throw new Error(`invalid image evidence: ${problems.join("; ")}`);
  }
  return evidence;
}

export async function createImageEvidence({
  repository,
  tag,
  revision,
  digest,
  releaseManifest,
  sbom,
  vulnerabilityReport,
}) {
  return requireValidEvidence({
    schema_version: 1,
    repository,
    tag,
    revision,
    digest,
    release_manifest_sha256: await sha256File(releaseManifest),
    sbom_sha256: await sha256File(sbom),
    vulnerability_report_sha256: await sha256File(vulnerabilityReport),
  });
}

export async function readImageEvidence(file) {
  return requireValidEvidence(JSON.parse(await readFile(file, "utf8")));
}

export async function verifyImageEvidence({
  evidenceFile,
  repository,
  tag,
  revision,
  releaseManifest,
  sbom,
  vulnerabilityReport,
}) {
  const evidence = await readImageEvidence(evidenceFile);
  for (const [field, expected] of Object.entries({
    repository,
    tag,
    revision,
  })) {
    if (evidence[field] !== expected) {
      throw new Error(
        `image evidence ${field} ${JSON.stringify(evidence[field])} does not match ${JSON.stringify(expected)}`,
      );
    }
  }
  const actualHashes = {
    release_manifest_sha256: await sha256File(releaseManifest),
    sbom_sha256: await sha256File(sbom),
    vulnerability_report_sha256: await sha256File(vulnerabilityReport),
  };
  for (const [field, actual] of Object.entries(actualHashes)) {
    if (evidence[field] !== actual) {
      throw new Error(`${field} does not match the candidate artifact`);
    }
  }
  return evidence;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`--${name} is required`);
  }
  return process.argv[index + 1];
}

async function main() {
  const command = process.argv[2];
  const common = {
    repository: option("repository"),
    tag: option("tag"),
    revision: option("revision"),
    releaseManifest: option("release-manifest"),
    sbom: option("sbom"),
    vulnerabilityReport: option("vulnerability-report"),
  };
  if (command === "create") {
    const evidence = await createImageEvidence({
      ...common,
      digest: option("digest"),
    });
    await writeFile(option("output"), `${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }
  if (command === "verify") {
    const evidence = await verifyImageEvidence({
      ...common,
      evidenceFile: option("evidence"),
    });
    process.stdout.write(`${evidence.digest}\n`);
    return;
  }
  throw new Error("usage: image-evidence.mjs <create|verify> [options]");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
