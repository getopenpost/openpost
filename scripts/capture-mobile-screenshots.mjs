import { spawn, spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error("Native iOS screenshots require macOS and Xcode.");
const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = resolve(root, "apps/mobile");
const output = resolve(mobile, "artifacts/screenshots");
const port = "8081";
const maestro = process.env.MAESTRO_BIN ?? "maestro";
const metroConfig = resolve(root, "apps/mobile/tests/screenshots/metro.config.cjs");
let simulator;
let metro;
let activeChild;
function cleanup() {
  activeChild?.kill("SIGTERM");
  metro?.kill("SIGTERM");
  if (simulator) {
    spawnSync("xcrun", ["simctl", "shutdown", simulator]);
    spawnSync("xcrun", ["simctl", "delete", simulator]);
    simulator = undefined;
  }
}
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${executable} failed: ${result.stderr ?? result.status}`);
  return result.stdout?.trim();
}

async function run(executable, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", ...options });
    activeChild = child;
    child.on("error", reject);
    child.on("exit", (code) => {
      activeChild = undefined;
      code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}`));
    });
  });
}

try {
  await mkdir(output, { recursive: true });
  command(maestro, ["--version"]);
  simulator = command("xcrun", [
    "simctl",
    "create",
    "OpenPost screenshots",
    "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
  ]);
  command("xcrun", ["simctl", "boot", simulator]);
  command("xcrun", ["simctl", "bootstatus", simulator, "-b"]);
  command("xcrun", ["simctl", "ui", simulator, "content_size", "large"]);
  command("xcrun", [
    "simctl",
    "status_bar",
    simulator,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "discharging",
    "--batteryLevel",
    "100",
    "--wifiBars",
    "3",
    "--cellularBars",
    "4",
  ]);
  try {
    const existing = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(1000),
    });
    if (existing.ok)
      throw new Error(`Stop the existing Metro server on port ${port} before capturing.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Stop the existing")) throw error;
  }
  await writeFile(resolve(output, "entry.js"), 'require("../../tests/screenshots/entry.js");\n');
  const env = {
    ...process.env,
    EXPO_OVERRIDE_METRO_CONFIG: metroConfig,
    CI: "1",
    MAESTRO_CLI_NO_ANALYTICS: "1",
  };
  metro = spawn("bunx", ["expo", "start", "--localhost", "--port", port], {
    cwd: mobile,
    env,
    stdio: "inherit",
  });
  metro.on("error", (error) => console.error(error));
  const deadline = Date.now() + 60000;
  while (true) {
    if (metro.exitCode !== null) throw new Error("Metro stopped before it became ready.");
    try {
      const status = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (status.ok) break;
    } catch {
      /* Metro starts asynchronously. */
    }
    if (Date.now() >= deadline) throw new Error("Metro did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (process.env.OPENPOST_SCREENSHOT_APP) {
    command("xcrun", ["simctl", "install", simulator, process.env.OPENPOST_SCREENSHOT_APP]);
  } else {
    await run("bun", ["run", "ios", "--", "--device", simulator, "--no-bundler"], {
      cwd: mobile,
      env,
    });
  }
  for (const scheme of ["light", "dark"]) {
    command("xcrun", ["simctl", "ui", simulator, "appearance", scheme]);
    await run(
      maestro,
      [
        "--udid",
        simulator,
        "test",
        "--test-output-dir",
        output,
        "-e",
        `OUTPUT=${output}`,
        "-e",
        `SCHEME=${scheme}`,
        "apps/mobile/tests/screenshots/gallery.yaml",
      ],
      { env },
    );
  }
  await run("bun", ["scripts/render-mobile-gallery.mjs", output]);
} finally {
  cleanup();
}
