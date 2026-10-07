import { execFileSync } from "node:child_process";
import lockfile from "proper-lockfile";
import { fileURLToPath } from "node:url";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
// Root checks may run web and marketing in separate Turbo processes.
const release = await lockfile.lock(packageRoot, {
  retries: { retries: 40, factor: 1, minTimeout: 500, maxTimeout: 500 },
});
try {
  execFileSync("svelte-package", { cwd: packageRoot, stdio: "inherit" });
} finally {
  await release();
}
