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

const tinySVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#f97316"/></svg>',
);

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

test("custom media chooser pastes a file with a local thumbnail and upload progress", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `media-paste-${unique}@example.com`);
  await createWorkspace(request, auth.token, "Media Paste E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/media");

  await page.getByRole("button", { name: "Add media", exact: true }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await page.evaluate(
    ({ encoded }) => {
      const bytes = Uint8Array.from(atob(encoded), (value) =>
        value.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "pasted-launch.png", { type: "image/png" }),
      );
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { encoded: tinyPNG.toString("base64") },
  );

  await expect(uploadDialog.getByText("pasted-launch.png")).toBeVisible();
  await expect(uploadDialog.locator('img[src^="blob:"]')).toHaveCount(1);
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  await expect(uploadDialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText("pasted-launch.png")).toBeVisible();
});

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

function emptyVideoProjectDocument(title: string) {
  return {
    schema_version: 1,
    title,
    timebase: {
      ticks_per_second: 1_000_000,
      fps_numerator: 30,
      fps_denominator: 1,
    },
    sources: {},
    primary_sequence: [],
    visual_tracks: [],
    audio_tracks: [],
    caption_tracks: [],
    variants: [
      {
        id: "portrait",
        name: "Portrait",
        width: 1080,
        height: 1920,
        safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
        background_color: "#000000",
      },
      {
        id: "feed-portrait",
        name: "Feed portrait",
        width: 1080,
        height: 1350,
        safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
        background_color: "#000000",
      },
      {
        id: "square",
        name: "Square",
        width: 1080,
        height: 1080,
        safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
        background_color: "#000000",
      },
      {
        id: "landscape",
        name: "Landscape",
        width: 1920,
        height: 1080,
        safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
        background_color: "#000000",
      },
    ],
    markers: [],
    export_defaults: {
      variant_ids: ["portrait"],
      format: "mp4",
      video_codec: "avc",
      audio_codec: "aac",
      frame_rate: { numerator: 30, denominator: 1 },
      video_bitrate: 8_000_000,
      audio_bitrate: 128_000,
      loudness_normalization: false,
    },
  };
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
  await expect(page.getByTestId("media-lifecycle-tabs")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(page.getByTestId("media-filter-bar")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(page.getByText("No media found")).toBeVisible();

  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Upload media" }),
  ).toBeVisible();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: "launch-card.svg",
    mimeType: "image/svg+xml",
    buffer: tinySVG,
  });
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("media-library-grid").getByText("launch-card.png"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("page-header")
      .getByText(/1 assets · .* stored/, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenPost Image Editor edits")).toHaveCount(0);

  const mediaSearch = page.getByPlaceholder("Search filename or alt text");
  await mediaSearch.fill("launch-card");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("media-result-count")).toHaveText(
    "1 result for “launch-card”",
  );
  await expect(page.getByText("launch-card.png")).toBeVisible();

  await mediaSearch.fill("guaranteed-no-match");
  await mediaSearch.press("Enter");
  await expect(page.getByTestId("media-result-count")).toHaveText(
    "0 results for “guaranteed-no-match”",
  );
  await expect(page.getByText("No media found")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByTestId("media-result-count")).toHaveCount(0);
  await expect(page.getByText("launch-card.png")).toBeVisible();

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
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename media" });
  await renameDialog.getByLabel("Filename").fill("renamed-launch-card");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(assetCard.getByText("renamed-launch-card.png")).toBeVisible();

  const renamedMedia = await request.get(
    `/api/v1/media?workspace_id=${workspaceBody.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(renamedMedia.ok()).toBeTruthy();
  expect((await renamedMedia.json()).media[0].original_filename).toBe(
    "renamed-launch-card.png",
  );

  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Favorite", exact: true }).click();
  await expect(
    assetCard.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();

  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete media?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("No media found")).toBeVisible();
});

test("editors renames cloud video projects from the context menu", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `editor-rename-${unique}@example.com`,
  );
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Editor Rename E2E",
  );
  const created = await request.post("/api/v1/video-editor/projects", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      client_request_id: `editor-rename-${unique}`,
      document: emptyVideoProjectDocument("Launch video"),
    },
  });
  expect(created.ok()).toBeTruthy();
  const project = (await created.json()) as { id: string };

  await authenticatePage(page, auth.token);
  await page.goto("/editors");
  const projectCard = page.locator(
    `a[href="/video-editor?cloud=${encodeURIComponent(project.id)}"]`,
  );
  await expect(
    projectCard.getByText("Launch video", { exact: true }),
  ).toBeVisible();
  await projectCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDialog = page.getByRole("dialog", {
    name: "Rename video project",
  });
  await renameDialog.getByLabel("Project name").fill("Launch recap");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    projectCard.getByText("Launch recap", { exact: true }),
  ).toBeVisible();

  const saved = await request.get(
    `/api/v1/video-editor/projects/${project.id}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).document.title).toBe("Launch recap");
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

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Filters" })
    .getByRole("button", { name: "Manage tags", exact: true })
    .last()
    .click();
  const tagDialog = page.getByRole("dialog", { name: "Manage tags" });
  await tagDialog.getByPlaceholder("Tag name").fill("Inbox");
  await tagDialog.getByRole("button", { name: "Create tag" }).click();
  await expect(tagDialog.getByText("Inbox", { exact: true })).toBeVisible();
  await tagDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Add media", exact: true }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: "tagged-launch.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("media-library-grid").getByText("tagged-launch.png"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const initialFilterDialog = page.getByRole("dialog", { name: "Filters" });
  const initialTagFilters = initialFilterDialog.locator(
    '[aria-label="Filter media by tag"]',
  );
  await initialTagFilters.getByRole("button", { name: "Untagged" }).click();
  await initialFilterDialog
    .getByRole("button", { name: "Apply filters" })
    .click();
  await expect(
    page.getByTestId("media-library-grid").getByText("tagged-launch.png"),
  ).toBeVisible();

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
  await expect(
    page.getByTestId("media-library-grid").getByText("tagged-launch.png"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filterDialog = page.getByRole("dialog", { name: "Filters" });
  const tagFilters = filterDialog.locator('[aria-label="Filter media by tag"]');
  await tagFilters.getByRole("button", { name: /Inbox/ }).click();
  await tagFilters.getByRole("button", { name: /Campaign/ }).click();
  await filterDialog.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByTestId("media-library-grid").getByText("tagged-launch.png"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await tagFilters.getByRole("button", { name: "Untagged" }).click();
  await filterDialog.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No media found")).toBeVisible();
  await page.getByRole("button", { name: "Show all" }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await filterDialog.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Audio", exact: true }).click();
  await filterDialog.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No media found")).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await filterDialog.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Images", exact: true }).click();
  await filterDialog.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByTestId("media-library-grid").getByText("tagged-launch.png"),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: "launch-video.mp4",
    mimeType: "video/mp4",
    buffer: createVideoFixture(),
  });

  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit video" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("160×90")).toBeVisible();
  await editor.locator('input[type="number"]').nth(1).fill("0.5");
  await editor.getByRole("button", { name: "Apply edit" }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 1 file" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId("media-library-grid").getByText("launch-video-edited.mp4"),
  ).toBeVisible();

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
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: "phone-video.mp4",
    mimeType: "video/mp4",
    buffer: createVideoFixture(),
  });
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Geist Sans serif", exact: true })
    .click();
  await expect(fontFamily).toContainText("Geist");
});
