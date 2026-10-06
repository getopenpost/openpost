import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createWorkspace, registerUser, clickComposerDeliveryAction } from "./helpers";
import {
  fixtureDirectory,
  uploadImageFixture,
  prepareProductPage,
} from "./product-capture-fixtures";

import { record } from "./product-demo-recording";
import { imageEditorDemo } from "./product-demo-image";
import { videoEditorDemo } from "./product-demo-video";
const viewport = { width: 1280, height: 800 };

// This is an opt-in asset capture, not a provider integration test. Fixtures are
// shared with the stills; actions, editor rendering and confetti use the real UI.
test.skip(process.env.OPENPOST_CAPTURE_DEMOS !== "1", "Run bun run capture:product-demos.");
test.use({
  actionTimeout: 15_000,
  viewport,
  deviceScaleFactor: 1,
  serviceWorkers: "block",
  trace: "off",
});
test.setTimeout(300_000);

for (const name of ["publishing", "image-editor", "video-editor"] as const) {
  test(`records ${name}`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `demo-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Personal");
    const [backgroundMediaID, logoMediaID] = await Promise.all([
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "lisbon-tram.png",
        await readFile(join(fixtureDirectory, "lisbon-tram.png")),
      ),
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "logo.png",
        await readFile(join(fixtureDirectory, "openpost-logo.png")),
      ),
    ]);
    await prepareProductPage({
      page,
      request,
      auth,
      workspace,
      backgroundMediaID,
      logoMediaID,
      scheme: "dark",
      composerAccountIDs: [
        "account-linkedin",
        "account-threads",
        "account-x",
        "account-mastodon",
        "account-bluesky",
      ],
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.addInitScript(() =>
      localStorage.setItem("openpost-image-editor-first-edit-v1", "1"),
    );

    if (name === "publishing") {
      await page.route("**/api/v1/publications/*/renditions", (route) =>
        route.fulfill({ json: {} }),
      );
      await page.route("**/api/v1/publications/*/validate", (route) =>
        route.fulfill({ json: { valid: true, issues: [] } }),
      );
      await page.route("**/api/v1/publications/*/schedule", (route) =>
        route.fulfill({
          json: { message: "Scheduled!", publication_id: "screenshot-publication", renditions: [] },
        }),
      );
      await page.route("**/api/v1/engagement?**", (route) =>
        route.fulfill({
          json: {
            total: 3,
            next_cursor: "",
            sync_states: [],
            items: [
              [
                "Marta Silva",
                "martasilva",
                "Can I use the image editor without an account?",
                "bluesky",
              ],
              [
                "Alex Chen",
                "alexbuilds",
                "The scheduling workflow saves me so much time.",
                "threads",
              ],
              [
                "Sam Taylor",
                "samtaylor",
                "Would love a walkthrough of the video editor!",
                "mastodon",
              ],
            ].map(([author_name, author_handle, body, platform], index) => ({
              id: `demo-comment-${index}`,
              workspace_id: workspace.id,
              author_name,
              author_handle,
              body,
              platform,
              social_account_id: `account-${platform}`,
              account_username: "rodrgds",
              author_avatar_url: "",
              author_remote_id: author_handle,
              attachments: [],
              can_reply: true,
              can_like: true,
              can_unlike: false,
              can_delete: false,
              can_hide: false,
              is_ours: false,
              liked: false,
              hidden: false,
              parent_remote_id: "",
              conversation_remote_id: "",
              remote_id: `comment-${index}`,
              rendition_id: `rendition-${index}`,
              publication_id: "published-aug-19",
              publication_title: "One workspace for your content",
              created_at: "2026-08-20T13:00:00Z",
              updated_at: "2026-08-20T13:00:00Z",
              last_seen_at: "2026-08-20T13:00:00Z",
            })),
          },
        }),
      );
      await page.goto(`/publications?tab=drafts&workspace=${workspace.id}`);
      await expect(page.getByTestId("publication-list")).toBeVisible();
      await record(page, name, [
        {
          title: "Write once. Post everywhere.",
          run: async () => {
            await page.getByRole("link", { name: "New post", exact: true }).click();
            await expect(page.getByTestId("compose-shell")).toBeVisible();
            await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
            await page
              .getByRole("textbox", { name: "Post text" })
              .pressSequentially("Just shipped: make it, post it, measure it. All in OpenPost.", {
                delay: 28,
              });
          },
        },
        {
          title: "Make a meme",
          seconds: 9,
          run: async () => {
            await page
              .getByTestId("text-thread-composer-content")
              .getByRole("button", { name: "Add media" })
              .click();
            const dialog = page.getByRole("dialog");
            await dialog.getByRole("tab", { name: "Meme", exact: true }).click();
            await dialog.getByRole("tab", { name: "Templates", exact: true }).click();
            await dialog.getByRole("textbox", { name: "Search templates" }).fill("Drake");
            await dialog.getByRole("textbox", { name: "Search templates" }).press("Enter");
            await page.waitForTimeout(500);
            await dialog
              .getByRole("button", { name: "Use the Drakeposting template", exact: true })
              .click();
            await dialog
              .getByRole("textbox", { name: "Caption 1", exact: true })
              .fill("Five apps to publish one post");
            await dialog
              .getByRole("textbox", { name: "Caption 2", exact: true })
              .fill("Make it all in OpenPost");
            await expect(dialog.getByText("Updating preview", { exact: true })).toHaveCount(0);
            await expect
              .poll(() =>
                dialog
                  .getByRole("img", { name: "Drakeposting" })
                  .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
              )
              .toBe(true);
          },
          hold: 1600,
        },
        {
          title: "Add it to your post",
          seconds: 4,
          run: async () => {
            await page
              .getByRole("dialog")
              .getByRole("button", { name: "Add to post", exact: true })
              .click();
            await expect(
              page
                .getByTestId("text-thread-composer-content")
                .getByRole("button", { name: "Remove media" }),
            ).toBeVisible();
          },
        },
        {
          title: "Pick a time",
          seconds: 4,
          run: async () => {
            await clickComposerDeliveryAction(page, "Schedule");
            const dialog = page.getByTestId("schedule-dialog-shell");
            await dialog.getByLabel("Schedule time").fill("2026-08-21T10:00");
          },
          hold: 1800,
        },
        {
          title: "Scheduled!",
          seconds: 4,
          run: async () => {
            const dialog = page.getByTestId("schedule-dialog-shell");
            await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
            await expect(page.getByText("Scheduled!", { exact: true })).toBeVisible();
          },
          hold: 2600,
        },
        {
          title: "Check your results",
          seconds: 5,
          run: async () => {
            await page.getByRole("button", { name: "Analytics", exact: true }).click();
            await expect(
              page.getByRole("heading", { name: "Analytics", exact: true }),
            ).toBeVisible();
            await expect(page.getByRole("img", { name: "Daily views" })).toBeVisible();
          },
          hold: 3000,
        },
        {
          title: "Reply in one inbox",
          seconds: 5,
          run: async () => {
            await page.getByRole("button", { name: "Inbox", exact: true }).click();
            await expect(
              page.getByRole("heading", { name: "Engagement", exact: true }),
            ).toBeVisible();
          },
          hold: 3000,
        },
      ]);
    }

    if (name === "image-editor") {
      await imageEditorDemo({ page, request, workspaceID: workspace.id, token: auth.token });
    }

    if (name === "video-editor") await videoEditorDemo(page);

    expect(errors).toEqual([]);
  });
}
