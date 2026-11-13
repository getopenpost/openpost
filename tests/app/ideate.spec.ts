import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ reducedMotion: "reduce" });

async function captureResponsive(page: Page, info: TestInfo, name: string) {
  for (const width of [1280, 320])
    for (const scheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`${name}-${width}-${scheme}.png`),
        animations: "disabled",
      });
    }
}

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
}, info) => {
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
  for (const width of [1280, 320])
    for (const scheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(choices).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`ideate-${width}-${scheme}.png`),
      });
    }
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
  await page.screenshot({ path: info.outputPath("ideate-edited.png") });
  await choices.first().focus();
  await choices.first().press("Enter");
  await expect(page).toHaveURL(/\/publications\//);
  const response = await request.get(`/api/v1/publications/${page.url().split("/").at(-1)}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const publication = await response.json();
  expect(publication.status).toBe("draft");
  expect(publication.renditions[0].segments[0].body).toBe("The editor now keeps up with me.");
  await page.context().storageState({ path: info.outputPath("browser-state.json") });
});

for (const closeDuringGeneration of [false, true]) {
  test(
    closeDuringGeneration
      ? "a selected series keeps generating when Ideate closes"
      : "a series generates only selected concepts and saves drafts explicitly",
    async ({ page, request }, info) => {
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
      await captureResponsive(page, info, "series-ready");
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

test("clients review submitted posts without entering authoring", async ({
  page,
  request,
}, info) => {
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
  await captureResponsive(page, info, "client-review");
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
}, info) => {
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
        [databasePath, `SELECT count(*) FROM jobs WHERE scope_id IN (${ids.map(sql).join(",")});`],
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
  await captureResponsive(page, info, "batch-preview");
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
