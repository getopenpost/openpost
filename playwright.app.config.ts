import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OPENPOST_APP_E2E_PORT ?? 18180);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const firstUsePort = port + 10;
const firstUseURL = `http://${host}:${firstUsePort}`;
const boundaryPort = port + 12;
const smtpPort = port + 13;
const mastodonPort = port + 14;
const boundaryURL = `http://${host}:${boundaryPort}`;
const mastodonCertPath = `/tmp/openpost-app-e2e-${port}-mastodon.crt`;
const mastodonKeyPath = `/tmp/openpost-app-e2e-${port}-mastodon.key`;
const dbPath = `/tmp/openpost-app-e2e-${port}.db`;
const reuseExistingServer = process.env.OPENPOST_APP_E2E_REUSE_SERVER === "1";
const usePrebuiltArtifact = process.env.OPENPOST_E2E_PREBUILT === "1";
const workers = Number(process.env.OPENPOST_APP_E2E_WORKERS ?? (process.env.CI ? 1 : 2));
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumUse = {
  launchOptions: {
    ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
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
  webServer: [
    {
      command: [
        `rm -f ${mastodonCertPath} ${mastodonKeyPath}`,
        "&&",
        `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${mastodonKeyPath} -out ${mastodonCertPath} -days 1 -subj /CN=${host} -addext subjectAltName=IP:${host}`,
        "&&",
        `OPENPOST_APP_E2E_BOUNDARY_PORT=${boundaryPort}`,
        `OPENPOST_APP_E2E_SMTP_PORT=${smtpPort}`,
        `OPENPOST_APP_E2E_MASTODON_PORT=${mastodonPort}`,
        `OPENPOST_APP_E2E_MASTODON_CERT=${mastodonCertPath}`,
        `OPENPOST_APP_E2E_MASTODON_KEY=${mastodonKeyPath}`,
        `OPENPOST_APP_E2E_APP_URL="${firstUseURL}"`,
        'OPENPOST_APP_E2E_PADDLE_WEBHOOK_SECRET="e2e-paddle-webhook-secret"',
        "bun run scripts/e2e-external-boundaries.ts",
      ].join(" "),
      url: `${boundaryURL}/health`,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: [
        `rm -f ${dbPath}`,
        ...(usePrebuiltArtifact ? [] : ["bun run build -- frontend"]),
        [
          "cd backend &&",
          `OPENPOST_PORT=${port}`,
          `OPENPOST_DATABASE_PATH="file:${dbPath}?cache=shared&mode=rwc"`,
          'OPENPOST_JWT_SECRET="jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj"',
          'OPENPOST_ENCRYPTION_KEY="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"',
          "OPENPOST_DISABLE_REGISTRATIONS=false",
          "OPENPOST_EMAIL_PROVIDER=smtp",
          'OPENPOST_EMAIL_FROM="OpenPost <hello@openpost.test>"',
          `OPENPOST_SMTP_HOST=${host}`,
          `OPENPOST_SMTP_PORT=${smtpPort}`,
          "OPENPOST_SMTP_TLS_MODE=none",
          `OPENPOST_APP_URL="${baseURL}"`,
          "go run -tags dev ./cmd/openpost",
        ].join(" "),
      ].join(" && "),
      url: baseURL,
      reuseExistingServer,
      timeout: 300_000,
    },
  ],
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
    },
  ],
});
