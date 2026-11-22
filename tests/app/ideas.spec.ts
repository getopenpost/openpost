import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, expectPostText } from "./helpers";

test.describe("ideate", () => {
  test.use({ reducedMotion: "reduce" });

  const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;

  test("Ideate starts a new generation after the previous build is cancelled", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `ideate-cancel-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Ideate restart");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active)
        VALUES (${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'restart-founder',X'00',1);`,
    ]);
    const receipts = new Map<
      string,
      {
        id: string;
        workspace_id: string;
        state: string;
        phase: string;
        revision: number;
      }
    >();
    const createdIDs: string[] = [];
    // Preserve the server's idempotent receipt behavior without paying for generation.
    await page.route("**/api/v1/publication-builds", async (route) => {
      const key = route.request().headers()["idempotency-key"];
      let build = receipts.get(key);
      if (!build) {
        build = {
          id: randomUUID(),
          workspace_id: workspace.id,
          state: "queued",
          phase: "queued",
          revision: 1,
        };
        receipts.set(key, build);
      }
      createdIDs.push(build.id);
      await route.fulfill({ json: build });
    });
    await page.route("**/api/v1/publication-builds/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const build = [...receipts.values()].find((value) => path.includes(value.id));
      expect(build).toBeDefined();
      if (path.endsWith("/cancel")) {
        build!.state = "cancelled";
        build!.phase = "cancelled";
        build!.revision++;
      }
      await route.fulfill({ json: build });
    });
    await authenticatePage(page, auth.token);
    await page.goto("/ideate");
    await page.getByRole("textbox").first().fill("The editor keeps source audio.");
    await page.getByTestId("composer-account-control").click();
    await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
    await page.keyboard.press("Escape");
    const generate = page.getByRole("button", {
      name: "Generate options",
      exact: true,
    });
    await generate.click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(() => createdIDs.length).toBe(2);
    expect(createdIDs[1]).not.toBe(createdIDs[0]);
    await expect(cancel).toBeVisible();
    await page.goto("/ideate");
    await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
    await expect(page.getByTestId("ideate-page")).toBeVisible();
  });

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

  for (const closeDuringGeneration of [false, true]) {
    test(
      closeDuringGeneration
        ? "a selected series keeps generating when Ideate closes"
        : "a series generates only selected concepts and saves drafts explicitly",
      async ({ page, request }) => {
        const email = `series-${randomUUID()}@example.com`;
        const auth = await registerUser(request, email);
        const workspace = await createWorkspace(request, auth.token, "Series review");
        const parentID = randomUUID(),
          accountID = randomUUID(),
          childIDs = [randomUUID(), randomUUID()];
        const concepts = [
          {
            id: "post-1",
            revision: 1,
            title: "The release",
            brief: "Announce offline drafts",
            evidence: "Offline drafts shipped",
            source_refs: ["idea"],
            child_build_id: "",
          },
          {
            id: "post-2",
            revision: 1,
            title: "The decision",
            brief: "Explain the local persistence decision",
            evidence: "The founder chose local persistence",
            source_refs: ["idea"],
            child_build_id: "",
          },
        ];
        const direction = {
          canonical_text: "Offline drafts shipped.",
          factual_kernel: ["Offline drafts shipped."],
          thesis: "Offline drafts",
          outcome: "shares",
          audience: "Founders",
          angle: "The release",
          route: "thesis_led",
          claims: [],
          media: {
            treatment: "none",
            role: "none",
            brief: "Text is sufficient.",
          },
          destinations: [{ account_id: accountID, include: true, reason: "Author selected" }],
        };
        const input = {
          idea: "Offline drafts shipped. We chose local persistence.",
          series_count: 3,
          direction: {},
          destination_policy: "require_all",
          destinations: [
            {
              account_id: accountID,
              platform: "x",
              label: "Founder",
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
        const parentResult = {
          series: concepts,
          sources: [],
          options: [],
          destinations: [],
          direction,
          skipped: [],
          review_flags: [],
        };
        const seed = (id: string, storedInput: unknown, result: unknown, origin?: unknown) =>
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            databasePath,
            `INSERT INTO publication_builds(id,workspace_id,created_by_id,state,phase,revision,idempotency_key,request_fingerprint,authority_json,request_json,result_json,created_at,updated_at) VALUES(${sql(id)},${sql(workspace.id)},(SELECT id FROM users WHERE email=${sql(email)}),'ready','ready',1,${sql(id)},'fixture',json_object('UserID',(SELECT id FROM users WHERE email=${sql(email)}),'WorkspaceID',${sql(workspace.id)},'AssuredAt',${sql(new Date().toISOString())}),${sql(JSON.stringify({ input: storedInput, series_origin: origin, source_snapshot: { sources: [] } }))},${sql(JSON.stringify(result))},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`,
          ]);
        execFileSync("sqlite3", [
          "-cmd",
          ".timeout 5000",
          databasePath,
          `INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES(${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'series-founder',X'00',1);`,
        ]);
        seed(parentID, input, parentResult);
        const generated: string[] = [];
        let releaseGeneration = () => {};
        const generationGate = new Promise<void>((resolve) => {
          releaseGeneration = resolve;
        });
        // The generation boundary supplies a deterministic ready child. Reads,
        // concept edits and draft commits still go through the actual server.
        await page.route(`**/publication-builds/${parentID}/series/*/generate`, async (route) => {
          const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
          generated.push(id);
          if (!closeDuringGeneration) expect(id).toBe("post-1");
          const index = id === "post-1" ? 0 : 1;
          const childID = childIDs[index];
          if (closeDuringGeneration && index === 0) await generationGate;
          const parentResponse = await request.get(`/api/v1/publication-builds/${parentID}`, {
            headers: { Authorization: `Bearer ${auth.token}` },
          });
          const parent = await parentResponse.json();
          expect(parent.result.series[0].brief).toBe("Explain how founders can draft offline");
          const option = {
            id: "post",
            label: "Offline drafts",
            canonical_text: "Write your next update offline.",
            direction,
            destinations: [
              {
                account_id: accountID,
                platform: "x",
                objective: "shares",
                archetype: "principle",
                output_profile: "x.post",
                preview: "Offline drafts",
                segments: [{ body: "Write your next update offline." }],
                media: direction.media,
                claims: [],
                warnings: [],
                follow_up_notes: [],
              },
            ],
            skipped: [],
            review_flags: [],
          };
          seed(
            childID,
            { ...input, series_count: 0, option_count: 0 },
            {
              canonical_text: option.canonical_text,
              direction,
              destinations: option.destinations,
              options: [option],
              sources: [],
              skipped: [],
              review_flags: [],
            },
            {
              build_id: parentID,
              item_id: id,
              item_revision: parent.result.series[index].revision,
            },
          );
          parent.result.series[index].child_build_id = childID;
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            databasePath,
            `UPDATE publication_builds SET result_json=${sql(JSON.stringify(parent.result))},revision=revision+1 WHERE id=${sql(parentID)};`,
          ]);
          const child = await request.get(`/api/v1/publication-builds/${childID}`, {
            headers: { Authorization: `Bearer ${auth.token}` },
          });
          await route.fulfill({ json: await child.json() });
        });
        await authenticatePage(page, auth.token);
        await page.goto(`/ideate?build=${parentID}`);
        let dialog = page.getByTestId("ideate-page");
        await expect(dialog.getByLabel("Direction for this post")).toHaveCount(2);
        await dialog
          .getByLabel("Direction for this post")
          .first()
          .fill("Explain how founders can draft offline");
        if (!closeDuringGeneration)
          await dialog.getByRole("checkbox", { name: "The decision", exact: true }).uncheck();
        await dialog.getByRole("button", { name: "Generate selected posts", exact: true }).click();
        if (closeDuringGeneration) {
          await expect.poll(() => generated.length).toBe(1);
          // Leaving the Ideas page keeps the build running and offers to resume it.
          await page
            .getByTestId("sidebar-workspace-navigation")
            .getByRole("button", { name: "Posts", exact: true })
            .click();
          releaseGeneration();
          await expect.poll(() => generated.length).toBe(2);
          await expect(page.getByTestId("ideate-page")).toHaveCount(0);
          await page.getByRole("button", { name: /Ideate ·/ }).click();
          dialog = page.getByRole("dialog", { name: "Ideate", exact: true });
        }
        await expect(dialog.getByRole("button", { name: "Edit post", exact: true })).toHaveCount(
          closeDuringGeneration ? 2 : 1,
        );
        expect(generated).toEqual(closeDuringGeneration ? ["post-1", "post-2"] : ["post-1"]);
        const count = () =>
          Number(
            execFileSync(
              "sqlite3",
              [
                databasePath,
                `SELECT count(*) FROM publications WHERE workspace_id=${sql(workspace.id)};`,
              ],
              { encoding: "utf8" },
            ).trim(),
          );
        expect(count()).toBe(0);
        await dialog.getByRole("button", { name: "Save selected drafts", exact: true }).click();
        await expect(dialog.getByRole("link", { name: "Open draft", exact: true })).toHaveCount(
          closeDuringGeneration ? 2 : 1,
        );
        expect(count()).toBe(closeDuringGeneration ? 2 : 1);
        const saved = JSON.parse(
          execFileSync(
            "sqlite3",
            [
              "-json",
              databasePath,
              `SELECT status,metadata_json FROM publications WHERE workspace_id=${sql(workspace.id)};`,
            ],
            { encoding: "utf8" },
          ),
        );
        expect(saved[0].status).toBe("draft");
        expect(JSON.parse(saved[0].metadata_json).series.build_id).toBe(parentID);
        await expect(
          dialog.getByRole("button", { name: "Schedule selected", exact: true }),
        ).toBeEnabled();
      },
    );
  }

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

  test("selected drafts preview dates before scheduling and recover the confirmed result", async ({
    page,
    request,
  }) => {
    const email = `batch-${randomUUID()}@example.com`;
    const auth = await registerUser(request, email);
    const workspace = await createWorkspace(request, auth.token, "Batch review");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `INSERT INTO oauth_grants(id,workspace_id,provider,access_token_encrypted,granted_scopes,validated_at,validation_status) VALUES(${sql(accountID)},${sql(workspace.id)},'threads',X'00','threads_basic threads_content_publish',CURRENT_TIMESTAMP,'valid');
        INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active,oauth_grant_id,granted_scopes) VALUES(${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'threads',${sql(accountID)},'batch-founder',X'00',1,${sql(accountID)},'threads_basic threads_content_publish');`,
    ]);
    const ids: string[] = [];
    for (const title of ["First release", "Follow-up lesson"]) {
      const response = await request.post("/api/v1/publications", {
        headers: { Authorization: `Bearer ${auth.token}` },
        data: {
          workspace_id: workspace.id,
          title,
          source_text: title,
          content_profile: "short_text",
          social_account_ids: [accountID],
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      ids.push((await response.json()).id);
    }
    const jobs = () =>
      Number(
        execFileSync(
          "sqlite3",
          [
            databasePath,
            `SELECT count(*) FROM jobs WHERE scope_id IN (${ids.map(sql).join(",")});`,
          ],
          { encoding: "utf8" },
        ).trim(),
      );
    await authenticatePage(page, auth.token);
    await page.goto("/publications?tab=drafts");
    await page.getByRole("button", { name: "Select drafts", exact: true }).click();
    const selected = page.getByRole("checkbox", {
      name: "Select post for scheduling",
      exact: true,
    });
    await expect(selected).toHaveCount(2);
    await selected.nth(0).check();
    await selected.nth(1).check();
    await page.setViewportSize({ width: 320, height: 900 });
    const heading = await page.getByRole("heading", { name: "Posts", exact: true }).boundingBox();
    expect(heading?.height).toBeLessThan(60);
    await page.getByRole("button", { name: "Schedule selected", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Preview dates", exact: true }).click();
    await expect(dialog.getByText("First release", { exact: true })).toBeVisible();
    expect(jobs()).toBe(0);
    const firstTime = dialog.getByLabel("Time: First release", { exact: true });
    const customTime = `${(await firstTime.inputValue()).split("T")[0]}T13:35`;
    await firstTime.fill(customTime);
    await firstTime.press("Tab");
    const include = dialog.getByRole("checkbox", {
      name: "Select post for scheduling: Follow-up lesson",
      exact: true,
    });
    await include.uncheck();
    await expect(firstTime).toHaveValue(customTime);
    await include.check();
    await dialog.getByRole("button", { name: "Confirm remaining dates", exact: true }).click();
    await expect(dialog.getByText("Scheduled", { exact: true })).toHaveCount(2);
    expect(jobs()).toBe(2);
    const scheduled = await request.get(`/api/v1/publications/${ids[0]}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(new Date((await scheduled.json()).scheduled_at).toISOString()).toBe(
      `${customTime}:00.000Z`,
    );
  });
});

test.describe("custom prompts", () => {
  test("custom prompt corrections persist without authoring a post", async ({ page, request }) => {
    const auth = await registerUser(request, `prompt-edit-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Custom prompt editing");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const categoriesResult = await request.get("/api/v1/prompts/categories", { headers });
    expect(categoriesResult.ok()).toBe(true);
    const { categories } = await categoriesResult.json();
    const created = await request.post("/api/v1/prompts", {
      headers,
      data: {
        workspace_id: workspace.id,
        text: "Audit original typo",
        example: "Audit original example",
        category: categories[0],
      },
    });
    expect(created.ok()).toBe(true);
    let stored = await created.json();
    const originalID = stored.id;
    const originalCreatedAt = stored.created_at;
    const errors: string[] = [];
    let injectedFailure = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const expectedFailure =
        injectedFailure &&
        message.location().url.endsWith(`/api/v1/prompts/${originalID}`) &&
        message.text().includes("503 (Service Unavailable)");
      if (!expectedFailure) errors.push(message.text());
    });
    await authenticatePage(page, auth.token);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/prompts");
    await page.reload();
    const card = page.getByRole("article").filter({ hasText: stored.text });
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const edit = card.getByRole("button", { name: "Edit prompt", exact: true });
    await expect(edit).toBeVisible();
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit prompt", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Prompt text", exact: true })).toHaveValue(
      stored.text,
    );
    await expect(dialog.getByRole("textbox", { name: "Example post", exact: true })).toHaveValue(
      stored.example,
    );
    await dialog.getByRole("textbox", { name: "Prompt text", exact: true }).fill("   ");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.click();
    const text = `Audit correction Café 👋\nمرحبا بالعالم`;
    const example = `Audit example\nSecond line with "quotes".`;
    const category = categories[1];
    await dialog.getByRole("textbox", { name: "Prompt text", exact: true }).fill(text);
    await dialog.getByRole("textbox", { name: "Example post", exact: true }).fill(example);
    await dialog.getByRole("button", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: category, exact: true }).click();
    const updateURL = `**/api/v1/prompts/${originalID}`;
    await page.route(updateURL, async (route) => {
      injectedFailure = true;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          title: "Service Unavailable",
          status: 503,
          detail: "Audit save failed",
        }),
      });
    });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Audit save failed", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Prompt text", exact: true })).toHaveValue(
      text,
    );
    await expect(dialog.getByRole("textbox", { name: "Example post", exact: true })).toHaveValue(
      example,
    );
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    const unchanged = await (
      await request.get(`/api/v1/prompts?workspace_id=${workspace.id}`, { headers })
    ).json();
    expect(unchanged.find((prompt: { id: string }) => prompt.id === originalID)).toMatchObject({
      id: originalID,
      text: stored.text,
      example: stored.example,
      category: stored.category,
    });
    await page.unroute(updateURL);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/prompts/${originalID}` &&
        response.request().method() === "PUT",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect((await saved).ok()).toBe(true);
    await expect(dialog).toHaveCount(0);
    const list = await request.get(`/api/v1/prompts?workspace_id=${workspace.id}`, { headers });
    expect(list.ok()).toBe(true);
    const custom = (await list.json()).filter(
      (prompt: { is_built_in: boolean }) => !prompt.is_built_in,
    );
    expect(custom).toHaveLength(1);
    stored = custom[0];
    expect(stored).toMatchObject({
      id: originalID,
      created_at: originalCreatedAt,
      text,
      example,
      category,
    });
    expect(
      await (
        await request.get(`/api/v1/publications?workspace_id=${workspace.id}`, { headers })
      ).json(),
    ).toEqual([]);
    await page.reload();
    const finalCard = page.getByRole("article").filter({ hasText: stored.text });
    await expect(finalCard).toBeVisible();
    await finalCard.getByRole("button", { name: "Edit prompt", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: "Edit prompt", exact: true });
    await expect(reopened.getByRole("textbox", { name: "Example post", exact: true })).toHaveValue(
      stored.example,
    );
    await page.keyboard.press("Escape");
    await expect(reopened).toHaveCount(0);
    expect(errors).toEqual([]);
  });

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

test.describe("random prompt", () => {
  test("Random reveals an idea and only an explicit New post authors its example", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `random-prompt-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Random prompt preview");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const postsURL = `/api/v1/publications?workspace_id=${workspace.id}`;
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
    await authenticatePage(page, auth.token);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/prompts");
    let selected: { text: string; example: string } | undefined;
    await page.reload();
    const random = page.getByRole("button", { name: "Random", exact: true });
    const response = page.waitForResponse(
      (res) => new URL(res.url()).pathname === "/api/v1/prompts/random",
    );
    await random.focus();
    await page.keyboard.press("Enter");
    const chosen = await response;
    expect(chosen.ok()).toBe(true);
    selected = await chosen.json();
    await expect(page).toHaveURL(/\/prompts$/);
    const preview = page.getByRole("region", { name: "Writing prompt", exact: true });
    await expect(preview.getByText(selected!.text, { exact: true })).toBeVisible();
    await expect(preview.getByText(selected!.example, { exact: true })).toBeVisible();
    await expect(preview.getByRole("button", { name: "New post", exact: true })).toBeVisible();
    await expect(random).toBeFocused();
    await expect(preview).toBeInViewport();
    expect(await (await request.get(postsURL, { headers })).json()).toEqual([]);
    expect(writes).toEqual([]);
    const categoriesResponse = await request.get("/api/v1/prompts/categories", { headers });
    expect(categoriesResponse.ok()).toBe(true);
    const { categories } = await categoriesResponse.json();
    const category = categories[0];
    await page.getByRole("button", { name: "All categories", exact: true }).click();
    await page.getByRole("option", { name: category, exact: true }).click();
    await expect(page.getByRole("region", { name: "Writing prompt", exact: true })).toHaveCount(0);
    const filteredResponse = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        url.pathname === "/api/v1/prompts/random" && url.searchParams.get("category") === category
      );
    });
    await page.getByRole("button", { name: "Random", exact: true }).click();
    const filtered = await filteredResponse;
    expect(filtered.ok()).toBe(true);
    selected = await filtered.json();
    await expect(
      page
        .getByRole("region", { name: "Writing prompt", exact: true })
        .getByText(selected!.text, { exact: true }),
    ).toBeVisible();
    expect(await (await request.get(postsURL, { headers })).json()).toEqual([]);
    expect(writes).toEqual([]);
    const author = page
      .getByRole("region", { name: "Writing prompt", exact: true })
      .getByRole("button", { name: "New post", exact: true });
    await author.focus();
    await page.keyboard.press("Enter");
    await expectPostText(
      page.getByRole("textbox", { name: "Post text", exact: true }),
      selected!.example,
    );
    await expect
      .poll(async () => (await (await request.get(postsURL, { headers })).json()).length)
      .toBe(1);
    const [post] = await (await request.get(postsURL, { headers })).json();
    expect(post.status).toBe("draft");
    expect(post.source_text).toBe(selected!.example);
    expect(errors).toEqual([]);
  });
});
