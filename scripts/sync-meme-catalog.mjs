#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import sharp from "sharp";

const SOURCE_REPOSITORY = "https://github.com/jacebrowning/memegen";
const SOURCE_COMMIT = "aa0fc3af4dd1c669cc35039a7d8efcca7d4eb98a";
const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png"]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputRoot = join(repositoryRoot, "apps/server/internal/memes/catalog");
const sourceRoot = resolve(process.argv[2] ?? process.env.OPENPOST_MEMEGEN_SOURCE_DIR ?? "");

if (!sourceRoot || !existsSync(join(sourceRoot, ".git"))) {
  throw new Error(
    "Pass a Memegen checkout as the first argument or set OPENPOST_MEMEGEN_SOURCE_DIR.",
  );
}

const sourceCommit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (sourceCommit !== SOURCE_COMMIT) {
  throw new Error(`Expected Memegen ${SOURCE_COMMIT}, received ${sourceCommit}.`);
}

const sourceLicense = join(sourceRoot, "LICENSE.txt");
const sourceTemplates = join(sourceRoot, "templates");
const sourceFonts = join(sourceRoot, "fonts");
if (!existsSync(sourceLicense) || !existsSync(sourceTemplates) || !existsSync(sourceFonts)) {
  throw new Error("The Memegen checkout is missing LICENSE.txt, fonts/, or templates/.");
}

const commitDate = execFileSync("git", ["-C", sourceRoot, "show", "-s", "--format=%cI", "HEAD"], {
  encoding: "utf8",
}).trim();
const stagingRoot = `${outputRoot}.staging`;
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(join(stagingRoot, "templates"), { recursive: true });
mkdirSync(join(stagingRoot, "thumbnails"), { recursive: true });
mkdirSync(join(stagingRoot, "fonts"), { recursive: true });

for (const filename of [
  "HG-Mincho-B.ttc",
  "Impact.ttf",
  "Kalam-Regular.ttf",
  "MicroFLF-Bold.ttf",
  "NotoSans-Bold.ttf",
  "NotoSansHebrew-Bold.ttf",
  "Segoe UI Bold.ttf",
  "Tahoma-Bold.ttf",
  "TitilliumWeb-Black.ttf",
  "TitilliumWeb-SemiBold.ttf",
]) {
  const source = join(sourceFonts, filename);
  if (!existsSync(source)) throw new Error(`The pinned font asset ${filename} is missing.`);
  cpSync(source, join(stagingRoot, "fonts", filename));
}

function copyNormalizedText(source, target) {
  const normalized = readFileSync(source, "utf8")
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+$/gm, "");
  writeFileSync(target, normalized.endsWith("\n") ? normalized : `${normalized}\n`);
}

for (const filename of ["OFL.txt", "SIL Open Font License.txt"]) {
  copyNormalizedText(join(sourceFonts, filename), join(stagingRoot, "fonts", filename));
}

function boundedText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function textField(input = {}) {
  return {
    style: boundedText(input.style, "upper"),
    color: boundedText(input.color, "white"),
    font: boundedText(input.font, "thick"),
    anchor_x: finiteNumber(input.anchor_x, 0),
    anchor_y: finiteNumber(input.anchor_y, 0),
    angle: finiteNumber(input.angle, 0),
    scale_x: finiteNumber(input.scale_x, 1),
    scale_y: finiteNumber(input.scale_y, 0.2),
    align: boundedText(input.align, "center"),
    start: finiteNumber(input.start, 0),
    stop: finiteNumber(input.stop, 1),
  };
}

function overlayField(input = {}) {
  return {
    center_x: finiteNumber(input.center_x, 0.5),
    center_y: finiteNumber(input.center_y, 0.5),
    angle: finiteNumber(input.angle, 0),
    scale: finiteNumber(input.scale, 0.25),
    start: finiteNumber(input.start, 0),
    stop: finiteNumber(input.stop, 1),
  };
}

function normalizeSourceURL(value) {
  const source = boundedText(value);
  if (!source.startsWith("http://")) return source;
  return `https://${source.slice("http://".length)}`;
}

const templateDirectories = readdirSync(sourceTemplates, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const manifestTemplates = [];
const thumbnailJobs = [];
for (const id of templateDirectories) {
  const sourceDirectory = join(sourceTemplates, id);
  const configPath = join(sourceDirectory, "config.yml");
  if (!existsSync(configPath)) throw new Error(`Template ${id} is missing config.yml.`);
  const config = yaml.load(readFileSync(configPath, "utf8")) ?? {};
  const text = Array.isArray(config.text) ? config.text.map(textField) : [];
  if (text.length < 1 || text.length > 16) {
    throw new Error(`Template ${id} has an invalid caption field count.`);
  }

  const targetDirectory = join(stagingRoot, "templates", id);
  mkdirSync(targetDirectory, { recursive: true });
  copyNormalizedText(configPath, join(targetDirectory, "config.yml"));
  const assets = readdirSync(sourceDirectory)
    .filter((filename) => IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  if (assets.length === 0) throw new Error(`Template ${id} has no raster assets.`);
  for (const filename of assets)
    cpSync(join(sourceDirectory, filename), join(targetDirectory, filename));

  const staticDefault = ["default.jpg", "default.jpeg", "default.png"].find((filename) =>
    assets.includes(filename),
  );
  const animatedDefault = assets.includes("default.gif") ? "default.gif" : "";
  const defaultAsset = staticDefault ?? animatedDefault;
  if (!defaultAsset) throw new Error(`Template ${id} has no default raster asset.`);
  const styles = assets
    .map((filename) => basename(filename, extname(filename)))
    .filter((style) => style !== "default");
  if (animatedDefault) styles.push("animated");
  if (styles.length > 0 || (Array.isArray(config.overlay) && config.overlay.length > 0)) {
    styles.push("default");
  }

  const assetHash = createHash("sha256");
  for (const filename of assets) assetHash.update(readFileSync(join(sourceDirectory, filename)));
  const thumbnailFilename = `${id}.jpg`;
  thumbnailJobs.push({
    id,
    input: join(sourceDirectory, staticDefault ?? animatedDefault),
    output: join(stagingRoot, "thumbnails", thumbnailFilename),
  });
  manifestTemplates.push({
    id,
    name: boundedText(config.name, id),
    source_url: normalizeSourceURL(config.source),
    keywords: Array.isArray(config.keywords)
      ? config.keywords.map((value) => boundedText(value)).filter(Boolean)
      : [],
    example: Array.isArray(config.example) ? config.example.map((value) => boundedText(value)) : [],
    text,
    overlay: Array.isArray(config.overlay) ? config.overlay.map(overlayField) : [],
    styles: [...new Set(styles)].sort((left, right) => left.localeCompare(right)),
    assets,
    default_asset: defaultAsset,
    animated_asset: animatedDefault,
    thumbnail_asset: `thumbnails/${thumbnailFilename}`,
    asset_sha256: assetHash.digest("hex"),
  });
}

const existingSemanticsPath = join(outputRoot, "semantics.json");
if (existsSync(existingSemanticsPath)) {
  const records = JSON.parse(readFileSync(existingSemanticsPath, "utf8"));
  if (!Array.isArray(records)) throw new Error("The existing meme semantics must be a JSON array.");

  const expectedRoleCounts = new Map(
    manifestTemplates.map((template) => [template.id, template.text.length]),
  );
  const seen = new Set();
  for (const record of records) {
    const id = typeof record?.id === "string" ? record.id : "";
    if (!expectedRoleCounts.has(id)) {
      throw new Error(`Meme semantics contain unknown template ${id || "<missing id>"}.`);
    }
    if (seen.has(id)) throw new Error(`Meme semantics contain duplicate template ${id}.`);
    if (
      !Array.isArray(record.caption_roles) ||
      record.caption_roles.length !== expectedRoleCounts.get(id)
    ) {
      throw new Error(`Meme semantics for ${id} do not match its caption field count.`);
    }
    seen.add(id);
  }
  const missing = manifestTemplates.map((template) => template.id).filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Meme semantics are missing ${missing.length} templates: ${missing.join(", ")}.`,
    );
  }
  copyNormalizedText(existingSemanticsPath, join(stagingRoot, "semantics.json"));
}

const concurrency = 6;
let thumbnailIndex = 0;
async function thumbnailWorker() {
  while (thumbnailIndex < thumbnailJobs.length) {
    const job = thumbnailJobs[thumbnailIndex++];
    await sharp(job.input, { animated: false, pages: 1 })
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#111111" })
      .jpeg({ quality: 78, chromaSubsampling: "4:2:0", mozjpeg: true })
      .toFile(job.output);
  }
}
await Promise.all(Array.from({ length: concurrency }, thumbnailWorker));

const manifest = {
  schema_version: 1,
  source_repository: SOURCE_REPOSITORY,
  source_commit: SOURCE_COMMIT,
  source_commit_date: commitDate,
  template_count: manifestTemplates.length,
  templates: manifestTemplates,
};
writeFileSync(join(stagingRoot, "catalog.json"), `${JSON.stringify(manifest, null, 2)}\n`);
copyNormalizedText(sourceLicense, join(stagingRoot, "LICENSE-MEMEGEN.txt"));

rmSync(outputRoot, { recursive: true, force: true });
cpSync(stagingRoot, outputRoot, { recursive: true });
rmSync(stagingRoot, { recursive: true, force: true });

const bytes = statSync(join(outputRoot, "catalog.json")).size;
console.log(
  `Synced ${manifestTemplates.length} templates from ${SOURCE_COMMIT.slice(0, 12)} (${bytes} manifest bytes).`,
);
