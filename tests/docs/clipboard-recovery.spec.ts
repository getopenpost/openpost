import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

const cases = [
  { control: "code", width: 1280, scheme: "light" },
  { control: "heading", width: 390, scheme: "dark" },
  { control: "page", width: 320, scheme: "light" },
  { control: "code", width: 320, scheme: "dark" },
  { control: "heading", width: 1280, scheme: "light" },
  { control: "page", width: 390, scheme: "dark" },
] as const;

for (const { control, width, scheme } of cases) {
  test(`denied ${control} copying stays recoverable and retries the original text at ${width} ${scheme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      let deny = true;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (deny) {
              deny = false;
              throw new DOMException("Fixture clipboard denied", "NotAllowedError");
            }
            document.documentElement.dataset.copiedText = text;
          },
          write: async (items: ClipboardItem[]) => {
            if (deny) {
              deny = false;
              throw new DOMException("Fixture clipboard denied", "NotAllowedError");
            }
            const blob = await items[0].getType("text/plain");
            document.documentElement.dataset.copiedText = await blob.text();
          },
        },
      });
    });
    await page.goto("/docs/self-hosting");
    const label =
      control === "code" ? "Copy Text" : control === "heading" ? "Copy Anchor Link" : "Copy page";
    const button = page.getByRole("button", { name: label, exact: true }).first();
    let expected: string;
    if (control === "code") {
      expected = await button.locator("xpath=ancestor::figure").locator("pre").innerText();
    } else if (control === "heading") {
      const id = await button.locator("xpath=..").getAttribute("id");
      const url = new URL(page.url());
      url.hash = id!;
      expected = url.href;
    } else {
      const response = await page.request.get("/docs/self-hosting/index.md");
      expect(response.ok()).toBe(true);
      expected = await response.text();
    }
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Could not copy" })).toContainText(
      "Could not copy",
    );
    await expect(page.getByRole("button", { name: "Copied Text", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await expect(button).toBeFocused();
    await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(
        async () => (await page.getByRole("button", { name: "Retry copy" }).boundingBox())!.height,
      )
      .toBeGreaterThanOrEqual(44);
    const manual = page.getByRole("textbox", { name: "Text to copy", exact: true });
    await expect(manual).toHaveValue(expected);
    await manual.focus();
    expect(
      await manual.evaluate((input: HTMLTextAreaElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual([0, expected.length]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`copy-recovery-${control}-${width}-${scheme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator("html").getAttribute("data-copied-text")).toBe(expected);
    await expect(page.getByRole("alert").filter({ hasText: "Could not copy" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
