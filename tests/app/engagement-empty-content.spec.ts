import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("stored empty replies explain missing content without claiming deletion or losing actions", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `empty-engagement-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Empty engagement");
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Audit reply content states",
  );
  const accountID = randomUUID();
  const renditionID = randomUUID();
  const fixtures = [
    { id: randomUUID(), name: "Audit empty reply", body: "", attachments: [], deleted: false },
    {
      id: randomUUID(),
      name: "Audit whitespace reply",
      body: "   ",
      attachments: [],
      deleted: false,
    },
    {
      id: randomUUID(),
      name: "Audit attachment reply",
      body: "",
      attachments: [
        { url: "https://example.com/audit-attachment", name: "Audit attachment", type: "image" },
      ],
      deleted: false,
    },
    { id: randomUUID(), name: "Audit deleted reply", body: "", attachments: [], deleted: true },
  ];
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `
    PRAGMA foreign_keys=ON;
    INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','empty-engagement-${accountID}','bluesky','${accountID}','Audit engagement',X'00',1);
    INSERT INTO account_features (social_account_id,workspace_id,feature,enabled,decided_at) VALUES ('${accountID}','${workspace.id}','engagement',1,CURRENT_TIMESTAMP);
    INSERT INTO renditions (id,publication_id,social_account_id,target_key,platform,profile,status) VALUES ('${renditionID}','${publication.id}','${accountID}','post','bluesky','short_text','published');
    ${fixtures.map((fixture) => `INSERT INTO engagement_items (id,workspace_id,rendition_id,social_account_id,platform,remote_id,author_name,body,attachments_json,can_reply,deleted_at,last_seen_at) VALUES ('${fixture.id}','${workspace.id}','${renditionID}','${accountID}','bluesky','${fixture.id}','${fixture.name}','${fixture.body}','${JSON.stringify(fixture.attachments)}',1,${fixture.deleted ? "CURRENT_TIMESTAMP" : "NULL"},CURRENT_TIMESTAMP);`).join("\n")}
  `,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const endpoint = `/api/v1/engagement?workspace_id=${workspace.id}`;
  const before = await request.get(endpoint, { headers });
  expect(before.ok()).toBe(true);
  const stored = await before.json();
  for (const fixture of fixtures) {
    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.id,
          body: fixture.body,
          attachments: fixture.attachments,
          can_reply: true,
        }),
      ]),
    );
  }
  await authenticatePage(page, auth.token);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/inbox/engagement");
  const notice = "No text or attachments are available for this reply.";
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const empty = page.locator(`[data-engagement-id='${fixtures[0].id}']`);
      await expect(empty.getByRole("heading", { name: fixtures[0].name })).toBeVisible();
      await empty.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`empty-${width}-${scheme}.png`) });
      await expect(empty.getByText(notice, { exact: true })).toBeVisible();
      await expect(
        empty.getByText("This reply was deleted on the social network.", { exact: true }),
      ).toHaveCount(0);
      const reply = empty.getByRole("button", { name: "Reply", exact: true });
      await reply.focus();
      await page.keyboard.press("Enter");
      await expect(
        empty.getByRole("textbox", { name: "Write a reply…", exact: true }),
      ).toBeVisible();
      await expect(empty.getByRole("button", { name: "Queue reply", exact: true })).toBeDisabled();
      await reply.focus();
      await page.keyboard.press("Enter");
      await expect(empty.getByRole("textbox")).toHaveCount(0);
      await expect(reply).toBeFocused();
      await expect(empty.getByRole("button", { name: "Mark read", exact: true })).toBeEnabled();
      await expect(empty.getByRole("button", { name: "Archive", exact: true })).toBeEnabled();
      await expect(
        page.locator(`[data-engagement-id='${fixtures[1].id}']`).getByText(notice, { exact: true }),
      ).toBeVisible();
      const attachment = page.locator(`[data-engagement-id='${fixtures[2].id}']`);
      await expect(
        attachment.getByRole("link", { name: "Audit attachment", exact: true }),
      ).toHaveAttribute("href", "https://example.com/audit-attachment");
      await expect(attachment.getByText(notice, { exact: true })).toHaveCount(0);
      const deleted = page.locator(`[data-engagement-id='${fixtures[3].id}']`);
      await expect(
        deleted.getByText("This reply was deleted on the social network.", { exact: true }),
      ).toBeVisible();
      await expect(deleted.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
  const after = await request.get(endpoint, { headers });
  expect(await after.json()).toEqual(stored);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
