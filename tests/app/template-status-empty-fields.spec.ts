import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Status template blank optional fields preserve content without dangling export separators", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `status-empty-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Optional Status fields");
  await authenticatePage(page, auth.token);
  await page.goto("/templates");
  await page.getByRole("button", { name: "Status page", exact: true }).click();
  await page.getByRole("textbox", { name: "Incident title", exact: true }).fill("");
  await page.getByRole("button", { name: "Add update", exact: true }).click();
  const stage = page.getByRole("textbox", { name: "Stage", exact: true }).nth(3);
  const body = page.getByRole("textbox", { name: "Update", exact: true }).nth(3);
  await body.fill("   ");
  const artwork = page.locator('[data-template-preview="status-page"]');
  const row = artwork.locator(".update").nth(3);
  await expect(row.locator("strong")).toHaveText("Update");
  const region = await row.evaluate((element) => {
    const art = element.closest("[data-template-preview]")!.getBoundingClientRect();
    const paragraph = element.querySelector("p")!.getBoundingClientRect();
    const label = element.querySelector("strong")!.getBoundingClientRect();
    return {
      left: (label.right - art.left) / art.width,
      right: (paragraph.right - art.left) / art.width,
      top: (paragraph.top - art.top) / art.height,
      bottom: (paragraph.bottom - art.top) / art.height,
    };
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const png = await readFile((await download.path())!);
  await download.saveAs(testInfo.outputPath("blank-update-export.png"));
  const inspected = await page.evaluate(
    async ({ base64, region }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const x = Math.ceil(region.left * img.width) + 2;
      const y = Math.ceil(region.top * img.height);
      const width = Math.floor(region.right * img.width) - x;
      const height = Math.floor(region.bottom * img.height) - y;
      const pixels = ctx.getImageData(x, y, width, height).data;
      let trailingInk = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 90 && pixels[i + 3] > 240)
          trailingInk++;
      }
      return { width: img.width, height: img.height, trailingInk };
    },
    { base64: png.toString("base64"), region },
  );
  expect(inspected.width).toBe(1080);
  expect(inspected.trailingInk).toBe(0);
  await expect(row.locator("p")).toHaveText("Update");
  await expect(row.locator(".update-time")).toHaveCount(0);
  await expect(artwork.locator("h2")).toHaveCount(0);
  await stage.fill("");
  await body.fill("Restored 👩🏽‍💻 مرحبا");
  await expect(row.locator("p")).toHaveText("Restored 👩🏽‍💻 مرحبا");
  await stage.fill("Resolved");
  await body.fill("Service ready");
  await expect(row.locator("p")).toHaveText("Resolved · Service ready");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      if (width < 1024) await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(artwork).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`status-${width}-${scheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await stage.fill("  ");
  await body.fill("  ");
  await expect(artwork.locator(".update")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Update", exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(artwork.locator(".update")).toHaveCount(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(artwork.locator(".update")).toHaveCount(3);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(body).toHaveValue("  ");
  await expect(stage).toHaveValue("  ");
  await expect(artwork.locator(".update")).toHaveCount(3);
  expect(errors).toEqual([]);
});
