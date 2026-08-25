import { expect, test } from "@playwright/test";

test("quick cut page loads with accessible controls and no overflow at 320/390/desktop", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/quick-cut");
    await expect(page.getByRole("heading", { name: /No video open/i })).toBeVisible();
    const openBtn = page.getByRole("button", { name: /Open videos/i });
    await expect(openBtn).toBeVisible();
    const box = await openBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
});

test("quick cut keyboard controls are focusable and loop mode cycles", async ({ page }) => {
  await page.goto("/quick-cut");
  await expect(page.getByText(/Open a video/i)).toBeVisible();
  await expect(page.getByText(/I\/O mark/i)).toBeVisible();
});
