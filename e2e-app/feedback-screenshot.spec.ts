import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("feedback capture omits its own blur overlay", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `feedback-screenshot-${unique}@example.com`,
  );
  await createWorkspace(request, auth.token, "Feedback Screenshot E2E");
  await authenticatePage(page, auth.token);

  await page.route("**/api/v1/feedback/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        enabled: true,
        recipient: "OpenPost team",
        app_version: "test",
        max_message_characters: 4000,
        max_screenshot_bytes: 1_048_576,
        diagnostic_categories: [],
      },
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    const marker = document.createElement("div");
    marker.id = "feedback-capture-marker";
    Object.assign(marker.style, {
      position: "fixed",
      top: "32px",
      left: "32px",
      width: "160px",
      height: "160px",
      zIndex: "40",
      pointerEvents: "none",
      background: "repeating-linear-gradient(90deg, #fff 0 4px, #000 4px 8px)",
    });
    document.body.append(marker);
  });

  await page.getByTestId("profile-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox").first().check();

  const preview = dialog.getByRole("img", { name: "Include a screenshot" });
  await expect(preview).toBeVisible();
  const contrastRange = await preview.evaluate(async (element) => {
    const source = (element as HTMLImageElement).src;
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(32, 32, 160, 160).data;
    let minimum = 255;
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance =
        pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
    return maximum - minimum;
  });

  expect(contrastRange).toBeGreaterThan(100);
});
