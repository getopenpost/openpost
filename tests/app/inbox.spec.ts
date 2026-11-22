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

test.describe("inbox collection recovery", () => {
  const width = 320;
  test("disabled collection offers account recovery", async ({ page, request }) => {
    const { token } = await registerUser(
      request,
      `engagement-recovery-${randomUUID()}@example.com`,
    );
    const workspace = await createWorkspace(request, token, "Recovery workspace");
    await authenticatePage(page, token);
    const disabledID = randomUUID();
    const retryID = randomUUID();
    await page.route("**/api/v1/accounts?**", (route) =>
      route.fulfill({
        json: [
          {
            id: disabledID,
            workspace_id: workspace.id,
            platform: "discord",
            is_active: true,
            account_username: "Disabled account",
          },
          {
            id: retryID,
            workspace_id: workspace.id,
            platform: "bluesky",
            is_active: true,
            account_username: "Retry account",
          },
        ],
      }),
    );
    await page.route("**/api/v1/account-features?**", (route) =>
      route.fulfill({
        json: [
          { social_account_id: disabledID, feature: "engagement", effective_enabled: false },
          { social_account_id: retryID, feature: "engagement", effective_enabled: true },
        ],
      }),
    );
    const states = [
      {
        id: randomUUID(),
        rendition_id: randomUUID(),
        social_account_id: disabledID,
        platform: "discord",
        status: "disabled",
        error_code: "feature_disabled",
        error_message: "Engagement is disabled for this account.",
        next_sync_at: "0001-01-01T00:00:00Z",
      },
      {
        id: randomUUID(),
        rendition_id: randomUUID(),
        social_account_id: retryID,
        platform: "bluesky",
        status: "temporarily_unavailable",
        error_code: "provider_temporarily_unavailable",
        error_message: "Provider is temporarily unavailable.",
        next_sync_at: "2030-01-01T00:00:00Z",
      },
    ];
    await page.route("**/api/v1/engagement?**", (route) =>
      route.fulfill({ json: { items: [], total: 0, sync_states: states } }),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inbox/engagement");
    // A feature the owner turned off is a choice, not a collection issue.
    const trigger = page.getByRole("button", { name: "Collection issues (1)", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const popup = page.locator('[data-slot="popover-content"]');
    await expect(popup.getByText("Comments and replies are off", { exact: true })).toHaveCount(0);
    await expect(
      popup.getByText("OpenPost will retry collection for 1 post.", { exact: true }),
    ).toHaveCount(1);
    await expect(
      popup.getByRole("button", { name: "Refresh engagement", exact: true }),
    ).toHaveCount(1);
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("collection recovery explains zero, one and several affected posts", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `recovery-count-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Recovery counts");
    const accountID = randomUUID();
    await authenticatePage(page, token);
    await page.route("**/api/v1/accounts?**", (route) =>
      route.fulfill({
        json: [
          {
            id: accountID,
            workspace_id: workspace.id,
            platform: "bluesky",
            is_active: true,
            account_username: "Recovery account",
          },
        ],
      }),
    );
    await page.route("**/api/v1/account-features?**", (route) =>
      route.fulfill({
        json: [
          {
            social_account_id: accountID,
            feature: "engagement",
            effective_enabled: true,
          },
        ],
      }),
    );
    let count = 0;
    await page.route("**/api/v1/engagement?**", (route) =>
      route.fulfill({
        json: {
          items: [],
          total: 0,
          sync_states: [
            "permission_required",
            "temporarily_unavailable",
            "not_found",
            "failed",
          ].flatMap((status) =>
            Array.from({ length: count }, () => ({
              id: randomUUID(),
              rendition_id: randomUUID(),
              social_account_id: accountID,
              platform: "bluesky",
              status,
              error_code: status,
              error_message: "Collection needs attention.",
            })),
          ),
        },
      }),
    );
    for (const affected of [0, 1, 3]) {
      count = affected;
      await page.goto("/inbox/engagement");
      await expect(
        page.getByRole("heading", { name: "You're all caught up", exact: true }),
      ).toBeVisible();
      const trigger = page.getByRole("button", { name: /^Collection issues/ });
      if (affected === 0) {
        await expect(trigger).toHaveCount(0);
        continue;
      }
      await trigger.focus();
      await page.keyboard.press("Enter");
      const popup = page.locator('[data-slot="popover-content"]');
      const posts = affected === 1 ? "1 post" : "3 posts";
      for (const sentence of [
        `Reconnect this account to restore collection for ${posts}.`,
        `OpenPost will retry collection for ${posts}.`,
        `${posts} ${affected === 1 ? "is" : "are"} no longer available from the provider. No action is needed.`,
        `Retry collection for ${posts}. Reconnect the account if it fails again.`,
      ])
        await expect(popup.getByText(sentence, { exact: true })).toHaveCount(1);
      await expect(
        popup.getByRole("link", { name: "Manage accounts", exact: true }),
      ).toHaveAttribute("href", "/settings?tab=accounts");
      await expect(
        popup.getByRole("button", { name: "Refresh engagement", exact: true }),
      ).toHaveCount(2);
      const width = 320;
      await page.setViewportSize({ width, height: 844 });
      // Floating UI repositions the open popup after the viewport resize event.
      await expect.poll(async () => (await popup.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      await expect
        .poll(async () => {
          const bounds = await popup.boundingBox();
          return bounds ? bounds.x + bounds.width : Infinity;
        })
        .toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  });
});

test.describe("inbox empty replies", () => {
  test("stored empty replies explain missing content without claiming deletion or losing actions", async ({
    page,
    request,
  }) => {
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
      if (
        req.url().includes("/api/v1/") &&
        !["GET", "HEAD"].includes(req.method()) &&
        new URL(req.url()).pathname !== "/api/v1/inbox/activity"
      )
        writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inbox/engagement");
    const notice = "No text or attachments are available for this reply.";
    await page.reload();
    const empty = page.locator(`[data-engagement-id='${fixtures[0].id}']`);
    await expect(empty.getByRole("heading", { name: fixtures[0].name })).toBeVisible();
    await empty.scrollIntoViewIfNeeded();
    await expect(empty.getByText(notice, { exact: true })).toBeVisible();
    await expect(
      empty.getByText("This reply was deleted on the social network.", { exact: true }),
    ).toHaveCount(0);
    const reply = empty.getByRole("button", { name: "Reply", exact: true });
    await reply.focus();
    await page.keyboard.press("Enter");
    await expect(empty.getByRole("textbox", { name: "Write a reply…", exact: true })).toBeVisible();
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
    const after = await request.get(endpoint, { headers });
    const current = await after.json();
    // Background feed health can change independently of these stored replies.
    expect(current.items).toEqual(stored.items);
    expect(current.total).toBe(stored.total);
    expect(writes).toEqual([]);
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

test.describe("inbox messages recovery", () => {
  test("Messages distinguishes archived filters from account setup and clears them with the keyboard", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { token } = await registerUser(request, `messages-recovery-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Messages recovery");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','messages-test','bluesky','${accountID}','Audit messages',X'00',1);
       INSERT INTO account_features (social_account_id,workspace_id,feature,enabled,decided_at) VALUES ('${accountID}','${workspace.id}','messaging',1,CURRENT_TIMESTAMP);`,
    ]);
    const headers = { Authorization: `Bearer ${token}` };
    const featuresURL = `/api/v1/account-features?workspace_id=${workspace.id}&account_ids=${accountID}`;
    const featuresBefore = await request.get(featuresURL, { headers });
    expect(featuresBefore.ok()).toBe(true);
    const features = await featuresBefore.json();
    expect(features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          social_account_id: accountID,
          feature: "messaging",
          supported: true,
          effective_enabled: true,
        }),
      ]),
    );
    await authenticatePage(page, token);
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (req) => {
      if (
        req.url().includes("/api/v1/") &&
        !["GET", "HEAD"].includes(req.method()) &&
        new URL(req.url()).pathname !== "/api/v1/inbox/activity"
      )
        writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inbox/messages");
    await expect(
      page.getByRole("heading", { name: "No conversations yet", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("button", { name: "All platforms", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Bluesky", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No matching conversations", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "All accounts", exact: true }).click();
    await page.getByRole("option", { name: /Audit messages/ }).click();
    await page.getByRole("checkbox", { name: "Archived", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox", { name: "Archived", exact: true })).toBeChecked();
    await expect(
      page.getByRole("heading", { name: "No archived conversations", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const reset = page.getByRole("button", { name: "Clear filters", exact: true });
    await reset.focus();
    await expect(reset).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Archived", exact: true })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "All accounts", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No conversations yet", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "All platforms", exact: true })).toHaveText(
      "All platforms",
    );
    await expect(
      page.getByRole("link", { name: "Open account details", exact: true }),
    ).toHaveAttribute("href", "/settings?tab=accounts");
    await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
    const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `UPDATE account_features SET enabled=0 WHERE social_account_id='${accountID}' AND feature='messaging';`,
    ]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Direct messages are off", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("button", { name: "All accounts", exact: true }).click();
    await page.getByRole("option", { name: /Audit messages/ }).click();
    const archivedRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/messages" && url.searchParams.get("archived") === "true";
    });
    await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
    expect((await archivedRead).ok()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Direct messages are off", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open account details", exact: true }),
    ).toHaveAttribute("href", "/settings?tab=accounts");
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `UPDATE account_features SET enabled=1 WHERE social_account_id='${accountID}' AND feature='messaging';`,
    ]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "No conversations yet", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open account details", exact: true }).focus();
    await page.keyboard.press("Enter");
    // Accounts is its own destination now; the old settings link redirects there.
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /@Audit messages.*Bluesky/ })).toBeVisible();
    const featuresAfter = await request.get(featuresURL, { headers });
    expect(featuresAfter.ok()).toBe(true);
    expect(await featuresAfter.json()).toEqual(features);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});
