import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

test("editor audit controls fit desktop and phone widths in both schemes", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "Quick announcement", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [1369, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "OpenPost Image Editor", exact: true }),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`image-editor-${width}-${colorScheme}.png`),
      });
    }
  }
  expect(errors).toEqual([]);
});

test("workspace template opens immediately with its pages and editable title", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const auth = await registerUser(request, `image-template-audit-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Template audit");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const source = await (
    await request.post("/api/v1/image-editor/designs", {
      headers,
      data: {
        workspace_id: workspace.id,
        preset_key: "custom",
        width_px: 1080,
        height_px: 1080,
        title: "Template source",
      },
    })
  ).json();
  source.document.pages.push({
    ...structuredClone(source.document.pages[0]),
    id: randomUUID(),
    name: "Second page",
  });
  const templateResponse = await request.post("/api/v1/image-editor/templates", {
    headers,
    data: {
      workspace_id: workspace.id,
      name: "Audit workspace template",
      category: "Audit",
      document: source.document,
    },
  });
  expect(templateResponse.ok()).toBe(true);
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Starter templates", exact: true })).toBeVisible();
  const showAll = page.getByRole("button", { name: /Show all .* templates/ });
  if (await showAll.isVisible()) await showAll.click();
  await page.getByRole("button", { name: /^Audit workspace template/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" }))
    .toBeVisible()
    .catch((error) => {
      throw new Error(`${error.message}\nBrowser errors: ${errors.join("\n")}`);
    });
  await expect(
    page.getByRole("button", { name: "Page 2: Second page", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Design title" }).fill("Opened template");
  await expect(page).toHaveTitle("Opened template");
});

test("failed cloud and recovery saves stay visible and protect unsaved work", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `image-recovery-audit-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Recovery audit");
  await authenticatePage(page, auth.token);
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
  await expect(page.getByRole("banner").getByText("Save unavailable for this test")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(
    page.getByRole("status").filter({ hasText: "Save unavailable for this test" }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "OpenPost Image Editor", exact: true }),
  ).toBeInViewport();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("save-error-320.png") });
});

test("desktop page background Image opens a visible chooser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "OpenPost Image Editor tools", exact: true })
      .getByRole("button", { name: "Add", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("portable import edits only the imported design and updates the tab title", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `image-identity-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image identity");
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const originalURL = page.url();
  const originalID = new URL(originalURL).pathname.split("/").at(-1)!;
  const headers = { Authorization: `Bearer ${auth.token}` };
  const original = await (
    await request.get(`/api/v1/image-editor/designs/${originalID}`, { headers })
  ).json();
  const archive = zipSync({
    "project.json": strToU8(
      JSON.stringify({
        format: "openpost-image-project",
        version: 1,
        exported_at: new Date().toISOString(),
        document: original.document,
        media: [],
      }),
    ),
  });
  await page.locator('input[type=file][accept*="openpost-image"]').setInputFiles({
    name: "identity.openpost-image",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  await expect(page).not.toHaveURL(originalURL);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const importedURL = page.url();
  await page.getByRole("textbox", { name: "Design title" }).fill("Imported design only");
  await expect
    .poll(async () => {
      const id = new URL(importedURL).pathname.split("/").at(-1)!;
      return (await (await request.get(`/api/v1/image-editor/designs/${id}`, { headers })).json())
        .document.title;
    })
    .toBe("Imported design only");
  await expect(page).toHaveTitle("Imported design only");
  expect(
    (await (await request.get(`/api/v1/image-editor/designs/${originalID}`, { headers })).json())
      .document.title,
  ).toBe(original.document.title);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Design title" })).toHaveValue(
    "Imported design only",
  );
});

test("guide arrow and delete keys leave the selected layer unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "Quick announcement", exact: true }).click();
  const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
  await expect(layers.first()).toBeVisible();
  const count = await layers.count();
  const selected = layers
    .filter({ hasNot: page.getByRole("button", { name: "Unlock layer", exact: true }) })
    .first();
  await selected.click({ position: { x: 60, y: 12 } });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: /Add guide/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add guide", exact: true }).click();
  const guide = page.getByRole("button", { name: /Vertical guide at/ });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await guide.focus();
  await guide.press("ArrowRight");
  await expect(guide).toHaveAccessibleName(/Vertical guide at 541 pixels/);
  await guide.press("Delete");
  await expect(guide).toHaveCount(0);
  await expect(layers).toHaveCount(count);
});
