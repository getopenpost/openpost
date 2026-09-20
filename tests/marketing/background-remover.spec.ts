import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

const FIXTURE_WIDTH = 1200;
const FIXTURE_HEIGHT = 800;

async function cutoutFixture(): Promise<Buffer> {
  return await sharp({
    create: {
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
      channels: 4,
      background: "#f7f4ed",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><circle cx="600" cy="310" r="180" fill="#e5622e"/><rect x="390" y="470" width="420" height="270" rx="90" fill="#283a36"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
}

test("downloads a transparent PNG at the original dimensions @desktop", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/tools/background-remover");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose an image").setInputFiles({
    name: "cutout-browser-fixture.png",
    mimeType: "image/png",
    buffer: await cutoutFixture(),
  });

  const downloadButton = page.getByRole("button", { name: "Download PNG" });
  await expect(downloadButton).toBeVisible({ timeout: 110_000 });
  await expect(page.getByRole("img", { name: "Background removed" })).toBeVisible();
  const comparison = page.getByRole("slider", { name: "Compare original and result" });
  await expect(comparison).toHaveAttribute("aria-valuenow", "50");
  await comparison.press("ArrowRight");
  await expect(comparison).toHaveAttribute("aria-valuenow", "51");
  await expect(comparison.getByText("Original", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Removed", { exact: true })).toBeVisible();
  const bounds = await comparison.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height / 2);
  await expect(comparison).toHaveAttribute("aria-valuenow", "75");

  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadEvent;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe("cutout-browser-fixture-no-background.png");
  expect(downloadPath).not.toBeNull();

  const image = sharp(downloadPath!);
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  expect(metadata.format).toBe("png");
  expect(metadata.width).toBe(FIXTURE_WIDTH);
  expect(metadata.height).toBe(FIXTURE_HEIGHT);
  expect(metadata.hasAlpha).toBe(true);
  const alpha = stats.channels[3];
  expect(alpha).toBeDefined();
  expect(alpha!.min).toBeLessThan(255);
  expect(alpha!.max).toBe(255);
});
