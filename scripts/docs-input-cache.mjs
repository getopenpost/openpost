import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const digest = (value) => createHash("sha256").update(value).digest("hex");
export const docsOutputs = [
  "apps/web/openapi.json",
  "apps/docs/.generated/openapi.json",
  "apps/docs/public/openapi.json",
  "apps/docs/content/docs/guides/media-limits.mdx",
  "docs/reference/cli.md",
];

// These generators use explicit dev/schema versions and produce no deployed
// runtime identity. Keep CI/deployment identity out of both execution and keys.
export function docsGeneratorEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !/^(?:GITHUB_|CF_|VITE_|OPENPOST_RELEASE_VERSION$|OPENPOST_TURBO_CACHE_DIR$)/u.test(name),
    ),
  );
}

function command(root, program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 30 * 1024 * 1024,
    env: docsGeneratorEnvironment(),
  });
  if (result.status !== 0) throw new Error(`Cannot establish docs inputs: ${program}`);
  return result.stdout;
}

// Deliberately conservative: include all server/CLI files (including embeds),
// configuration and generator helpers, not just a hand-maintained import list.
export async function docsInputKey(root, env = process.env) {
  const files = command(root, "git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "apps/server",
    "apps/cli",
    "config",
    "scripts",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".oxfmtrc.json",
    "apps/web/.oxfmtrc.json",
    "go.work",
    "go.work.sum",
  ]);
  const hash = createHash("sha256");
  hash.update("docs-inputs-v1\0");
  for (const file of [...new Set(files.split("\0").filter(Boolean))].sort()) {
    // Deleted indexed files and unreadable inputs make reuse unsafe.
    hash.update(file + "\0");
    hash.update(await readFile(path.join(root, file)));
    hash.update("\0");
  }
  for (const directory of ["apps/server", "apps/cli"]) {
    const cwd = path.join(root, directory);
    const go = JSON.parse(command(cwd, "go", ["env", "-json"]));
    if (
      go.GOWORK ||
      go.GOFLAGS ||
      /=>\s*(?:\.|\/)/u.test(await readFile(path.join(cwd, "go.mod"), "utf8"))
    ) {
      throw new Error("External workspace or local module replacement has unknown inputs");
    }
    // Hash actual local Go/CGO/embed inputs even when Git ignores them.
    // Unrelated frontend outputs, dev environments and scratch packages do
    // not participate in these command dependency graphs.
    const targets =
      directory === "apps/server"
        ? ["./cmd/openpost-openapi", "./cmd/openpost-media-limits"]
        : ["./cmd/openpost-docs"];
    const template =
      '{{if .Module}}{{if .Module.Main}}{{.Dir}}\t{{join .GoFiles "|"}}|{{join .CgoFiles "|"}}|{{join .CFiles "|"}}|{{join .CXXFiles "|"}}|{{join .HFiles "|"}}|{{join .SFiles "|"}}|{{join .SysoFiles "|"}}|{{join .EmbedFiles "|"}}{{end}}{{end}}';
    const packages = command(cwd, "go", ["list", "-deps", "-f", template, ...targets]);
    const inputs = new Set();
    for (const line of packages.split("\n").filter(Boolean)) {
      const [packageDirectory, names] = line.split("\t");
      if (!packageDirectory || names === undefined || !packageDirectory.startsWith(root + path.sep))
        throw new Error("Unknown local Go dependency");
      for (const name of names.split("|").filter(Boolean))
        inputs.add(path.join(packageDirectory, name));
    }
    for (const input of [...inputs].sort()) {
      hash.update(path.relative(root, input) + "\0");
      hash.update(await readFile(input));
      hash.update("\0");
    }
    // Go chooses a fresh compiler scratch directory for every env probe.
    // Its prefix-map target is stable and this path never reaches outputs.
    go.GOGCCFLAGS = go.GOGCCFLAGS.replace(
      /-ffile-prefix-map=\S*go-build\d+=/gu,
      "-ffile-prefix-map=<go-build>=",
    );
    hash.update(JSON.stringify(go));
    if (go.CGO_ENABLED === "1") hash.update(command(cwd, go.CC, ["--version"]));
  }
  hash.update(command(root, "bun", ["--version"]));
  hash.update(command(root, "bunx", ["oxfmt", "--version"]));
  // Hash remaining generator configuration, including new OpenPost settings.
  // Runtime artifact provenance remains in the consuming build, never here.
  env = docsGeneratorEnvironment(env);
  const names = Object.keys(env)
    .filter((name) =>
      /^(?:OPENPOST_|VITE_|GITHUB_|CF_|GO|CGO|CC$|CXX$|CFLAGS$|CPPFLAGS$|LDFLAGS$|SOURCE_DATE_EPOCH$|TZ$|LANG$|LC_)/u.test(
        name,
      ),
    )
    .sort();
  hash.update(JSON.stringify(names.map((name) => [name, env[name]])));
  return hash.digest("hex");
}

export async function cachedDocsInputs({
  root,
  key,
  generate,
  outputs = docsOutputs,
  directory = path.join(root, ".turbo/docs-inputs"),
}) {
  let identity;
  try {
    identity = await key();
  } catch {
    console.log("Docs inputs: unknown input state, regenerating");
    await generate();
    return "uncached";
  }
  const entry = path.join(directory, `${identity}.json`);
  try {
    const cached = JSON.parse(await readFile(entry, "utf8"));
    if (
      cached.version !== 1 ||
      cached.key !== identity ||
      JSON.stringify(Object.keys(cached.outputs)) !== JSON.stringify(outputs)
    )
      throw new Error("Invalid manifest");
    const verified = outputs.map((file) => {
      const record = cached.outputs[file];
      const bytes = Buffer.from(record.content, "base64");
      if (digest(bytes) !== record.sha256) throw new Error("Corrupt output");
      return [file, bytes];
    });
    for (const [file, bytes] of verified) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    console.log("Docs inputs: verified cache hit (zero Go generation)");
    return "hit";
  } catch {
    /* Missing, old or corrupt entries always regenerate. */
  }
  await generate();
  // Never associate outputs with inputs that changed during generation.
  let after;
  try {
    after = await key();
  } catch {
    return "uncached";
  }
  if (after !== identity) return "uncached";
  const records = {};
  for (const file of outputs) {
    const bytes = await readFile(path.join(root, file));
    records[file] = { sha256: digest(bytes), content: bytes.toString("base64") };
  }
  await mkdir(directory, { recursive: true });
  const temporary = `${entry}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, key: identity, outputs: records }));
  await rename(temporary, entry);
  console.log("Docs inputs: generated and cached");
  return "miss";
}
