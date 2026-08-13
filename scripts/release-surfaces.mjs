import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readGitPaths(args, root) {
  return execFileSync("git", [...args, "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

export function readReleaseSurfaceManifest(root = repositoryRoot) {
  return JSON.parse(
    readFileSync(path.join(root, "release-surfaces.json"), "utf8"),
  );
}

export function classifyReleasePath(file, manifest) {
  const surfaces = [];
  for (const [name, owner] of Object.entries(manifest.surfaces ?? {})) {
    if (
      (owner.paths ?? []).includes(file) ||
      (owner.prefixes ?? []).some((prefix) => file.startsWith(prefix))
    ) {
      surfaces.push(name);
    }
  }
  const exemption = (manifest.exemptions ?? []).find(
    (item) =>
      item.path === file ||
      (typeof item.prefix === "string" && file.startsWith(item.prefix)),
  );
  return { surfaces: surfaces.sort(), exemption };
}

export function validateReleaseSurfaceManifest(
  manifest,
  trackedFiles,
  root = repositoryRoot,
) {
  const problems = [];
  if (manifest.schema_version !== 1) problems.push("schema_version must be 1");
  if (!manifest.surfaces || Object.keys(manifest.surfaces).length === 0) {
    problems.push("at least one release surface is required");
  }

  for (const [name, owner] of Object.entries(manifest.surfaces ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      problems.push(`invalid surface name ${JSON.stringify(name)}`);
    }
    if (!String(owner.description ?? "").trim()) {
      problems.push(`${name} is missing a description`);
    }
    if (
      (owner.paths?.length ?? 0) === 0 &&
      (owner.prefixes?.length ?? 0) === 0
    ) {
      problems.push(`${name} does not own any path or prefix`);
    }
    for (const prefix of owner.prefixes ?? []) {
      if (!prefix.endsWith("/")) {
        problems.push(`${name} prefix ${prefix} must end in /`);
      } else if (!trackedFiles.some((file) => file.startsWith(prefix))) {
        problems.push(`${name} prefix ${prefix} does not own a tracked file`);
      }
    }
    for (const file of owner.paths ?? []) {
      if (!trackedFiles.includes(file) && !existsSync(path.join(root, file))) {
        problems.push(`${name} path ${file} does not exist`);
      }
    }
  }

  for (const item of manifest.exemptions ?? []) {
    if (!String(item.reason ?? "").trim()) {
      problems.push(
        `exemption ${item.path ?? item.prefix ?? "unknown"} needs a reason`,
      );
    }
    if (item.prefix && !item.prefix.endsWith("/")) {
      problems.push(`exemption prefix ${item.prefix} must end in /`);
    }
    if (
      item.prefix &&
      !trackedFiles.some((file) => file.startsWith(item.prefix)) &&
      !existsSync(path.join(root, item.prefix))
    ) {
      problems.push(`exemption prefix ${item.prefix} does not exist`);
    }
    if (
      item.path &&
      !trackedFiles.includes(item.path) &&
      !existsSync(path.join(root, item.path))
    ) {
      problems.push(`exemption path ${item.path} does not exist`);
    }
  }

  for (const file of trackedFiles) {
    const classification = classifyReleasePath(file, manifest);
    if (classification.surfaces.length === 0 && !classification.exemption) {
      problems.push(`unowned tracked path: ${file}`);
    }
    if (classification.surfaces.length > 0 && classification.exemption) {
      problems.push(`path is both owned and exempt: ${file}`);
    }
  }
  return problems;
}

export function trackedReleasePaths(root = repositoryRoot) {
  return readGitPaths(["ls-files", "--cached"], root).sort();
}

export function maintainedReleasePaths(root = repositoryRoot) {
  return [
    ...new Set([
      ...trackedReleasePaths(root),
      ...readGitPaths(["ls-files", "--others", "--exclude-standard"], root),
    ]),
  ].sort();
}

export function changedReleasePaths(base, root = repositoryRoot) {
  const paths = new Set();
  const add = (lines) => lines.forEach((line) => paths.add(line));
  // Treat a move as one removed path and one added path. Git's rename
  // detection can otherwise report only the destination and hide the release
  // surface that lost the source file.
  add(
    readGitPaths(
      ["diff", "--name-only", "--no-renames", `${base}...HEAD`],
      root,
    ),
  );
  add(readGitPaths(["diff", "--name-only", "--no-renames"], root));
  add(readGitPaths(["diff", "--cached", "--name-only", "--no-renames"], root));
  add(readGitPaths(["ls-files", "--others", "--exclude-standard"], root));
  return [...paths].sort();
}

export function releaseSurfacePlan(files, manifest) {
  return files.map((file) => ({
    file,
    ...classifyReleasePath(file, manifest),
  }));
}

function main() {
  const manifest = readReleaseSurfaceManifest();
  const problems = validateReleaseSurfaceManifest(
    manifest,
    maintainedReleasePaths(),
  );
  if (problems.length > 0) {
    console.error(
      `Release surface ownership check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `Every maintained path has a release owner or explicit exemption across ${Object.keys(manifest.surfaces).length} surfaces.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
