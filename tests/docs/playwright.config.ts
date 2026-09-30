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
    storageState: {
      cookies: [
        {
          name: "openpost_analytics",
          value: "v1%3Aoff",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    cwd: root,
    command:
      "bun run build -- public-site && bunx wrangler pages dev dist/public-site --compatibility-date 2026-08-06 --port 4175",
    env: {
      VITE_POSTHOG_PROJECT_TOKEN: "phc_browser_fixture",
      VITE_POSTHOG_API_HOST: baseURL,
      VITE_POSTHOG_UI_HOST: baseURL,
      VITE_OPENPOST_ENVIRONMENT: "ci",
      POSTHOG_SOURCEMAPS_ENABLED: "0",
    },
    url: baseURL,
    timeout: 300_000,
  },
});
