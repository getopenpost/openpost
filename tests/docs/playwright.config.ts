import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const baseURL = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: ".",
  outputDir: `${root}/test-results/docs`,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    cwd: root,
    command:
      "cd apps/docs && bunx wrangler pages dev out --compatibility-date 2026-08-06 --port 4175",
    url: baseURL,
    timeout: 60_000,
  },
});
