import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px controls`, () => {
    test.use({ hasTouch: width < 768 });
    for (const scheme of ["light", "dark"] as const) {
      test(`shared poll choices persist at ${width}px in ${scheme}`, async ({
        page,
        request,
      }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const auth = await registerUser(request, `poll-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Polls");
        await authenticatePage(page, auth.token);
        const targets = [
          { id: randomUUID(), platform: "x", username: "pollx" },
          { id: randomUUID(), platform: "bluesky", username: "pollsky" },
        ];
        for (const account of targets)
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
            `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','poll-${account.id}','${account.platform}','${account.id}','${account.username}',X'00',1);`,
          ]);
        await page.route("**/api/v1/capabilities/resolve", (route) =>
          route.fulfill({
            json: {
              accounts: targets.map((account) => ({
                account_id: account.id,
                provider: account.platform,
                profile: "short_text",
                output_profile: `${account.platform}.post`,
                label: account.platform,
                text_limit: 280,
                media: {
                  min_count: 0,
                  max_count: 4,
                  allowed_mimes: [],
                  requires_public_url: false,
                  requires_https_fetchable: false,
                },
                intents: ["post"],
                media_shapes: ["text"],
                settings:
                  account.platform === "x"
                    ? [
                        {
                          key: "poll_options",
                          label: "Poll",
                          type: "textarea",
                          control: "poll",
                          scope: "segment",
                          constraints: { min_items: 2, max_items: 4, max_length: 25 },
                        },
                        {
                          key: "poll_duration_minutes",
                          label: "Duration",
                          type: "number",
                          scope: "segment",
                        },
                      ]
                    : [],
                setting_groups: [],
                compatible: true,
                active_constraints: {},
                issues: [],
                capability_revision: "poll-test",
                dynamic_options: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              })),
            },
          }),
        );
        await page.goto("/");
        await page.getByRole("textbox", { name: "Post text", exact: true }).fill("Help us plan.");
        await page.screenshot({ path: testInfo.outputPath("before.png") });
        const add = page.getByRole("button", { name: "Add poll", exact: true });
        await add.focus();
        await page.keyboard.press("Enter");
        const poll = page.getByTestId("shared-poll-editor");
        await poll
          .getByRole("textbox", { name: "Question", exact: true })
          .fill("Would you use this?");
        await poll.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes, sometimes");
        await poll.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
        await expect(
          poll.getByText("Choose a version for each destination before publishing."),
        ).toBeVisible();
        await poll.getByRole("button", { name: /^@pollsky/ }).click();
        await page.getByRole("option", { name: "Text version", exact: true }).click();
        await expect(
          poll.getByText("Choose a version for each destination before publishing."),
        ).toHaveCount(0);
        await poll.getByText("Text version preview", { exact: true }).click();
        await expect(
          poll.getByText("Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No", {
            exact: true,
          }),
        ).toBeVisible();
        const accessibility = await new AxeBuilder({ page })
          .include('[data-testid="shared-poll-editor"]')
          .analyze();
        expect(accessibility.violations).toEqual([]);
        if (width < 768) {
          expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
          const smallTargets = await poll
            .locator("button:visible, input:visible, summary:visible")
            .evaluateAll((elements) =>
              elements.flatMap((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.width > 0 && bounds.height > 0 && bounds.height < 44
                  ? [
                      {
                        label: element.getAttribute("aria-label") ?? element.textContent,
                        height: bounds.height,
                      },
                    ]
                  : [];
              }),
            );
          expect(smallTargets).toEqual([]);
        }
        const bounds = await poll.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await poll
          .getByRole("heading", { name: "Poll", exact: true })
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: testInfo.outputPath("poll-fields.png") });
        await poll
          .getByRole("heading", { name: "Poll versions", exact: true })
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: testInfo.outputPath("poll-versions.png") });
        const headers = { Authorization: `Bearer ${auth.token}` };
        let saved: any;
        await expect
          .poll(async () => {
            const response = await request.get("/api/v1/publications", {
              headers,
              params: { workspace_id: workspace.id },
            });
            const data = await response.json();
            const items = Array.isArray(data) ? data : (data.items ?? data.publications ?? []);
            saved = items.find((item: any) => item.source_text === "Help us plan.");
            if (!saved) return false;
            const detail = await request.get(`/api/v1/publications/${saved.id}`, { headers });
            saved = await detail.json();
            return (
              saved.segments?.[0]?.settings?.poll?.destinations?.[targets[1].id]?.mode === "text"
            );
          })
          .toBe(true);
        expect(
          saved.renditions.find((item: any) => item.platform === "x").segments[0].settings
            .poll_options,
        ).toBe("Yes, sometimes\nNo");
        await page.goto(`/publications/${saved.id}`);
        await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
          "Would you use this?",
        );
        await expect(page.getByRole("button", { name: /^@pollsky/ })).toContainText("Text version");
        await page
          .getByTestId("shared-poll-editor")
          .getByRole("button", { name: "Customize post text", exact: true })
          .click();
        const editor = page.getByRole("textbox", { name: "Post text", exact: true });
        await expect(editor).toHaveValue(
          "Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No",
        );
        await expect(page.getByRole("button", { name: /^@pollsky/ })).toContainText(
          "Post without poll",
        );
        await editor.fill("A separate question for this audience.");
        expect(errors).toEqual([]);
      });
    }
  });
}
