import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.describe("analytics date range", () => {
  test.describe(`analytics dates light 1280`, () => {
    test.use({ colorScheme: "light", hasTouch: false });
    test("presets and custom dates apply complete ranges and cancel safely", async ({
      page,
      request,
    }) => {
      const { token } = await registerUser(request, `dates-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Analytics dates");
      await authenticatePage(page, token);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const ranges: { days: string | null; from: string | null; to: string | null }[] = [];
      await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
      await page.route("**/api/v1/analytics?**", (route) => {
        const q = new URL(route.request().url()).searchParams;
        ranges.push({ days: q.get("days"), from: q.get("from"), to: q.get("to") });
        return route.fulfill({
          json: {
            range_days: Number(q.get("days")),
            accounts: [],
            content: [],
            insights: [],
            trends: {},
            summary: {
              followers: { value: 0, measured: 0 },
              engagement: { value: 0, measured: 0 },
              views: { value: 0, measured: 0 },
              impressions: { value: 0, measured: 0 },
              reach: { value: 0, measured: 0 },
              published: 0,
            },
          },
        });
      });
      await page.goto(`/analytics?workspace=${workspace.id}`);
      const trigger = page.getByRole("button", { name: /^Reporting window:/ });
      await expect(trigger).toContainText("30 days");
      await trigger.click();
      await page.getByRole("button", { name: "Last year", exact: true }).click();
      await expect.poll(() => ranges.at(-1)).toEqual({ days: "365", from: null, to: null });
      await trigger.click();
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await expect.poll(() => ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
      await trigger.focus();
      await trigger.press("Enter");
      await page.getByRole("button", { name: "Custom range", exact: true }).click();
      await page.getByLabel("From", { exact: true }).fill("2026-07-21");
      await page.getByLabel("To", { exact: true }).fill("2026-07-22");
      expect(ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect
        .poll(() => ranges.at(-1))
        .toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
      await trigger.click();
      await page.getByLabel("To", { exact: true }).fill("2026-07-20");
      await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(ranges.at(-1)).toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
      expect(errors).toEqual([]);
    });
  });
});

test.describe("analytics layout", () => {
  test("native repurpose restores its authorized Workspace before resolving the source", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `analytics-handoff-${randomUUID()}@example.com`);
    const first = await createWorkspace(request, token, "Browser workspace");
    const target = await createWorkspace(request, token, "Native workspace");
    await authenticatePage(page, token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);
    const reads: string[] = [];
    await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/analytics?**", (route) => {
      reads.push(new URL(route.request().url()).searchParams.get("workspace_id") ?? "");
      return route.fulfill({
        json: {
          range_days: 30,
          publication_total: 0,
          content_total: 0,
          accounts: [],
          content: [],
          publications: [],
          insights: [],
          takeaways: [],
          performance: [],
          highlights: [],
          visibility_breakdown: [],
          follower_series: [],
          trends: { followers: [], engagement: [], views: [], visibility: [] },
          summary: {
            followers: { value: 0, measured: 0 },
            engagement: { value: 0, measured: 0 },
            views: { value: 0, measured: 0 },
            visibility: { value: 0, measured: 0 },
            impressions: { value: 0, measured: 0 },
            reach: { value: 0, measured: 0 },
            published: 0,
          },
        },
      });
    });
    let resolved: Record<string, unknown> | undefined;
    await page.route("**/api/v1/analytics/repurpose", (route) => {
      resolved = route.request().postDataJSON();
      return route.fulfill({
        status: 422,
        json: { detail: "Source fixture reached" },
      });
    });
    const source = {
      type: "openpost",
      publication_id: randomUUID(),
      rendition_id: randomUUID(),
    };
    const query = new URLSearchParams({
      workspace: target.id,
      repurpose_type: source.type,
      repurpose_publication_id: source.publication_id,
      repurpose_rendition_id: source.rendition_id,
      days: "30",
    });
    await page.goto(`/analytics?${query}`);
    await expect
      .poll(() => resolved, { timeout: 15_000 })
      .toEqual({
        workspace_id: target.id,
        reference: source,
        range: { days: 30 },
      });
    expect(reads).toContain(target.id);
    expect(page.url()).not.toContain("repurpose_type");
  });
});
