import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

// The capability resolver and draft persistence are real. Synthetic credentials
// cannot publish, and this test never requests delivery.
test("media on a follow-up preserves the first post's native poll", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `thread-poll-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Thread poll media");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','poll-${accountID}','x','${accountID}','auditpoll',X'00',1);`,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const uploaded = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: {
        name: "audit-thread-poll.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const media = await uploaded.json();
  const attachPhoto = async (postIndex: number) => {
    await page.getByRole("textbox", { name: "Post text", exact: true }).nth(postIndex).click();
    const addMedia = page.getByRole("button", { name: "Add media", exact: true }).nth(postIndex);
    await addMedia.click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker
      .getByRole("button", {
        name: "Select audit-thread-poll.png",
        exact: true,
      })
      .click();
    const resolvedMedia = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/v1/capabilities/resolve")) return false;
      const input = response.request().postDataJSON();
      return input.segments?.[postIndex]?.media?.[0]?.media_id === media.id;
    });
    await picker.getByRole("button", { name: /^Add/ }).click();
    expect((await resolvedMedia).ok()).toBeTruthy();
  };
  await authenticatePage(page, auth.token);
  let releaseCapabilities!: () => void;
  const capabilitiesReady = new Promise<void>((resolve) => {
    releaseCapabilities = resolve;
  });
  await page.route(
    "**/api/v1/capabilities",
    async (route) => {
      await capabilitiesReady;
      await route.continue();
    },
    { times: 1 },
  );
  const capabilityRequest = page.waitForRequest("**/api/v1/capabilities");
  await page.goto("/");
  await capabilityRequest;
  await page
    .getByRole("textbox", { name: "Post text", exact: true })
    .fill("Audit poll before a photo.");
  try {
    await expect(page.getByRole("button", { name: "Add poll", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("poll-capabilities-loading.png") });
  } finally {
    releaseCapabilities();
  }
  await page.getByRole("button", { name: "Add poll", exact: true }).click();
  const poll = page.locator(
    '[data-testid="shared-poll-editor"]:visible, [data-testid="composer-account-preview"]:visible',
  );
  const dialog = page.getByRole("dialog", { name: "Add poll", exact: true });
  await dialog.getByRole("textbox", { name: "Question", exact: true }).fill("Which option?");
  await dialog.getByRole("textbox", { name: "Option 1", exact: true }).fill("First");
  await dialog.getByRole("textbox", { name: "Option 2", exact: true }).fill("Second");
  await dialog.getByRole("button", { name: "Add poll", exact: true }).click();
  await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add post", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Post text", exact: true })
    .nth(1)
    .fill("Audit photo follow-up.");
  await attachPhoto(1);
  await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();

  let saved: any;
  await expect
    .poll(async () => {
      const list = await (
        await request.get("/api/v1/publications", {
          headers,
          params: { workspace_id: workspace.id },
        })
      ).json();
      const items = Array.isArray(list) ? list : (list.items ?? list.publications ?? []);
      const item = items.find((entry: any) => entry.source_text === "Audit poll before a photo.");
      if (!item) return false;
      saved = await (await request.get(`/api/v1/publications/${item.id}`, { headers })).json();
      return saved.segments?.[1]?.media?.[0]?.id === media.id;
    })
    .toBe(true);
  expect(saved.segments[0].media ?? []).toEqual([]);
  expect(saved.segments[0].settings.poll.destinations[accountID].mode).toBe("native");
  expect(saved.renditions[0].segments).toHaveLength(2);
  expect(saved.renditions[0].segments[0].settings.poll_options).toBe("First\nSecond");
  expect(saved.renditions[0].segments[1].settings.poll_options).toBeUndefined();
  const validation = await request.post(`/api/v1/publications/${saved.id}/validate`, { headers });
  expect(validation.ok(), await validation.text()).toBeTruthy();
  const issueCodes = (await validation.json()).issues.map((issue: { code: string }) => issue.code);
  expect(issueCodes).not.toContain("x_mutually_exclusive_attachment");
  expect(issueCodes).not.toContain("poll_resolution_required");
  await page.screenshot({ path: testInfo.outputPath("mixed-thread.png") });
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.goto(`/publications/${saved.id}`);
      await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: /@auditpoll,/ }).click();
      const version = poll.getByRole("button", {
        name: "Poll version",
        exact: true,
      });
      await version.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("option", { name: "Native poll", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(version).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await poll.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`poll-${width}-${scheme}.png`),
      });
      await page.getByRole("tab", { name: "All", exact: true }).click();
    }
  }
  // Moving the same photo onto the poll's own post must still be refused.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page
    .getByRole("region", { name: "Drop zone for post 2", exact: true })
    .getByRole("button", { name: "Remove media", exact: true })
    .click();
  await attachPhoto(0);
  await page.getByRole("tab", { name: /@auditpoll,/ }).click();
  await expect(
    poll.getByText("Remove media from this destination or choose a text version of the poll.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const detail = await (
        await request.get(`/api/v1/publications/${saved.id}`, { headers })
      ).json();
      return detail.segments[0].media?.[0]?.id === media.id && !detail.segments[1].media?.length;
    })
    .toBe(true);
  const blocked = await request.post(`/api/v1/publications/${saved.id}/validate`, { headers });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  expect((await blocked.json()).issues.map((issue: { code: string }) => issue.code)).toContain(
    "x_mutually_exclusive_attachment",
  );
  await page.screenshot({
    path: testInfo.outputPath("same-post-media-guard.png"),
  });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page
    .getByRole("region", { name: "Drop zone for post 1", exact: true })
    .getByRole("button", { name: "Remove media", exact: true })
    .click();
  await attachPhoto(1);
  await expect
    .poll(async () => {
      const detail = await (
        await request.get(`/api/v1/publications/${saved.id}`, { headers })
      ).json();
      return !detail.segments[0].media?.length && detail.segments[1].media?.[0]?.id === media.id;
    })
    .toBe(true);
  await page.reload();
  await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
