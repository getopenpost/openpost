import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
      if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 90 && pixels[i + 3] > 240) dark++;
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
    page.getByText("Saved to Media. You can edit a copy from the media library.", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [320, 390])
  test(`mobile ${width}px exports visible artwork from Edit and Preview`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({
      colorScheme: width === 320 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await openTemplates(page);
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toBeVisible({
      timeout: 30000,
    });
    const editPNG = await inspectPNG(page, await downloadPNG(page));
    expect(editPNG.width).toBe(1080);
    expect(editPNG.opaque / editPNG.pixels).toBeGreaterThan(0.99);
    expect(editPNG.blue).toBeGreaterThan(10000);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-template-preview]")).toBeVisible();
    const previewPNG = await inspectPNG(page, await downloadPNG(page));
    expect(previewPNG).toEqual(editPNG);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "We just hit 10k users.", exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toBeFocused();
  });

test("receipt and status templates expose their own fields and update artwork", async ({
  page,
}) => {
  await openTemplates(page);
  await page.getByRole("button", { name: "Receipt", exact: true }).click();
  await page.getByRole("textbox", { name: "Business name", exact: true }).fill("Test Coffee");
  await page.getByRole("spinbutton", { name: "Quantity", exact: true }).first().fill("2");
  await expect(page.locator("[data-template-preview]")).toContainText("$18.00");
  await page
    .getByRole("textbox", { name: "Custom total (optional)", exact: true })
    .fill("One good idea");
  await expect(page.locator("[data-template-preview]")).toContainText("One good idea");
  let png = await inspectPNG(page, await downloadPNG(page));
  expect(png.dark).toBeGreaterThan(1000);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Status page", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Incident title", exact: true })
    .fill("Everything is fine");
  await expect(page.locator("[data-template-preview]")).toContainText("Everything is fine");
  await page.getByRole("button", { name: "Add update", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Update", exact: true })).toHaveCount(4);
  png = await inspectPNG(page, await downloadPNG(page));
  expect(png.dark).toBeGreaterThan(500);
});

test("standalone export opens a new publication with its image", async ({ page }) => {
  await openTemplates(page);
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await page.getByRole("button", { name: "Add to publication", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("[data-composer-media-id]")).toHaveCount(1);
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
  await page.getByRole("textbox", { name: "Message 1", exact: true }).fill("A custom screenshot.");
  await page.getByRole("button", { name: "Return to publication", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toHaveValue(
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

test("Media reopens the exported content after its original draft is edited and deleted", async ({
  page,
}) => {
  await openTemplates(page);
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/[^/?]+$/);
  const originalURL = page.url();
  await page
    .getByRole("textbox", { name: "Design name", exact: true })
    .fill("Exported conversation");
  await page.getByRole("textbox", { name: "Message 1", exact: true }).fill("The exported version.");
  await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  await expect(
    page.getByText("Saved to Media. You can edit a copy from the media library.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message 1", exact: true })
    .fill("A later draft version.");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /Exported conversation/ })).toHaveCount(0);
  await page.goto("/media");
  await page
    .getByRole("button", { name: "Open details for Exported conversation.png", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("link", { name: "Edit a copy", exact: true }).click();
  await page.getByRole("button", { name: "Edit a copy", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
    "The exported version.",
  );
  expect(page.url()).not.toBe(originalURL);
});

test("message reordering previews locally, cancels, and commits pointer moves with undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTemplates(page);
  await page.getByRole("button", { name: "Group chat", exact: true }).click();
  const first = page.locator('[data-reorder-key="a"]');
  await first.focus();
  await first.press("Space");
  await first.press("ArrowDown");
  await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
    "Congrats! How many users?",
  );
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await first.press("Escape");
  await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
    "We finally shipped it.",
  );
  await first.scrollIntoViewIfNeeded();
  const source = (await first.boundingBox())!;
  const target = (await page.locator('[data-reorder-key="b"]').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
    "Congrats! How many users?",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message 1", exact: true })).toHaveValue(
    "We finally shipped it.",
  );
});

test("duplicated messages save and reopen", async ({ page }) => {
  await openTemplates(page);
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Message 2", exact: true })).toHaveValue(
    "We just hit 10k users.",
  );
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message 2", exact: true })).toHaveValue(
    "We just hit 10k users.",
    { timeout: 30000 },
  );
  await expect(page.getByRole("textbox", { name: "Message 5", exact: true })).toBeVisible();
});
