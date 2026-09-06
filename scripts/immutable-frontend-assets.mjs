import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, cp, link, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const immutableFrontendAssetDirectories = ["image-editor-models"];

const linkFallbackCodes = new Set(["EACCES", "EMLINK", "ENOSYS", "ENOTSUP", "EPERM", "EXDEV"]);
const validatedFileDigests = new Set();

async function pathExists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertRelativeAssetPath(pathname, label) {
  const normalized = path.posix.normalize(pathname);
  if (
    !pathname ||
    normalized !== pathname ||
    path.posix.isAbsolute(pathname) ||
    pathname === ".." ||
    pathname.startsWith("../")
  ) {
    throw new Error(`Invalid ${label} path: ${pathname}`);
  }
  return pathname.split("/").join(path.sep);
}

async function readJson(pathname) {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch (error) {
    throw new Error(`Invalid immutable frontend asset manifest: ${pathname}`, { cause: error });
  }
}

async function expectedImmutableFrontendAssets(sourceRoot) {
  const expected = new Map();
  const add = (directory, relativePath, size, sha256 = null) => {
    const pathname = path.join(directory, assertRelativeAssetPath(relativePath, "immutable asset"));
    if (size !== null && (!Number.isSafeInteger(size) || size <= 0)) {
      throw new Error(`Invalid immutable frontend asset size for ${pathname}`);
    }
    if (sha256 !== null && !/^[0-9a-f]{64}$/u.test(sha256)) {
      throw new Error(`Invalid immutable frontend asset digest for ${pathname}`);
    }
    const contract = JSON.stringify({ size, sha256 });
    if (expected.has(pathname) && expected.get(pathname) !== contract) {
      throw new Error(`Conflicting immutable frontend asset sizes for ${pathname}`);
    }
    expected.set(pathname, contract);
  };

  const imageDirectory = "image-editor-models";
  const imageManifest = await readJson(path.join(sourceRoot, imageDirectory, "resources.json"));
  const imageBundleManifest = await readJson(
    path.join(sourceRoot, imageDirectory, "bundle-manifest.json"),
  );
  add(imageDirectory, "resources.json", null);
  add(imageDirectory, "bundle-manifest.json", null);
  if (
    !Array.isArray(imageBundleManifest.resources) ||
    imageBundleManifest.resources.length === 0 ||
    new Set(imageBundleManifest.resources).size !== imageBundleManifest.resources.length
  ) {
    throw new Error("The image editor bundle manifest has no unique resources");
  }
  for (const resourceName of imageBundleManifest.resources) {
    const resource = imageManifest[resourceName];
    if (!Array.isArray(resource?.chunks) || resource.chunks.length === 0) {
      throw new Error(`Missing required image editor resource: ${resourceName}`);
    }
    for (const chunk of resource.chunks) {
      const [start, end] = chunk.offsets ?? [];
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
        throw new Error(`Invalid image editor resource chunk: ${resourceName}`);
      }
      add(imageDirectory, chunk.name, end - start, chunk.hash ?? chunk.name);
    }
  }

  return expected;
}

async function sha256File(pathname) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  return hash.digest("hex");
}

export function shouldCopyFrontendPath(sourceDirectory, pathname) {
  const relative = path.relative(path.resolve(sourceDirectory), path.resolve(pathname));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === "..") return true;
  const [topLevelDirectory] = relative.split(path.sep);
  return !immutableFrontendAssetDirectories.includes(topLevelDirectory);
}

export async function copyFrontendWithoutImmutableAssets({ sourceDirectory, outputDirectory }) {
  await cp(sourceDirectory, outputDirectory, {
    recursive: true,
    force: true,
    preserveTimestamps: false,
    filter: (pathname) => shouldCopyFrontendPath(sourceDirectory, pathname),
  });
}

export async function validateImmutableFrontendAssets(sourceDirectory) {
  const sourceRoot = path.resolve(sourceDirectory);
  for (const directory of immutableFrontendAssetDirectories) {
    const source = path.join(sourceRoot, directory);
    if (!(await pathExists(source))) {
      throw new Error(`Missing canonical immutable frontend asset directory: ${source}`);
    }
  }
  for (const [relativePath, serializedContract] of await expectedImmutableFrontendAssets(
    sourceRoot,
  )) {
    const { size: expectedSize, sha256 } = JSON.parse(serializedContract);
    const pathname = path.join(sourceRoot, relativePath);
    let file;
    try {
      file = await lstat(pathname);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Missing canonical immutable frontend asset: ${pathname}`);
      }
      throw error;
    }
    if (!file.isFile() || (expectedSize !== null && file.size !== expectedSize)) {
      throw new Error(`Invalid canonical immutable frontend asset: ${pathname}`);
    }
    if (sha256 !== null) {
      const validationKey = [
        file.dev,
        file.ino,
        file.size,
        file.mtimeMs,
        file.ctimeMs,
        sha256,
      ].join(":");
      if (!validatedFileDigests.has(validationKey)) {
        if ((await sha256File(pathname)) !== sha256) {
          throw new Error(`Invalid canonical immutable frontend asset digest: ${pathname}`);
        }
        validatedFileDigests.add(validationKey);
      }
    }
  }
}

async function linkTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await linkTree(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Immutable frontend assets contain an unsupported entry: ${sourcePath}`);
    }
    try {
      await link(sourcePath, destinationPath);
    } catch (error) {
      if (!linkFallbackCodes.has(error?.code)) throw error;
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_FICLONE);
    }
  }
}

export async function materializeImmutableFrontendAssets({ sourceDirectory, outputDirectory }) {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  if (sourceRoot === outputRoot) {
    throw new Error(`Immutable frontend asset source and output must differ: ${sourceRoot}`);
  }

  await validateImmutableFrontendAssets(sourceRoot);

  for (const directory of immutableFrontendAssetDirectories) {
    const source = path.join(sourceRoot, directory);
    const destination = path.join(outputRoot, directory);
    await rm(destination, { recursive: true, force: true });
    await linkTree(source, destination);
  }
}

export function frontendAssetOutputDirectories(surface, root = repositoryRoot) {
  if (surface === "web") {
    return [
      path.join(root, "apps/web/.svelte-kit/output/client"),
      path.join(root, "apps/web/build"),
    ];
  }
  throw new Error(`Unsupported immutable frontend asset surface: ${surface}`);
}

export async function materializeFrontendSurfaceAssets(surface, root = repositoryRoot) {
  const sourceDirectory = path.join(root, "apps/web/static");
  for (const outputDirectory of frontendAssetOutputDirectories(surface, root)) {
    await materializeImmutableFrontendAssets({ sourceDirectory, outputDirectory });
  }
}

if (import.meta.main) {
  const [surface, ...rest] = process.argv.slice(2);
  if (!surface || rest.length > 0) {
    throw new Error("Usage: bun scripts/immutable-frontend-assets.mjs web");
  }
  await materializeFrontendSurfaceAssets(surface);
}
