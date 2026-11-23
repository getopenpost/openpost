import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";
import { fileURLToPath } from "node:url";
import { parseGIF } from "gifuct-js";

test.describe("image editor", () => {
  // A public visitor can create a design, keep working across a reload, and
  // export it without an account and without any server write. If local
  // persistence breaks, edits silently vanish; if the public boundary leaks,
  // anonymous work hits the API.
  test("public image editor creates, restores, and exports a local design", async ({ page }) => {
    test.setTimeout(60_000);
    const browserErrors: string[] = [];
    const workspaceWrites: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/image-editor/designs")) {
        workspaceWrites.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto("/image-editor");
    await expect(page.getByRole("heading", { name: "Image Editor", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Instagram square/ }).click();

    await expect(page).toHaveURL(/\/image-editor\/local_design_/);
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
      timeout: 20_000,
    });
    expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);

    const title = page.getByRole("textbox", { name: "Design title" });
    await title.fill("Local launch design");
    const saveIndicator = page.getByTestId("image-editor-save-indicator");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveAttribute("data-state", "saved");
    await expect(saveIndicator).toHaveAttribute("aria-label", "Saved on this device");

    await page.reload();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(title).toHaveValue("Local launch design");

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("heading", { name: "Export design" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    await download;
    await expect(
      page.getByLabel("Notifications alt+T").getByText("Export download started."),
    ).toBeVisible();

    const home = page
      .getByRole("banner")
      .getByRole("button", { name: "OpenPost Image Editor", exact: true });
    await home.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/image-editor$/);
    await expect(page.getByText("Local launch design", { exact: true })).toBeVisible();

    expect(workspaceWrites).toEqual([]);
    expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  });

  test("Image Editor previews and downloads the same encoded PNG, JPEG, and WebP bytes", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto("/image-editor");
    await page.getByRole("button", { name: /Instagram square/ }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
      timeout: 20_000,
    });

    for (const format of ["PNG", "JPEG", "WebP"] as const) {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Export design" });
      await dialog.getByRole("button", { name: "Format", exact: true }).click();
      await page.getByRole("option", { name: format, exact: true }).click();

      const preview = dialog.getByRole("img", { name: "Encoded export preview" });
      await expect(preview).toBeVisible();
      await expect(dialog.getByText(/^[\d,.]+ bytes$/)).toBeVisible();
      await expect
        .poll(() =>
          preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
        )
        .toEqual([1080, 1080]);

      const previewResult = await preview.evaluate(async (image: HTMLImageElement) => {
        const response = await fetch(image.src);
        const blob = await response.blob();
        return {
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
          type: blob.type,
        };
      });
      const exactByteLabel = await dialog.getByText(/^[\d,.]+ bytes$/).textContent();
      expect(Number(exactByteLabel?.replace(/\D/g, ""))).toBe(previewResult.bytes.length);
      expect(previewResult.type).toBe(
        format === "PNG" ? "image/png" : format === "JPEG" ? "image/jpeg" : "image/webp",
      );
      const downloadEvent = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download", exact: true }).click();
      const download = await downloadEvent;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      expect(Array.from(await readFile(downloadPath!))).toEqual(previewResult.bytes);
      expect(download.suggestedFilename()).toMatch(
        format === "PNG" ? /\.png$/ : format === "JPEG" ? /\.jpg$/ : /\.webp$/,
      );
    }

    await expect(page.getByLabel("Notifications alt+T")).not.toContainText(
      "Export download started.",
      {
        timeout: 10_000,
      },
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export design" });
    for (const format of ["PNG", "JPEG", "WebP"] as const) {
      await dialog.getByRole("button", { name: "Format", exact: true }).click();
      await page.getByRole("option", { name: format, exact: true }).click();
    }
    const latestPreview = dialog.getByRole("img", { name: "Encoded export preview" });
    await expect(latestPreview).toBeVisible();
    expect(
      await latestPreview.evaluate(async (image: HTMLImageElement) =>
        (await fetch(image.src)).headers.get("content-type"),
      ),
    ).toBe("image/webp");
  });

  test("workspace designs can be deleted and editing a media file reopens its design", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `design-lifecycle-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Design lifecycle");
    const upload = await request.post("/api/v1/media/upload", {
      headers: { Authorization: `Bearer ${auth.token}` },
      multipart: {
        workspace_id: workspace.id,
        file: {
          name: "reuse.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const media = await upload.json();
    await authenticatePage(page, auth.token);
    const sourceURL = `/image-editor/new?workspace=${workspace.id}&source_media=${media.id}&source_name=reuse.png&width=1080&height=1080`;
    await page.goto(sourceURL);
    await expect(page).toHaveURL(/\/image-editor\/[a-f0-9-]+(?:\?.*)?$/);
    const firstURL = page.url();
    await page.goto(sourceURL);
    await expect(page).toHaveURL(firstURL);
    await page.goto("/image-editor");
    const deleteButton = page.getByRole("button", { name: "Delete Edit reuse", exact: true });
    await expect(deleteButton).toBeVisible();
    await deleteButton.focus();
    await expect(deleteButton).toBeFocused();

    await deleteButton.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("This design will be moved to trash.");
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("link", { name: /Edit reuse/ })).toHaveCount(0);
    const usage = await request.get(`/api/v1/media/${media.id}/usage`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(
      (await usage.json()).usage.filter((item: { kind: string }) => item.kind.startsWith("design")),
    ).toEqual([]);
    const replacements = await Promise.all(
      [0, 1].map(() =>
        request.post("/api/v1/image-editor/designs", {
          headers: { Authorization: `Bearer ${auth.token}` },
          data: {
            workspace_id: workspace.id,
            source_media_id: media.id,
            preset_key: "instagram-square",
            title: "Replacement edit",
            width_px: 1080,
            height_px: 1080,
          },
        }),
      ),
    );
    for (const response of replacements) expect(response.ok(), await response.text()).toBe(true);
    const documents = await Promise.all(replacements.map((response) => response.json()));
    expect(documents[0].id).toBe(documents[1].id);
    expect(firstURL).not.toContain(documents[0].id);
  });
});

test.describe("image editor animation", () => {
  const gifPath = fileURLToPath(
    new URL("../../apps/web/src/lib/video-editor/media/fixtures/animated-rgb.gif", import.meta.url),
  );

  test("touch GIF edits persist across reload and download as an animated GIF", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      hasTouch: true,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/image-editor`);
      await page.getByLabel("Open an image", { exact: true }).setInputFiles(gifPath);
      await expect(page).toHaveURL(/\/image-editor\/local_design_/);
      const tools = page.getByRole("navigation", {
        name: "OpenPost Image Editor tools",
        exact: true,
      });
      await tools.getByRole("button", { name: "Layers", exact: true }).tap();
      await page.getByRole("treeitem").filter({ hasText: "animated-rgb" }).tap();
      await page.keyboard.press("Escape");
      await tools.getByRole("button", { name: "Properties", exact: true }).tap();
      const duplicate = page.getByRole("button", { name: "Duplicate frame", exact: true });
      await duplicate.scrollIntoViewIfNeeded();
      expect((await duplicate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await duplicate.tap();
      await expect(
        page.getByRole("group", { name: "Animation frames", exact: true }).getByRole("button"),
      ).toHaveCount(4);
      await page.getByLabel("Frame duration (ms)", { exact: true }).fill("200");
      await page.getByRole("heading", { name: "GIF animation", exact: true }).tap();
      await page.setViewportSize({ width: 320, height: 900 });
      await page.emulateMedia({ colorScheme: "dark" });
      await duplicate.scrollIntoViewIfNeeded();
      expect((await duplicate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
        "data-state",
        "saved",
      );
      await page.reload();
      await tools.getByRole("button", { name: "Layers", exact: true }).tap();
      await page.getByRole("treeitem").filter({ hasText: "animated-rgb" }).tap();
      await page.keyboard.press("Escape");
      await tools.getByRole("button", { name: "Properties", exact: true }).tap();
      await expect(
        page.getByRole("group", { name: "Animation frames", exact: true }).getByRole("button"),
      ).toHaveCount(4);
      await expect(
        page.getByRole("button", { name: "Frame 2, 200 ms", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Export", exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: "Export design", exact: true });
      await dialog.getByRole("button", { name: "Format", exact: true }).tap();
      await page.getByRole("option", { name: "GIF", exact: true }).tap();
      const downloading = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download", exact: true }).tap();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/\.gif$/);
      const buffer = await readFile((await download.path())!);
      const gif = parseGIF(Uint8Array.from(buffer).buffer);
      expect(
        gif.frames.flatMap((frame) => ("image" in frame ? [frame.gce.delay * 10] : [])),
      ).toEqual([100, 200, 100, 100]);
    } finally {
      await context.close();
    }
  });
});

test.describe("image editor audit", () => {
  test(`failed cloud and recovery saves stay visible and protect unsaved work`, async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `image-recovery-audit-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Recovery audit");
    await authenticatePage(page, auth.token);
    await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "light"));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/image-editor/new?workspace=${workspace.id}`);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    await page.route("**/api/v1/image-editor/designs/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Save unavailable for this test" }),
      });
    });
    await page.evaluate(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      };
    });
    await page.getByRole("textbox", { name: "Design title" }).fill("Unsaved changes");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "aria-label",
      "Save unavailable for this test",
    );
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    const width = 320;
    await page.setViewportSize({ width, height: 800 });
    await expect(
      page.locator('[role="status"][aria-label="Save unavailable for this test"]').last(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "OpenPost Image Editor",
        exact: true,
      }),
    ).toBeInViewport();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
  });

  test("cloud design trash restores the same saved design", async ({ page, request }, testInfo) => {
    const auth = await registerUser(request, `image-trash-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Image trash");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/image-editor/designs", {
      headers,
      data: {
        workspace_id: workspace.id,
        preset_key: "custom",
        width_px: 1080,
        height_px: 1080,
        title: "Restore this design",
      },
    });
    expect(created.ok()).toBe(true);
    let original = await created.json();
    const second = {
      ...structuredClone(original.document.pages[0]),
      id: randomUUID(),
      name: "Retained second page",
    };
    original.document.pages.push(second);
    const saved = await request.patch(`/api/v1/image-editor/designs/${original.id}`, {
      headers,
      data: { expected_revision: original.revision, document: original.document },
    });
    expect(saved.ok()).toBe(true);
    original = await saved.json();
    const checkpoint = await request.post(`/api/v1/image-editor/designs/${original.id}/revisions`, {
      headers,
      data: { expected_revision: original.revision, name: "Retained checkpoint" },
    });
    expect(checkpoint.ok()).toBe(true);
    await authenticatePage(page, auth.token);
    await page.goto("/image-editor");
    await page.getByRole("button", { name: "Delete Restore this design", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("link", { name: /Restore this design/ })).toBeVisible();
    await page.getByRole("button", { name: "Delete Restore this design", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("link", { name: /Restore this design/ })).toHaveCount(0);
    const trash = page.getByRole("region", { name: "Trash", exact: true });
    await trash.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(trash.getByText("Restore this design", { exact: true })).toBeVisible();
    await page.reload();
    await trash.getByRole("button", { name: "Trash", exact: true }).click();
    await trash.getByRole("button", { name: "Restore", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(trash.getByText("Restore this design", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("link", { name: /Restore this design/ }).click();
    await expect(page).toHaveURL(new RegExp(`/image-editor/${original.id}$`));
    await expect(page.getByRole("textbox", { name: "Design title" })).toHaveValue(
      "Restore this design",
    );
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Design title" })).toHaveValue(
      "Restore this design",
    );
    const restored = await (
      await request.get(`/api/v1/image-editor/designs/${original.id}`, { headers })
    ).json();
    expect(restored.document).toEqual(original.document);
    expect(
      (
        await request.post(`/api/v1/image-editor/designs/${original.id}/restore`, { headers })
      ).status(),
    ).toBe(404);
    const history = await (
      await request.get(`/api/v1/image-editor/designs/${original.id}/revisions`, { headers })
    ).json();
    expect(
      history.revisions.some((item: { name: string }) => item.name === "Retained checkpoint"),
    ).toBe(true);
  });
});

test.describe("image editor compositing", () => {
  test("cloud layers can be merged, restored, and flattened without losing the saved project", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.setViewportSize({ width: 1369, height: 800 });
    const auth = await registerUser(request, `compositing-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Compositing");
    await authenticatePage(page, auth.token);
    await page.goto(`/image-editor/new?workspace=${workspace.id}`);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
    for (let index = 0; index < 2; index++) {
      await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Shape\b/ }).click();
    }
    await expect(layers).toHaveCount(2);
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await expect(page.getByText("Bakes pixels inside the page.", { exact: false })).toBeVisible();
    await page.getByRole("menuitem", { name: "Merge down", exact: true }).click();
    await expect(layers).toHaveCount(1);
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(layers).toHaveCount(2);
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Flatten page", exact: true }).click();
    await expect(layers).toHaveCount(1);
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    await expect(layers).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    const bakeHelp = page.getByText("Bakes pixels inside the page.", { exact: false });
    await bakeHelp.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(bakeHelp).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Rasterize to image", exact: true }),
    ).toBeVisible();
    await bakeHelp.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(bakeHelp).toBeInViewport({ ratio: 1 });
    expect(errors).toEqual([]);
  });
});

test.describe("image editor concurrency", () => {
  for (const recovery of ["Reload server version", "Save my version as a copy"] as const) {
    test(`conflict ${recovery} preserves pending local title and stale page together`, async ({
      page,
      browser,
      request,
    }, testInfo) => {
      test.setTimeout(120_000);
      const auth = await registerUser(request, `image-conflict-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Image conflict snapshot");
      const headers = { Authorization: `Bearer ${auth.token}` };
      await authenticatePage(page, auth.token);
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.goto(`/image-editor/new?workspace=${workspace.id}`);
      await page.getByRole("button", { name: "New project", exact: true }).click();
      await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
      const sourceID = new URL(page.url()).pathname.split("/").at(-1)!;
      const title = page.getByRole("textbox", { name: "Design title", exact: true });
      await title.fill("Server baseline");
      await title.press("Tab");
      const readSource = async () => {
        const response = await request.get(`/api/v1/image-editor/designs/${sourceID}`, { headers });
        expect(response.ok()).toBeTruthy();
        return response.json();
      };
      await expect.poll(async () => (await readSource()).document.title).toBe("Server baseline");
      const secondContext = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        viewport: { width: 1280, height: 850 },
        colorScheme: "dark",
      });
      const stale = await secondContext.newPage();
      const errors: string[] = [];
      stale.on("pageerror", (error) => errors.push(error.message));
      try {
        await authenticatePage(stale, auth.token);
        await stale.goto(`/image-editor/${sourceID}?workspace=${workspace.id}`);
        await expect(stale.getByRole("textbox", { name: "Design title", exact: true })).toHaveValue(
          "Server baseline",
        );
        const sourceStrip = page.getByTestId("image-editor-page-strip");
        const staleStrip = stale.getByTestId("image-editor-page-strip");
        await sourceStrip.getByRole("button", { name: "Expand pages", exact: true }).click();
        await staleStrip.getByRole("button", { name: "Expand pages", exact: true }).click();
        await sourceStrip.getByRole("button", { name: "Rename page", exact: true }).click();
        const pageName = sourceStrip.getByRole("textbox", { name: "Page name", exact: true });
        await pageName.fill("Server updated page");
        await pageName.press("Enter");
        await expect
          .poll(async () => (await readSource()).document.pages[0].name)
          .toBe("Server updated page");
        await expect(staleStrip.getByRole("button", { name: /Page 1: Page 1,/ })).toBeVisible();
        const pendingTitle = "Pending local café title";
        const staleTitle = stale.getByRole("textbox", { name: "Design title", exact: true });
        await staleTitle.fill(pendingTitle);
        await staleTitle.press("Tab");
        const conflict = stale.getByRole("dialog", {
          name: "This design changed elsewhere",
          exact: true,
        });
        await expect(conflict).toBeVisible();
        await expect(staleTitle).toHaveValue(pendingTitle);
        await conflict.getByRole("button", { name: "Continue locally", exact: true }).click();
        await expect(conflict).toHaveCount(0);
        await expect(staleTitle).toHaveValue(pendingTitle);
        await expect(staleStrip.getByRole("button", { name: /Page 1: Page 1,/ })).toBeVisible();
        // Keep closing-menu teardown overlapping the resize, including on fast machines.
        const animationSession = await secondContext.newCDPSession(stale);
        await animationSession.send("Animation.enable");
        await animationSession.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
        await stale.getByRole("menuitem", { name: "File", exact: true }).click();
        await stale.getByRole("menuitem", { name: /^Save\s+(?:⌘|Ctrl)/ }).click();
        await expect(conflict).toBeVisible();
        await stale.setViewportSize({ width: 320, height: 850 });
        const bounds = await conflict.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        await animationSession.send("Animation.setPlaybackRate", { playbackRate: 1 });
        await conflict.evaluate(async (element) => {
          await Promise.all(element.getAnimations().map((animation) => animation.finished));
        });
        const copySaved = stale.waitForResponse(
          (response) =>
            response.request().method() === "PATCH" &&
            /\/api\/v1\/image-editor\/designs\/[^/]+$/.test(new URL(response.url()).pathname) &&
            !response.url().includes(sourceID),
        );
        await conflict.getByRole("button", { name: recovery, exact: true }).press("Enter");
        const copyResponse = await copySaved;
        expect(copyResponse.ok()).toBeTruthy();
        const savedCopy = await copyResponse.json();
        expect(savedCopy.document.title).toBe(pendingTitle);
        expect(savedCopy.document.pages.map((item: { name: string }) => item.name)).toEqual([
          "Page 1",
        ]);
        expect(savedCopy.id).not.toBe(sourceID);
        expect(savedCopy.revision).toBeGreaterThan(1);
        await expect(conflict).toHaveCount(0);
        await stale.setViewportSize({ width: 1280, height: 850 });
        const original = await readSource();
        expect(original.document.title).toBe("Server baseline");
        expect(original.document.pages[0].name).toBe("Server updated page");
        if (recovery === "Reload server version") {
          await expect(staleTitle).toHaveValue("Server baseline");
          await expect(
            staleStrip.getByRole("button", { name: /Server updated page/ }),
          ).toBeVisible();
        } else {
          await expect(stale).toHaveURL(new RegExp(`/image-editor/${savedCopy.id}`));
          await expect(staleTitle).toHaveValue(pendingTitle);
        }
        await stale.goto(`/image-editor/${savedCopy.id}?workspace=${workspace.id}`);
        await stale.reload();
        await expect(staleTitle).toHaveValue(pendingTitle);
        const expand = staleStrip.getByRole("button", { name: "Expand pages", exact: true });
        if (await expand.isVisible()) await expand.click();
        await expect(staleStrip.getByRole("button", { name: /Page 1: Page 1,/ })).toBeVisible();
        const cold = await (
          await request.get(`/api/v1/image-editor/designs/${savedCopy.id}`, { headers })
        ).json();
        expect(cold.document.title).toBe(pendingTitle);
        expect(cold.document.pages[0].name).toBe("Page 1");
        expect(errors).toEqual([]);
      } finally {
        await secondContext.close();
      }
    });
  }
});

test.describe("image editor page text", () => {
  test.use({ hasTouch: true, actionTimeout: 15_000 });

  test("mixed page sizes persist and Resize design also resets pages to the default size", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const auth = await registerUser(request, `mixed-pages-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Mixed pages");
    const headers = { Authorization: `Bearer ${auth.token}` };
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1369, height: 850 });
    await page.goto(`/image-editor/new?workspace=${workspace.id}`);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const strip = page.getByTestId("image-editor-page-strip");
    await strip.getByRole("button", { name: "Expand pages", exact: true }).click();
    await strip.getByRole("button", { name: "Duplicate page", exact: true }).click();
    await strip.getByRole("button", { name: "Resize page", exact: true }).click();
    const resizePage = page.getByRole("dialog", { name: "Resize page", exact: true });
    await resizePage.getByRole("spinbutton", { name: "Width", exact: true }).fill("720");
    await resizePage.getByRole("spinbutton", { name: "Height", exact: true }).fill("1280");
    await resizePage.getByRole("button", { name: "Resize", exact: true }).click();
    const sizes = async () => {
      const data = await (
        await request.get(`/api/v1/image-editor/designs/${id}`, { headers })
      ).json();
      return data.document.pages.map((item: { width_px?: number; height_px?: number }) => [
        item.width_px ?? data.document.width_px,
        item.height_px ?? data.document.height_px,
      ]);
    };
    await expect.poll(sizes).toEqual([
      [1080, 1080],
      [720, 1280],
    ]);
    const width = 390;
    const colorScheme = "light";

    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const expand = strip.getByRole("button", { name: "Expand pages", exact: true });
    if (await expand.isVisible()) await expand.click();
    const resize = strip.getByRole("button", { name: "Resize page", exact: true });
    await resize.scrollIntoViewIfNeeded();
    await expect(resize).toBeInViewport();
    const box = await resize.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 1369, height: 850 });
    await page.reload();
    await expect(strip.getByRole("button", { name: /720 × 1280 px/ })).toBeVisible();
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Resize design", exact: true }).click();
    const resizeDesign = page.getByRole("dialog", { name: "Resize design", exact: true });
    await expect(resizeDesign.getByRole("spinbutton", { name: "Width", exact: true })).toHaveValue(
      "1080",
    );
    await resizeDesign.getByRole("button", { name: "Resize", exact: true }).click();
    await expect.poll(sizes).toEqual([
      [1080, 1080],
      [1080, 1080],
    ]);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect.poll(sizes).toEqual([
      [1080, 1080],
      [720, 1280],
    ]);
    await strip.getByRole("button", { name: /1080 × 1080 px/ }).click();
    await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Shape\b/ }).click();
    await page.getByRole("menubar").getByRole("menuitem", { name: "Select", exact: true }).click();
    await page.getByRole("menuitem", { name: "Select layer alpha", exact: true }).click();
    const selection = page.getByTestId("image-editor-pixel-selection");
    await expect(selection).toHaveAttribute("data-active", "true");
    const transfer = await page.evaluateHandle(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2255cc";
      context.fillRect(0, 0, 64, 64);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
      const data = new DataTransfer();
      data.items.add(new File([blob], "page-drop.png", { type: "image/png" }));
      return data;
    });
    const target = strip.getByRole("button", { name: /720 × 1280 px/ });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(target).toHaveAttribute("aria-current", "page");
    await expect(selection).toHaveAttribute("data-active", "false");
    await expect
      .poll(async () => {
        const data = await (
          await request.get(`/api/v1/image-editor/designs/${id}`, { headers })
        ).json();
        return data.document.pages[1].layers.map((layer: { type: string }) => layer.type);
      })
      .toEqual(["image"]);
  });
});

test.describe("editor storage library", () => {
  test("Image Editor keeps local and cloud designs visible when changing creation storage", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `image-library-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Image library");
    await authenticatePage(page, auth.token);
    await page.goto("/image-editor");
    await page.getByRole("button", { name: "Save new projects to", exact: true }).click();
    await page.getByRole("option", { name: "This device", exact: true }).click();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page).toHaveURL(/image-editor\/local_design_/);
    await page.goto("/image-editor");
    await expect(page.getByRole("img", { name: "Local only" })).toBeVisible();
    await page.getByRole("button", { name: "Save new projects to", exact: true }).click();
    await page.getByRole("option", { name: "OpenPost cloud", exact: true }).click();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page).toHaveURL(/image-editor\/(?!local_design_)[^/]+$/);
    await page.goto("/image-editor");
    await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Local only" })).toBeVisible();
    await page.getByRole("button", { name: "Save new projects to", exact: true }).click();
    await page.getByRole("option", { name: "This device", exact: true }).click();
    await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your designs", exact: true })).toBeVisible();
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        if (name === "openpost-studio") throw new Error("Local library unavailable");
        return open(name, version);
      };
    });
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "Local library unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
  });
});
