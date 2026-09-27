import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

type MediaInput = { media_id: string; alt_text?: string };
type CapturedPublication = {
  segments?: { media?: MediaInput[] }[];
  renditions?: { segments?: { media?: MediaInput[] }[] }[];
};
type CapabilityRequest = {
  account_settings: Record<string, Record<string, unknown>>;
  account_segments?: Record<string, { media?: MediaInput[] }[]>;
};

for (const destinationOnly of [false, true]) {
  test(`saved publication media survives composer hydration (destination only: ${destinationOnly})`, async ({
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
    const segment = {
      id: "segment-report",
      position: 0,
      body: created.source_text,
      media: destinationOnly ? [] : [media],
    };
    const account = {
      id: "instagram-report",
      workspace_id: workspace.id,
      platform: "instagram",
      account_id: "instagram-report",
      account_name: "Instagram report",
      account_username: "report",
      is_active: true,
    };
    const publication = {
      ...created,
      content_profile: "image_post",
      segments: [segment],
      media: destinationOnly ? [] : [media],
      renditions: [
        {
          id: "rendition-report",
          social_account_id: account.id,
          platform: "instagram",
          profile: "image_post",
          output_profile: "instagram.feed",
          format_locked: true,
          body: segment.body,
          settings: {},
          media: [media],
          segments: [
            {
              ...segment,
              id: "rendition-segment-report",
              publication_segment_id: segment.id,
              media_inherited: !destinationOnly,
              media: [media],
            },
          ],
        },
      ],
    };
    await authenticatePage(page, auth.token);
    await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [account] }));
    const saves: CapturedPublication[] = [];
    await page.route(`**/api/v1/publications/${created.id}`, async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: publication });
      saves.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...publication, revision: 2 } });
    });
    await page.route("**/api/v1/media/metadata**", (route) =>
      route.fulfill({ json: { media: [{ ...media, alt_text: "Library description" }] } }),
    );
    const requests: CapabilityRequest[] = [];
    await page.route("**/api/v1/capabilities/resolve", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          accounts: [
            {
              account_id: account.id,
              provider: "instagram",
              profile: "image_post",
              output_profile: "instagram.feed",
              label: "Instagram feed",
              compatible: true,
              settings: [],
              issues: [],
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
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
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
      expect(request.account_segments?.[account.id]?.[0]?.media).toEqual([
        { media_id: media.id, alt_text: media.alt_text },
      ]);
      await page.locator(`#composer-destination-${account.id}`).click();
    }
    await page.getByRole("button", { name: /^(Add alt text|Alt text)$/ }).click();
    await expect(page.getByPlaceholder("Alt text...")).toHaveValue(media.alt_text);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(page.getByPlaceholder("Alt text...")).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`alt-text-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    }
    await page.getByPlaceholder("Alt text...").fill("Updated publication description");
    await page.getByPlaceholder("Alt text...").blur();
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
