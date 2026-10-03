import path from "node:path";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const projectSchema = z
  .object({
    id: z.string(),
    document: z
      .object({
        timeline: z
          .object({
            sources: z.array(
              z
                .object({
                  id: z.string(),
                  duration: z.number(),
                  transcript: z.unknown().optional(),
                })
                .passthrough(),
            ),
            segments: z.array(
              z
                .object({
                  sourceId: z.string(),
                  start: z.number(),
                  end: z.number(),
                  cutMode: z.string().optional(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
const suggestionRequestSchema = z.object({
  workspace_id: z.string(),
  source: z.object({ id: z.string(), revision: z.string(), audio_track_index: z.number() }),
});

test("Repurpose reviews real source clips and creates independent editable projects that reopen", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const auth = await registerUser(request, `repurpose-${Date.now()}@example.com`);
  const workspace = z
    .object({ id: z.string() })
    .parse(await createWorkspace(request, auth.token, "Repurpose review"));
  const headers = { Authorization: `Bearer ${auth.token}` };
  await authenticatePage(page, auth.token);
  await page.addInitScript(() =>
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
  );
  await page.goto("/quick-cut");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open videos", exact: true }).click();
  await (
    await chooser
  ).setFiles(path.join(process.cwd(), "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"));
  await expect(page).toHaveURL(/project=[^&]+&storage=cloud/u);
  await expect(page.getByRole("img", { name: /Saved to OpenPost/u })).toBeVisible();
  const originalId = new URL(page.url()).searchParams.get("project")!;
  const original = projectSchema.parse(
    await (
      await request.get(`/api/v1/video-projects/${originalId}`, {
        headers,
        params: { workspace_id: workspace.id },
      })
    ).json(),
  );
  const words = [
    "We",
    "launched",
    "a",
    "simpler",
    "workflow",
    "today.",
    "Customers",
    "save",
    "time.",
    "Thanks.",
  ].map((text, index) => ({ text, start: index * 0.7 + 0.1, end: index * 0.7 + 0.6 }));
  // A legacy saved transcript exercises migration into the real browser-local transcript owner.
  await page.route(
    (url) => url.pathname === `/api/v1/video-projects/${originalId}`,
    async (route) => {
      const response = await route.fetch();
      const saved = projectSchema.parse(await response.json());
      saved.document.timeline.sources[0]!.transcript = { audioTrackIndex: 0, words };
      await route.fulfill({ response, json: saved });
    },
    { times: 1 },
  );
  let suggestion: object | null = null;
  let submissions = 0;
  await page.route("**/api/v1/repurpose-suggestions", async (route) => {
    const body = suggestionRequestSchema.parse(route.request().postDataJSON());
    submissions++;
    expect(body.source.audio_track_index).toBe(0);
    suggestion = {
      id: "review-one",
      revision: 1,
      workspace_id: workspace.id,
      source_id: body.source.id,
      source_revision: body.source.revision,
      state: "ready",
      updated_at: new Date().toISOString(),
      candidates: [
        {
          id: "launch",
          title: "A simpler workflow",
          rationale: "A complete product update",
          context_warning: "Check the opening words",
          first_word: 1,
          last_word: 5,
          start: words[1]!.start,
          end: words[5]!.end,
        },
        {
          id: "benefit",
          title: "Customers save time",
          rationale: "A concise benefit",
          context_warning: "",
          first_word: 6,
          last_word: 8,
          start: words[6]!.start,
          end: words[8]!.end,
        },
      ],
    };
    await route.fulfill({ status: 202, json: suggestion });
  });
  await page.route("**/api/v1/repurpose-suggestions/review-one", async (route) =>
    route.fulfill({ json: suggestion }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Find clips", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("cuts-before-review.png") });
  await page.getByRole("button", { name: "Find clips", exact: true }).click();
  await page.getByRole("button", { name: "Find clips", exact: true }).click();
  await expect(page.getByRole("button", { name: "A simpler workflow", exact: true })).toBeVisible();
  expect(submissions).toBe(1);
  const before = await request.get(`/api/v1/video-projects?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(z.array(z.unknown()).parse(await before.json())).toHaveLength(1);

  const touch = await page.context().newCDPSession(page);
  for (const width of [1280, 390, 320]) {
    await touch.send("Emulation.setTouchEmulationEnabled", {
      enabled: width < 600,
      maxTouchPoints: 1,
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(
        page.getByRole("button", { name: "A simpler workflow", exact: true }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      if (width < 600) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        const checkbox = page.getByRole("checkbox", {
          name: "Include Customers save time",
          exact: true,
        });
        await checkbox.scrollIntoViewIfNeeded();
        const bounds = await checkbox.boundingBox();
        for (const checked of [false, true]) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }],
          });
          await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect(checkbox).toHaveAttribute("aria-checked", String(checked));
        }
      }
      await page.getByRole("button", { name: "Find again", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`review-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      if (width < 600) {
        const create = page.getByRole("button", { name: "Create clips (2)", exact: true });
        await create.scrollIntoViewIfNeeded();
        await expect(create).toBeInViewport();
        expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`review-actions-${width}-${colorScheme}.png`),
        });
      }
    }
  }
  expect(submissions).toBe(1);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("textbox", { name: "Start", exact: true }).fill("0.1");
  await page.keyboard.press("Tab");
  await page.getByRole("checkbox", { name: "Include Customers save time", exact: true }).uncheck();
  await page.getByRole("button", { name: "Preview clip", exact: true }).focus();
  await page.keyboard.press("Enter");
  const preview = page.getByLabel("Preview A simpler workflow", { exact: true });
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await preview.evaluate(async (element: HTMLVideoElement) => {
    await element.play();
  });
  await expect
    .poll(() => preview.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await preview.evaluate((element: HTMLVideoElement) => element.pause());
  await page.getByRole("button", { name: "Create clips (1)", exact: true }).click();
  const outputLink = page.getByRole("link", { name: "Open clip project", exact: true });
  await expect(outputLink).toBeVisible({ timeout: 90_000 });
  const href = await outputLink.getAttribute("href");
  const outputId = new URL(href!, page.url()).searchParams.get("project")!;
  const output = projectSchema.parse(
    await (
      await request.get(`/api/v1/video-projects/${outputId}`, {
        headers,
        params: { workspace_id: workspace.id },
      })
    ).json(),
  );
  expect(outputId).not.toBe(originalId);
  expect(output.document.timeline.sources[0]!.id).not.toBe(
    original.document.timeline.sources[0]!.id,
  );
  expect(output.document.timeline.sources[0]!.duration).toBe(
    original.document.timeline.sources[0]!.duration,
  );
  expect(output.document.timeline.sources[0]!.transcript).toBeUndefined();
  expect(output.document.timeline.segments).toMatchObject([
    { start: 0.1, end: words[5]!.end, cutMode: "exact" },
  ]);
  const unchanged = projectSchema.parse(
    await (
      await request.get(`/api/v1/video-projects/${originalId}`, {
        headers,
        params: { workspace_id: workspace.id },
      })
    ).json(),
  );
  expect(unchanged.document.timeline.segments).toEqual(original.document.timeline.segments);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Find clips", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Start", exact: true })).toHaveValue("00:00.10");
  await expect(
    page.getByRole("checkbox", { name: "Include Customers save time", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("link", { name: "Open clip project", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "A simpler workflow",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Find clips", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find clips", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Create transcript", exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
