import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type AudioProbeWindow = Window & { __openpostCueCount?: number };

async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const minimumMasterGain = 0.2;
    const maximumMasterGain = 0.35;
    const audioWindow = window as AudioProbeWindow;
    audioWindow.__openpostCueCount = 0;
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return;

    const originalCreateGain = AudioContextConstructor.prototype.createGain;
    AudioContextConstructor.prototype.createGain = function () {
      const node = originalCreateGain.call(this);
      const originalConnect = node.connect.bind(node);
      node.connect = ((destination: AudioNode, output?: number, input?: number) => {
        if (node.gain.value >= minimumMasterGain && node.gain.value <= maximumMasterGain) {
          audioWindow.__openpostCueCount = (audioWindow.__openpostCueCount ?? 0) + 1;
        }
        return originalConnect(destination, output, input);
      }) as typeof node.connect;
      return node;
    };
  });
}

async function cueCount(page: Page) {
  return page.evaluate(() => (window as AudioProbeWindow).__openpostCueCount ?? 0);
}

test("settings actions emit one cue per gesture and respect mute", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installAudioProbe(page);

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `interaction-sounds-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Interaction Sounds E2E");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("openpost:interface-sounds", "on"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  await page.locator('[data-settings-tab="schedule"]').click();
  await expect(page).toHaveURL(/\/settings\?tab=schedule$/);
  await expect.poll(() => cueCount(page)).toBe(1);

  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Personal", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\?tab=profile$/);
  await expect.poll(() => cueCount(page)).toBe(2);

  await page.getByRole("button", { name: "Change picture", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => cueCount(page)).toBe(3);

  await page.evaluate(() => localStorage.setItem("openpost:interface-sounds", "off"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Workspace", exact: true })
    .click();
  await page.locator('[data-settings-tab="schedule"]').click();
  await expect(page).toHaveURL(/\/settings\?tab=schedule$/);
  await expect.poll(() => cueCount(page)).toBe(0);
  await expect.poll(() => consoleErrors).toEqual([]);
});
