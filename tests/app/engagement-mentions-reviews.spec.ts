import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("native mentions and reviews retain separate subjects, filters and review controls", async ({
  page,
  request,
}, testInfo) => {
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
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/inbox/engagement");
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
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
      await page.screenshot({
        path: testInfo.outputPath(`all-${width}-${scheme}.png`),
        animations: "disabled",
      });
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
      await expect(
        reviewRow.getByRole("button", { name: "Queue reply", exact: true }),
      ).toBeEnabled();
      // The fixture has an owner reply, so removal may target only that reply.
      await expect(
        reviewRow.getByRole("button", { name: "Remove your reply", exact: true }),
      ).toBeVisible();
      await expect(reviewRow.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`review-${width}-${scheme}.png`),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
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
