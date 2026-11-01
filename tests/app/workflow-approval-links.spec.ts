import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("approval links select their workspace before loading a run, including same-route navigation", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `approval-links-${randomUUID()}@example.com`);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const fixtures = [];
  for (const name of ["First approval", "Second approval"]) {
    const workspace = await createWorkspace(request, auth.token, name);
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name,
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "fields",
              name: name + " marker",
              kind: "set_fields",
              inputs: { fields: { literal: { marker: name } } },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const workflow = await created.json();
    const started = await request.post(
      `/api/v1/workflows/${workflow.id}/runs?workspace_id=${workspace.id}`,
      {
        headers,
        data: { expected_revision: workflow.revision, mode: "preview", source: {} },
      },
    );
    expect(started.ok(), await started.text()).toBeTruthy();
    const run = await started.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/v1/workflow-runs/${run.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).state,
      )
      .toBe("succeeded");
    fixtures.push({
      workspace,
      run,
      href: `/workflows?run=${run.id}&workspace_id=${workspace.id}`,
    });
  }
  const [first, second] = fixtures;
  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    if (window !== window.top || sessionStorage.getItem("approval-link-fixture")) return;
    localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    sessionStorage.setItem("approval-link-fixture", "ready");
  }, second.workspace);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/workflow-runs/")) requests.push(req.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(first.href);
  await page.screenshot({ path: testInfo.outputPath("approval-entry.png") });
  await expect(page.getByText("Workflow revision 1 · Preview", { exact: true })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "First approval marker" })).toBeVisible();
  await expect(page).toHaveURL(first.href);
  // A local link exercises SvelteKit navigation without remounting the app.
  async function followApprovalLink(href: string) {
    await page.evaluate((href) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = "Open next approval";
      link.style.cssText =
        "position:fixed;top:80px;right:16px;z-index:1000;padding:12px;background:white;color:black";
      document.body.append(link);
    }, href);
    await page.getByRole("link", { name: "Open next approval" }).click();
    await page.getByRole("link", { name: "Open next approval" }).evaluate((link) => link.remove());
  }
  await followApprovalLink(second.href);
  await expect(page.locator("summary").filter({ hasText: "Second approval marker" })).toBeVisible();
  await expect(page).toHaveURL(second.href);
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`approval-${width}-${colorScheme}.png`) });
    }
  }
  expect(requests.some((url) => url.includes(first.run.id))).toBe(true);
  expect(requests.some((url) => url.includes(second.run.id))).toBe(true);
  for (const fixture of fixtures) {
    expect(
      requests
        .filter((url) => url.includes(fixture.run.id))
        .every((url) => new URL(url).searchParams.get("workspace_id") === fixture.workspace.id),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  const workspaceButton = page
    .getByRole("button", { name: /First approval|Second approval/ })
    .first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: /First approval/ }).click();
  await expect(workspaceButton).toContainText("First approval");
  await expect(page.locator("summary").filter({ hasText: "Second approval marker" })).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "Runs", exact: true }).first().click();
  await expect(page.locator(`#workflow-run-${first.run.id}`)).toBeVisible();
  // Opening the same notification again must apply its destination again.
  await followApprovalLink(second.href);
  await expect(page.locator("summary").filter({ hasText: "Second approval marker" })).toBeVisible();
  await expect(workspaceButton).toContainText("Second approval");
  expect(errors).toEqual([]);
});
