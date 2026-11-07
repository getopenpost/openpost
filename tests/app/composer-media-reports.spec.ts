import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { components } from "@openpost/api-contract";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

type MediaInput = { media_id: string; alt_text?: string };
type CapturedPublication = {
  segments?: { media?: MediaInput[] }[];
  renditions?: { segments?: { media?: MediaInput[] }[] }[];
};
type CapabilityRequest = {
  account_settings: NonNullable<
    components["schemas"]["ResolveCapabilitiesInputBody"]["account_settings"]
  >;
  account_segments?: Record<string, { media?: MediaInput[] }[]>;
};

for (const { destinationOnly, provider, outputProfile, count } of [
  { destinationOnly: false, provider: "instagram", outputProfile: "instagram.feed", count: 1 },
  { destinationOnly: true, provider: "instagram", outputProfile: "instagram.feed", count: 1 },
  { destinationOnly: true, provider: "instagram", outputProfile: "instagram.story", count: 1 },
  { destinationOnly: true, provider: "linkedin", outputProfile: "linkedin.multi_image", count: 6 },
  { destinationOnly: true, provider: "threads", outputProfile: "threads.post", count: 2 },
]) {
  test(`saved publication media stays editable (${outputProfile}, ${count}, destination only: ${destinationOnly})`, async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `media-reports-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Media reports");
    const created = await createPublication(
      request,
      auth.token,
      workspace.id,
      "A photo https://example.com",
    );
    const media = {
      id: "image-report",
      mime_type: "image/png",
      size: 1024,
      alt_text: "A scene open in the editor",
      url: "/media/image-report",
      width: 1080,
      height: 1080,
    };
    const attachments = Array.from({ length: count }, (_, index) => ({
      ...media,
      id: index === count - 1 ? media.id : `${media.id}-${index}`,
      url: `/media/${index === count - 1 ? media.id : `${media.id}-${index}`}`,
    }));
    const segment = {
      id: "segment-report",
      position: 0,
      body: created.source_text,
      media: destinationOnly ? [] : attachments,
    };
    const account = {
      id: "instagram-report",
      workspace_id: workspace.id,
      platform: provider,
      account_id: "instagram-report",
      account_name: "Instagram report",
      account_username: "report",
      is_active: true,
    };
    const publication = {
      ...created,
      content_profile: "image_post",
      segments: [segment],
      media: destinationOnly ? [] : attachments,
      renditions: [
        {
          id: "rendition-report",
          social_account_id: account.id,
          platform: provider,
          profile: "image_post",
          output_profile: outputProfile,
          format_locked: true,
          body: segment.body,
          settings: {},
          media: attachments,
          segments: [
            {
              ...segment,
              id: "rendition-segment-report",
              publication_segment_id: segment.id,
              media_inherited: !destinationOnly,
              media: attachments,
            },
          ],
        },
      ],
    };
    await authenticatePage(page, auth.token);
    await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [account] }));
    // Sidebar lists seed the detail cache, so every read must describe the same saved post.
    await page.route("**/api/v1/publications?**", async (route) => {
      const response = await route.fetch();
      // SAFETY: The real publications list endpoint returns objects with schema-required IDs.
      const publications = (await response.json()) as { id: string }[];
      await route.fulfill({
        response,
        json: publications.map((item) => (item.id === publication.id ? publication : item)),
      });
    });
    const saves: CapturedPublication[] = [];
    await page.route(`**/api/v1/publications/${created.id}`, async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: publication });
      saves.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...publication, revision: 2 } });
    });
    await page.route("**/api/v1/media/metadata**", (route) =>
      route.fulfill({
        json: { media: attachments.map((item) => ({ ...item, alt_text: "Library description" })) },
      }),
    );
    const requests: CapabilityRequest[] = [];
    await page.route("**/api/v1/capabilities/resolve", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          accounts: [
            {
              account_id: account.id,
              provider,
              profile: "image_post",
              output_profile: outputProfile,
              label: "Instagram feed",
              compatible: true,
              settings: [],
              issues:
                count > 1 || outputProfile === "instagram.story"
                  ? [
                      {
                        severity: "error",
                        code: "media_size",
                        message: "Replace this image.",
                        provider,
                        media_id: media.id,
                      },
                    ]
                  : [],
              media: { min_count: 1, max_count: 1, allowed_mimes: ["image/png"] },
              content: {},
              active_constraints: {},
              immediate_readiness: { state: "healthy", publishable: true },
              scheduled_readiness: { state: "healthy", publishable: true },
            },
          ],
        },
      });
    });
    await page.route("**/media/image-report*", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
    );
    await page.goto(`/publications/${created.id}`);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect.soft(requests[0].account_settings[account.id]).not.toHaveProperty("share_to_feed");
    expect.soft(requests[0].account_settings[account.id]).not.toHaveProperty("is_trial_reel");
    await page.screenshot({ path: testInfo.outputPath("loaded-composer.png"), fullPage: true });
    if (destinationOnly) {
      const request = requests.at(-1)!;
      expect(request.account_segments?.[account.id]?.[0]?.media).toEqual(
        attachments.map((item) => ({ media_id: item.id, alt_text: item.alt_text })),
      );
      await page.locator(`#composer-destination-${account.id}`).click();
      if (provider === "threads") {
        const remove = page.getByRole("button", { name: "Remove media", exact: true }).first();
        await remove.scrollIntoViewIfNeeded();
        expect(
          await remove.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
            );
          }),
        ).toBe(true);
      }
      if (count > 1 || outputProfile === "instagram.story") {
        await page.getByTestId("composer-validation-control").click();
        await page.getByRole("button", { name: /^Edit:.*Replace this image/ }).click();
        const inventory = page.getByTestId("composer-media-editor");
        await expect(inventory.locator("[data-composer-media-id]")).toHaveCount(count);
        await expect(inventory.locator(`[data-composer-media-id="${media.id}"]`)).toBeFocused();
      } else {
        await expect(page.getByRole("button", { name: "Remove media", exact: true })).toBeVisible();
      }
    }
    await page
      .locator(`[data-composer-media-id="${media.id}"]`)
      .getByRole("button", { name: /^(Add alt text|Alt text)$/ })
      .click();
    await expect(page.getByPlaceholder("Alt text…")).toHaveValue(media.alt_text);
    for (const colorScheme of ["light"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const width of [320]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(page.getByPlaceholder("Alt text…")).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page
          .getByRole("button", { name: "Done", exact: true })
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.screenshot({
          path: testInfo.outputPath(`alt-text-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    }
    await page.getByPlaceholder("Alt text…").fill("Updated publication description");
    await page.getByPlaceholder("Alt text…").blur();
    await expect
      .poll(() =>
        saves.some((saved) =>
          saved.renditions?.[0]?.segments?.[0]?.media?.some(
            (item) => item.alt_text === "Updated publication description",
          ),
        ),
      )
      .toBe(true);
  });
}
