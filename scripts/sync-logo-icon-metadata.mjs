import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as tar from "tar";

const LUCIDE_VERSION = "0.577.0";
const LUCIDE_COMMIT = "0ea8780434e2b4527dc860b18ff94883d080b59c";
const ARCHIVE_SHA256 = "0410a74f1c9f80e3ee0414a5ad66a510a2e13d5e95393133ee3412fee960d7eb";
const ARCHIVE_URL = `https://github.com/lucide-icons/lucide/archive/${LUCIDE_COMMIT}.tar.gz`;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repositoryRoot, "node_modules", "@lucide", "svelte");
const iconsRoot = join(packageRoot, "dist", "icons");
const outputPath = join(
  repositoryRoot,
  "apps",
  "marketing",
  "src",
  "routes",
  "_components",
  "tools",
  "logo-icon-metadata.json",
);
const checkOnly = process.argv.includes("--check");
const execFileAsync = promisify(execFile);

async function readInstalledCatalog() {
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (packageJson.version !== LUCIDE_VERSION) {
    throw new Error(
      `Expected @lucide/svelte ${LUCIDE_VERSION}, but found ${packageJson.version}. Update the metadata pin with the package.`,
    );
  }

  return (await readdir(iconsRoot))
    .filter((name) => name.endsWith(".svelte"))
    .map((name) => name.slice(0, -".svelte".length))
    .sort();
}

async function downloadArchive(archivePath) {
  const response = await fetch(ARCHIVE_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Could not download Lucide metadata: ${response.status} ${response.statusText}`,
    );
  }

  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== ARCHIVE_SHA256) {
    throw new Error(
      `Lucide archive checksum mismatch: expected ${ARCHIVE_SHA256}, received ${digest}`,
    );
  }
  await writeFile(archivePath, archive);
}

async function generateMetadata() {
  const installedIcons = await readInstalledCatalog();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openpost-lucide-metadata-"));
  const archivePath = join(temporaryRoot, "lucide.tar.gz");

  try {
    await downloadArchive(archivePath);
    await tar.extract({ file: archivePath, cwd: temporaryRoot });

    const extractedRoot = join(temporaryRoot, `lucide-${LUCIDE_COMMIT}`);
    const sourceIconsRoot = join(extractedRoot, "icons");
    const sourceIcons = (await readdir(sourceIconsRoot))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();

    if (JSON.stringify(sourceIcons) !== JSON.stringify(installedIcons)) {
      const installed = new Set(installedIcons);
      const source = new Set(sourceIcons);
      const missing = installedIcons.filter((name) => !source.has(name));
      const unexpected = sourceIcons.filter((name) => !installed.has(name));
      throw new Error(
        `Lucide source and installed icon catalogs differ. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
      );
    }

    const metadata = {};
    for (const slug of installedIcons) {
      const source = JSON.parse(await readFile(join(sourceIconsRoot, `${slug}.json`), "utf8"));
      metadata[slug] = {
        tags: source.tags,
        categories: source.categories,
        aliases: (source.aliases ?? []).map((alias) =>
          typeof alias === "string" ? alias : alias.name,
        ),
      };
    }

    const candidatePath = join(temporaryRoot, "logo-icon-metadata.json");
    await writeFile(candidatePath, `${JSON.stringify(metadata, null, 2)}\n`);
    await execFileAsync(join(repositoryRoot, "node_modules", ".bin", "oxfmt"), [
      "--config",
      join(repositoryRoot, "apps", "marketing", ".oxfmtrc.json"),
      candidatePath,
    ]);
    return readFile(candidatePath, "utf8");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv.includes("--check-catalog")) {
  const installed = await readInstalledCatalog();
  const metadata = JSON.parse(await readFile(outputPath, "utf8"));
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(installed)) {
    throw new Error("Logo icon catalog changed. Update the pinned Lucide metadata.");
  }
  console.log(`Logo metadata covers all ${installed.length} installed Lucide icons.`);
  process.exit(0);
}

const generated = await generateMetadata();
if (checkOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== generated) {
    throw new Error("Logo icon metadata is stale. Run `bun scripts/sync-logo-icon-metadata.mjs`.");
  }
  console.log(`Logo icon metadata matches Lucide ${LUCIDE_VERSION} (${LUCIDE_COMMIT}).`);
} else {
  await writeFile(outputPath, generated);
  console.log(`Wrote ${outputPath} from Lucide ${LUCIDE_VERSION} (${LUCIDE_COMMIT}).`);
}
