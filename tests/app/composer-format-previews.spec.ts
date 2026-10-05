import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  registerUser,
  openComposerPlatformSettings,
} from "./helpers";

test.use({ hasTouch: true });
for (const width of [1280, 390, 320])
  for (const scheme of ["light", "dark"] as const) {
    test(`account media follows feed, carousel and Story at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const auth = await registerUser(request, `format-preview-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Media format previews");
      const accountID = randomUUID();
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','format-${accountID}','instagram','${accountID}','formatpreview',X'00',1);`,
      ]);
      const headers = { Authorization: `Bearer ${auth.token}` };
      const media = [];
      for (const name of ["portrait", "landscape"]) {
        const response = await request.post("/api/v1/media/upload", {
          headers,
          multipart: {
            workspace_id: workspace.id,
            alt_text: `${name} fixture`,
            file: {
              name: `preview-${name}.png`,
              mimeType: "image/png",
              buffer: readFileSync(new URL(`./fixtures/compose/${name}.png`, import.meta.url)),
            },
          },
        });
        expect(response.ok(), await response.text()).toBe(true);
        media.push(await response.json());
      }
      const created = await request.post("/api/v1/publications", {
        headers,
        data: {
          workspace_id: workspace.id,
          title: "Format preview",
          content_profile: "image_post",
          source_text: "One shared caption",
          segments: [{ body: "One shared caption", media: [{ media_id: media[0].id }] }],
          renditions: [{ social_account_id: accountID, output_profile: "instagram.feed" }],
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const publication = await created.json();
      await page.route("**/api/v1/capabilities/resolve", (route) => {
        const body = route.request().postDataJSON();
        const selected = body.requested_output_profiles?.[accountID] || "instagram.feed";
        return route.fulfill({
          json: {
            accounts: [
              {
                account_id: accountID,
                provider: "instagram",
                profile: selected.endsWith("story")
                  ? "story"
                  : selected.endsWith("carousel")
                    ? "carousel"
                    : "image_post",
                output_profile: selected,
                segment_strategy: "preserve",
                label: "Instagram",
                text_limit: 2200,
                media: {
                  min_count: 1,
                  max_count: selected.endsWith("story") ? 1 : 10,
                  allowed_mimes: ["image/png"],
                },
                available_formats: [
                  { output_profile: "instagram.feed", label: "Feed", compatible: true },
                  { output_profile: "instagram.carousel", label: "Carousel", compatible: true },
                  { output_profile: "instagram.story", label: "Story", compatible: true },
                ],
                settings: [],
                issues: [],
                active_constraints: {},
                compatible: true,
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              },
            ],
          },
        });
      });
      await authenticatePage(page, auth.token);
      const url = `/publications/${publication.id}?workspace_id=${workspace.id}`;
      await page.goto(url);
      await page.locator(`#composer-destination-${accountID}`).click();
      const frame = page.getByTestId("composer-account-preview");
      const portrait = frame.getByRole("img", { name: "portrait fixture", exact: true });
      await expect(portrait).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await portrait.boundingBox();
          return bounds!.width / bounds!.height;
        })
        .toBeCloseTo(0.8, 1);
      await page.screenshot({ path: info.outputPath("feed.png") });
      await page.getByRole("button", { name: "Add media", exact: true }).click();
      await page.getByRole("button").filter({ hasText: "Add media" }).click();
      const picker = page.getByRole("dialog");
      await picker.getByRole("tab", { name: "Library", exact: true }).click();
      await picker
        .getByRole("button", { name: "Select preview-landscape.png", exact: true })
        .click();
      await picker.getByRole("button", { name: /^Add/ }).click();
      const selectFormat = async (label: string) => {
        await openComposerPlatformSettings(page);
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "Destination format", exact: true }).click();
        await page.getByRole("option", { name: label, exact: true }).click();
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
      };
      await selectFormat("Carousel");
      await frame.getByRole("button", { name: "Next media", exact: true }).click();
      const landscape = frame.getByRole("img", { name: "landscape fixture", exact: true });
      await expect(landscape).toBeVisible();
      await expect(landscape).toHaveCSS("object-fit", "cover");
      await expect
        .poll(async () => {
          const bounds = await landscape.boundingBox();
          return bounds!.width / bounds!.height;
        })
        .toBeCloseTo(0.8, 1);
      await page.screenshot({ path: info.outputPath("carousel.png") });
      const popupEvent = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Full preview", exact: true }).click();
      const popup = await popupEvent;
      await expect(popup.getByRole("img", { name: "portrait fixture", exact: true })).toBeVisible();
      await popup.getByRole("button", { name: "Next media", exact: true }).click();
      await expect(popup.getByRole("img", { name: "landscape fixture", exact: true })).toHaveCSS(
        "object-fit",
        "cover",
      );
      await popup.close();
      await page.getByRole("button", { name: "Remove media", exact: true }).nth(1).click();
      await selectFormat("Story");
      const player = frame.getByLabel("Instagram story player", { exact: true });
      await expect(player).toBeVisible();
      await expect(portrait).toHaveCSS("object-fit", "contain");
      const bounds = await player.boundingBox();
      expect(bounds!.width / bounds!.height).toBeCloseTo(9 / 16, 2);
      await expect
        .poll(async () => {
          const saved = await (
            await request.get(`/api/v1/publications/${publication.id}`, { headers })
          ).json();
          return {
            format: saved.renditions[0].output_profile,
            shared: saved.segments[0].media.map((item: any) => item.id),
            account: saved.renditions[0].segments[0].media.map((item: any) => item.id),
          };
        })
        .toEqual({ format: "instagram.story", shared: [media[0].id], account: [media[0].id] });
      await page.reload();
      await page.locator(`#composer-destination-${accountID}`).click();
      await expect(player).toBeVisible();
      await expect(portrait).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-testid="composer-account-editor"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await player.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("story.png") });
      expect(errors).toEqual([]);
    });
  }
