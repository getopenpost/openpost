import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { authenticatePage, composerDestinations, createWorkspace, registerUser } from "./helpers";

// Real media, capabilities and draft persistence. Synthetic accounts never publish.
test("account media controls preserve shared attachments and survive reload", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors: string[] = [];
  // A failed automatic optimization must keep the original editable and savable.
  let preparationAttempts = 0;
  await page.route("**/api/v1/media/*/optimize-image", (route) => {
    preparationAttempts++;
    return route.fulfill({ status: 503, json: { detail: "Optimizer temporarily unavailable" } });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `account-media-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Account media");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const accounts = [
    { id: randomUUID(), platform: "bluesky", username: "mediasky" },
    { id: randomUUID(), platform: "linkedin", username: "Media person" },
  ];
  for (const account of accounts)
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','media-${account.id}','${account.platform}','${account.id}','${account.username}',X'00',1);`,
    ]);
  const media = [];
  for (const [index, color] of ["#b74c05", "#376e63", "#4469a4"].entries()) {
    const encoded = await sharp({
      create: { width: 640, height: 360, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    // Padding preserves valid PNG pixels while exercising the real byte-limit warning.
    const buffer =
      index === 0 ? Buffer.concat([encoded, Buffer.alloc(4_203_031 - encoded.length)]) : encoded;
    const response = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        alt_text: index === 2 ? "Library blue photo" : "",
        file: { name: `account-photo-${index}.png`, mimeType: "image/png", buffer },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    media.push(await response.json());
  }
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Account media regression",
      content_profile: "thread",
      source_text: "Shared first",
      segments: [
        {
          body: "Shared first",
          media: [{ media_id: media[0].id, alt_text: "Shared orange photo" }],
        },
        {
          body: "Shared second",
          media: [{ media_id: media[1].id, alt_text: "Shared green photo" }],
        },
      ],
      renditions: accounts.map((account) => ({ social_account_id: account.id })),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  const read = async () =>
    await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
  const tab = (index: number) => page.locator(`#composer-destination-${accounts[index].id}`);
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  await page.getByTestId("composer-validation-control").click();
  await expect(
    page.getByText("Image is 4.2 MB; the maximum is 2 MB. Resize or replace it for this account.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByText("Image is 4.2 MB; the maximum is 2 MB. Resize or replace it for this account.", {
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("image-size-warning.png"), fullPage: true });
  await page.getByRole("button", { name: /Edit:.*Image is 4.2 MB/ }).click();
  const preview = page.getByTestId("composer-account-preview");
  const orange = () => preview.locator(`[data-composer-media-id="${media[0].id}"]`);
  await expect(
    page.getByTestId("composer-media-editor").locator(`[data-composer-media-id="${media[0].id}"]`),
  ).toBeFocused();
  await page.getByRole("button", { name: "Edit media", exact: true }).click();
  await expect(orange().getByRole("button", { name: "Remove media", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Shared content", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Editing inherited media creates a media override, without detaching text.
  await orange().getByRole("button", { name: "Alt text", exact: true }).click();
  await orange()
    .getByRole("textbox", { name: "Alt text", exact: true })
    .fill("Bluesky orange photo");
  await orange().getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(async () => {
      const detail = await read();
      const sky = detail.renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
      );
      return {
        alt: sky.segments[0].media[0].alt_text,
        inherited: sky.segments[0].media_inherited,
        body: sky.segments[0].body_override,
        shared: detail.segments[0].media[0].alt_text,
      };
    })
    .toEqual({
      alt: "Bluesky orange photo",
      inherited: false,
      body: undefined,
      shared: "Shared orange photo",
    });
  for (const colorScheme of ["light"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(
        orange().getByRole("button", { name: "Remove media", exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`account-media-${width}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  }
  await orange().getByRole("button", { name: "Remove media", exact: true }).click();
  await expect(orange()).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await read()).renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        ).segments[0].media,
    )
    .toEqual([]);
  // Add media always opens acquisition, even with another attachment present.
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("tab", { name: "Library", exact: true }).click();
  await picker.getByRole("button", { name: "Select account-photo-0.png", exact: true }).click();
  await picker.getByRole("button", { name: /^Add/ }).click();
  await expect(orange()).toBeVisible();
  await expect
    .poll(
      async () =>
        (await read()).renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        ).segments[0].media[0]?.id,
    )
    .toBe(media[0].id);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await tab(0).click();
  await expect(orange().locator("img")).toHaveAttribute("alt", "Bluesky orange photo");
  await orange().getByRole("button", { name: "Alt text", exact: true }).click();
  await orange().getByRole("textbox", { name: "Alt text", exact: true }).fill("");
  await orange().getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await read()).renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        ).segments[0].media[0].alt_text ?? "",
    )
    .toBe("");
  await page.waitForLoadState("networkidle");
  await page.reload();
  await tab(0).click();
  await expect(orange().locator("img")).toHaveAttribute("alt", "");
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await picker.getByRole("tab", { name: "Library", exact: true }).click();
  await picker.getByRole("button", { name: "Select account-photo-2.png", exact: true }).click();
  await picker.getByRole("button", { name: /^Add/ }).click();
  const blue = preview.locator(`[data-composer-media-id="${media[2].id}"]`);
  await expect(blue.locator("img")).toHaveAttribute("alt", "Library blue photo");
  await expect
    .poll(
      async () =>
        (await read()).renditions
          .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
          .segments[0].media.find((m: { id: string }) => m.id === media[2].id)?.alt_text,
    )
    .toBe("Library blue photo");
  await blue.getByRole("button", { name: "Remove media", exact: true }).click();
  // Joined outputs expose both source images, independently of active text focus.
  await tab(1).click();
  const green = preview.locator(`[data-composer-media-id="${media[1].id}"]`);
  await green.getByRole("button", { name: "Remove media", exact: true }).click();
  await expect
    .poll(async () => {
      const detail = await read();
      const linked = detail.renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[1].id,
      );
      return linked.segments[0].media.map((m: { id: string }) => m.id);
    })
    .toEqual([media[0].id]);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await tab(1).click();
  await expect(green).toHaveCount(0);
  await expect(orange().locator("img")).toHaveAttribute("alt", "Shared orange photo");
  await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
  const sharedOrange = page.locator(`[data-composer-media-id="${media[0].id}"]`);
  await sharedOrange.getByRole("button", { name: "Alt text", exact: true }).click();
  await sharedOrange
    .getByRole("textbox", { name: "Alt text", exact: true })
    .fill("Updated shared photo");
  await sharedOrange.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(async () => (await read()).segments[0].media[0].alt_text)
    .toBe("Updated shared photo");
  await tab(1).click();
  await expect(orange().locator("img")).toHaveAttribute("alt", "Shared orange photo");
  await tab(0).click();
  await expect(orange().locator("img")).toHaveAttribute("alt", "");
  const detail = await read();
  expect(
    detail.segments.map((s: { media: { id: string; alt_text: string }[] }) =>
      s.media.map((m) => ({ id: m.id, alt: m.alt_text })),
    ),
  ).toEqual([
    [{ id: media[0].id, alt: "Updated shared photo" }],
    [{ id: media[1].id, alt: "Shared green photo" }],
  ]);
  expect(preparationAttempts).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

for (const platform of ["discord", "pixelfed"]) {
  test(`removing a repeated ${platform} attachment respects its segment strategy`, async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `repeated-media-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Repeated media");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','repeat-${accountID}','${platform}','${accountID}','repeat',X'00',1);`,
    ]);
    const upload = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: {
          name: "repeated.png",
          mimeType: "image/png",
          buffer: await sharp({
            create: { width: 640, height: 360, channels: 3, background: "#376e63" },
          })
            .png()
            .toBuffer(),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const media = await upload.json();
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Repeated attachment",
        content_profile: "thread",
        source_text: "First source",
        segments: [
          { body: "First source", media: [{ media_id: media.id }] },
          { body: "Second source", media: [{ media_id: media.id }] },
        ],
        renditions: [{ social_account_id: accountID }],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.locator(`#composer-destination-${accountID}`).click();
    const tiles = page
      .getByTestId("composer-account-preview")
      .locator(`[data-composer-media-id="${media.id}"]`);
    await expect(tiles).toHaveCount(platform === "discord" ? 1 : 2, { timeout: 15000 });
    await tiles.first().getByRole("button", { name: "Remove media", exact: true }).click();
    await expect(tiles).toHaveCount(platform === "discord" ? 0 : 1);
    await expect
      .poll(async () => {
        const detail = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return detail.renditions[0].segments.map((s: { media: { id: string }[] }) =>
          s.media.map((m) => m.id),
        );
      })
      .toEqual(platform === "discord" ? [[]] : [[], [media.id]]);
  });
}
