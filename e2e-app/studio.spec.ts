import { expect, test, type Locator } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Studio creates from an original template, adapts to mobile, and exports to Media", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `studio-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = await createWorkspace(request, auth.token, "Studio E2E");

  await authenticatePage(page, auth.token);
  await page.goto(`/media?view=designs`);
  await page.getByRole("button", { name: "New design" }).click();

  await expect(
    page.getByRole("heading", { name: "Choose a format" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Starter templates" }),
  ).toBeVisible();

  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();

  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("application", { name: "Design canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: /A clear update, text/ }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(
    page.getByRole("button", { name: "Expand pages" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("button:visible").evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const bounds = button.getBoundingClientRect();
          if (bounds.width >= 44 && bounds.height >= 44) return [];
          return [
            {
              label:
                button.getAttribute("aria-label") ||
                button.textContent?.trim() ||
                "unlabelled",
              width: bounds.width,
              height: bounds.height,
            },
          ];
        }),
      ),
    )
    .toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Export" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog).toBeVisible();
  await exportDialog
    .getByRole("button", { name: "Media", exact: true })
    .click();
  await exportDialog
    .getByRole("button", { name: "Export to Media", exact: true })
    .click();

  await expect(page.getByText("1 exported page saved to Media.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/media\?view=designs$/);
  await expect(
    page.getByRole("heading", { name: "Your designs" }),
  ).toBeVisible();
  const designPreview = page
    .getByRole("region", { name: "Your designs" })
    .locator("a img")
    .first();
  await expect
    .poll(() => distinctSampledColors(designPreview))
    .toBeGreaterThan(2);
  await page.goto("/media");
  await expect(page.getByText("quick-announcement-page-01.png")).toBeVisible();
  const exportedImage = page.getByRole("img", {
    name: "quick-announcement-page-01.png",
  });
  await expect
    .poll(() => distinctSampledColors(exportedImage))
    .toBeGreaterThan(2);
});

async function distinctSampledColors(image: Locator): Promise<number> {
  return image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement) || !element.complete) return 0;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 16) {
      colors.add(
        `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}:${pixels[index + 3]}`,
      );
    }
    return colors.size;
  });
}
