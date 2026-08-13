import { expect, test, type Locator } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function expectMinimumTouchTarget(locator: Locator, name: string) {
  await expect(locator, `${name} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${name} should have a measurable touch target`).not.toBeNull();
  expect(
    box!.width,
    `${name} should be at least 44px wide`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box!.height,
    `${name} should be at least 44px tall`,
  ).toBeGreaterThanOrEqual(44);
}

test("mobile shell and composer expose touch-first controls without overflow", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `mobile-shell-${unique}@example.com`,
  );
  const firstWorkspace = `Mobile UX ${unique}`;
  const secondWorkspace = `Client UX ${unique}`;
  await createWorkspace(request, auth.token, firstWorkspace);
  await createWorkspace(request, auth.token, secondWorkspace);
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "mobile-bluesky",
          platform: "bluesky",
          account_id: "mobile-bluesky",
          account_username: "openpost_mobile",
          is_active: true,
        },
      ],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const languageSetting = {
      key: "languages",
      message_key: "publishing.setting.languages",
      label: "Languages",
      group: "distribution",
      control: "tag_input",
      type: "tags",
      scope: "destination",
      intents: ["post"],
      output_profiles: ["bluesky.post"],
      media_shapes: ["text"],
      required: false,
      required_policy: "never",
      constraints: {},
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: [
          {
            account_id: "mobile-bluesky",
            provider: "bluesky",
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
            text_limit: 300,
            media: {
              min_count: 0,
              max_count: 4,
              allowed_mimes: [],
              requires_public_url: false,
              requires_https_fetchable: false,
            },
            intents: ["post"],
            media_shapes: ["text"],
            settings: [languageSetting],
            setting_groups: [
              { key: "distribution", settings: [languageSetting] },
            ],
            compatible: true,
            active_constraints: {},
            issues: [],
            capability_revision: "test-v1",
            dynamic_options: {},
            immediate_readiness: { state: "healthy", publishable: true },
            scheduled_readiness: { state: "healthy", publishable: true },
          },
        ],
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Toggle Sidebar" }),
  ).toHaveCount(0);
  await expect(page.getByText("OpenPost", { exact: true })).toHaveCount(0);
  const more = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "More", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Accounts" }),
  ).toHaveAttribute("href", "/settings?tab=accounts");
  await expect(
    page.getByRole("menuitem", { name: "Settings" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    page.getByRole("menuitem", { name: /Appearance/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Interface sounds" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Language/ })).toBeVisible();
  const workspaceNames = [firstWorkspace, secondWorkspace];
  const workspaceTrigger = page.getByRole("menuitem", {
    name: new RegExp(`(?:${workspaceNames.join("|")}).*Switch workspace`),
  });
  const workspaceTriggerText = await workspaceTrigger.innerText();
  const currentWorkspace = workspaceNames.find((name) =>
    workspaceTriggerText.includes(name),
  );
  expect(currentWorkspace).toBeTruthy();
  const nextWorkspace =
    currentWorkspace === firstWorkspace ? secondWorkspace : firstWorkspace;
  await expect(workspaceTrigger).toHaveAttribute("aria-expanded", "false");
  await workspaceTrigger.click();
  await expect(workspaceTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem", { name: "Accounts" })).toBeVisible();
  await page
    .getByRole("group", { name: "Switch workspace" })
    .getByRole("menuitem", { name: new RegExp(nextWorkspace) })
    .click();
  await more.click();
  await expect(
    page.getByRole("menuitem", { name: new RegExp(nextWorkspace) }),
  ).toContainText(nextWorkspace);
  await page.keyboard.press("Escape");

  const controls = page.getByTestId("mobile-composer-controls");
  await expect(controls).toBeVisible();
  const overflow = await controls.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    childRightEdges: Array.from(element.querySelectorAll("button")).map(
      (child) => child.getBoundingClientRect().right,
    ),
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(Math.max(...overflow.childRightEdges)).toBeLessThanOrEqual(390);

  await expect(page.getByTestId("composer-account-control")).toHaveCount(1);
  const newPostAction = page.getByRole("button", {
    name: "New",
    exact: true,
  });
  await newPostAction.click();
  await newPostAction.click();
  await expect(page.getByTestId("composer-account-control")).toHaveCount(1);
  await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
  const actions = controls.getByTestId("composer-action-controls");
  await expect(actions).toBeVisible();
  await expect(
    actions.getByRole("button", { name: "Publish Now", exact: true }),
  ).toHaveCount(1);
  await expect(
    actions.getByRole("button", { name: "Schedule", exact: true }),
  ).toHaveCount(1);
  await expect(
    actions.getByRole("button", {
      name: "Schedule to next free slot",
      exact: true,
    }),
  ).toHaveCount(1);

  await expectMinimumTouchTarget(
    page.getByRole("button", { name: "Add media" }).first(),
    "media picker button",
  );
  await expect(
    controls.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await expectMinimumTouchTarget(
    actions.getByRole("button", { name: "Schedule", exact: true }),
    "schedule button",
  );
  await expectMinimumTouchTarget(
    actions.getByRole("button", {
      name: "Schedule to next free slot",
      exact: true,
    }),
    "quick schedule button",
  );

  await expect(
    page.locator(
      '[data-testid="mobile-rendition-all"], [data-testid="mobile-rendition-account"]',
    ),
  ).toHaveCount(0);

  const accountControl = page.getByTestId("composer-account-control");
  await expectMinimumTouchTarget(accountControl, "account control");
  await expect(accountControl.getByTestId("composer-account-icon")).toHaveCount(
    1,
  );
  await accountControl.click();
  const accountRow = page.getByTestId("composer-account-row");
  await expect(accountRow).toHaveCount(1);
  await expect(accountRow).toContainText("openpost_mobile");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /openpost_mobile/ }).click();
  await expectMinimumTouchTarget(
    page.getByRole("button", { name: "Platform settings" }),
    "destination settings",
  );
  await page.getByRole("button", { name: "Platform settings" }).click();
  const settingsDialog = page.getByRole("dialog");
  await expect(
    settingsDialog.getByRole("heading", { name: "Bluesky settings" }),
  ).toBeVisible();
  const settingsBox = await settingsDialog.boundingBox();
  expect(settingsBox?.height).toBeGreaterThanOrEqual(800);
  await settingsDialog.getByRole("button", { name: "Done" }).click();

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(controls).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const compactOverflow = await controls.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    childRightEdges: Array.from(element.querySelectorAll("button")).map(
      (child) => child.getBoundingClientRect().right,
    ),
  }));
  expect(compactOverflow.scrollWidth).toBeLessThanOrEqual(
    compactOverflow.clientWidth,
  );
  expect(Math.max(...compactOverflow.childRightEdges)).toBeLessThanOrEqual(320);
  await expectMinimumTouchTarget(accountControl, "compact account control");
  await expectMinimumTouchTarget(
    actions.getByRole("button", { name: "Schedule", exact: true }),
    "compact schedule button",
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopControls = page.getByTestId("desktop-composer-controls");
  await expect(desktopControls).toBeVisible();
  await expect(page.getByTestId("composer-account-control")).toHaveCount(1);
  const desktopActions = desktopControls.getByTestId(
    "composer-action-controls",
  );
  await expect(desktopActions).toBeVisible();
  await expect(
    desktopActions.getByRole("button", { name: "Publish Now", exact: true }),
  ).toHaveCount(1);
  await expect(
    desktopActions.getByRole("button", { name: "Schedule", exact: true }),
  ).toHaveCount(1);
  await expect(
    desktopControls.getByRole("button", {
      name: "Schedule to next free slot",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("attached media controls stay touch accessible on mobile and desktop", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `mobile-media-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Mobile Media E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);

  await page.goto("/media");
  await page.getByRole("button", { name: "Add media" }).first().click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: "mobile-actions.png",
    mimeType: "image/png",
    buffer: Buffer.concat([tinyPNG, Buffer.from(unique)]),
  });
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  await expect(uploadDialog).toHaveCount(0, { timeout: 15_000 });

  const mediaResponse = await request.get(
    `/api/v1/media?workspace_id=${workspace.id}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
  expect(mediaResponse.ok()).toBeTruthy();
  const media = (await mediaResponse.json()) as {
    media: Array<{ id: string }>;
  };
  const draftResponse = await request.post("/api/v1/posts", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      content: "Media accessibility check",
      social_account_ids: [],
      media_ids: [media.media[0].id],
    },
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draft = (await draftResponse.json()) as {
    id: string;
    publication_id: string;
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/posts/${draft.id}`);
  await expect(page).toHaveURL(new RegExp(`/posts/${draft.id}$`));
  const actions = page.getByTestId("composer-media-actions");
  await expect(actions).toBeVisible();
  const removeMedia = page.getByRole("button", { name: "Remove media" });
  await expectMinimumTouchTarget(removeMedia, "remove media button");
  await page.getByRole("button", { name: "Add alt text" }).click();
  const altText = page.getByRole("textbox", { name: "Alt text" });
  await expect(altText).toBeVisible();
  await altText.fill("A single-pixel accessibility fixture.");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(actions).toBeVisible();
  await expect(altText).toHaveValue("A single-pixel accessibility fixture.");
  await expect(removeMedia).toBeVisible();
});
