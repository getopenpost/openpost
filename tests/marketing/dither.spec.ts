import { expect, test } from "@playwright/test";

test("CTA dithering changes pixel density on hover and keyboard focus @desktop", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("link", { name: "Start your free trial" }).first();
  await expect(button).toBeVisible();
  const mask = () => button.evaluate((el) => getComputedStyle(el, "::before").maskImage);
  await page.mouse.move(0, 0);
  await expect.poll(mask).toContain("data:image/svg+xml");
  const rest = await mask();
  await button.hover();
  await expect.poll(mask).not.toBe(rest);
  await page.mouse.move(0, 0);
  await expect.poll(mask).toBe(rest);
  await page.keyboard.press("Tab");
  await button.focus();
  await expect.poll(mask).not.toBe(rest);
  await page.emulateMedia({ forcedColors: "active" });
  await expect
    .poll(() => button.evaluate((el) => getComputedStyle(el, "::before").display))
    .toBe("none");
});
