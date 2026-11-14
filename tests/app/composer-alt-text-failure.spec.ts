import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

// Automatic captioning is best effort. A provider failure belongs to the media
// editor, not to a persistent page toast that covers composer controls.
test("a failed automatic alt text draft stays inside the media editor", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const auth = await registerUser(request, `alt-text-failure-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Alt text failure");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','alt-${accountID}','bluesky','${accountID}','altcaptions',X'00',1);`,
  ]);
  const buffer = await sharp({
    create: { width: 640, height: 360, channels: 3, background: "#6b7f52" },
  })
    .png()
    .toBuffer();
  const uploaded = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: { name: "alt-failure.png", mimeType: "image/png", buffer },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Alt text failure",
      content_profile: "image_post",
      source_text: "A calm launch photo",
      segments: [{ body: "A calm launch photo" }],
      renditions: [{ social_account_id: accountID }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const publication = await created.json();
  let captionAttempts = 0;
  await page.route("**/api/v1/media/*/alt-text/generate", (route) => {
    captionAttempts += 1;
    if (captionAttempts === 1) {
      return route.fulfill({ status: 502, json: { detail: "Caption provider unavailable" } });
    }
    return route.fulfill({ json: { alt_text: "A calm launch photo" } });
  });
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("tab", { name: "Library", exact: true }).click();
  await picker.getByRole("button", { name: "Select alt-failure.png", exact: true }).click();
  await picker.getByRole("button", { name: /^Add/ }).click();

  await expect(page.getByRole("button", { name: "Add alt text", exact: true }).first()).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

  // The failure must not intercept the composer's own actions.
  await page.locator(`#composer-destination-${accountID}`).click();
  await page
    .getByTestId("composer-variant-toolbar")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Platform settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const tile = page
    .getByTestId("composer-account-preview")
    .locator("[data-composer-media-id]")
    .first();
  const altButton = tile.getByRole("button", { name: "Add alt text", exact: true });
  await altButton.click();
  const failure = tile.getByText(
    "OpenPost could not generate alt text. You can try again or write it yourself.",
    { exact: true },
  );
  await expect(failure).toBeVisible();
  await tile.getByRole("button", { name: "Try again", exact: true }).click();
  const altField = tile.getByRole("textbox", { name: "Alt text", exact: true });
  await expect(altField).toHaveValue("A calm launch photo");
  await expect(failure).not.toBeVisible();

  type SavedMedia = { alt_text?: string };
  type SavedSegment = { media?: SavedMedia[] };
  await expect
    .poll(async () => {
      const saved = (await (
        await request.get(`/api/v1/publications/${publication.id}`, { headers })
      ).json()) as {
        segments: SavedSegment[];
        renditions: Array<{ segments: SavedSegment[] }>;
      };
      return [...saved.segments, ...saved.renditions.flatMap((item) => item.segments)]
        .flatMap((segment) => segment.media ?? [])
        .map((item) => item.alt_text)
        .filter(Boolean);
    })
    .toContain("A calm launch photo");
});
