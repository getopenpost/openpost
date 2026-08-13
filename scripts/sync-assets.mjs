import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assetSurfaceManifest } from "./asset-surfaces.ts";
import {
  assetSourceDirectory,
  assetTargetDirectories,
  validateAssetSurfaceManifest,
  validateAssetTarget,
} from "./asset-surfaces.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const source = assetSourceDirectory;
const frontendRoot = path.join(root, "frontend");

const targets = new Map(Object.entries(assetTargetDirectories));

const brandIconSource = path.join(source, "brand", "icon.svg");
const capacitorAssetsTarget = path.join(frontendRoot, "assets");
const lockDir = path.join(root, ".sync-assets.lock");

export async function syncAssets({ surface = "all" } = {}) {
  if (!existsSync(source)) {
    throw new Error("Missing assets/ directory");
  }
  if (surface !== "all" && !targets.has(surface)) {
    throw new Error(
      `Unknown asset surface ${JSON.stringify(surface)}; expected frontend, docs, marketing, or all`,
    );
  }

  await acquireLock();
  try {
    const selectedTargets =
      surface === "all"
        ? [...targets.entries()]
        : [[surface, targets.get(surface)]];
    const manifestProblems = await validateAssetSurfaceManifest(
      assetSurfaceManifest,
      root,
      selectedTargets.map(([surfaceName]) => surfaceName),
    );
    if (manifestProblems.length > 0) {
      throw new Error(
        `Asset surface manifest check failed:\n${manifestProblems.map((problem) => `- ${problem}`).join("\n")}`,
      );
    }

    for (const [surfaceName, target] of selectedTargets) {
      await syncAssetSurface(surfaceName, target);
      console.log(
        `Synced ${assetSurfaceManifest[surfaceName].length} declared assets -> ${path.relative(root, target)}`,
      );
    }

    if (surface === "all" || surface === "frontend") {
      if (!existsSync(brandIconSource)) {
        throw new Error("Missing brand icon at assets/brand/icon.svg");
      }
      await mkdir(capacitorAssetsTarget, { recursive: true });
      await cp(brandIconSource, path.join(capacitorAssetsTarget, "logo.svg"));
      console.log(
        "Prepared frontend/assets/logo.svg for Capacitor asset generation",
      );
    }
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function syncAssetSurface(surface, target) {
  const targetParent = path.dirname(target);
  // A stable sibling backup lets the next run recover if the process exits
  // between the two same-filesystem renames.
  const previousTarget = `${target}.previous`;
  await mkdir(targetParent, { recursive: true });
  await recoverAssetTarget(surface, target, previousTarget);
  await removeStaleAssetStages(target);
  const stagedTarget = await mkdtemp(
    path.join(targetParent, `.${path.basename(target)}.staged-`),
  );

  try {
    for (const relativePath of assetSurfaceManifest[surface]) {
      const destination = path.join(stagedTarget, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(source, relativePath), destination);
    }

    const targetProblems = await validateAssetTarget(surface, stagedTarget);
    if (targetProblems.length > 0) {
      throw new Error(
        `Staged ${surface} assets are invalid:\n${targetProblems.map((problem) => `- ${problem}`).join("\n")}`,
      );
    }

    if (existsSync(target)) {
      await rm(previousTarget, { recursive: true, force: true });
    }
    if (existsSync(target)) await moveAssetDirectory(target, previousTarget);
    try {
      await moveAssetDirectory(stagedTarget, target);
    } catch (error) {
      if (existsSync(previousTarget) && !existsSync(target)) {
        await moveAssetDirectory(previousTarget, target);
      }
      throw error;
    }
    await rm(previousTarget, { recursive: true, force: true });
  } finally {
    await rm(stagedTarget, { recursive: true, force: true });
  }
}

async function recoverAssetTarget(surface, target, previousTarget) {
  if (!existsSync(previousTarget)) return;
  if (existsSync(target)) {
    const targetProblems = await validateAssetTarget(surface, target);
    if (targetProblems.length === 0) {
      await rm(previousTarget, { recursive: true, force: true });
      return;
    }
    await rm(target, { recursive: true, force: true });
  }

  const previousProblems = await validateAssetTarget(surface, previousTarget);
  if (previousProblems.length === 0) {
    await moveAssetDirectory(previousTarget, target);
  } else {
    await rm(previousTarget, { recursive: true, force: true });
  }
}

async function removeStaleAssetStages(target) {
  const parent = path.dirname(target);
  const prefix = `.${path.basename(target)}.staged-`;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      await rm(path.join(parent, entry.name), { recursive: true, force: true });
    }
  }
}

export async function moveAssetDirectory(
  sourceDirectory,
  destinationDirectory,
  { renameDirectory = rename } = {},
) {
  try {
    await renameDirectory(sourceDirectory, destinationDirectory);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await cp(sourceDirectory, destinationDirectory, { recursive: true });
    await rm(sourceDirectory, { recursive: true, force: true });
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await syncAssets({ surface: optionValue("--surface") ?? "all" });
}

async function acquireLock() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = await stat(lockDir);
        if (Date.now() - lock.mtimeMs > 120_000) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") throw lockError;
      }
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for the asset synchronization lock");
}
