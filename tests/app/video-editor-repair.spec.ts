import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const CLOUD_SAVE_TIMEOUT_MS = 15_000;

async function newProject(page: Page, name: string) {
  if (new URL(page.url()).pathname !== "/video-editor") await page.goto("/video-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Project name" });
  await expect(title).toHaveValue("Untitled project");
  await title.fill(name);
  await title.press("Tab");
  await expect(page.locator("header").getByText("Saved to OpenPost", { exact: true })).toBeVisible({
    timeout: CLOUD_SAVE_TIMEOUT_MS,
  });
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

test("cloud editing saves text, preserves spaces and reopens without a refresh", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const auth = await registerUser(request, `editor-repair-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Editor repair");
  await authenticatePage(page, auth.token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, "Text proof");
  const url = page.url();
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await page
    .getByRole("toolbar", { name: "On-canvas editing tools" })
    .getByRole("button", { name: "Text", exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: /Edit text on canvas/ });
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("A launch with spaces");
  await expect(editor).toHaveText("A launch with spaces");
  await editor.press("ControlOrMeta+Enter");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("img", { name: "Your text", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("img", { name: "A launch with spaces", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator("header").getByText("Saved to OpenPost", { exact: true })).toBeVisible({
    timeout: CLOUD_SAVE_TIMEOUT_MS,
  });
  await page
    .locator("header")
    .getByRole("link", { name: /Video Editor/u })
    .click();
  await page.goto(url);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect(page.getByRole("img", { name: "A launch with spaces", exact: true })).toBeVisible();
  await expect(page.getByText("Save failed", { exact: false })).toHaveCount(0);
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export MP4", exact: true }).click();
  await expect(
    page.getByText("Saved Text proof.mp4 to the exports folder.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download Text proof.mp4", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page
    .locator("header")
    .getByRole("link", { name: /Video Editor/u })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await newProject(page, "Text proof");
  await expect(page.locator("[data-project-summary]")).toContainText("0 clips");
  expect(errors).toEqual([]);
});

test("a new cloud project cannot edit the previous project while its document loads", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const auth = await registerUser(request, `editor-switch-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Editor switch");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, "Previous project");
  await page
    .locator("header")
    .getByRole("link", { name: /Video Editor/u })
    .click();
  await expect(page).toHaveURL(/\/video-editor$/u);
  await newProject(page, "Next project");
  await page
    .locator("header")
    .getByRole("link", { name: /Video Editor/u })
    .click();
  await expect(page).toHaveURL(/\/video-editor$/u);
  await page.reload();
  await page
    .getByRole("article")
    .filter({ hasText: "Previous project" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Previous project");
  await page
    .locator("header")
    .getByRole("link", { name: /Video Editor/u })
    .click();
  await expect(page).toHaveURL(/\/video-editor$/u);

  let releaseLoad!: () => void;
  const heldLoad = new Promise<void>((resolve) => (releaseLoad = resolve));
  let loadStarted!: () => void;
  const started = new Promise<void>((resolve) => (loadStarted = resolve));
  await page.route(/\/api\/v1\/video-projects\/[^/?]+\?/, async (route) => {
    loadStarted();
    await heldLoad;
    await route.continue();
  });

  try {
    await page
      .getByRole("article")
      .filter({ hasText: "Next project" })
      .getByRole("button", { name: "Open" })
      .click();
    await started;
    const title = page.getByRole("textbox", { name: "Project name" });
    await expect(title).toBeDisabled();
    await expect(title).toHaveValue("");
    await expect(
      page.locator("header").getByText("Saved to OpenPost", { exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseLoad();
  }
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Next project");
});

async function waitForRecording(dialog: Locator): Promise<void> {
  await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeEnabled({
    timeout: 15000,
  });
  await expect
    .poll(
      async () => {
        const elapsed = await dialog.getByText(/\d+:\d{2}/).innerText();
        const time = elapsed.match(/(\d+):(\d{2})/)!;
        return Number(time[1]) * 60 + Number(time[2]);
      },
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(2);
}

test("recording setup fits both themes and imports a real streaming WebM", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const auth = await registerUser(request, `recorder-repair-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Recording repair");
  await authenticatePage(page, auth.token);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d")!;
        let frame = 0;
        const draw = () => {
          context.fillStyle = frame++ % 2 ? "#345abc" : "#123456";
          context.fillRect(0, 0, 320, 180);
        };
        draw();
        const interval = setInterval(draw, 40);
        const stream = canvas.captureStream(25);
        const track = stream.getVideoTracks()[0];
        track.addEventListener("ended", () => clearInterval(interval));
        window.addEventListener(
          "test-stop-sharing",
          () => {
            track.stop();
            track.dispatchEvent(new Event("ended"));
          },
          { once: true },
        );
        return stream;
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, "Recording proof");
  await expect(page.getByText(/Workspace root is not set/)).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("header").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Record screen" }).click();
      const dialog = page.getByRole("dialog", { name: "Record screen" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Microphone", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Microphone", exact: true }).click();
      await expect(page.getByRole("option", { name: "Device default", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`recording-${width}-${colorScheme}.png`),
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
      await page.screenshot({
        path: test.info().outputPath(`editor-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Record screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Record screen" });
  await dialog.getByRole("checkbox", { name: "Microphone", exact: true }).uncheck();
  await dialog.getByText("Advanced", { exact: true }).click();
  await dialog.getByRole("button", { name: "Countdown" }).click();
  await page.getByRole("option", { name: "Off", exact: true }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await waitForRecording(dialog);
  await dialog.getByRole("button", { name: "Stop recording" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-project-summary]")).toContainText("1 clip");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator("header").getByText(/saved/i)).toBeVisible({
    timeout: 15000,
  });
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Record screen" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await waitForRecording(dialog);
  await page.evaluate(() => window.dispatchEvent(new Event("test-stop-sharing")));
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-project-summary]")).toContainText("2 clips");
  const uploadRoute = /\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/;
  await page.route(uploadRoute, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Deliberate upload failure" }),
    }),
  );
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Record screen" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await waitForRecording(dialog);
  await dialog.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByText("The recording could not be added to this project.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download Screen", exact: true })).toHaveCount(1);
  await page.unroute(uploadRoute);
  await dialog.getByRole("button", { name: "Recover recording", exact: true }).click();
  await expect(page.locator("[data-project-summary]")).toContainText("3 clips");
  await expect(dialog.getByRole("link", { name: "Download Screen", exact: true })).toHaveCount(0);
});

test("editing text over a background does not leave the old lettering underneath", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `composited-text-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Composited text");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, "Background text");
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("button", { name: "Ocean mesh", exact: true }).click();
  const canvas = page.locator<HTMLCanvasElement>("[data-stacked-preview]");
  const overlay = page.getByRole("group", { name: "Visual 2", exact: true });
  await overlay.getByRole("button", { name: "Hide track", exact: true }).click();
  await expect
    .poll(() =>
      canvas.evaluate(
        (el) => el.getContext("2d")!.getImageData(el.width / 2, el.height / 2, 1, 1).data[2],
      ),
    )
    .toBeGreaterThan(0);
  const background = await canvas.evaluate((el) => el.toDataURL());
  await overlay.getByRole("button", { name: "Show track", exact: true }).click();
  await page.getByRole("button", { name: /^Your text\. Drag to move/ }).click();
  await expect
    .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() !== baseline, background))
    .toBe(true);
  await page
    .getByRole("toolbar", { name: "On-canvas editing tools" })
    .getByRole("button", { name: "Text", exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: /Edit text on canvas/ });
  await editor.fill("");
  await expect
    .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() === baseline, background))
    .toBe(true);
  await editor.pressSequentially("Clear new text");
  await expect(editor).toHaveText("Clear new text");
  await expect
    .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() === baseline, background))
    .toBe(true);
  await editor.press("ControlOrMeta+Enter");
  await expect
    .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() !== baseline, background))
    .toBe(true);
});
