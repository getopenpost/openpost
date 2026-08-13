import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

function healthyPublicationReadiness() {
  return {
    state: "healthy",
    executable: true,
    connectable: false,
    publishable: true,
    advertisable: false,
    facts: {
      configuration: "configured",
      local_test: "passed",
      live_certification: "passed",
      approval: "approved",
      authorization: "authorized",
      control: "enabled",
      policy: "allowed",
    },
    blockers: [],
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
    immediate_readiness: healthyPublicationReadiness(),
    scheduled_readiness: healthyPublicationReadiness(),
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
  const captionRequests: string[] = [];
  const captionPostContexts = new Map<string, string>();
  await page.route("**/api/v1/media**", async (route) => {
    const url = new URL(route.request().url());
    const captionMatch = url.pathname.match(
      /\/media\/([^/]+)\/alt-text\/generate$/,
    );
    if (captionMatch) {
      const mediaID = captionMatch[1];
      captionRequests.push(mediaID);
      const requestBody = route.request().postDataJSON() as {
        post_context?: string;
      };
      captionPostContexts.set(mediaID, requestBody.post_context ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: {
          alt_text: `Generated description for ${mediaID}.`,
          generated: true,
          model: "openai/gpt-5.6-luna",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/media/tags")) {
      await route.fulfill({
        contentType: "application/json",
        json: { tags: [], can_edit: true },
      });
      return;
    }
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
  const postText = "We are launching the new OpenPost media workflow today.";
  await composer.getByRole("textbox", { name: "Post text" }).fill(postText);

  await composer.getByRole("button", { name: "Add media" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toContainText("0 of 35 selected");
  await expect(picker.getByRole("tab", { name: "Device" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await picker.getByRole("tab", { name: "Library" }).click();
  await picker
    .getByRole("button", { name: "Select draft-image-1.png" })
    .click();
  await picker.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    1,
  );
  await expect.poll(() => [...captionRequests]).toEqual(["media-1"]);
  expect(captionPostContexts.get("media-1")).toBe(postText);
  await composer.getByRole("button", { name: "Alt text" }).click();
  await expect(composer.getByRole("textbox", { name: "Alt text" })).toHaveValue(
    "Generated description for media-1.",
  );
  await expect(composer).not.toContainText(
    "AI-generated — review before publishing.",
  );
  await composer.getByRole("button", { name: "Done" }).click();

  await composer.getByRole("button", { name: "Add media" }).click();
  await expect(picker).toContainText("1 of 35 selected");
  await picker.getByRole("tab", { name: "Library" }).click();
  for (let index = 2; index <= 5; index += 1) {
    await picker
      .getByRole("button", { name: `Select draft-image-${index}.png` })
      .click();
  }
  await picker.getByRole("button", { name: "Add media", exact: true }).click();

  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    5,
  );
  await expect
    .poll(() => [...captionRequests].sort())
    .toEqual(mediaItems.map((item) => item.id).sort());
  expect([...captionPostContexts.values()]).toEqual(
    mediaItems.map(() => postText),
  );
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row")).toHaveCount(5);
  await expect(
    page.getByTestId("composer-account-row").filter({ hasText: "openpost_x" }),
  ).toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_bluesky" }),
  ).toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_linkedin" }),
  ).not.toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_threads" }),
  ).not.toContainText("Needs attention");
});

test("pasted composer images upload in place without opening the media picker", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `composer-paste-${unique}@example.com`,
  );
  await createWorkspace(request, auth.token, "Composer paste E2E");
  await authenticatePage(page, auth.token);

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [account("x")],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: [
          {
            ...resolvedCapability("x"),
            issues: [
              {
                code: "media_required",
                severity: "error",
                message: "Add media before publishing.",
              },
            ],
            immediate_readiness: healthyPublicationReadiness(),
            scheduled_readiness: healthyPublicationReadiness(),
          },
        ],
      },
    });
  });

  let releaseFirstUpload!: () => void;
  const firstUploadGate = new Promise<void>((resolve) => {
    releaseFirstUpload = resolve;
  });
  let uploadAttempt = 0;
  await page.route("**/api/v1/media**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/media/storage")) {
      await route.fulfill({
        contentType: "application/json",
        json: { direct_upload_supported: false },
      });
      return;
    }
    if (/\/media\/[^/]+\/alt-text\/generate$/u.test(url.pathname)) {
      await route.fulfill({
        contentType: "application/json",
        json: { alt_text: "", generated: false, model: "" },
      });
      return;
    }
    if (url.pathname.endsWith("/media/upload")) {
      uploadAttempt += 1;
      if (uploadAttempt === 1) await firstUploadGate;
      if (uploadAttempt === 2) {
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Temporary upload failure",
        });
        return;
      }
      const id = uploadAttempt === 1 ? "pasted-success" : "pasted-retry";
      await route.fulfill({
        contentType: "application/json",
        json: {
          id,
          mime_type: "image/png",
          url: `/media/${id}`,
          size: tinyPNG.length,
          deduped: false,
          alt_text: "",
          original_filename: `${id}.png`,
          source: "upload",
          asset_kind: "library",
          retention_class: "temporary",
          processing_status: "ready",
          processing_progress: 100,
          analysis_status: "ready",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  const composer = page.getByTestId("text-thread-composer-shell");
  const textbox = composer.getByRole("textbox", { name: "Post text" });
  await textbox.focus();

  const plainTextPrevented = await textbox.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "Keep the browser paste path");
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(plainTextPrevented).toBe(false);

  const pasteImage = async (name: string) =>
    textbox.evaluate(
      (element, { encoded, filename }) => {
        const bytes = Uint8Array.from(atob(encoded), (value) =>
          value.charCodeAt(0),
        );
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], filename, { type: "image/png" }));
        const event = new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { encoded: tinyPNG.toString("base64"), filename: name },
    );

  expect(await pasteImage("clipboard-success.png")).toBe(true);
  const transientUpload = composer.getByTestId("composer-paste-upload");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transientUpload).toHaveAttribute("aria-busy", "true");
  await expect(transientUpload.locator('img[src^="blob:"]')).toHaveCount(1);
  await expect(transientUpload.getByRole("progressbar")).toBeVisible();
  const addMediaActions = composer.getByRole("button", { name: "Add media" });
  await expect(addMediaActions).toHaveCount(2);
  await expect(addMediaActions.nth(0)).toBeDisabled();
  await expect(addMediaActions.nth(0)).toHaveAttribute("aria-busy", "true");
  await expect(addMediaActions.nth(1)).toBeDisabled();
  await expect(addMediaActions.nth(1)).toHaveAttribute("aria-busy", "true");

  releaseFirstUpload();
  await expect(transientUpload).toHaveCount(0);
  await expect(
    composer.locator('img[src*="/media/pasted-success"]'),
  ).toHaveCount(1);

  expect(await pasteImage("clipboard-retry.png")).toBe(true);
  await expect(transientUpload).toHaveAttribute("data-status", "failed");
  await expect(transientUpload.getByRole("alert")).toContainText(
    "Temporary upload failure",
  );
  await transientUpload.getByRole("button", { name: "Try again" }).click();

  await expect(transientUpload).toHaveCount(0);
  await expect(composer.locator('img[src*="/media/pasted-retry"]')).toHaveCount(
    1,
  );
  await expect(
    composer.getByRole("button", { name: "Remove media" }),
  ).toHaveCount(2);
});
