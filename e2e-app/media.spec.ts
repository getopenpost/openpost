import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

function createVideoFixture(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "openpost-video-e2e-"));
  const filename = join(directory, "clip.mp4");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x2563eb:s=160x90:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-shortest",
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      filename,
    ]);
    return readFileSync(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("media library uploads and lists a local media file", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `media-library-${unique}@example.com`;

  const auth = await registerUser(request, email);
  const workspaceBody = await createWorkspace(
    request,
    auth.token,
    "Media Library E2E",
  );

  await authenticatePage(page, auth.token);
  await page.goto("/media");

  await expect(
    page.getByRole("heading", { name: "Media", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Media sections" }),
  ).toHaveCount(0);
  await expect(page.getByText("No media found")).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload media" }).click();
  await expect(
    page.getByRole("dialog", { name: "Upload Media" }),
  ).toBeVisible();
  await page.locator("#file-upload").setInputFiles({
    name: "launch-card.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload" })
    .click();

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible();
  await expect(page.getByText("launch-card.png")).toBeVisible();
  await expect(
    page
      .getByTestId("page-header")
      .getByText(/1 assets · .* stored/, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenPost Image Editor edits")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Open details for launch-card.png" })
    .click();
  const detailsDialog = page.getByRole("dialog", { name: "launch-card.png" });
  await expect(detailsDialog).toBeVisible();
  await expect(
    detailsDialog.getByRole("img", { name: "launch-card.png" }),
  ).toHaveAttribute("src", /\/media\//);
  await expect(detailsDialog.getByLabel("Alt text")).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Close" }).last().click();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select launch-card.png" }).click();
  await expect(
    page.getByRole("toolbar", { name: "Selected media actions" }),
  ).toContainText("1 selected");

  const media = await request.get(
    `/api/v1/media?workspace_id=${workspaceBody.id}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
  expect(media.ok()).toBeTruthy();
  const mediaBody = await media.json();
  expect(mediaBody.total).toBe(1);
  expect(mediaBody.media[0]).toMatchObject({
    original_filename: "launch-card.png",
    mime_type: "image/png",
    usage_count: 0,
    can_delete: true,
    processing_status: "ready",
  });

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const assetCard = page.locator('[data-library-kind="asset"]');
  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Favorite", exact: true }).click();
  await expect(assetCard.locator("svg.fill-red-500")).toBeVisible();

  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete media?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("No media found")).toBeVisible();
});

test("media tags combine with type filters while new uploads remain untagged", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `media-tags-${unique}@example.com`);
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Media Tags E2E",
  );

  await authenticatePage(page, auth.token);
  await page.goto("/media");

  await page.getByRole("button", { name: "Manage tags" }).click();
  const tagDialog = page.getByRole("dialog", { name: "Manage tags" });
  await tagDialog.getByPlaceholder("Tag name").fill("Inbox");
  await tagDialog.getByRole("button", { name: "Create tag" }).click();
  await expect(tagDialog.getByText("Inbox", { exact: true })).toBeVisible();
  await tagDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload media" }).click();
  await page.locator("#file-upload").setInputFiles({
    name: "tagged-launch.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await page
    .getByRole("dialog", { name: "Upload Media" })
    .getByRole("button", { name: "Upload" })
    .click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible();
  await expect(page.getByText("tagged-launch.png")).toBeVisible();
  const initialTagFilters = page.locator('[aria-label="Filter media by tag"]');
  await initialTagFilters.getByRole("button", { name: "Untagged" }).click();
  await expect(page.getByText("tagged-launch.png")).toBeVisible();
  await initialTagFilters.getByRole("button", { name: "All tags" }).click();

  const tagsResponse = await request.get(
    `/api/v1/media/tags?workspace_id=${workspace.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(tagsResponse.ok()).toBeTruthy();
  const tagsBody = (await tagsResponse.json()) as {
    tags: Array<{ id: string; name: string }>;
  };
  const inbox = tagsBody.tags.find((tag) => tag.name === "Inbox");
  expect(inbox).toBeTruthy();

  const mediaResponse = await request.get(
    `/api/v1/media?workspace_id=${workspace.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(mediaResponse.ok()).toBeTruthy();
  const mediaBody = (await mediaResponse.json()) as {
    media: Array<{ id: string; tags: string[] }>;
  };
  expect(mediaBody.media[0]?.tags).toEqual([]);

  const assignInboxResponse = await request.put(
    `/api/v1/media/tags/${inbox?.id}/items`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { media_ids: [mediaBody.media[0]?.id], mode: "add" },
    },
  );
  expect(assignInboxResponse.ok()).toBeTruthy();

  const campaignResponse = await request.post("/api/v1/media/tags", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { workspace_id: workspace.id, name: "Campaign" },
  });
  expect(campaignResponse.ok()).toBeTruthy();
  const campaign = (await campaignResponse.json()) as { id: string };
  const assignResponse = await request.put(
    `/api/v1/media/tags/${campaign.id}/items`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { media_ids: [mediaBody.media[0]?.id], mode: "add" },
    },
  );
  expect(assignResponse.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByText("tagged-launch.png")).toBeVisible();
  const tagFilters = page.locator('[aria-label="Filter media by tag"]');
  await tagFilters.getByRole("button", { name: /Inbox/ }).click();
  await tagFilters.getByRole("button", { name: /Campaign/ }).click();
  await expect(page.getByText("tagged-launch.png")).toBeVisible();

  await tagFilters.getByRole("button", { name: "Untagged" }).click();
  await expect(page.getByText("No media found")).toBeVisible();
  await tagFilters.getByRole("button", { name: "All tags" }).click();
  await page.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(page.getByText("No media found")).toBeVisible();
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await expect(page.getByText("tagged-launch.png")).toBeVisible();
});

test("video upload edits in the browser and becomes a verified media asset", async ({
  page,
  request,
}) => {
  test.skip(!ffmpegAvailable, "ffmpeg is required to generate video fixture");

  test.setTimeout(120_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `media-video-${unique}@example.com`);
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Video Media E2E",
  );
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload media" }).click();
  await page.locator("#file-upload").setInputFiles({
    name: "launch-video.mp4",
    mimeType: "video/mp4",
    buffer: createVideoFixture(),
  });

  const editor = page.getByRole("dialog", { name: "Edit video" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("160×90")).toBeVisible();
  await editor.locator('input[type="number"]').nth(1).fill("0.5");
  await editor.getByRole("button", { name: "Apply edit" }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });

  const uploadDialog = page.getByRole("dialog", { name: "Upload Media" });
  await expect(uploadDialog.getByText("launch-video-edited.mp4")).toBeVisible();
  await uploadDialog.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("launch-video-edited.mp4")).toBeVisible();

  const mediaResponse = await request.get(
    `/api/v1/media?workspace_id=${workspace.id}&type=video`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(mediaResponse.ok()).toBeTruthy();
  const mediaBody = (await mediaResponse.json()) as {
    total: number;
    media: Array<Record<string, unknown>>;
  };
  expect(mediaBody.total).toBe(1);
  expect(mediaBody.media[0]).toMatchObject({
    original_filename: "launch-video-edited.mp4",
    mime_type: "video/mp4",
    processing_status: "ready",
    analysis_status: "ready",
    container_format: "mov",
    video_codec: "h264",
    audio_codec: "aac",
  });
  expect(Number(mediaBody.media[0].duration_ms)).toBeGreaterThan(0);
  expect(String(mediaBody.media[0].poster_thumbnail_url)).toContain("/poster");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload media" }).click();
  await page.locator("#file-upload").setInputFiles({
    name: "phone-video.mp4",
    mimeType: "video/mp4",
    buffer: createVideoFixture(),
  });
  await expect(editor).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  for (const label of [
    "Original",
    "Upload without editing",
    "Cancel",
    "Apply edit",
  ]) {
    const button = editor.getByRole("button", { name: label, exact: true });
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(browserErrors).toEqual([]);
});

test("brand kit inputs keep focus while editing", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const email = `brand-inputs-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Brand Inputs E2E");

  await authenticatePage(page, auth.token);
  await page.goto("/media?view=brand");
  await expect(page).toHaveURL(/\/settings\?tab=brand$/);
  await expect(page.locator('[data-settings-tab="brand"]')).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("button", { name: "Add color" }).click();
  const colorName = page.getByLabel("Color name");
  await colorName.fill("");
  await colorName.pressSequentially("Signal orange", { delay: 20 });
  await expect(colorName).toBeFocused();
  await expect(colorName).toHaveValue("Signal orange");

  await page.getByRole("button", { name: "Add style" }).click();
  await page.getByText("Text style 1", { exact: true }).click();
  const styleName = page.getByLabel("Style name");
  await styleName.fill("");
  await styleName.pressSequentially("Campaign heading", { delay: 20 });
  await expect(styleName).toBeFocused();
  await expect(styleName).toHaveValue("Campaign heading");

  const fontFamily = page.getByLabel("Font family");
  await fontFamily.click();
  const fontSearch = page.getByLabel("Search fonts");
  await fontSearch.fill("");
  await fontSearch.pressSequentially("Geist", { delay: 20 });
  await expect(fontSearch).toBeFocused();
  await expect(fontSearch).toHaveValue("Geist");
  await page.getByRole("button", { name: "Geist Sans serif", exact: true }).click();
  await expect(fontFamily).toContainText("Geist");
});

test("brand assets fall back to the original file when no thumbnail exists", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `brand-preview-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Brand Preview E2E",
  )) as { id: string };

  const upload = await request.post("/api/v1/media/upload", {
    headers: { Authorization: `Bearer ${auth.token}` },
    multipart: {
      workspace_id: workspace.id,
      source: "upload",
      asset_kind: "brand_asset",
      file: {
        name: "brand-mark.png",
        mimeType: "image/png",
        buffer: tinyPNG,
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const media = (await upload.json()) as { id: string };

  const saveBrand = await request.put("/api/v1/image-editor/brand-kit", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      name: "Brand Preview",
      colors: [],
      text_styles: [],
      backgrounds: [],
      assets: [
        {
          media_id: media.id,
          role: "primary_logo",
          name: "Brand mark",
        },
      ],
      fonts: [],
    },
  });
  expect(saveBrand.ok()).toBeTruthy();

  await authenticatePage(page, auth.token);
  await page.route(`**/media/${media.id}/thumb/md**`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"error":"thumbnail not found"}',
    });
  });
  await page.goto("/settings?tab=brand");

  const preview = page.getByRole("img", { name: "Brand mark" }).first();
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image) =>
        image instanceof HTMLImageElement
          ? { width: image.naturalWidth, source: image.currentSrc }
          : { width: 0, source: "" },
      ),
    )
    .toEqual({
      width: 1,
      source: expect.stringMatching(new RegExp(`/media/${media.id}(?:\\?|$)`)),
    });
});
