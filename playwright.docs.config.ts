import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OPENPOST_DOCS_E2E_PORT ?? 4176);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const reuseExistingServer = process.env.OPENPOST_DOCS_E2E_REUSE_SERVER === "1";
const usePrebuiltArtifact = process.env.OPENPOST_E2E_PREBUILT === "1";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumUse = chromiumExecutablePath
  ? { launchOptions: { executablePath: chromiumExecutablePath } }
  : {};

export default defineConfig({
  testDir: "./e2e-docs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `${usePrebuiltArtifact ? "" : "bun run docs:build && "}cd docs-site && bunx vitepress preview --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
    },
  ],
});
