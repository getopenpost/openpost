import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

function seedComment(workspaceID: string, publicationID: string) {
  const accountID = randomUUID(),
    renditionID = randomUUID(),
    itemID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `
    PRAGMA foreign_keys=ON;
UPDATE publications SET status='published' WHERE id='${publicationID}';
    INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active,granted_scopes) VALUES('${accountID}','${workspaceID}','${accountID}','instagram','sample-owner','Sample studio',X'00',1,'instagram_manage_comments,pages_read_engagement');
    INSERT INTO account_features(social_account_id,workspace_id,feature,enabled,decided_at) VALUES('${accountID}','${workspaceID}','engagement',1,CURRENT_TIMESTAMP);
    INSERT INTO renditions(id,publication_id,social_account_id,target_key,platform,profile,status,external_id) VALUES('${renditionID}','${publicationID}','${accountID}','instagram','instagram','reel','published','sample-reel');
    INSERT INTO engagement_items(id,workspace_id,rendition_id,social_account_id,platform,remote_id,conversation_remote_id,author_remote_id,author_name,body,can_reply,last_seen_at,remote_created_at) VALUES('${itemID}','${workspaceID}','${renditionID}','${accountID}','instagram','${itemID}','sample-reel','sample-reader','Sample reader','GRIND please!',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  `,
  ]);
  return { accountID, renditionID, itemID };
}

test("a Reel campaign starts with focused setup, previews safely and saves separate private/public steps", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const auth = await registerUser(request, `comment-campaign-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Comment campaigns");
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Sample playbook Reel",
  );
  const { accountID, renditionID } = seedComment(workspace.id, publication.id);
  const errors: string[] = [],
    dispatches: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/(publish|run|test-node|actions)(?:\?|$)/.test(req.url()))
      dispatches.push(req.url());
  });
  await authenticatePage(page, auth.token);
  await page.goto(
    `/workflows?template=instagram-playbook&account_id=${accountID}&rendition_id=${renditionID}`,
  );
  const setup = page.getByRole("region", { name: "Set up comment replies" });
  await expect(setup).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".svelte-flow")).toHaveCount(0);
  await expect(page.getByLabel("Keywords or phrases", { exact: true })).toHaveValue("GRIND");
  const create = page.getByRole("button", { name: "Create workflow draft", exact: true });
  await expect(create).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("comment-campaign-before.png"),
    fullPage: true,
  });
  await page.getByLabel("Saved response", { exact: true }).fill("🔥".repeat(251));
  await expect(create).toBeDisabled();
  await expect(setup.getByRole("alert")).toContainText("1,000 UTF-8 bytes");
  await page
    .getByLabel("Saved response", { exact: true })
    .fill("Here is the full playbook: https://example.com/playbook");
  await expect(create).toBeEnabled();
  await page.getByRole("button", { name: "Preview", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(setup.locator("blockquote")).toContainText("GRIND please!");
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect(page.locator("body")).toHaveJSProperty(
        "scrollWidth",
        await page.locator("body").evaluate((el) => el.clientWidth),
      );
      await setup.locator("h2").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`comment-campaign-${width}-${scheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/api\/v1\/workflows\?/.test(response.url()),
  );
  await create.click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  expect(workflow.enabled).toBe(false);
  expect(workflow.definition.source).toMatchObject({
    kind: "comment_received",
    account_ids: [accountID],
    rendition_ids: [renditionID],
    keywords: ["GRIND"],
    post_scope: "selected",
  });
  expect(workflow.definition.steps.map((step: { kind: string }) => step.kind)).toEqual([
    "private_comment_reply",
    "comment_reply",
  ]);
  expect(workflow.definition.steps[0].inputs.text.literal).toBe(
    "Here is the full playbook: https://example.com/playbook",
  );
  expect(workflow.definition.steps[1].inputs.text.literal).toBe("Sent! Check your messages.");
  expect(dispatches).toEqual([]);
  expect(errors).toEqual([]);
});

test("Inbox review keeps the edited private reply and takeover cancels the waiting run", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `comment-review-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Reply review");
  const publication = await createPublication(request, auth.token, workspace.id, "Review Reel");
  const { itemID } = seedComment(workspace.id, publication.id);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Review private playbook",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "reply",
            name: "Send private playbook",
            kind: "private_comment_reply",
            inputs: {
              engagement_id: { literal: itemID },
              text: { literal: "Original playbook message" },
              delivery: { literal: "review" },
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  // The browser server has no Meta app configured. Seed a stored proposal;
  // native admission and delivery are exercised with provider adapters in Go.
  const run = { id: randomUUID() };
  const replyID = randomUUID();
  const sql = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const inputs = { engagement_id: itemID, text: "Original playbook message", delivery: "review" };
  const results = [
    {
      step_id: "reply",
      kind: "private_comment_reply",
      name: "Send private playbook",
      state: "awaiting_approval",
      inputs,
      output: {
        engagement_id: itemID,
        status: "awaiting_review",
        text: inputs.text,
        channel: "private",
      },
    },
  ];
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `
    PRAGMA foreign_keys=ON;
    INSERT INTO workflow_runs(id,workflow_id,workspace_id,workflow_name,workflow_revision,revision,mode,state,definition_json,authority_json,source_json,remaining_json,results_json,current_step_id,created_at,updated_at)
    VALUES('${run.id}','${workflow.id}','${workspace.id}','Review private playbook',1,1,'live','awaiting_approval',${sql(JSON.stringify(workflow.definition))},'{}',${sql(JSON.stringify({ engagement_id: itemID }))},${sql(JSON.stringify(workflow.definition.steps))},${sql(JSON.stringify(results))},'reply',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO engagement_automation_replies(id,workspace_id,item_id,workflow_id,run_id,step_id,user_id,channel,body,item_body,state,created_at,updated_at)
    VALUES('${replyID}','${workspace.id}','${itemID}','${workflow.id}','${run.id}','reply',(SELECT created_by FROM publications WHERE id='${publication.id}'),'private','Original playbook message','GRIND please!','awaiting_review',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  `,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto("/inbox/engagement");
  await page.locator("summary").filter({ hasText: "Reply waiting for review" }).click();
  const textarea = page.getByLabel("Saved response", { exact: true });
  await expect(textarea).toHaveValue("Original playbook message");
  await textarea.fill("Edited playbook message");
  let approvalBody: unknown;
  await page.route(`**/api/v1/workflow-runs/${run.id}/approve?**`, async (route) => {
    approvalBody = route.request().postDataJSON();
    await route.fulfill({
      status: 409,
      json: { detail: "This review changed. Refresh and try again." },
    });
  });
  await page.getByRole("button", { name: "Approve reply", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This review changed");
  expect(approvalBody).toMatchObject({ reply_text: "Edited playbook message" });
  await expect(textarea).toHaveValue("Edited playbook message");
  await page.setViewportSize({ width: 390, height: 1000 });
  await textarea.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("comment-review-phone.png"), fullPage: true });
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/workflow-runs/${run.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json()
        ).state,
    )
    .toBe("cancelled");
  await expect(
    page.locator("summary").filter({ hasText: "Automatic replies stopped" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("comment-takeover-phone.png"),
    fullPage: true,
  });
});
