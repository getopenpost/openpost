import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { authenticatePage, createWorkspace, registerUser, expectPostText } from "./helpers";

test.describe("screenshot templates", () => {
  async function openTemplates(page: Page) {
    const { token } = await registerUser(
      page.request,
      `templates-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    );
    const workspace = await createWorkspace(page.request, token, "Screenshot templates");
    await authenticatePage(page, token);
    await page.goto("/templates");
    await expect(page.getByRole("button", { name: "Messages", exact: true })).toBeVisible({
      timeout: 30000,
    });
    return { token, workspace };
  }
  async function inspectPNG(page: Page, buffer: Buffer) {
    return page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0,
        blue = 0,
        dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255) opaque++;
        if (
          pixels[i] < 40 &&
          pixels[i + 1] > 90 &&
          pixels[i + 1] < 170 &&
          pixels[i + 2] > 220 &&
          pixels[i + 3] > 240
        )
          blue++;
        if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 90 && pixels[i + 3] > 240)
          dark++;
      }
      return {
        width: image.width,
        height: image.height,
        opaque,
        blue,
        dark,
        pixels: pixels.length / 4,
      };
    }, buffer.toString("base64"));
  }
  async function downloadPNG(page: Page) {
    const downloaded = page.waitForEvent("download");
    if (await page.getByRole("button", { name: "Download", exact: true }).isVisible())
      await page.getByRole("button", { name: "Download", exact: true }).click();
    else {
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Download", exact: true }).click();
    }
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    return readFile((await download.path())!);
  }

  test("conversation editing persists, supports history, and exports readable Unicode", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openTemplates(page);
    await page.getByRole("button", { name: "Group chat", exact: true }).click();
    const first = page.getByRole("textbox", { name: "Message 1", exact: true });
    await first.fill("Hello 👋 café 日本語 مرحبا");
    await expect(
      page.getByRole("button", { name: "Hello 👋 café 日本語 مرحبا", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hello 👋 café 日本語 مرحبا", exact: true }).click();
    await expect(first).toBeFocused();
    await page.getByRole("button", { name: "Add message", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message 5", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message 5", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.getByRole("textbox", { name: "Message 5", exact: true }).fill("A final thought.");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.reload();
    await expect(first).toHaveValue("Hello 👋 café 日本語 مرحبا", { timeout: 30000 });
    await expect(page.getByRole("textbox", { name: "Message 5", exact: true })).toHaveValue(
      "A final thought.",
    );
    const png = await inspectPNG(page, await downloadPNG(page));
    expect(png.width).toBe(1080);
    expect(png.opaque / png.pixels).toBeGreaterThan(0.99);
    expect(png.blue).toBeGreaterThan(10000);
    expect(png.dark).toBeGreaterThan(500);
    await page.getByRole("button", { name: "Save to Media", exact: true }).click();
    await expect(
      page.getByText("Saved to Media. You can edit a copy from the media library.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("composer round trip preserves text and attaches the template export", async ({ page }) => {
    await openTemplates(page);
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Post text", exact: true })
      .fill("Keep this publication and its text.");
    await page.getByRole("button", { name: "Add media", exact: true }).first().click();
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\?.*return_token=/);
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message 1", exact: true })
      .fill("A custom screenshot.");
    await page.getByRole("button", { name: "Return to post", exact: true }).click();
    await expectPostText(
      page.getByRole("textbox", { name: "Post text", exact: true }),
      "Keep this publication and its text.",
      { timeout: 15000 },
    );
    await expect(page.locator("[data-composer-media-id]")).toHaveCount(1);
  });

  test("workspace switch waits for the pending design save", async ({ page }) => {
    const { token, workspace } = await openTemplates(page);
    const second = await createWorkspace(page.request, token, "Other template workspace");
    // Reload the real workspace catalog before editing.
    await page.reload();
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\/[^/?]+$/);
    const designID = new URL(page.url()).pathname.split("/").at(-1)!;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => (releaseSave = resolve));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    await page.route(`**/api/v1/screenshot-templates/designs/${designID}`, async (route) => {
      if (route.request().method() === "PUT") {
        markStarted();
        await saveGate;
      }
      await route.continue();
    });
    await page
      .getByRole("textbox", { name: "Message 1", exact: true })
      .fill("Keep this before switching.");
    await page.getByTestId("workspace-menu-trigger").click();
    await page.getByRole("menuitem").filter({ hasText: second.name }).click();
    await started;
    await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
      "Keep this before switching.",
    );
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("openpost_current_workspace")!).id),
    ).toBe(workspace.id);
    releaseSave();
    await expect(page).toHaveURL(/\/templates$/);
    const saved = await page.request.get(`/api/v1/screenshot-templates/designs/${designID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).document.conversation.messages[0].text).toBe(
      "Keep this before switching.",
    );
  });

  test("fixed shapes block an overflowing conversation without cropping it", async ({ page }) => {
    await openTemplates(page);
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message 1", exact: true })
      .fill("A long conversation. ".repeat(60));
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Image shape", exact: true }).click();
    await page.getByRole("option", { name: "Square · 1:1", exact: true }).click();
    await expect(
      page.getByText(
        "This content does not fit the selected shape. Choose Fit content, smaller text, or shorten the content.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Image shape", exact: true }).click();
    await page.getByRole("option", { name: "Fit content", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  });

  test("chat images and every participant photo survive editing, export and draft deletion", async ({
    page,
  }) => {
    const { token, workspace } = await openTemplates(page);
    const headers = { Authorization: `Bearer ${token}` };
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#00dd55";
      ctx.fillRect(0, 0, 160, 120);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const upload = await page.request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        source: "upload",
        file: { name: "chat-photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const photo = await upload.json();
    await page.getByRole("button", { name: "Group chat", exact: true }).click();
    const choose = async (label: string) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Select chat-photo.png", exact: true }).click();
      await dialog.getByRole("button", { name: /^Add/ }).click();
      await expect(dialog).toHaveCount(0);
    };
    await choose("Image for message 1");
    await page.getByRole("textbox", { name: "Message 1", exact: true }).fill("");
    await page.getByText("Conversation details", { exact: true }).click();
    for (const name of ["You", "Alex", "Sam"]) await choose(`Photo for ${name}`);
    const preview = page.locator("[data-template-preview]");
    await expect(preview.locator(".message-image")).toHaveCount(1);
    await expect(preview.locator(".group-avatars img")).toHaveCount(3);
    await page.getByRole("button", { name: "Remove: Image for message 1", exact: true }).click();
    await expect(preview.locator(".message-image")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(preview.locator(".message-image")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.getByRole("button", { name: "Duplicate", exact: true }).first().click();
    await expect(preview.locator(".message-image")).toHaveCount(2);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const handle = page.locator('[data-reorder-key="a"]');
    await handle.focus();
    await handle.press("Space");
    await handle.press("ArrowDown");
    await handle.press("Space");
    await expect(
      page.getByRole("button", { name: "Remove: Image for message 2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Remove: Image for message 1", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    const designID = page.url().split("/").at(-1)!;
    await page.reload();
    await expect(preview.locator(".message-image")).toHaveCount(1, { timeout: 30000 });
    await expect(preview.locator(".group-avatars img")).toHaveCount(3);
    const exported = await downloadPNG(page);
    const greenPixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 20 && pixels[i + 1] > 200 && pixels[i + 2] > 60 && pixels[i + 2] < 110)
          green++;
      return green;
    }, exported.toString("base64"));
    expect(greenPixels).toBeGreaterThan(150000);
    const blocked = await page.request.delete(
      `/api/v1/media/${photo.id}?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(blocked.status()).toBe(400);
    expect(await blocked.text()).toContain("cannot delete media while it is used");
    const recipeResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/screenshot-templates/designs/${designID}/exports`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save to Media", exact: true }).click();
    const response = await recipeResponse;
    expect(response.ok()).toBeTruthy();
    const request = response.request().postDataJSON();
    const deleted = await page.request.delete(`/api/v1/screenshot-templates/designs/${designID}`, {
      headers,
    });
    expect(deleted.ok()).toBeTruthy();
    const stillBlocked = await page.request.delete(
      `/api/v1/media/${photo.id}?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(stillBlocked.status()).toBe(400);
    expect(await stillBlocked.text()).toContain("cannot delete media while it is used");
    const recipe = await page.request.get(
      `/api/v1/screenshot-templates/recipes/${request.media_id}`,
      { headers },
    );
    expect(recipe.ok()).toBeTruthy();
    const snapshot = (await recipe.json()).document;
    expect(
      snapshot.conversation.people.map((p: { avatar_media_id: string }) => p.avatar_media_id),
    ).toEqual([photo.id, photo.id, photo.id]);
    expect(snapshot.conversation.messages[0].image_media_id).toBe(photo.id);
  });

  test("memes share template drafts, history, media exports and editable recipes", async ({
    page,
  }) => {
    const { token, workspace } = await openTemplates(page);
    const catalogResponse = await page.request.get(
      `/api/v1/memes/templates?workspace_id=${workspace.id}&limit=250`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const catalog = await catalogResponse.json();
    const still = catalog.templates.find(
      (template: { animated: boolean; lines: number }) =>
        !template.animated && template.lines === 2,
    );
    expect(still).toBeTruthy();
    await page.getByRole("button", { name: "Meme", exact: true }).click();
    await page.getByRole("textbox", { name: "Search templates", exact: true }).fill(still.name);
    await page.getByRole("textbox", { name: "Search templates", exact: true }).press("Enter");
    const choice = page.getByRole("button", {
      name: `Use the ${still.name} template`,
      exact: true,
    });
    await expect(choice).toBeVisible({ timeout: 30000 });
    await choice.click();
    await expect(page).toHaveURL(/\/templates\/[^?]+$/);
    const draftURL = page.url();
    const caption = page.getByLabel("Caption 1", { exact: true });
    await caption.fill("Ship the shared editor");
    await page.getByLabel("Caption 2", { exact: true }).fill("Keep the jokes");
    await caption.blur();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(caption).toHaveValue("Ship the shared editor", { timeout: 30000 });
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toHaveCount(0);
    await page.route("**/api/v1/memes/preview", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Preview is temporarily unavailable" }),
      }),
    );
    await caption.fill("Ship the shared editor again");
    await expect(page.getByRole("button", { name: "Save to Media", exact: true })).toBeDisabled();
    await expect(
      page.getByText("Preview is temporarily unavailable", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/v1/memes/preview");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await caption.fill("Ship the shared editor");
    await page.getByRole("button", { name: "Save to Media", exact: true }).click();
    await expect(
      page.getByText("Saved to Media. You can edit a copy from the media library.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    const list = await page.request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await list.json();
    const media = (data.media ?? data).find(
      (item: { source: string }) => item.source === "meme_generator",
    );
    expect(media).toBeTruthy();
    const recipe = await page.request.get(`/api/v1/screenshot-templates/recipes/${media.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(recipe.ok()).toBeTruthy();
    expect((await recipe.json()).document.meme.captions).toEqual([
      "Ship the shared editor",
      "Keep the jokes",
    ]);
    const png = await downloadPNG(page);
    const pixels = await inspectPNG(page, png);
    expect(pixels.opaque).toBeGreaterThan(1000);
    expect(page.url()).toBe(draftURL);
    await page.goto(`/templates?media=${media.id}`);
    await page.getByRole("button", { name: "Edit a copy", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\/[^?]+$/);
    await expect(caption).toHaveValue("Ship the shared editor");
    await page.reload();
    await expect(caption).toHaveValue("Ship the shared editor", { timeout: 30000 });
    await expect(page.getByRole("button", { name: "Save to Media", exact: true })).toBeEnabled({
      timeout: 30000,
    });
    const renderResponse = page.waitForResponse(
      (response) => response.url().endsWith("/memes/render") && response.ok(),
    );
    const copiedPNG = await downloadPNG(page);
    expect(await inspectPNG(page, copiedPNG)).toEqual(pixels);
    await page.getByRole("button", { name: "Save to Media", exact: true }).click();
    const copiedMedia = (await (await renderResponse).json()).media;
    const copiedRecipe = await page.request.get(`/api/v1/memes/recipes/${copiedMedia.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await copiedRecipe.json()).recipe.parent_media_id).toBe(media.id);
  });
});
