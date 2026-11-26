import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.describe("ideate", () => {
  test.use({ reducedMotion: "reduce" });

  const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;

  test("Ideate restores edited alternatives and explicitly selects one draft", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const email = `ideate-${randomUUID()}@example.com`;
    const auth = await registerUser(request, email);
    const workspace = await createWorkspace(request, auth.token, "Ideate review");
    const accountID = randomUUID(),
      buildID = randomUUID();
    const now = new Date().toISOString();
    const direction = {
      canonical_text: "The editor is faster.",
      factual_kernel: ["The editor is faster."],
      thesis: "A faster editor.",
      outcome: "shares",
      audience: "Builders",
      angle: "The improvement",
      route: "thesis_led",
      claims: [],
      media: { treatment: "none", role: "none", brief: "Text is sufficient." },
      destinations: [
        {
          account_id: accountID,
          include: true,
          reason: "Selected by the author.",
        },
      ],
    };
    const options = ["The result", "The observation", "The lesson", "The update"].map(
      (label, index) => ({
        id: `option-${index + 1}`,
        label,
        canonical_text: `${label}: the editor is faster.`,
        direction,
        destinations: [
          {
            account_id: accountID,
            platform: "x",
            objective: "shares",
            archetype: "principle",
            output_profile: "x.post",
            preview: label,
            segments: [{ body: `${label}: the editor is faster.` }],
            media: direction.media,
            claims: [],
            warnings: [],
            follow_up_notes: [],
          },
        ],
        skipped: [],
        review_flags: [],
      }),
    );
    const input = {
      idea: "The editor is faster.",
      option_count: 4,
      direction: {},
      destination_policy: "require_all",
      destinations: [
        {
          account_id: accountID,
          platform: "x",
          label: "Review founder",
          voice: { definition: {} },
          allowed_output_profiles: [
            {
              key: "x.post",
              text_limit: 280,
              max_segments: 1,
              media_max_count: 4,
              allowed_mimes: ["image/*"],
            },
          ],
        },
      ],
    };
    // Stored alternatives cross real authorized reads, durable edits, and draft handoff.
    // Go service regressions separately cover actual generation and stale selection.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `
      INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active)
        VALUES (${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'review-founder',X'00',1);
      INSERT INTO publication_builds (id,workspace_id,created_by_id,state,phase,revision,idempotency_key,request_fingerprint,authority_json,request_json,result_json,created_at,updated_at)
        VALUES (${sql(buildID)},${sql(workspace.id)},(SELECT id FROM users WHERE email=${sql(email)}),'ready','ready',1,${sql(buildID)},'fixture',
          json_object('UserID',(SELECT id FROM users WHERE email=${sql(email)}),'WorkspaceID',${sql(workspace.id)},'AssuredAt',${sql(now)}),
          ${sql(JSON.stringify({ input }))},${sql(JSON.stringify({ canonical_text: "", sources: [], direction, destinations: [], options, skipped: [], review_flags: [] }))},${sql(now)},${sql(now)});
    `,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto(`/ideate?build=${buildID}`);
    const choices = page.getByRole("button", {
      name: "Use this post",
      exact: true,
    });
    await expect(choices).toHaveCount(4);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(choices).toHaveCount(4);
    await page.getByRole("button", { name: "Edit post text", exact: true }).first().click();
    const text = page.getByRole("textbox", { name: "Post text", exact: true });
    await text.fill("The editor now keeps up with me.");
    await expect
      .poll(async () => {
        const response = await request.get(`/api/v1/publication-builds/${buildID}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        return (await response.json()).result.options[0].destinations[0].segments[0].body;
      })
      .toBe("The editor now keeps up with me.");
    await page.reload();
    await expect(page.getByText("The editor now keeps up with me.", { exact: true })).toBeVisible();
    await choices.first().focus();
    await choices.first().press("Enter");
    await expect(page).toHaveURL(/\/publications\//);
    const response = await request.get(`/api/v1/publications/${page.url().split("/").at(-1)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const publication = await response.json();
    expect(publication.status).toBe("draft");
    expect(publication.renditions[0].segments[0].body).toBe("The editor now keeps up with me.");
  });

  test("clients review submitted posts without entering authoring", async ({ page, request }) => {
    const owner = await registerUser(request, `review-owner-${randomUUID()}@example.com`);
    const clientEmail = `review-client-${randomUUID()}@example.com`;
    const reviewer = await registerUser(request, clientEmail);
    const workspace = await createWorkspace(request, owner.token, "Client review");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES(${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'client-brand',X'00',1); INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES(${sql(workspace.id)},(SELECT id FROM users WHERE email=${sql(clientEmail)}),'client','active');`,
    ]);
    const created = await request.post("/api/v1/publications", {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: {
        workspace_id: workspace.id,
        title: "Release approval",
        content_profile: "short_text",
        source_text: "Offline drafts are now available.",
        social_account_ids: [accountID],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const post = await created.json();
    await authenticatePage(page, owner.token);
    await page.goto(`/publications/${post.id}?workspace_id=${workspace.id}`);
    await page.getByRole("button", { name: "Post settings", exact: true }).click();
    await page.getByRole("button", { name: "Send to client", exact: true }).click();
    const ownerReview = page.getByRole("dialog", { name: "Client review", exact: true });
    await expect(
      ownerReview.getByText("Offline drafts are now available.", { exact: true }),
    ).toBeVisible();
    await ownerReview.getByRole("button", { name: "Choose a client", exact: true }).click();
    await page.getByRole("option", { name: clientEmail, exact: true }).click();
    await ownerReview
      .getByRole("textbox", { name: "Note to the client", exact: true })
      .fill("Please check the launch claim.");
    await ownerReview.getByRole("button", { name: "Send to client", exact: true }).click();
    await expect(
      ownerReview.getByText("Awaiting client approval", { exact: true }).first(),
    ).toBeVisible();
    await ownerReview.getByRole("button", { name: "Close", exact: true }).click();
    await authenticatePage(page, reviewer.token);
    await page.goto("/ideate");
    await expect(page).toHaveURL(/\/publications$/);
    await expect(page.getByTestId("ideate-page")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-new-post")).toHaveCount(0);
    await page.goto(`/publications/${post.id}?workspace_id=${workspace.id}`);
    await page.getByRole("button", { name: "Awaiting client approval", exact: true }).click();
    const reviewDialog = page.getByRole("dialog", {
      name: "Client review",
      exact: true,
    });
    await expect(
      reviewDialog
        .getByTestId("composer-account-preview")
        .first()
        .getByText("Offline drafts are now available.", { exact: true }),
    ).toBeVisible();
    await expect(
      reviewDialog.getByRole("button", {
        name: "Approve this version",
        exact: true,
      }),
    ).toBeEnabled();
    await reviewDialog.getByRole("button", { name: "Approve this version", exact: true }).click();
    await expect(reviewDialog.getByText("Client approved", { exact: true }).first()).toBeVisible();
    const checked = await request.get(`/api/v1/publications/${post.id}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const approved = await checked.json();
    expect(approved.review_state).toBe("approved");
    expect(approved.status).toBe("draft");
    expect(
      Number(
        execFileSync(
          "sqlite3",
          [databasePath, `SELECT count(*) FROM jobs WHERE scope_id=${sql(post.id)};`],
          { encoding: "utf8" },
        ).trim(),
      ),
    ).toBe(0);
  });
});

test.describe("custom prompts", () => {
  test("public custom-prompt update preserves identity and rejects other actors and built-ins", async ({
    request,
  }) => {
    const owner = await registerUser(request, `prompt-owner-${randomUUID()}@example.com`);
    const other = await registerUser(request, `prompt-other-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, owner.token, "Prompt update owner");
    const otherWorkspace = await createWorkspace(request, other.token, "Prompt update other");
    const ownerHeaders = { Authorization: `Bearer ${owner.token}` };
    const otherHeaders = { Authorization: `Bearer ${other.token}` };
    const create = await request.post("/api/v1/prompts", {
      headers: ownerHeaders,
      data: {
        workspace_id: workspace.id,
        text: "Original prompt",
        example: "Original example",
        category: "Developer",
      },
    });
    expect(create.ok()).toBe(true);
    const originalResponse = await create.json();
    const { $schema: _schema, ...original } = originalResponse;
    const correction = { text: "Corrected Café 👋\nمرحبا", example: "", category: "Business" };
    const update = await request.put(`/api/v1/prompts/${original.id}`, {
      headers: ownerHeaders,
      data: correction,
    });
    expect(update.status()).toBe(200);
    expect(await update.json()).toEqual({ ...originalResponse, ...correction });
    const listURL = `/api/v1/prompts?workspace_id=${workspace.id}`;
    const listed = await (await request.get(listURL, { headers: ownerHeaders })).json();
    expect(listed.find((prompt: { id: string }) => prompt.id === original.id)).toEqual({
      ...original,
      ...correction,
    });
    const forbidden = await request.put(`/api/v1/prompts/${original.id}`, {
      headers: otherHeaders,
      data: { ...correction, text: "Wrong actor" },
    });
    expect(forbidden.status()).toBe(403);
    const invalid = await request.put(`/api/v1/prompts/${original.id}`, {
      headers: ownerHeaders,
      data: { ...correction, text: "   " },
    });
    expect(invalid.status()).toBe(400);
    const builtin = listed.find((prompt: { is_built_in: boolean }) => prompt.is_built_in);
    expect(builtin).toBeDefined();
    const protectedBuiltin = await request.put(`/api/v1/prompts/${builtin.id}`, {
      headers: ownerHeaders,
      data: correction,
    });
    expect(protectedBuiltin.status()).toBe(400);
    const foreignCreate = await request.post("/api/v1/prompts", {
      headers: otherHeaders,
      data: {
        workspace_id: otherWorkspace.id,
        text: "Foreign prompt",
        example: "",
        category: "Developer",
      },
    });
    expect(foreignCreate.ok()).toBe(true);
    const { $schema: _foreignSchema, ...foreign } = await foreignCreate.json();
    const crossWorkspace = await request.put(`/api/v1/prompts/${foreign.id}`, {
      headers: ownerHeaders,
      data: correction,
    });
    expect(crossWorkspace.status()).toBe(403);
    const after = await (await request.get(listURL, { headers: ownerHeaders })).json();
    expect(after.find((prompt: { id: string }) => prompt.id === original.id)).toEqual({
      ...original,
      ...correction,
    });
    expect(after.find((prompt: { id: string }) => prompt.id === builtin.id)).toEqual(builtin);
    const foreignAfter = await (
      await request.get(`/api/v1/prompts?workspace_id=${otherWorkspace.id}`, {
        headers: otherHeaders,
      })
    ).json();
    expect(foreignAfter.find((prompt: { id: string }) => prompt.id === foreign.id)).toEqual(
      foreign,
    );
  });
});
