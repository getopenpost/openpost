import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.body.scrollWidth <= window.innerWidth &&
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test("Recorder keeps source choices without requesting devices before Start", async ({ page }) => {
  await page.addInitScript(() => {
    const calls = { display: 0, user: 0 };
    Object.defineProperty(window, "__openpostRecorderCalls", {
      configurable: true,
      value: calls,
    });
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const originalDisplay = mediaDevices.getDisplayMedia?.bind(mediaDevices);
    const originalUser = mediaDevices.getUserMedia?.bind(mediaDevices);
    if (originalDisplay) {
      Object.defineProperty(mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: (...args: Parameters<MediaDevices["getDisplayMedia"]>) => {
          calls.display += 1;
          return originalDisplay(...args);
        },
      });
    }
    if (originalUser) {
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: (...args: Parameters<MediaDevices["getUserMedia"]>) => {
          calls.user += 1;
          return originalUser(...args);
        },
      });
    }
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/record");

  const screen = page.getByRole("checkbox", { name: "Screen" });
  const camera = page.getByRole("checkbox", { name: "Camera" });
  const microphone = page.getByRole("checkbox", { name: "Microphone" });
  await expect(screen).toBeChecked();
  await expect(camera).not.toBeChecked();
  await expect(microphone).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as typeof window & {
            __openpostRecorderCalls: { display: number; user: number };
          }
        ).__openpostRecorderCalls;
        return calls.display + calls.user;
      }),
    )
    .toBe(0);

  await screen.uncheck();
  await microphone.uncheck();
  await camera.check();
  await page.reload();

  await expect(page.getByRole("checkbox", { name: "Screen" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Camera" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Microphone" })).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as typeof window & {
            __openpostRecorderCalls: { display: number; user: number };
          }
        ).__openpostRecorderCalls;
        return calls.display + calls.user;
      }),
    )
    .toBe(0);
});
