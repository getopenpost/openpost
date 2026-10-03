import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("oversized Meme overlay explains its limits and choosing a smaller image recovers", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const { token } = await registerUser(page.request, `meme-limits-${Date.now()}@example.com`);
  const workspace = await createWorkspace(page.request, token, "Meme overlay limits");
  const headers = { Authorization: `Bearer ${token}` };
  for (const [name, width, height] of [
    ["over-pixels", 4000, 3250],
    ["small", 160, 120],
  ] as const) {
    const buffer = await sharp({
      create: { width, height, channels: 3, background: "#ee6446" },
    })
      .png()
      .toBuffer();
    const response = await page.request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        source: "upload",
        file: { name: `${name}.png`, mimeType: "image/png", buffer },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    expect((await response.json()).id).toBeTruthy();
    const decoded = await sharp(buffer).metadata();
    expect([decoded.width, decoded.height]).toEqual([width, height]);
  }
  const catalogResponse = await page.request.get(
    `/api/v1/memes/templates?workspace_id=${workspace.id}&limit=250`,
    { headers },
  );
  const catalog = await catalogResponse.json();
  const template = catalog.templates.find(
    (item: { animated: boolean; overlays: number }) => !item.animated && item.overlays > 0,
  );
  expect(template).toBeTruthy();
  await authenticatePage(page, token);
  await page.goto("/templates");
  await page.getByRole("button", { name: "Meme", exact: true }).click();
  const search = page.getByRole("textbox", {
    name: "Search templates",
    exact: true,
  });
  await search.fill(template.name);
  await search.press("Enter");
  await page
    .getByRole("button", {
      name: `Use the ${template.name} template`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/templates\/[^?]+$/);
  const choose = async (name: string) => {
    await page.getByRole("button", { name: "Image 1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const item = dialog.getByRole("button", {
      name: `Select ${name}.png`,
      exact: true,
    });
    await item.focus();
    await item.press("Space");
    await dialog.getByRole("button", { name: /^Add/ }).click();
    await expect(dialog).toHaveCount(0);
  };
  await choose("over-pixels");
  const preview = page.getByRole("region", { name: "Preview", exact: true });
  const guidance = page.getByText(
    "Meme overlay images must be at most 10 MiB, 6000 pixels per side, and 12 million pixels. Resize the image or choose a smaller one.",
    { exact: true },
  );
  await page.screenshot({
    path: testInfo.outputPath("oversized-before-assertion.png"),
  });
  await expect(guidance).toBeVisible();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 740 });
      await page.emulateMedia({ colorScheme });
      if (width < 1024) await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(guidance).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`limits-${width}-${colorScheme}.png`),
      });
      if (width < 1024) await page.getByRole("button", { name: "Edit", exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1280, height: 740 });
  await choose("small");
  await expect(guidance).toHaveCount(0);
  await expect(preview.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      preview
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBeTruthy();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("recovered.png") });
});
