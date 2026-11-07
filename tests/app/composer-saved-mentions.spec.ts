import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type Locator } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

async function caretAtEnd(editor: Locator) {
  await editor.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

test("a dismissed save cannot insert into a newer mention dialog", async ({ page, request }) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `mention-dialog-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Mention dialog targets");
  const created = await request.post("/api/v1/publications", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      title: "Targets",
      content_profile: "thread",
      source_text: "One ",
      segments: [{ body: "One " }, { body: "Two " }],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started: () => void = () => {};
  const pending = new Promise<void>((resolve) => (started = resolve));
  let finished: () => void = () => {};
  const completed = new Promise<void>((resolve) => (finished = resolve));
  await page.route(`**/api/v1/workspaces/${workspace.id}/mentions`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
    finished();
  });
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  const editors = page.getByRole("textbox", { name: "Post text", exact: true });
  const first = editors.first();
  await first.click();
  await first.press("ControlOrMeta+a");
  await first.press("ArrowRight");
  await first.pressSequentially("@");
  await page.getByRole("option", { name: "Add mention", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Saved mentions", exact: true });
  await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@old");
  await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@old_x");
  await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
  await pending;
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  const second = editors.nth(1);
  await second.click();
  await second.press("ControlOrMeta+a");
  await second.press("ArrowRight");
  await second.pressSequentially("@");
  await page.getByRole("option", { name: "Add mention", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@new");
  release();
  await completed;
  await expect.poll(async () => await dialog.isVisible()).toBe(true);
  await expect(dialog.getByRole("textbox", { name: "Mention name", exact: true })).toHaveValue(
    "@new",
  );
  expect(await first.locator("[data-mention]").count()).toBe(0);
  expect(await second.locator("[data-mention]").count()).toBe(0);
});

test("identity-only edits refresh readiness in a new shared composition", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `mention-readiness-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Mention readiness");
  const account = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account}','${workspace.id}','x','x','${account}','x-account',X'00',1);`,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const saved = await request.post(`/api/v1/workspaces/${workspace.id}/mentions`, {
    headers,
    data: { name: "@guest", profiles: [{ provider: "x", text: "@a_much_longer_guest" }] },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await authenticatePage(page, auth.token);
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Post text", exact: true });
  await editor.fill("@");
  await page.getByRole("option", { name: /@guest.*@a_much_longer_guest/ }).click();
  await expect(editor.locator("[data-mention]")).toHaveCount(1);
  const resolved = page.waitForResponse(
    (response) =>
      response.url().includes("/capabilities/resolve") &&
      response.request().postDataJSON()?.account_segments?.[account]?.[0]?.content ===
        "@a_much_longer_guest",
  );
  await editor.press("Backspace");
  await resolved;
  await expect
    .poll(async () => {
      const list = await (
        await request.get("/api/v1/publications", {
          headers,
          params: { workspace_id: workspace.id },
        })
      ).json();
      return list.some((post: any) => post.source_text === "@guest");
    })
    .toBe(true);
  const refreshed = page.waitForRequest(
    (request) =>
      request.url().includes("/capabilities/resolve") &&
      request.method() === "POST" &&
      request.postDataJSON()?.segments?.[0]?.content === "@guest" &&
      !request.postDataJSON()?.account_segments?.[account],
    { timeout: 5000 },
  );
  await editor.press("Backspace");
  await expect(editor).toHaveText("@guest");
  await expect(editor.locator("[data-mention]")).toHaveCount(0);
  await refreshed;
});

test("shared @ picker creates and reuses immutable per-network mention snapshots", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  const auth = await registerUser(request, `saved-mentions-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Recurring mentions");
  const ids = Object.fromEntries(
    ["x", "bluesky", "facebook"].map((provider) => [provider, randomUUID()]),
  );
  for (const [provider, id] of Object.entries(ids))
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${id}','${workspace.id}','${provider}','${provider}','${id}','${provider}-account',X'00',1);`,
    ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Recurring guest",
      content_profile: "short_text",
      source_text: "Hi ",
      renditions: Object.values(ids).map((id) => ({ social_account_id: id })),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  const read = async () =>
    await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/accounts/*/mentions?**", (route) =>
    route.fulfill({
      json: {
        mode: "accounts",
        candidates: [
          {
            label: "@guest.bsky.social",
            detail: "Guest",
            target: {
              provider: "bluesky",
              kind: "person",
              id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
              handle: "guest.bsky.social",
            },
          },
        ],
      },
    }),
  );
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  const editor = page.getByRole("textbox", { name: "Post text", exact: true });
  await editor.click();
  await caretAtEnd(editor);
  await editor.pressSequentially("@");
  await page.getByRole("option", { name: "Add mention", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Saved mentions", exact: true });
  await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@guest");
  await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@guest_x");
  await dialog.getByRole("textbox", { name: "Bluesky", exact: true }).fill("guest");
  await dialog.getByRole("button", { name: /@guest\.bsky\.social/ }).click();
  await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator("[data-mention]")).toHaveText("@guest");
  await expect
    .poll(async () => {
      const saved = await read();
      return Object.fromEntries(
        saved.renditions.map((rendition: any) => [rendition.platform, rendition.body]),
      );
    })
    .toEqual({ x: "Hi @guest_x ", bluesky: "Hi @guest.bsky.social ", facebook: "Hi @guest " });
  const original = await read();
  expect(
    original.renditions.every((rendition: any) => rendition.segments[0].body_override == null),
  ).toBe(true);
  const snapshot = original.segments[0].settings.mentions.spans[0];
  expect(snapshot.target.provider).toBe("workspace");
  const libraryPath = `/api/v1/workspaces/${workspace.id}/mentions`;
  const library = await (await request.get(libraryPath, { headers })).json();
  expect(library).toHaveLength(1);
  await caretAtEnd(editor);
  await editor.pressSequentially(" @");
  await page.getByRole("option", { name: "Add mention", exact: true }).click();
  await dialog.getByRole("button", { name: "@guest", exact: true }).click();
  await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@new_guest");
  await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
  await expect(editor.locator("[data-mention]")).toHaveCount(2);
  await expect
    .poll(async () => (await read()).renditions.find((r: any) => r.platform === "x").body)
    .toBe("Hi @guest_x  @new_guest ");
  await page.reload();
  await expect(editor.locator("[data-mention]")).toHaveCount(2);
  await caretAtEnd(editor);
  await editor.pressSequentially(" @");
  await expect(page.getByRole("option", { name: /@guest.*@new_guest/ })).toBeVisible();
  await expect(editor.locator("[data-mention]")).toHaveCount(2);
  await editor.press("Enter");
  await expect(editor.locator("[data-mention]")).toHaveCount(3);
  await expect
    .poll(async () => (await read()).renditions.find((r: any) => r.platform === "x").body)
    .toBe("Hi @guest_x  @new_guest  @new_guest ");
  const removed = await request.delete(`${libraryPath}/${library[0].id}`, { headers });
  expect(removed.ok()).toBe(true);
  await page.reload();
  await expect(editor.locator("[data-mention]")).toHaveCount(3);
  expect((await read()).renditions.find((r: any) => r.platform === "x").body).toBe(
    "Hi @guest_x  @new_guest  @new_guest ",
  );
  for (const width of [1280, 320])
    for (const scheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await expect(editor.locator("[data-mention]")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`saved-mentions-${width}-${scheme}.png`),
      });
      const before = await editor.innerText();
      await editor.click();
      await caretAtEnd(editor);
      await editor.pressSequentially(" @");
      await expect(page.getByRole("option", { name: "Add mention", exact: true })).toBeVisible();
      const picker = page.getByRole("listbox");
      await expect(picker).toHaveAttribute("aria-busy", "false");
      const bounds = await picker.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(8);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width - 8);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`saved-mention-picker-${width}-${scheme}.png`),
      });
      await page.getByRole("option", { name: "Add mention", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`saved-mention-dialog-${width}-${scheme}.png`),
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await editor.press("ControlOrMeta+z");
      await expect(editor).toHaveText(before);
    }
  expect(errors).toEqual([]);
});
