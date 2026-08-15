import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OPENPOST_APP_E2E_PORT ?? 18180);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const firstUsePort = port + 10;
const firstUseURL = `http://${host}:${firstUsePort}`;
const dailyPort = port + 20;
const dailyURL = `http://${host}:${dailyPort}`;
const boundaryPort = port + 12;
const smtpPort = port + 13;
const mastodonPort = port + 14;
const boundaryURL = `http://${host}:${boundaryPort}`;
const mastodonURL = `https://${host}:${mastodonPort}`;
const mastodonCertPath = `/tmp/openpost-app-e2e-${port}-mastodon.crt`;
const mastodonKeyPath = `/tmp/openpost-app-e2e-${port}-mastodon.key`;
const dbPath = `/tmp/openpost-app-e2e-${port}.db`;
const firstUseDBPath = `/tmp/openpost-app-e2e-${firstUsePort}.db`;
const dailyDBPath = `/tmp/openpost-app-e2e-${dailyPort}.db`;
const reuseExistingServer = process.env.OPENPOST_APP_E2E_REUSE_SERVER === "1";
const usePrebuiltArtifact = process.env.OPENPOST_E2E_PREBUILT === "1";
const workers = Number(process.env.OPENPOST_APP_E2E_WORKERS ?? 2);
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
          'OPENPOST_JWT_SECRET="0123456789abcdef0123456789abcdef"',
          'OPENPOST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"',
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
    {
      command: [
        `until curl --silent --fail "${baseURL}" >/dev/null; do sleep 0.25; done`,
        `rm -f ${dailyDBPath}`,
        [
          "cd backend &&",
          `OPENPOST_PORT=${dailyPort}`,
          `OPENPOST_DATABASE_PATH="file:${dailyDBPath}?cache=shared&mode=rwc"`,
          'OPENPOST_JWT_SECRET="0123456789abcdef0123456789abcdef"',
          'OPENPOST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"',
          "OPENPOST_DISABLE_REGISTRATIONS=false",
          "OPENPOST_APP_E2E_DELIVERY_PROJECTION=true",
          `SSL_CERT_FILE=${mastodonCertPath}`,
          `OPENPOST_PROVIDER_APPS='[{"provider":"mastodon","name":"OpenPost Daily E2E","client_id":"e2e-client","client_secret":"e2e-secret","redirect_uri":"${dailyURL}/api/v1/accounts/mastodon/callback","instance_url":"${mastodonURL}"}]'`,
          `MASTODON_REDIRECT_URI="${dailyURL}/api/v1/accounts/mastodon/callback"`,
          `OPENPOST_APP_URL="${dailyURL}"`,
          "go run -tags dev ./cmd/openpost",
        ].join(" "),
      ].join(" && "),
      url: dailyURL,
      reuseExistingServer,
      timeout: 300_000,
    },
    {
      command: [
        `until curl --silent --fail "${baseURL}" >/dev/null; do sleep 0.25; done`,
        `rm -f ${firstUseDBPath}`,
        [
          "cd backend &&",
          `OPENPOST_PORT=${firstUsePort}`,
          `OPENPOST_DATABASE_PATH="file:${firstUseDBPath}?cache=shared&mode=rwc"`,
          'OPENPOST_JWT_SECRET="0123456789abcdef0123456789abcdef"',
          'OPENPOST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"',
          "OPENPOST_DISABLE_REGISTRATIONS=false",
          "OPENPOST_APP_E2E_HOSTED_SIGNUP=true",
          "OPENPOST_EMAIL_VERIFICATION_REQUIRED=true",
          "OPENPOST_EMAIL_PROVIDER=smtp",
          'OPENPOST_EMAIL_FROM="OpenPost <hello@openpost.test>"',
          `OPENPOST_SMTP_HOST=${host}`,
          `OPENPOST_SMTP_PORT=${smtpPort}`,
          "OPENPOST_SMTP_TLS_MODE=none",
          "OPENPOST_PADDLE_ENVIRONMENT=sandbox",
          "OPENPOST_PADDLE_API_KEY=e2e-paddle-api-key",
          `OPENPOST_PADDLE_API_BASE_URL="${boundaryURL}"`,
          "OPENPOST_PADDLE_CLIENT_TOKEN=e2e-paddle-client-token",
          "OPENPOST_PADDLE_WEBHOOK_SECRET=e2e-paddle-webhook-secret",
          `SSL_CERT_FILE=${mastodonCertPath}`,
          `OPENPOST_PADDLE_CHECKOUT_RETURN_URL="${firstUseURL}/checkout"`,
          ...["STARTER", "FOUNDER", "PRO", "TEAM", "AGENCY"].flatMap((plan) => [
            `OPENPOST_PADDLE_${plan}_MONTHLY_PRICE_ID=pri_${plan.toLowerCase()}_monthly`,
            `OPENPOST_PADDLE_${plan}_ANNUAL_PRICE_ID=pri_${plan.toLowerCase()}_annual`,
          ]),
          `OPENPOST_PROVIDER_APPS='[{"provider":"mastodon","name":"OpenPost E2E","client_id":"e2e-client","client_secret":"e2e-secret","redirect_uri":"${firstUseURL}/api/v1/accounts/mastodon/callback","instance_url":"${mastodonURL}"}]'`,
          `MASTODON_REDIRECT_URI="${firstUseURL}/api/v1/accounts/mastodon/callback"`,
          `OPENPOST_APP_URL="${firstUseURL}"`,
          "go run -tags dev ./cmd/openpost",
        ].join(" "),
      ].join(" && "),
      url: firstUseURL,
      reuseExistingServer,
      timeout: 300_000,
    },
  ],
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...chromiumUse },
      testIgnore: /(first-use|daily-workflow)-cohort\.spec\.ts/u,
    },
    {
      name: "first-use-real",
      testMatch: /first-use-cohort\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumUse,
        baseURL: firstUseURL,
        ignoreHTTPSErrors: true,
      },
    },
    {
      name: "daily-real",
      testMatch: /daily-workflow-cohort\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumUse,
        baseURL: dailyURL,
        ignoreHTTPSErrors: true,
      },
    },
  ],
});
