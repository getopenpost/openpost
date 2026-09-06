import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const port = Number(process.env.OPENPOST_MARKETING_E2E_PORT ?? 4322);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const reuseExistingServer = process.env.OPENPOST_MARKETING_E2E_REUSE_SERVER === "1";
const usePrebuiltArtifact = process.env.OPENPOST_E2E_PREBUILT === "1";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumUse = chromiumExecutablePath
  ? { launchOptions: { executablePath: chromiumExecutablePath } }
  : {};
const webServerCommand = usePrebuiltArtifact
  ? `cd apps/marketing && bunx wrangler pages dev dist --ip ${host} --port ${port} --compatibility-date 2026-08-06`
  : `bun run build -- marketing && bun run --filter @openpost/site preview --host ${host} --port ${port}`;

export default defineConfig({
  testDir: ".",
  outputDir: `${repositoryRoot}/test-results`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: `${repositoryRoot}/playwright-report` }]]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    cwd: repositoryRoot,
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
    },
    {
      name: "mobile-chrome",
      grepInvert: /@desktop/,
      use: { ...devices["Pixel 5"], ...chromiumUse },
    },
  ],
});
