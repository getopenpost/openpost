import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, createPublication } from "./helpers";
import { execFileSync } from "node:child_process";

test.describe("inbox bulk read", () => {
  test("mark all matching read", async ({ page, request }) => {
    const { token } = await registerUser(request, `bulk-read-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Bulk read workspace");
    await authenticatePage(page, token);
    let read = false;
    let attempts = 0;
    await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/engagement?**", (route) =>
      route.fulfill({ json: { items: [], total: read ? 0 : 137, sync_states: [] } }),
    );
    await page.route("**/api/v1/engagement/read", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        workspace_id: workspace.id,
        archived: true,
      });
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      read = true;
      return route.fulfill({ json: { updated_count: 137 } });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inbox/engagement");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
    await page.keyboard.press("Escape");
    const button = page.getByRole("button", { name: "Mark all matching read", exact: true });
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("OpenPost could not start that action.")).toBeVisible();
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Marked 137 matching items as read.")).toBeVisible();
    // Nothing matches any more, so the action leaves the header.
    await expect(button).toHaveCount(0);
    expect(attempts).toBe(2);
    expect(errors).toEqual([]);
  });
});

test.describe("inbox mentions and reviews", () => {
  test("native mentions and reviews retain separate subjects, filters and review controls", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `activity-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Account activity");
    const account = randomUUID();
    const blueskyAccount = randomUUID();
    const review = randomUUID();
    const mention = randomUUID();
    const anotherMention = randomUUID();
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const subject = JSON.stringify({
      kind: "review",
      remote_id: "accounts/1/locations/2/reviews/3",
      review: {
        anonymous: true,
        stars: 5,
        owner_reply: { text: "Thanks for your feedback", state: "PENDING" },
      },
    });
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `
      PRAGMA foreign_keys=ON;
      INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES(${quote(account)},${quote(workspace.id)},${quote(account)},'googlebusiness','accounts/1/locations/2','Sample business',X'00',1);
      INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES(${quote(blueskyAccount)},${quote(workspace.id)},${quote(blueskyAccount)},'bluesky','did:plc:sample','sample.bsky.social',X'00',1);
      INSERT INTO account_features(social_account_id,workspace_id,feature,enabled,decided_at) VALUES(${quote(account)},${quote(workspace.id)},'engagement',1,CURRENT_TIMESTAMP);
      INSERT INTO engagement_items(id,workspace_id,social_account_id,platform,remote_id,kind,subject_json,body,can_reply,last_seen_at) VALUES(${quote(review)},${quote(workspace.id)},${quote(account)},'googlebusiness','accounts/1/locations/2/reviews/3','review',${quote(subject)},'',1,CURRENT_TIMESTAMP);
      ${[mention, anotherMention].map((id, index) => `INSERT INTO engagement_items(id,workspace_id,social_account_id,platform,remote_id,kind,subject_json,body,author_name,can_reply,last_seen_at) VALUES(${quote(id)},${quote(workspace.id)},${quote(blueskyAccount)},'bluesky',${quote(id)},'mention',${quote(JSON.stringify({ kind: "post", remote_id: id }))},${quote(`Native mention ${index + 1}`)},'Alice',1,CURRENT_TIMESTAMP);`).join("\n")}
    `,
    ]);
    await authenticatePage(page, auth.token);
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      // Reloads abort in-flight route imports, and the app bounds its own chunk
      // recovery; the rendered page is the evidence that it succeeded.
      if (error.message.includes("Failed to fetch dynamically imported module")) return;
      errors.push(error.message);
    });
    // Collection and provider writes are separate from these stored-reader checks.
    await page.route("**/api/v1/engagement/refresh", (route) =>
      route.fulfill({ json: { status: "queued", queued: 0, job_ids: [] } }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inbox/engagement");
    await page.reload();
    const reviewRow = page.locator(`[data-engagement-id="${review}"]`);
    const mentionRow = page.locator(`[data-engagement-id="${mention}"]`);
    await expect(reviewRow.getByRole("heading", { name: "Anonymous reviewer" })).toBeVisible();
    await expect(reviewRow.getByText("Rating without written feedback")).toBeVisible();
    await expect(reviewRow.getByText("Rating: 5/5")).toBeVisible();
    await expect(reviewRow.getByText("Google moderation: Pending review")).toBeVisible();
    await expect(
      page.locator("section").filter({ has: mentionRow }).locator("[data-engagement-id]"),
    ).toHaveCount(1);
    // The kind filter is the Reviews page tab on the calm Inbox surface.
    await page
      .getByTestId("communications-navigation")
      .getByRole("link", { name: "Reviews", exact: true })
      .click();
    await expect(mentionRow).toHaveCount(0);
    await expect(reviewRow).toBeVisible();
    await reviewRow.getByRole("button", { name: "Reply", exact: true }).click();
    const text = reviewRow.getByRole("textbox", { name: "Write a reply…", exact: true });
    await text.fill("🚀".repeat(1025));
    await expect(
      reviewRow.getByRole("button", { name: "Queue reply", exact: true }),
    ).toBeDisabled();
    await expect(reviewRow.getByText("4100/4096 UTF-8 bytes")).toBeVisible();
    await text.fill("Thanks 日本語");
    await expect(reviewRow.getByRole("button", { name: "Queue reply", exact: true })).toBeEnabled();
    // The fixture has an owner reply, so removal may target only that reply.
    await expect(
      reviewRow.getByRole("button", { name: "Remove your reply", exact: true }),
    ).toBeVisible();
    await expect(reviewRow.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Mark all matching read", exact: true }).click();
    await expect(page.getByText("Marked 1 matching items as read.")).toBeVisible();
    const stored = await request.get(`/api/v1/engagement?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(stored.ok()).toBe(true);
    const data = await stored.json();
    expect(data.items.find((item: { id: string }) => item.id === review).read_at).toBeTruthy();
    expect(data.items.find((item: { id: string }) => item.id === mention).read_at).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

test.describe("inbox Meta recovery", () => {
  test("persisted Meta permission outcomes offer account recovery and disappear after recovery", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `meta-collection-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Meta collection recovery");
    const post = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Audit collection only",
    );
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
      if (
        req.url().includes("/api/v1/") &&
        !["GET", "HEAD"].includes(req.method()) &&
        new URL(req.url()).pathname !== "/api/v1/inbox/activity"
      )
        writes.push(req.method() + " " + new URL(req.url()).pathname);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
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
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    // This checks presentation of the recovered read model; the public HTTP/job
    // regression independently proves the service clears these fields.
    sql(
      `UPDATE engagement_sync_states SET status='ok',error_code='',error_message='',last_success_at=CURRENT_TIMESTAMP WHERE workspace_id='${workspace.id}'`,
    );
    await page.reload();
    await expect(page.getByRole("button", { name: /Collection issues/ })).toHaveCount(0);
    expect(writes).toEqual([]);
  });
});
