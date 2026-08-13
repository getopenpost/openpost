import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const captureEnabled = process.env.OPENPOST_UPDATE_PRODUCT_SCREENSHOTS === "1";
const screenshotDirectory = fileURLToPath(
  new URL("../assets/screenshots/", import.meta.url),
);
const captureViewport = { width: 1440, height: 900 };
const fixedNow = "2026-07-21T14:30:00.000Z";

const connectedAccounts = [
  {
    id: "account-x",
    slug: "northstar-x",
    platform: "x",
    account_id: "northstar-x",
    account_username: "northstar_studio",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-mastodon",
    slug: "northstar-mastodon",
    platform: "mastodon",
    account_id: "northstar-mastodon",
    account_username: "northstar",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "https://mastodon.social",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-linkedin",
    slug: "northstar-linkedin",
    platform: "linkedin",
    account_id: "northstar-linkedin",
    account_username: "northstar-studio",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
];

const providerFixtures = [
  {
    platform: "x",
    display_name: "X",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    description: "Connect an X account.",
  },
  {
    platform: "mastodon",
    display_name: "Mastodon",
    auth_mode: "oauth_oob",
    configured: true,
    status: "available",
    description: "Connect any public Mastodon instance.",
  },
  {
    platform: "bluesky",
    display_name: "Bluesky",
    auth_mode: "app_password",
    configured: true,
    status: "available",
    description: "Connect with an app password.",
  },
  {
    platform: "linkedin",
    display_name: "LinkedIn",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    description: "Connect a LinkedIn profile.",
  },
  {
    platform: "threads",
    display_name: "Threads",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    description: "Connect a Threads profile.",
  },
  {
    platform: "facebook",
    display_name: "Facebook Pages",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    description: "Requires a Meta provider app.",
  },
  {
    platform: "instagram",
    display_name: "Instagram Business",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    description: "Requires a Meta provider app.",
  },
  {
    platform: "tiktok",
    display_name: "TikTok",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    description: "Requires a reviewed TikTok provider app.",
  },
  {
    platform: "youtube",
    display_name: "YouTube",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    description: "Requires a Google OAuth provider app.",
  },
];

const mediaFixtures = [
  {
    id: "media-launch",
    filename: "launch-card.png",
    artwork: "launch",
    width: 1600,
    height: 900,
    size: 248_300,
    favorite: true,
    usage: 3,
    canDelete: false,
  },
  {
    id: "media-workflow",
    filename: "publishing-workflow.png",
    artwork: "workflow",
    width: 1200,
    height: 1200,
    size: 189_440,
    favorite: false,
    usage: 1,
    canDelete: false,
  },
  {
    id: "media-release",
    filename: "release-notes.png",
    artwork: "release",
    width: 1080,
    height: 1350,
    size: 312_080,
    favorite: true,
    usage: 0,
    canDelete: true,
  },
  {
    id: "media-calendar",
    filename: "content-calendar.png",
    artwork: "calendar",
    width: 1600,
    height: 1000,
    size: 276_900,
    favorite: false,
    usage: 2,
    canDelete: false,
  },
  {
    id: "media-library",
    filename: "media-library.png",
    artwork: "library",
    width: 1400,
    height: 1050,
    size: 221_640,
    favorite: false,
    usage: 0,
    canDelete: true,
  },
];

const artwork = {
  "avatar-northstar": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#f97316"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
      <rect width="160" height="160" rx="80" fill="url(#g)"/>
      <path d="M80 31 92 67l38 1-30 22 11 37-31-21-31 21 11-37-30-22 38-1Z" fill="#fff7ed"/>
    </svg>`,
  launch: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#261f1b"/><stop offset=".55" stop-color="#9a3412"/><stop offset="1" stop-color="#fb923c"/></linearGradient></defs>
      <rect width="1200" height="1200" fill="url(#g)"/><circle cx="930" cy="245" r="210" fill="#fff7ed" opacity=".16"/>
      <path d="M150 835c210-340 420-340 630 0" fill="none" stroke="#fed7aa" stroke-width="54" stroke-linecap="round"/>
      <text x="150" y="290" fill="#fff7ed" font-family="system-ui,sans-serif" font-size="72" font-weight="700">Launch week</text>
      <text x="150" y="380" fill="#ffedd5" font-family="system-ui,sans-serif" font-size="36">One plan. Every destination.</text>
    </svg>`,
  workflow: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#f3efe8"/><g fill="none" stroke="#292524" stroke-width="18"><path d="M215 330h770M215 600h770M215 870h770"/></g>
      <g fill="#ea580c"><circle cx="300" cy="330" r="68"/><circle cx="600" cy="600" r="68"/><circle cx="900" cy="870" r="68"/></g>
      <text x="160" y="1080" fill="#292524" font-family="system-ui,sans-serif" font-size="64" font-weight="700">Draft · Adapt · Schedule</text>
    </svg>`,
  release: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#1c1917"/><rect x="150" y="150" width="900" height="900" rx="60" fill="#292524" stroke="#57534e" stroke-width="8"/>
      <rect x="245" y="300" width="520" height="28" rx="14" fill="#fb923c"/><rect x="245" y="410" width="710" height="24" rx="12" fill="#78716c"/><rect x="245" y="485" width="610" height="24" rx="12" fill="#78716c"/>
      <rect x="245" y="690" width="260" height="110" rx="55" fill="#f97316"/><text x="245" y="235" fill="#fafaf9" font-family="system-ui,sans-serif" font-size="54" font-weight="700">Release notes</text>
    </svg>`,
  calendar: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#172554"/><g fill="#dbeafe" opacity=".96"><rect x="145" y="190" width="910" height="820" rx="48"/></g>
      <g fill="#bfdbfe"><rect x="220" y="350" width="180" height="150" rx="24"/><rect x="435" y="350" width="180" height="150" rx="24"/><rect x="650" y="350" width="330" height="150" rx="24"/><rect x="220" y="535" width="330" height="230" rx="24"/><rect x="585" y="535" width="395" height="230" rx="24"/></g>
      <circle cx="910" cy="870" r="70" fill="#f97316"/><path d="m877 870 24 24 44-52" fill="none" stroke="white" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  library: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#134e4a"/><stop offset="1" stop-color="#5eead4"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/>
      <g fill="#f0fdfa" opacity=".92"><rect x="155" y="170" width="410" height="410" rx="42"/><rect x="635" y="170" width="410" height="410" rx="42"/><rect x="155" y="650" width="410" height="380" rx="42"/><rect x="635" y="650" width="410" height="380" rx="42"/></g>
      <g fill="#0f766e"><circle cx="360" cy="375" r="92"/><path d="m700 500 100-120 75 75 75-105 55 150Z"/><rect x="235" y="750" width="250" height="34" rx="17"/><rect x="715" y="750" width="250" height="34" rx="17"/></g>
    </svg>`,
} as const;

test.describe("product screenshot capture", () => {
  test.skip(
    !captureEnabled,
    "Run bun run capture:product-screenshots to update canonical product images.",
  );

  test.use({
    viewport: captureViewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  });

  test("captures current product surfaces with synthetic data", async ({
    page,
    request,
  }) => {
    await mkdir(screenshotDirectory, { recursive: true });

    const auth = await registerUser(request, "studio@openpost.example");
    const workspace = await createWorkspace(
      request,
      auth.token,
      "Northstar Image Editor",
    );
    const profile = await request.patch("/api/v1/auth/profile", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { display_name: "Northstar Operator" },
    });
    expect(profile.ok()).toBeTruthy();

    await authenticatePage(page, auth.token);
    await page.addInitScript(() => {
      localStorage.setItem("mode-watcher-mode", "dark");
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date(fixedNow));

    await page.route("**/marketing-fixtures/**", async (route) => {
      const key = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)
        ?.replace(/\.svg$/, "");
      const body = key ? artwork[key as keyof typeof artwork] : undefined;
      if (!body) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body,
      });
    });

    await page.route("**/api/v1/accounts?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: connectedAccounts,
      });
    });
    await page.route("**/api/v1/accounts/providers", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: providerFixtures,
      });
    });
    await page.route("**/api/v1/provider-readiness?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          providers: connectedAccounts.map((account) => ({
            provider: account.platform,
            configured_app_state: "ready",
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
          })),
        },
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      const body = route.request().postDataJSON() as {
        account_ids?: string[];
        intent?: string;
      };
      const accounts = (body.account_ids ?? [])
        .map((accountID) =>
          connectedAccounts.find((account) => account.id === accountID),
        )
        .filter((account): account is (typeof connectedAccounts)[number] =>
          Boolean(account),
        )
        .map((account) => ({
          account_id: account.id,
          active_constraints: {},
          capability_revision: "product-screenshot-v1",
          compatible: true,
          intents: ["post", "thread"],
          issues: [],
          label:
            providerFixtures.find(
              (provider) => provider.platform === account.platform,
            )?.display_name ?? account.platform,
          media: {
            allowed_mimes: ["image/jpeg", "image/png", "video/mp4"],
            max_count: 4,
            min_count: 0,
            requires_https_fetchable: false,
            requires_public_url: false,
          },
          media_shapes: ["landscape", "portrait", "square"],
          native_scheduling: false,
          openpost_queued: true,
          output_profile: account.platform,
          profile: account.platform,
          provider: account.platform,
          requires_app_review: false,
          requires_public_media: false,
          setting_groups: [],
          text_limit: account.platform === "x" ? 280 : 3_000,
        }));
      await route.fulfill({
        contentType: "application/json",
        json: { accounts },
      });
    });
    await page.route("**/api/v1/media?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          total: mediaFixtures.length,
          limit: 40,
          offset: 0,
          media: mediaFixtures.map((item, index) => ({
            id: item.id,
            workspace_id: workspace.id,
            mime_type: "image/png",
            size: item.size,
            original_filename: item.filename,
            width: item.width,
            height: item.height,
            alt_text: `${item.filename.replace(/\.png$/, "")} marketing artwork`,
            is_favorite: item.favorite,
            created_at: new Date(
              Date.parse(fixedNow) - index * 86_400_000,
            ).toISOString(),
            url: `/marketing-fixtures/${item.artwork}.svg`,
            thumbnail_url: `/marketing-fixtures/${item.artwork}.svg`,
            usage_count: item.usage,
            can_delete: item.canDelete,
            processing_status: "ready",
            processing_progress: 100,
            analysis_status: "complete",
            duration_ms: 0,
            frame_rate: 0,
            source: "upload",
            asset_kind: "image",
            tags: [],
          })),
        },
      });
    });
    await page.route("**/api/v1/posts/draft", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          post_id: "screenshot-draft",
          publication_id: "screenshot-publication",
          revision: 1,
          updated_at: "2026-07-24T12:00:00Z",
        },
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("compose-shell")).toBeVisible();
    await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
    await page
      .locator("#post-textarea-0")
      .fill(
        "A clearer way to plan the next release: draft once, adapt each destination, and keep every scheduled post visible.",
      );
    await page.getByRole("button", { name: "Add post" }).click();
    await page
      .locator("#post-textarea-1")
      .fill(
        "The new workspace keeps media, account-specific copy, and publishing status together.",
      );
    await page.getByRole("button", { name: "Add post" }).last().click();
    await page
      .locator("#post-textarea-2")
      .fill(
        "Review every destination before it enters the queue, with clear limits and account-specific variants.",
      );
    await page.getByRole("button", { name: "Add post" }).last().click();
    await page
      .locator("#post-textarea-3")
      .fill(
        "Schedule it, follow the job state, and know what published—or what needs attention.",
      );
    await capture(page, "main-dark.png");

    await page.goto("/accounts");
    await expect(
      page.getByRole("heading", { name: "Connected channels" }),
    ).toBeVisible();
    await expect(page.getByText("@northstar_studio")).toBeVisible();
    await expect(page.getByTestId("provider-card-bluesky")).toBeVisible();
    await capture(page, "accounts-dark.png");

    await page.goto("/media");
    await expect(
      page.getByRole("heading", { name: "Media", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("launch-card.png")).toBeVisible();
    await page.waitForFunction(() =>
      Array.from(document.images).every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await capture(page, "media-dark.png");

    await page.goto("/settings?tab=general");
    await expect(
      page.getByRole("heading", { name: "General", level: 1 }),
    ).toBeVisible();
    await expect(page.locator('[data-settings-tab="general"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await capture(page, "settings-dark.png");
  });
});

async function capture(page: Page, filename: string) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: join(screenshotDirectory, filename),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "css",
  });
}
