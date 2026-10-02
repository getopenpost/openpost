import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

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
      await page.screenshot({ path: testInfo.outputPath("server-desktop-light.png") });
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
      await stale.screenshot({ path: testInfo.outputPath("conflict-desktop-dark.png") });
      await conflict.getByRole("button", { name: "Continue locally", exact: true }).click();
      await expect(conflict).toHaveCount(0);
      await expect(staleTitle).toHaveValue(pendingTitle);
      await expect(staleStrip.getByRole("button", { name: /Page 1: Page 1,/ })).toBeVisible();
      await stale.getByRole("menuitem", { name: "File", exact: true }).click();
      await stale.getByRole("menuitem", { name: /^Save\s+(?:⌘|Ctrl)/ }).click();
      await expect(conflict).toBeVisible();
      await stale.setViewportSize({ width: 320, height: 850 });
      expect(await stale.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      await stale.screenshot({ path: testInfo.outputPath("conflict-narrow-dark.png") });
      await stale.setViewportSize({ width: 1280, height: 850 });
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
      const original = await readSource();
      expect(original.document.title).toBe("Server baseline");
      expect(original.document.pages[0].name).toBe("Server updated page");
      if (recovery === "Reload server version") {
        await expect(staleTitle).toHaveValue("Server baseline");
        await expect(staleStrip.getByRole("button", { name: /Server updated page/ })).toBeVisible();
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
      await stale.screenshot({ path: testInfo.outputPath("copy-cold-dark.png") });
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
