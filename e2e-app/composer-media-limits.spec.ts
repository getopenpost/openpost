import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const providers = ["mastodon", "linkedin", "x", "bluesky", "threads"];
const mediaItems = Array.from({ length: 5 }, (_, index) => ({
  id: `media-${index + 1}`,
  original_filename: `draft-image-${index + 1}.png`,
  mime_type: "image/png",
  size: 128,
  width: 1,
  height: 1,
  url: "/assets/logo.svg",
  thumbnail_url: "/assets/logo.svg",
  processing_status: "ready",
  analysis_status: "ready",
  asset_kind: "library",
  created_at: "2026-08-03T12:00:00Z",
}));

function account(provider: string) {
  return {
    id: `${provider}-main`,
    slug: `${provider}-main`,
    platform: provider,
    account_id: `${provider}-user`,
    account_username: `openpost_${provider}`,
    account_avatar_url: "",
    instance_url: provider === "mastodon" ? "https://mastodon.social" : "",
    is_active: true,
    thread_replies_supported: true,
  };
}

function resolvedCapability(provider: string) {
  return {
    account_id: `${provider}-main`,
    provider,
    profile: "image_post",
    output_profile: `${provider}.image`,
    label: `${provider} image`,
    text_limit: provider === "bluesky" ? 300 : 500,
    media: {
      min_count: 1,
      max_count: 1,
      allowed_mimes: ["image/png"],
      requires_public_url: provider === "threads",
      requires_https_fetchable: provider === "threads",
    },
    intents: ["post"],
    media_shapes: ["single_image"],
    settings: [],
    setting_groups: [],
    compatible: true,
    active_constraints: { media_shape: "single_image" },
    issues: [],
    capability_revision: "composer-media-test-v1",
    dynamic_options: {},
  };
}

test("Post drafts can move from one image to multiple before destination validation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `composer-media-${unique}@example.com`,
  );
  await createWorkspace(request, auth.token, "Composer media limits E2E");
  await authenticatePage(page, auth.token);

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: providers.map(account),
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { accounts: providers.map(resolvedCapability) },
    });
  });
  await page.route("**/api/v1/media/metadata?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { media: mediaItems },
    });
  });
  await page.route("**/api/v1/media?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { media: mediaItems, total: mediaItems.length },
    });
  });
  await page.route("**/api/v1/posts/draft", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 1,
        updated_at: "2026-08-03T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-1/draft", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 2,
        updated_at: "2026-08-03T12:00:01Z",
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("composer-account-row")).toHaveCount(0);
  const composer = page.getByTestId("text-thread-composer-shell");

  await composer.getByRole("button", { name: "Add media" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toContainText("0 of 35 selected");
  await picker
    .getByRole("button", { name: "Select draft-image-1.png" })
    .click();
  await picker.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    1,
  );

  await composer.getByRole("button", { name: "Add media" }).click();
  await expect(picker).toContainText("1 of 35 selected");
  for (let index = 2; index <= 5; index += 1) {
    await picker
      .getByRole("button", { name: `Select draft-image-${index}.png` })
      .click();
  }
  await picker.getByRole("button", { name: "Add media", exact: true }).click();

  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    5,
  );
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row")).toHaveCount(5);
  await expect(
    page.getByText("X supports up to 4 images per post."),
  ).toBeVisible();
  await expect(
    page.getByText("Bluesky supports up to 4 images per post."),
  ).toBeVisible();
  await expect(
    page.getByText("LinkedIn multi-image posts support 2-20 images."),
  ).toHaveCount(0);
  await expect(
    page.getByText("Threads supports up to 20 media attachments per post."),
  ).toHaveCount(0);
});
