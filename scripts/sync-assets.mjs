import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const source = path.join(root, "assets");
const frontendRoot = path.join(root, "frontend");

const targets = [
  path.join(frontendRoot, "static", "assets"),
  path.join(root, "docs-site", "public", "assets"),
  path.join(root, "marketing-site", "static", "assets"),
];

const brandIconSource = path.join(source, "brand", "icon.svg");
const capacitorAssetsTarget = path.join(frontendRoot, "assets");
const lockDir = path.join(root, ".sync-assets.lock");

if (!existsSync(source)) {
  console.error("Missing assets/ directory");
  process.exit(1);
}

await acquireLock();
try {
  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
    console.log(`Synced assets -> ${path.relative(root, target)}`);
  }

  if (!existsSync(brandIconSource)) {
    throw new Error("Missing brand icon at assets/brand/icon.svg");
  }

  await mkdir(capacitorAssetsTarget, { recursive: true });
  await cp(brandIconSource, path.join(capacitorAssetsTarget, "logo.svg"));
  console.log("Prepared frontend/assets/logo.svg for Capacitor asset generation");
} finally {
  await rm(lockDir, { recursive: true, force: true });
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
