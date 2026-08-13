import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OPENPOST_APP_E2E_PORT ?? 18180);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const dbPath = `/tmp/openpost-app-e2e-${port}.db`;
const reuseExistingServer = process.env.OPENPOST_APP_E2E_REUSE_SERVER === "1";
const usePrebuiltArtifact = process.env.OPENPOST_E2E_PREBUILT === "1";
const workers = Number(process.env.OPENPOST_APP_E2E_WORKERS ?? 2);
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumUse = {
  launchOptions: {
    ...(chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {}),
    args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
  },
};

export default defineConfig({
  testDir: "./e2e-app",
  fullyParallel: true,
  workers,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      `rm -f ${dbPath}`,
      ...(usePrebuiltArtifact ? [] : ["bun run frontend:build"]),
      [
        "cd backend &&",
        `OPENPOST_PORT=${port}`,
        `OPENPOST_DATABASE_PATH="file:${dbPath}?cache=shared&mode=rwc"`,
        'OPENPOST_JWT_SECRET="0123456789abcdef0123456789abcdef"',
        'OPENPOST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"',
        "OPENPOST_DISABLE_REGISTRATIONS=false",
        `OPENPOST_APP_URL="${baseURL}"`,
        "go run -tags dev ./cmd/openpost",
      ].join(" "),
    ].join(" && "),
    url: baseURL,
    reuseExistingServer,
    timeout: 300_000,
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
    },
  ],
});
