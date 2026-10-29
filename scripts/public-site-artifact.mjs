#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fullSHA = (value) => /^[a-f0-9]{40}$/.test(value || "");
export function assertQualifiedRun(run, jobs, repository, source) {
  if (
    !fullSHA(source) ||
    run.head_sha !== source ||
    run.head_repository?.full_name !== repository ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error("CI source/trust/status mismatch");
  for (const name of ["Marketing build", "Documentation build", "Public artifact contract"]) {
    const matches = jobs.filter((job) => job.name === name);
    if (matches.length !== 1 || matches[0].conclusion !== "success")
      throw new Error(`required prerequisite did not succeed: ${name}`);
  }
}
export function configIdentity(env = process.env) {
  const names = [
    "VITE_POSTHOG_PROJECT_TOKEN",
    "VITE_POSTHOG_API_HOST",
    "VITE_POSTHOG_UI_HOST",
    "VITE_OPENPOST_ENVIRONMENT",
    "POSTHOG_PROJECT_ID",
    "POSTHOG_SOURCEMAPS_ENABLED",
    "POSTHOG_UI_HOST",
    "BUN_VERSION",
    "NODE_VERSION",
  ];
  return sha256(JSON.stringify(names.map((name) => [name, env[name] || ""])));
}
export async function inventory(directory, prefix = "") {
  const files = {};
  for (const name of (await readdir(path.join(directory, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const file = path.join(directory, relative);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative}`);
    if (info.isDirectory()) Object.assign(files, await inventory(directory, relative));
    else if (info.isFile()) files[relative] = sha256(await readFile(file));
    else throw new Error(`unsupported artifact entry: ${relative}`);
  }
  return files;
}
export function matchIdentity(identity, source, config) {
  if (!fullSHA(source) || identity.source !== source || identity.config !== config)
    throw new Error("producer source/config mismatch");
}
export async function seal(directory, manifestFile, identity) {
  if (!fullSHA(identity.source) || !/^[a-f0-9]{64}$/.test(identity.config))
    throw new Error("invalid source/config identity");
  const files = await inventory(directory);
  if (!Object.keys(files).length) throw new Error("empty public artifact");
  const manifest = { schema: 1, ...identity, files, digest: sha256(JSON.stringify(files)) };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
export async function verify(directory, manifestFile, expected) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (
    (expected.digest && manifest.digest !== expected.digest) ||
    manifest.schema !== 1 ||
    manifest.source !== expected.source ||
    manifest.config !== expected.config ||
    !fullSHA(manifest.source)
  )
    throw new Error("artifact source/config mismatch");
  const files = await inventory(directory);
  if (
    !Object.keys(files).length ||
    JSON.stringify(files) !== JSON.stringify(manifest.files) ||
    sha256(JSON.stringify(files)) !== manifest.digest
  )
    throw new Error("artifact digest mismatch");
  return manifest;
}
// Live proof checks every deployed static byte, including discovery and docs. Pages
// control files are deployment configuration, not publicly served resources.
export async function proveLive(directory, manifestFile, expected, origin, fetchImpl = fetch) {
  const manifest = await verify(directory, manifestFile, expected);
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash)
    throw new Error("expected HTTPS deployment origin");
  let count = 0;
  const pending = Object.entries(manifest.files);
  async function worker() {
    while (pending.length) {
      const [file, digest] = pending.shift();
      if (file === "_headers" || file === "_redirects") continue;
      const route =
        file === "index.html"
          ? ""
          : file.endsWith("/index.html")
            ? file.slice(0, -10)
            : file.endsWith(".html")
              ? file.slice(0, -5)
              : file;
      const url = new URL(route.split("/").map(encodeURIComponent).join("/"), base);
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        headers: { "Cache-Control": "no-cache" },
      });
      if (
        !(response.ok || (file.endsWith("404.html") && response.status === 404)) ||
        sha256(Buffer.from(await response.arrayBuffer())) !== digest
      )
        throw new Error(`live byte mismatch: ${file}`);
      count++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return { source: manifest.source, digest: manifest.digest, origin, verifiedFiles: count };
}
async function main() {
  const [command, directory, manifestFile, source, config, origin] = process.argv.slice(2);
  if (command === "config") return console.log(configIdentity());
  if (command === "match-identity")
    return matchIdentity(JSON.parse(await readFile(directory, "utf8")), manifestFile, source);
  if (command === "qualify-run") {
    const run = JSON.parse(await readFile(directory, "utf8"));
    const jobs = JSON.parse(await readFile(manifestFile, "utf8")).flatMap(
      (page) => page.jobs || [],
    );
    assertQualifiedRun(run, jobs, source, config);
    return;
  }
  if (command === "seal")
    await seal(directory, manifestFile, {
      source,
      config,
      producerRun: process.env.PRODUCER_RUN || process.env.GITHUB_RUN_ID,
    });
  else if (command === "verify")
    await verify(directory, manifestFile, { source, config, digest: origin });
  else if (command === "live")
    console.log(
      JSON.stringify(await proveLive(directory, manifestFile, { source, config }, origin)),
    );
  else
    throw new Error(
      "usage: public-site-artifact.mjs config | qualify-run RUN JOBS REPO SHA | seal/verify/live DIRECTORY MANIFEST SHA CONFIG [HTTPS_ORIGIN]",
    );
}
if (import.meta.main) await main();
