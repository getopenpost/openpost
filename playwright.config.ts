import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OPENPOST_MARKETING_E2E_PORT ?? 4322);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumUse = chromiumExecutablePath
  ? { launchOptions: { executablePath: chromiumExecutablePath } }
  : {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm run marketing:build && pnpm --filter @openpost/site preview --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"], ...chromiumUse },
    },
  ],
});
