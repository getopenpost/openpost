import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Meme Media exports use the authored design name and remain searchable after reload", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `meme-name-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Meme output name");
  const catalogResponse = await request.get(
    `/api/v1/memes/templates?workspace_id=${workspace.id}&limit=250`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json();
  const template = catalog.templates.find(
    (item: { animated: boolean; overlays: number }) => !item.animated,
  );
  expect(template).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto("/templates");
  await page.getByRole("button", { name: "Meme", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search templates", exact: true });
  await search.fill(template.name);
  await search.press("Enter");
  await page
    .getByRole("button", { name: `Use the ${template.name} template`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/templates\/[^?]+$/);
  const name = page.getByLabel("Design name", { exact: true });
  await name.fill("Audit café named meme");
  await name.press("Tab");
  await page.getByLabel("Caption 1", { exact: true }).fill("A named local export");
  const render = page.waitForResponse(
    (response) => response.url().endsWith("/memes/render") && response.ok(),
  );
  await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  const media = (await (await render).json()).media;
  await page.screenshot({ path: testInfo.outputPath("saved-name-before-assertion.png") });
  expect(media.original_filename).toBe("Audit café named meme.png");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Audit café named meme.png");
  await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
  await page.goto("/media");
  const mediaSearch = page.getByRole("textbox", {
    name: "Search filename or alt text",
    exact: true,
  });
  await mediaSearch.fill("Audit café named meme");
  await mediaSearch.press("Enter");
  await expect(page.getByText("Audit café named meme.png", { exact: true }).first()).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await mediaSearch.focus();
      await expect(mediaSearch).toBeFocused();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`name-${width}-${scheme}.png`),
      });
    }
  }
  await page.reload();
  await expect(page.getByText("Audit café named meme.png", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
