import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("persisted Meta permission outcomes offer account recovery and disappear after recovery", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `meta-collection-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Meta collection recovery");
  const post = await createPublication(request, auth.token, workspace.id, "Audit collection only");
  const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const accounts = ["facebook", "instagram", "threads"].map((platform) => ({
    platform,
    id: randomUUID(),
    rendition: randomUUID(),
    state: randomUUID(),
  }));
  const sql = (query: string) =>
    execFileSync("sqlite3", ["-cmd", ".timeout 5000", database, query]);
  sql(
    accounts
      .map(
        (
          a,
        ) => `INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES('${a.id}','${workspace.id}','audit-${a.id}','${a.platform}','${a.id}','Audit ${a.platform}',X'00',1);
 INSERT INTO account_features(social_account_id,workspace_id,feature,enabled,decided_at) VALUES('${a.id}','${workspace.id}','engagement',1,CURRENT_TIMESTAMP);
 INSERT INTO renditions(id,publication_id,social_account_id,target_key,platform,profile,status) VALUES('${a.rendition}','${post.id}','${a.id}','post','${a.platform}','short_text','published');
 INSERT INTO engagement_sync_states(id,workspace_id,rendition_id,social_account_id,platform,status,error_code,error_message,next_sync_at) VALUES('${a.state}','${workspace.id}','${a.rendition}','${a.id}','${a.platform}','permission_required','meta:permission:200','Reconnect this account to resume engagement collection.','2030-01-01 00:00:00+00:00');`,
      )
      .join("\n"),
  );
  await authenticatePage(page, auth.token);
  await page.goto("/inbox/engagement");
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(req.method() + " " + new URL(req.url()).pathname);
  });
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.goto("/inbox/engagement");
      await page.reload();
      const trigger = page.getByRole("button", { name: "Collection issues (3)", exact: true });
      await trigger.focus();
      await trigger.press("Enter");
      const popup = page.locator('[data-slot="popover-content"]');
      const links = popup.getByRole("link", { name: "Manage accounts", exact: true });
      await expect(links).toHaveCount(3);
      await expect(
        popup.getByRole("button", { name: "Refresh engagement", exact: true }),
      ).toHaveCount(0);
      await expect(
        popup.getByText("OpenPost will retry collection for 1 post.", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`meta-permission-${width}-${scheme}.png`) });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  // This checks presentation of the recovered read model; the public HTTP/job
  // regression independently proves the service clears these fields.
  sql(
    `UPDATE engagement_sync_states SET status='ok',error_code='',error_message='',last_success_at=CURRENT_TIMESTAMP WHERE workspace_id='${workspace.id}'`,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: /Collection issues/ })).toHaveCount(0);
  expect(writes).toEqual([]);
});
