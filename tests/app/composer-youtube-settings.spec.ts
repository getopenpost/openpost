import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const hint =
  "Add a video in All, or customize this version to add separate media. Then reopen settings to enter its title and choose video options.";

test("YouTube settings explain required video before fields are resolved", async ({
  page,
  request,
}, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const auth = await registerUser(request, `youtube-settings-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "YouTube settings discovery");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','youtube-${accountID}','youtube','${accountID}','Audit video channel',X'00',1);`,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const uploaded = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: {
        name: "audit-youtube-settings.mp4",
        mimeType: "video/mp4",
        buffer: readFileSync(
          new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
        ),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const media = await uploaded.json();
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Audit YouTube settings",
      content_profile: "text",
      source_text: "Audit internal unscheduled video description.",
      renditions: [{ social_account_id: accountID }],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  const path = `/api/v1/publications/${publication.id}`;
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await page.locator(`#composer-destination-${accountID}`).click();
      const settings = page.getByRole("button", { name: "Platform settings", exact: true });
      await settings.focus();
      await settings.press("Enter");
      const dialog = page.getByRole("dialog", { name: "YouTube settings", exact: true });
      await expect(dialog.getByText(hint, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`youtube-empty-${width}-${scheme}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(settings).toBeFocused();
    }
  const shared = page.getByRole("tab", { name: "All", exact: true });
  await shared.focus();
  await shared.press("Enter");
  const add = page
    .getByRole("region", { name: "Required destination details" })
    .getByRole("button", { name: "Add media", exact: true });
  await add.focus();
  await add.press("Enter");
  const picker = page.getByRole("dialog");
  await picker.getByRole("tab", { name: "Library", exact: true }).click();
  await picker
    .getByRole("button", { name: "Select audit-youtube-settings.mp4", exact: true })
    .click();
  await picker.getByRole("button", { name: /^Add/ }).click();
  await expect
    .poll(async () => {
      const saved = await (await request.get(path, { headers })).json();
      return (saved.segments[0].media ?? []).map((item: { id: string }) => item.id);
    })
    .toEqual([media.id]);
  await page.locator(`#composer-destination-${accountID}`).click();
  await page.getByRole("button", { name: "Platform settings", exact: true }).click();
  const populated = page.getByRole("dialog", { name: "YouTube settings", exact: true });
  await expect(populated.getByText(hint, { exact: true })).toHaveCount(0);
  await expect(populated.getByRole("textbox", { name: /^Title/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("youtube-video-fields-320-dark.png") });
  await page.keyboard.press("Escape");
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await page.locator(`#composer-destination-${accountID}`).click();
      await page.getByRole("button", { name: "Platform settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "YouTube settings", exact: true });
      const description = dialog.getByRole("textbox", { name: "Description", exact: true });
      await description.focus();
      await expect(description).toBeFocused();
      await description.fill("😀".repeat(1251));
      await expect(description).toHaveAttribute("aria-invalid", "true");
      await expect(dialog.getByText("5004 / 5000 bytes", { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          dialog.getByText("5004 / 5000 bytes", { exact: true }).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              if (!/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) continue;
              const bounds = parent.getBoundingClientRect();
              if (rect.top < bounds.top || rect.bottom > bounds.bottom) return false;
            }
            return rect.top >= 0 && rect.bottom <= window.innerHeight;
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`youtube-description-overflow-${width}-${scheme}.png`),
      });
      await description.fill("Launch <now>");
      await expect(
        dialog.getByText("Descriptions cannot contain < or >.", { exact: true }),
      ).toBeVisible();
      await expect(description).toHaveAccessibleDescription(/Descriptions cannot contain < or >\./);
      await description.fill("é".repeat(2500));
      await expect(description).toHaveAttribute("aria-invalid", "false");
      await expect(dialog.getByText("5000 / 5000 bytes", { exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`youtube-description-valid-${width}-${scheme}.png`),
      });
      await page.keyboard.press("Escape");
    }
  await expect
    .poll(async () => {
      const saved = await (await request.get(path, { headers })).json();
      return saved.renditions[0].description;
    })
    .toBe("é".repeat(2500));
  const saved = await (await request.get(path, { headers })).json();
  expect(saved.status).toBe("draft");
  expect(saved.scheduled_at).toBeFalsy();
  expect(pageErrors).toEqual([]);
});
