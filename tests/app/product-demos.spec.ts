import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createWorkspace, registerUser, clickComposerDeliveryAction } from "./helpers";
import {
  fixtureDirectory,
  uploadImageFixture,
  prepareProductPage,
  installLocalVideoWorkspace,
  createVideoEditorProject,
} from "./product-capture-fixtures";

const outputDirectory = "tmp/product-demos";
const viewport = { width: 1280, height: 800 };
type Scene = { title: string; run: () => Promise<void>; hold?: number };

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
test.setTimeout(180_000);

async function record(page: Page, name: string, scenes: Scene[]) {
  await mkdir(outputDirectory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screencast.showActions({ cursor: "pointer", fontSize: 1, duration: 450 });
  await page.screencast.start({ path: join(outputDirectory, `${name}.webm`), size: viewport });
  const frameDirectory = join(outputDirectory, `${name}-frames`);
  await mkdir(frameDirectory, { recursive: true });
  const frames: { file: string; at: number }[] = [];
  let capturing = true;
  let captureError: unknown;
  // PNGs preserve unchanged UI pixels, which GIF delta compression can reuse.
  // The simultaneous WebM remains useful as a full-frame-rate video source.
  const captureFrames = (async () => {
    while (capturing) {
      const file = `${name}-frames/${String(frames.length).padStart(5, "0")}.png`;
      await page.screenshot({ path: join(outputDirectory, file) });
      frames.push({ file, at: performance.now() });
      await page.waitForTimeout(100);
    }
  })().catch((error: unknown) => {
    captureError = error;
  });
  try {
    for (const scene of scenes) {
      await test.step(scene.title, async () => {
        const caption = await page.screencast.showOverlay(
          `<div style="position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#171512;color:#fff;border:1px solid #645348;border-radius:10px;padding:12px 24px;font:600 48px system-ui;white-space:nowrap">${scene.title}</div>`,
        );
        await scene.run();
        await page.waitForTimeout(scene.hold ?? 1100);
        await caption[Symbol.asyncDispose]();
      });
    }
    await page.screenshot({ path: join(outputDirectory, `${name}-last.png`) });
  } finally {
    capturing = false;
    await captureFrames;
    await page.screencast.stop();
  }
  if (captureError) throw captureError;
  const manifest = frames
    .map((frame, index) => {
      const next = frames[index + 1];
      return `file '${frame.file}'\nduration ${next ? (next.at - frame.at) / 1000 : 0.2}`;
    })
    .join("\n");
  await writeFile(
    join(outputDirectory, `${name}.ffconcat`),
    `ffconcat version 1.0\n${manifest}\nfile '${frames.at(-1)!.file}'\n`,
  );
}

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
    const fixtures = await prepareProductPage({
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
          run: async () => {
            await page
              .getByTestId("text-thread-composer-content")
              .getByRole("button", { name: "Add media" })
              .click();
            const dialog = page.getByRole("dialog");
            await dialog.getByRole("tab", { name: "Meme", exact: true }).click();
            await dialog.getByRole("tab", { name: "Templates", exact: true }).click();
            await dialog.getByRole("textbox", { name: "Search templates" }).fill("Drake");
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
          run: async () => {
            await clickComposerDeliveryAction(page, "Schedule");
            const dialog = page.getByTestId("schedule-dialog-shell");
            await dialog.getByLabel("Schedule time").fill("2026-08-21T10:00");
            await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
            await expect(page.getByText("Scheduled!", { exact: true })).toBeVisible();
          },
          hold: 2100,
        },
        {
          title: "Check your results",
          run: async () => {
            await page.getByRole("button", { name: "Analytics", exact: true }).click();
            await expect(
              page.getByRole("heading", { name: "Analytics", exact: true }),
            ).toBeVisible();
            await expect(page.getByRole("img", { name: "Daily views" })).toBeVisible();
          },
          hold: 1800,
        },
        {
          title: "Reply in one inbox",
          run: async () => {
            await page.getByRole("button", { name: "Inbox", exact: true }).click();
            await expect(
              page.getByRole("heading", { name: "Engagement", exact: true }),
            ).toBeVisible();
          },
          hold: 1800,
        },
      ]);
    }

    if (name === "image-editor") {
      fixtures.enableEditorMedia();
      await page.goto(`/image-editor/new?workspace=${workspace.id}`);
      await expect(page.getByRole("heading", { name: "Choose a format" })).toBeVisible();
      const properties = page.locator(".image-editor-inspector");
      await record(page, name, [
        {
          title: "Make a thumbnail",
          run: async () => {
            await page.getByRole("button", { name: /YouTube thumbnail/ }).click();
            await expect(page.getByTestId("image-editor-stage")).toBeVisible();
            await page.getByRole("textbox", { name: "Design title" }).fill("A day in Lisbon");
          },
        },
        {
          title: "Choose a photo",
          run: async () => {
            await properties.getByRole("button", { name: "Image", exact: true }).click();
            await page.getByRole("button", { name: /lisbon-tram\.png/ }).click();
            await properties.getByRole("button", { name: "Fit", exact: true }).click();
            await page.getByRole("option", { name: "Cover", exact: true }).click();
            await page.getByRole("button", { name: "Done", exact: true }).first().click();
          },
        },
        {
          title: "Add your title",
          run: async () => {
            await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
            await page.getByRole("menuitem", { name: /^Text\b/ }).click();
            await page.getByRole("textbox", { name: "Text", exact: true }).fill("A DAY\nIN LISBON");
            await page.getByRole("textbox", { name: "Text", exact: true }).press("Tab");
            await properties.getByRole("spinbutton", { name: "Size", exact: true }).fill("120");
            await properties.getByRole("spinbutton", { name: "Size", exact: true }).press("Tab");
            await properties.getByRole("button", { name: "Color", exact: true }).click();
            await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#FFFFFF");
            await page.getByRole("textbox", { name: "Hex color", exact: true }).press("Enter");
            await page.keyboard.press("Escape");
            await properties.getByRole("button", { name: /^Transform\b/ }).click();
            const lock = properties.getByRole("button", { name: "Lock aspect ratio", exact: true });
            if ((await lock.getAttribute("aria-pressed")) === "true") await lock.click();
            for (const [axis, value] of [
              ["W", "1100"],
              ["H", "340"],
              ["X", "90"],
              ["Y", "180"],
            ]) {
              await properties.getByRole("spinbutton", { name: axis, exact: true }).fill(value);
              await properties.getByRole("spinbutton", { name: axis, exact: true }).press("Tab");
            }
            await properties.getByRole("button", { name: /^Transform\b/ }).click();
            await page.keyboard.press("Escape");
          },
          hold: 1500,
        },
        {
          title: "Download the thumbnail",
          run: async () => {
            await page.getByRole("button", { name: "Export", exact: true }).click();
            const dialog = page.getByRole("dialog", { name: "Export design" });
            await expect(dialog).toBeVisible();
            await expect(
              dialog.getByRole("button", { name: "Download", exact: true }),
            ).toBeEnabled();
            const download = page.waitForEvent("download");
            await dialog.getByRole("button", { name: "Download", exact: true }).click();
            await (await download).saveAs(join(outputDirectory, "thumbnail.png"));
          },
          hold: 1700,
        },
      ]);
    }

    if (name === "video-editor") {
      await installLocalVideoWorkspace(
        page,
        (await readFile(join(fixtureDirectory, "study-sos-demo.mp4"))).toString("base64"),
      );
      await createVideoEditorProject(page, "Study SOS · YouTube");
      const clips = page.locator("[data-timeline-item-id]");
      await record(page, name, [
        {
          title: "Import your footage",
          run: async () => {
            await page.getByRole("button", { name: "Import media" }).click();
            await page
              .getByRole("button", { name: /Place on timeline: study-sos-demo\.mp4/ })
              .click();
            await expect(page.locator("[data-media-placement-status]")).toBeVisible();
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("Enter");
            await expect(clips).toHaveCount(1);
            await expect(clips.first().locator("[data-filmstrip-tile]").first()).toBeVisible({
              timeout: 30000,
            });
          },
        },
        {
          title: "Trim the opening",
          run: async () => {
            await clips.first().click();
            await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
            await page.keyboard.press("Home");
            for (let step = 0; step < 3; step++) await page.keyboard.press("Shift+ArrowRight");
            await page.getByRole("button", { name: "Trim start to playhead", exact: true }).click();
          },
        },
        {
          title: "Add a title",
          run: async () => {
            await page.getByRole("button", { name: "Add layer", exact: true }).click();
            await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
            const inspector = page.locator("#video-editor-tools-panel");
            await inspector.locator("textarea").fill("STUDY SOS");
            await inspector.locator("textarea").press("Tab");
            await expect(clips.filter({ hasText: "STUDY SOS" })).toHaveCount(1);
          },
        },
        {
          title: "Preview your edit",
          run: async () => {
            await page.getByRole("button", { name: "Play", exact: true }).click();
            await page.waitForTimeout(1800);
            await page.getByRole("button", { name: "Pause", exact: true }).click();
          },
        },
        {
          title: "Choose your export",
          run: async () => {
            await page
              .getByRole("banner")
              .getByRole("button", { name: "Export", exact: true })
              .click();
            await expect(page.getByRole("dialog", { name: "Export video" })).toBeVisible();
          },
          hold: 1800,
        },
      ]);
    }
    expect(errors).toEqual([]);
  });
}
