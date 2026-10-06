import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const captureEnabled = process.env.OPENPOST_UPDATE_PRODUCT_SCREENSHOTS === "1";
const screenshotDirectory =
  process.env.OPENPOST_PRODUCT_SCREENSHOT_DIRECTORY ??
  fileURLToPath(new URL("../../assets/screenshots/", import.meta.url));
import {
  fixtureDirectory,
  captureViewport,
  fixedNow,
  rasterFixtureFiles,
  connectionReadiness,
  providerFixtures,
  uploadImageFixture,
  installLocalVideoWorkspace,
  createVideoEditorProject,
  prepareProductPage,
} from "./product-capture-fixtures";

test.describe("product screenshot capture", () => {
  // Route fixtures must own every request; service worker behavior is covered by pwa.spec.ts.
  test.use({ serviceWorkers: "block" });
  test.setTimeout(120_000);

  let auth: Awaited<ReturnType<typeof registerUser>>;
  let workspace: { id: string };
  let backgroundMediaID: string;
  let logoMediaID: string;

  test.beforeAll(async ({ request }) => {
    auth = await registerUser(request, `product-capture-${randomUUID()}@example.com`);
    workspace = (await createWorkspace(request, auth.token, "Personal")) as { id: string };
    [backgroundMediaID, logoMediaID] = await Promise.all([
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "lisbon-tram.png",
        await readFile(join(fixtureDirectory, rasterFixtureFiles["lisbon-tram"])),
      ),
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "logo.png",
        await readFile(join(fixtureDirectory, rasterFixtureFiles["openpost-logo"])),
      ),
    ]);
  });

  test.skip(
    !captureEnabled,
    "Run bun run capture:product-screenshots to update canonical product images.",
  );

  test.use({
    actionTimeout: 15_000,
    viewport: captureViewport,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "Europe/Lisbon",
  });

  for (const captureScheme of ["dark", "light"] as const) {
    test(`captures workflow authoring in ${captureScheme} mode`, async ({ page }) => {
      await mkdir(screenshotDirectory, { recursive: true });
      await authenticatePage(page, auth.token);
      await page.addInitScript((scheme) => {
        localStorage.setItem("mode-watcher-mode", scheme);
      }, captureScheme);
      await page.emulateMedia({ colorScheme: captureScheme, reducedMotion: "reduce" });
      await page.clock.setFixedTime(new Date(fixedNow));
      await page.goto("/workflows");
      await page
        .getByRole("button", { name: "Start from a template", exact: true })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "Announce a GitHub release", exact: true })
        .locator("../..")
        .getByRole("button", { name: "Use template", exact: true })
        .click();
      await page.getByLabel("Workflow name", { exact: true }).fill("Release announcements");
      await page.getByRole("button", { name: /^Needs attention/ }).click();
      await page.getByLabel("GitHub repository", { exact: true }).fill("getopenpost/openpost");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      const nodes = page.locator(".svelte-flow__node");
      await expect(nodes).toHaveCount(3);
      const bounds = await nodes.evaluateAll((elements) => {
        const boxes = elements.map((element) => element.getBoundingClientRect());
        const x = Math.min(...boxes.map((box) => box.left)) - 36;
        const y = Math.min(...boxes.map((box) => box.top)) - 64;
        return {
          x,
          y,
          width: Math.max(...boxes.map((box) => box.right)) - x + 88,
          height: Math.max(...boxes.map((box) => box.bottom)) - y + 64,
        };
      });
      await page.screenshot({
        path: join(screenshotDirectory, `workflows-detail-${captureScheme}.png`),
        clip: bounds,
        animations: "disabled",
        caret: "hide",
        scale: "device",
      });
      await page.getByRole("button", { name: "Create draft Create draft", exact: true }).click();
      await expect(page.getByLabel("Post text", { exact: true })).toBeVisible();
      await captureDetail(page.getByRole("dialog"), `workflows-node-${captureScheme}.png`, 0);

      const created = await page.request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        data: {
          name: "Release announcements",
          description:
            "Announce breaking changes after approval, or save a short update with a tracking link.",
          expected_revision: 0,
          definition: {
            schema: 1,
            source: { kind: "github_release", repository: "getopenpost/openpost" },
            steps: [
              {
                id: "major",
                kind: "condition",
                name: "Breaking change?",
                inputs: {
                  left: { reference: "source.body" },
                  operator: { literal: "contains" },
                  right: { literal: "Breaking" },
                },
                then: [
                  {
                    id: "launch_write",
                    kind: "ai_text",
                    name: "Explain migration",
                    inputs: {
                      text: { reference: "source.body" },
                      instructions: {
                        literal:
                          "Explain the breaking changes and migration steps. Use only the supplied release notes.",
                      },
                    },
                  },
                  {
                    id: "launch_draft",
                    kind: "create_draft",
                    name: "Draft announcement",
                    inputs: {
                      text: { reference: "launch_write.text" },
                      title: { reference: "source.title" },
                      account_ids: { literal: [] },
                    },
                  },
                  {
                    id: "launch_review",
                    kind: "approval",
                    name: "Approve post",
                    inputs: { publication_id: { reference: "launch_draft.id" } },
                  },
                  {
                    id: "launch_schedule",
                    kind: "schedule",
                    name: "Schedule in 1 hour",
                    inputs: {
                      publication_id: { reference: "launch_review.publication_id" },
                      revision: { reference: "launch_review.revision" },
                      minutes: { literal: 60 },
                    },
                  },
                ],
                else: [
                  {
                    id: "update_text",
                    kind: "text",
                    name: "Shorten notes",
                    inputs: {
                      text: { reference: "source.body" },
                      operation: { literal: "truncate" },
                      limit: { literal: 240 },
                    },
                  },
                  {
                    id: "update_link",
                    kind: "tracking_link",
                    name: "Add tracking link",
                    inputs: {
                      url: { reference: "source.url" },
                      source: { literal: "social" },
                      medium: { literal: "organic" },
                      campaign: { reference: "source.title" },
                    },
                  },
                  {
                    id: "update_draft",
                    kind: "create_draft",
                    name: "Save update for later",
                    inputs: {
                      text: { literal: "{{update_text.text}}\n\n{{update_link.url}}" },
                      title: { reference: "source.title" },
                      account_ids: { literal: [] },
                    },
                  },
                ],
              },
            ],
          },
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const workflow = await created.json();
      await page.goto(`/workflows/${workflow.id}`);
      await page.getByRole("button", { name: "Organize", exact: true }).click();
      await expect(nodes).toHaveCount(9);
      await expect(page.getByText("Yes", { exact: true })).toHaveCount(1);
      await expect(page.getByText("No", { exact: true })).toHaveCount(1);
      // Space the two paths using the same drag gesture as the editor.
      for (const [prefix, suffixes, offset] of [
        ["launch", ["write", "draft", "review", "schedule"], -120],
        ["update", ["text", "link", "draft"], 120],
      ] as const) {
        for (const suffix of suffixes) {
          const target = page.locator(`.svelte-flow__node[data-id="${prefix}_${suffix}"]`);
          const box = await target.boundingBox();
          if (!box) throw new Error("Workflow node is not visible");
          await page.mouse.move(box.x + 80, box.y + 24);
          await page.mouse.down();
          await page.mouse.move(box.x + 80, box.y + 24 + offset, { steps: 12 });
          await page.mouse.up();
        }
      }
      await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
      await capture(page, `workflows-${captureScheme}.png`, [
        page.getByRole("button", { name: "Breaking change? Condition", exact: true }),
        page.getByRole("button", { name: "Explain migration AI text", exact: true }),
        page.getByRole("button", { name: "Shorten notes Transform text", exact: true }),
        page.getByRole("button", { name: "Schedule in 1 hour Schedule post", exact: true }),
        page.getByRole("button", { name: "Save update for later Create draft", exact: true }),
      ]);
    });

    test(`captures current product surfaces in ${captureScheme} mode`, async ({
      page,
      request,
    }) => {
      await mkdir(screenshotDirectory, { recursive: true });
      const fixtures = await prepareProductPage({
        page,
        request,
        auth,
        workspace,
        backgroundMediaID,
        logoMediaID,
        scheme: captureScheme,
      });
      const studySOSVideo = await readFile(join(fixtureDirectory, "study-sos-demo.mp4"));
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto("/");
      await expect(page.getByTestId("compose-shell")).toBeVisible();
      await expect(page.getByText("me@rgo.pt", { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
      await expect(
        page.getByTestId("composer-account-control").getByTestId("composer-account-icon"),
      ).toHaveCount(3);
      await expect(page.getByTestId("composer-account-control")).toContainText("+3");
      await page
        .locator("#post-textarea-0")
        .fill(
          "Approval prompts FEEL safe because they ask a human.\n\nBut the human is usually tired and doesn't want to read a huge confusing bash command.\n\nWelp...",
        );
      const composer = page.getByTestId("text-thread-composer-content");
      await composer.getByRole("button", { name: "Add media" }).click();
      const mediaPicker = page.getByRole("dialog");
      await mediaPicker.getByRole("tab", { name: "Library" }).click();
      await mediaPicker.getByRole("button", { name: "Select command-review.png" }).click();
      await mediaPicker.getByRole("button", { name: "Add media", exact: true }).click();
      await expect(composer.getByRole("button", { name: "Remove media" })).toBeVisible();
      await expect(page.getByTestId("composer-primary-delivery-action")).toBeVisible();
      await capture(page, `main-${captureScheme}.png`, [
        page.getByTestId("desktop-composer-controls"),
        composer.getByRole("button", { name: "Remove media" }),
      ]);

      await composer.getByRole("button", { name: "Add media" }).click();
      await mediaPicker.getByRole("tab", { name: "Meme", exact: true }).click();
      await mediaPicker.getByRole("tab", { name: "Templates", exact: true }).click();
      await mediaPicker.getByRole("textbox", { name: "Search templates" }).fill("Drake");
      await mediaPicker
        .getByRole("button", {
          name: "Use the Drakeposting template",
          exact: true,
        })
        .click();
      await mediaPicker
        .getByRole("textbox", { name: "Caption 1", exact: true })
        .fill("Writing the same post five times");
      const memePreview = mediaPicker.getByRole("img", {
        name: "Drakeposting",
      });
      const previewResponse = page.waitForResponse(
        (response) => response.url().includes("/memes/preview") && response.ok(),
      );
      await mediaPicker
        .getByRole("textbox", { name: "Caption 2", exact: true })
        .fill("One draft. Every channel.");
      await previewResponse;
      await expect(mediaPicker.getByText("Updating preview", { exact: true })).toHaveCount(0);
      await expect
        .poll(() =>
          memePreview.evaluate(
            (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await captureDetail(mediaPicker, `meme-creator-detail-${captureScheme}.png`, 0);
      await page.keyboard.press("Escape");

      await page.goto(`/publications?tab=drafts&workspace=${workspace.id}`);
      await expect(page.getByTestId("publication-list")).toContainText(
        "Finally moved over to Wayland",
      );
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: captureViewport.height });
        await page.screenshot({
          path: `.impeccable/review/dither-migration/publications-populated-${width}-${captureScheme}.png`,
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.setViewportSize(captureViewport);
      await page.goto(`/calendar?workspace=${workspace.id}`);
      await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
      await expect(
        page.locator('[data-slot="page-navigation"]').getByText("August 2026", { exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-calendar-item]")).toHaveCount(
        fixtures.calendarPublications.length,
      );
      await capture(page, `calendar-${captureScheme}.png`, [
        page.getByRole("region", { name: "Monthly publishing calendar" }),
        page.getByRole("button", {
          name: /Launch notes for the next OpenPost release/u,
        }),
      ]);

      await captureDetail(
        page.getByRole("region", { name: "Monthly publishing calendar" }),
        `calendar-detail-${captureScheme}.png`,
      );

      await page.goto(`/analytics?workspace=${workspace.id}`);
      await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
      await expect(page.getByRole("img", { name: "6.9K", exact: true }).first()).toBeVisible();
      const dailyViewsChart = page.getByRole("img", { name: "Daily views" });
      await expect(dailyViewsChart).toBeVisible();
      await expect
        .poll(() =>
          page.getByTestId("analytics-chart-scroll").evaluate((viewport) => {
            const canvas = viewport.firstElementChild;
            if (!(canvas instanceof HTMLElement) || viewport.clientWidth === 0) return 0;
            return canvas.getBoundingClientRect().width / viewport.clientWidth;
          }),
        )
        .toBeGreaterThanOrEqual(0.99);
      await capture(page, `analytics-${captureScheme}.png`, [
        page.getByRole("heading", { name: "Audience by account" }),
        dailyViewsChart,
      ]);

      await captureDetail(dailyViewsChart, `analytics-detail-${captureScheme}.png`);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: captureViewport.height });
        const audience = page.getByRole("region", { name: "Audience by account", exact: true });
        await expect(audience.getByTestId("analytics-composition-chart")).toBeVisible();
        await page.mouse.move(0, 0);
        await audience.screenshot({
          path: `.impeccable/review/dither-migration/audience-${width}-${captureScheme}.png`,
          animations: "disabled",
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.setViewportSize(captureViewport);

      await page.goto("/settings?tab=accounts");
      await expect(page.getByRole("heading", { name: "Connected channels" })).toBeVisible();
      await expect(page.getByText("@rodrgds").first()).toBeVisible();
      await capture(page, `accounts-${captureScheme}.png`, [
        page.getByRole("heading", { name: "Connected channels" }),
        page.getByRole("heading", { name: "Add a channel", exact: true }),
        page.getByTestId("provider-card-x"),
      ]);

      await page.goto("/media");
      await expect(page.getByRole("heading", { name: "Media", level: 1 })).toBeVisible();
      await expect(page.getByText("command-review.png")).toBeVisible();
      await page.waitForFunction(() =>
        Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
      );
      await capture(page, `media-${captureScheme}.png`, [
        page.getByRole("heading", { name: "Media", level: 1 }),
        page.getByText("media-library.png"),
      ]);

      await page.evaluate(() => {
        localStorage.setItem("openpost-image-editor-first-edit-v1", "1");
      });
      fixtures.enableEditorMedia();
      await page.goto(`/image-editor/new?workspace=${workspace.id}`);
      await capture(page, `image-start-${captureScheme}.png`, [
        page.getByRole("heading", { name: "Choose a format" }),
        page.locator("summary", { hasText: "Custom size" }),
      ]);
      await page.getByText("Custom size", { exact: true }).first().click();
      await page.getByRole("spinbutton", { name: "Width" }).fill("1500");
      await page.getByRole("spinbutton", { name: "Height" }).fill("500");
      await page.getByRole("button", { name: "Create custom design" }).click();
      await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/u);
      const imageEditorStage = page.getByTestId("image-editor-stage");
      await expect(imageEditorStage).toBeVisible();
      await page.getByRole("textbox", { name: "Design title" }).fill("X Banner");
      const imageProperties = page.locator(".image-editor-inspector");
      await imageProperties.getByRole("button", { name: "Image", exact: true }).click();
      await page.getByRole("button", { name: /lisbon-tram\.png/u }).click();
      await imageProperties.getByRole("button", { name: "Fit" }).click();
      await page.getByRole("option", { name: "Stretch", exact: true }).click();
      await page.getByRole("button", { name: /logo\.png/u }).click();
      const logoLayer = page.getByRole("treeitem", {
        name: /logo\.png, image/u,
      });
      await expect(logoLayer).toHaveAttribute("aria-selected", "true");
      await imageProperties.getByRole("button", { name: /^Transform\b/ }).click();
      await imageProperties.getByRole("spinbutton", { name: "W", exact: true }).fill("147");
      await imageProperties.getByRole("spinbutton", { name: "W", exact: true }).press("Tab");
      await imageProperties.getByRole("spinbutton", { name: "X", exact: true }).fill("676.5");
      await imageProperties.getByRole("spinbutton", { name: "Y", exact: true }).fill("176.5");
      await imageProperties.getByRole("spinbutton", { name: "Y", exact: true }).press("Tab");
      await expect(imageProperties.getByRole("spinbutton", { name: "W", exact: true })).toHaveValue(
        "147",
      );
      await expect(imageProperties.getByRole("spinbutton", { name: "H", exact: true })).toHaveValue(
        "147",
      );
      await imageProperties.getByRole("button", { name: /^Transform\b/ }).click();
      const adjustmentsButton = imageProperties.getByRole("button", {
        name: "Adjustments",
        exact: true,
      });
      await adjustmentsButton.click();
      const brightnessSlider = imageProperties.getByRole("slider", {
        name: "Brightness",
      });
      await brightnessSlider.press("End");
      await expect(brightnessSlider).toHaveAttribute("aria-valuenow", "1");
      await brightnessSlider.scrollIntoViewIfNeeded();
      await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
        "data-state",
        "saved",
        { timeout: 15_000 },
      );
      await capture(page, `image-editor-${captureScheme}.png`, [
        imageEditorStage,
        logoLayer,
        adjustmentsButton,
        brightnessSlider,
      ]);

      await captureDetail(imageEditorStage, `image-canvas-detail-${captureScheme}.png`);
      await captureDetail(
        imageProperties.locator('[data-slot="collapsible-content"] > div').filter({
          has: page.getByRole("heading", { name: "Tone", exact: true }),
        }),
        `image-controls-detail-${captureScheme}.png`,
      );

      const layersPanel = page.getByTestId("image-editor-layers");
      await expect(layersPanel).toBeVisible();
      await captureDetail(layersPanel, `image-layers-detail-${captureScheme}.png`);

      await page
        .getByTestId("image-editor-page-strip")
        .getByRole("button", { name: "Expand pages", exact: true })
        .click();
      await page.getByRole("button", { name: "Add page" }).click();
      await expect(page.locator(".template-preview-frame img")).toHaveCount(2);
      await captureDetail(
        page.getByTestId("image-editor-page-strip"),
        `image-pages-detail-${captureScheme}.png`,
      );

      await page.getByRole("button", { name: "Export", exact: true }).click();
      const exportDialog = page.getByRole("dialog", { name: "Export design" });
      await expect(exportDialog).toBeVisible();
      await captureDetail(exportDialog, `image-export-detail-${captureScheme}.png`);
      await page.keyboard.press("Escape");

      // The placed logo is an image layer, so the Layer menu offers background removal.
      await page.getByRole("menuitem", { name: "Layer" }).click();
      const removeBackgroundItem = page.getByRole("menuitem", {
        name: "Remove background",
      });
      await expect(removeBackgroundItem).toBeVisible();
      await page.waitForTimeout(400);
      const layerMenu = page.getByRole("menu").filter({ has: removeBackgroundItem });
      await expect
        .poll(() => layerMenu.evaluate((menu) => getComputedStyle(menu).opacity))
        .toBe("1");
      await captureDetail(layerMenu, `image-background-removal-detail-${captureScheme}.png`);
      await page.keyboard.press("Escape");

      await installLocalVideoWorkspace(page, studySOSVideo.toString("base64"));
      await createVideoEditorProject(page, "Study SOS cut");
      await page.getByRole("button", { name: "Import media" }).click();
      const placeStudySOS = page.getByRole("button", {
        name: /Place on timeline: study-sos-demo\.mp4/u,
      });
      await expect(placeStudySOS).toBeVisible({ timeout: 30_000 });
      await placeStudySOS.click();
      await expect(page.locator("[data-media-placement-status]")).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      const timelineItems = page.locator("[data-timeline-item-id]");
      await expect(timelineItems).toHaveCount(1);
      await expect(timelineItems.first().locator("[data-filmstrip-tile]").first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(timelineItems.first().locator("[data-waveform-window]")).toBeVisible({
        timeout: 15_000,
      });
      const videoInspector = page.getByRole("complementary", { name: "Edit" });
      const programMonitor = page.locator("[data-program-monitor]");
      const programVideo = programMonitor.locator("video").first();
      await expect(programMonitor).toBeVisible();
      await expect(programVideo).toBeVisible();
      await expect
        .poll(
          () =>
            programVideo.evaluate((video) => ({
              hasFrame: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
              width: video.videoWidth,
              height: video.videoHeight,
            })),
          { timeout: 15_000 },
        )
        .toEqual({ hasFrame: true, width: 640, height: 360 });
      await programVideo.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      );
      const propertiesTab = videoInspector.getByRole("tab", {
        name: "Properties",
      });
      await expect(propertiesTab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("region", { name: "Background tasks", exact: true })).toBeHidden({
        timeout: 30_000,
      });
      await capture(page, `video-editor-${captureScheme}.png`, [
        programMonitor,
        timelineItems.first(),
        propertiesTab,
      ]);

      await captureDetail(programMonitor, `video-preview-detail-${captureScheme}.png`);
      await captureDetail(
        page
          .getByRole("region", { name: "Timeline", exact: true })
          .locator("xpath=ancestor::footer"),
        `video-timeline-detail-${captureScheme}.png`,
      );

      const workspaceTabs = page.getByRole("tablist", { name: "Editor workspaces" });
      const assetTabs = page.getByRole("tablist", { name: "Assets", exact: true });

      await workspaceTabs.getByRole("tab", { name: "Color" }).click();
      const colorWorkspace = page.getByRole("region", { name: "Color workspace" });
      await expect(colorWorkspace).toBeVisible();
      await capture(page, `video-color-${captureScheme}.png`, [colorWorkspace]);

      await workspaceTabs.getByRole("tab", { name: "Motion" }).click();
      const motionPanel = page.getByRole("region", { name: "Motion", exact: true });
      await expect(motionPanel).toBeVisible();
      await capture(page, `video-motion-${captureScheme}.png`, [motionPanel]);

      await workspaceTabs.getByRole("tab", { name: "Edit" }).click();
      await assetTabs.getByRole("tab", { name: "Effects", exact: true }).click();
      const effectsBrowser = page.locator(".effect-browser");
      await expect(effectsBrowser).toBeVisible();
      await capture(page, `video-effects-${captureScheme}.png`, [effectsBrowser]);

      await assetTabs.getByRole("tab", { name: "Transcript", exact: true }).click();
      const transcriptPanel = page.getByRole("region", { name: "Transcript" });
      await expect(transcriptPanel).toBeVisible();
      await capture(page, `video-transcript-${captureScheme}.png`, [transcriptPanel]);

      await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
      const exportVideoDialog = page.getByRole("dialog", { name: "Export video" });
      await expect(exportVideoDialog).toBeVisible();
      await capture(page, `video-export-${captureScheme}.png`, [exportVideoDialog]);
      await page.keyboard.press("Escape");

      await page.goto("/settings?tab=general");
      await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
      await expect(page.locator('[data-settings-tab="general"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
      if (captureScheme === "dark") {
        await capture(page, "settings-dark.png", [
          page.getByRole("heading", { name: "General", level: 1 }),
          page.getByRole("button", { name: "Save changes" }),
        ]);
      }

      if (captureScheme === "dark") await frameReadmeHero(page);

      expect(pageErrors).toEqual([]);
    });

    test(`captures integration setup in ${captureScheme} mode`, async ({ page }) => {
      await mkdir(screenshotDirectory, { recursive: true });
      await authenticatePage(page, auth.token);
      await page.addInitScript((scheme) => {
        localStorage.setItem("mode-watcher-mode", scheme);
      }, captureScheme);
      await page.emulateMedia({ colorScheme: captureScheme, reducedMotion: "reduce" });
      await page.route("**/api/v1/accounts/providers*", (route) =>
        route.fulfill({
          json: [
            ...providerFixtures.filter(({ platform }) =>
              ["bluesky", "mastodon", "pixelfed", "peertube", "lemmy", "piefed"].includes(platform),
            ),
            ...[
              { platform: "discord", display_name: "Discord", auth_mode: "webhook" },
              { platform: "telegram", display_name: "Telegram", auth_mode: "bot" },
            ].map((provider) => ({
              ...provider,
              configured: true,
              status: "available",
              readiness: connectionReadiness("healthy", true),
            })),
          ],
        }),
      );
      await page.goto("/settings?tab=accounts");
      await expect(page.getByRole("heading", { name: "Connected channels" })).toBeVisible();
      await page.addStyleTag({
        content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      for (const provider of [
        "bluesky",
        "mastodon",
        "pixelfed",
        "peertube",
        "lemmy",
        "piefed",
        "discord",
        "telegram",
      ]) {
        await page.getByTestId(`provider-card-${provider}`).getByRole("button").click();
        let dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        if (provider === "mastodon" || provider === "pixelfed") {
          const continueName =
            provider === "pixelfed" ? "Continue to Pixelfed" : "Continue to Mastodon";
          await dialog.getByRole("button", { name: continueName }).click();
          const serverInput = provider === "pixelfed" ? "#pixelfed-server" : "#mastodon-server";
          dialog = page.getByRole("dialog").filter({ has: page.locator(serverInput) });
          await expect(dialog.locator(serverInput)).toBeVisible();
          await dialog
            .locator(serverInput)
            .fill(provider === "pixelfed" ? "pixelfed.social" : "mastodon.social");
        }
        if (provider === "bluesky") await dialog.locator("#bluesky-handle").fill("you.bsky.social");
        if (provider === "peertube" || provider === "lemmy" || provider === "piefed") {
          await dialog.locator("#fediverse-instance").fill("https://fedi.example");
          await dialog.locator("#fediverse-username").fill("rodrigo");
          await dialog.locator("#fediverse-password").fill("example-password");
        }
        if (provider === "telegram")
          await dialog.locator("#telegram-chat-id").fill("-1001234567890");
        await captureDetail(dialog, `connect-${provider}-${captureScheme}.png`);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
      }
    });
  }
});

async function captureDetail(element: Locator, filename: string, contextPadding = 20) {
  await element.scrollIntoViewIfNeeded();
  const page = element.page();
  const bounds = await element.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error(`Cannot frame product detail: ${filename}`);
  // Retain neighboring app surface so crops do not end at a control's edge.
  const x = Math.max(0, bounds.x - contextPadding);
  const y = Math.max(0, bounds.y - contextPadding);
  await page.screenshot({
    path: join(screenshotDirectory, filename),
    clip: {
      x,
      y,
      width: Math.min(viewport.width, bounds.x + bounds.width + contextPadding) - x,
      height: Math.min(viewport.height, bounds.y + bounds.height + contextPadding) - y,
    },
    animations: "disabled",
    caret: "hide",
    scale: "device",
  });
}

async function capture(page: Page, filename: string, landmarks: Locator[]) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await expect(
    page.getByRole("region", { name: /Notifications/u }).getByRole("listitem"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    )
    .toEqual({
      documentWidth: captureViewport.width,
      viewportWidth: captureViewport.width,
    });
  for (const landmark of landmarks) await expect(landmark).toBeInViewport();
  await page.screenshot({
    path: join(screenshotDirectory, filename),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "device",
  });
}

async function frameReadmeHero(page: Page) {
  const rawScreenshot = await readFile(join(screenshotDirectory, "main-dark.png"));
  await page.setViewportSize(captureViewport);
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
          body { display: grid; place-items: center; }
          img {
            display: block;
            width: 1320px;
            height: 880px;
            border: 1px solid rgba(255, 250, 244, 0.13);
            border-radius: 18px;
            box-shadow: 0 30px 58px rgba(0, 0, 0, 0.44), 0 8px 18px rgba(0, 0, 0, 0.22);
          }
        </style>
      </head>
      <body><img alt="" src="data:image/png;base64,${rawScreenshot.toString("base64")}"></body>
    </html>
  `);
  await page.screenshot({
    path: join(screenshotDirectory, "readme-hero-dark.png"),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    omitBackground: true,
    scale: "device",
  });
}
