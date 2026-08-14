import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Organization Owner audit stays safe, filterable, exportable, and responsive", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const unique = Date.now().toString(36);
  const owner = await registerUser(request, `audit-owner-${unique}@example.com`);
  const workspace = await createWorkspace(request, owner.token, "Audit browser proof");
  const privateEmail = `private-${unique}@example.com`;
  const invitation = await request.post(`/api/v1/workspaces/${workspace.id}/invitations`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { email: privateEmail, role: "viewer" },
  });
  expect(invitation.ok()).toBeTruthy();
  await authenticatePage(page, owner.token);

  const scenarios = [
    { width: 1280, height: 900, locale: "en", theme: "light" },
    { width: 390, height: 844, locale: "en", theme: "dark" },
    { width: 320, height: 760, locale: "pt", theme: "light" },
  ] as const;

  for (const scenario of scenarios) {
    await test.step(`${scenario.width}px ${scenario.locale} ${scenario.theme}`, async () => {
      await page.setViewportSize(scenario);
      await page.context().addCookies([
        {
          name: "PARAGLIDE_LOCALE",
          value: scenario.locale,
          domain: "127.0.0.1",
          path: "/",
          sameSite: "Lax",
        },
      ]);
      await page.goto(`/settings?tab=audit&workspace=${workspace.id}`);
      await page.evaluate(
        (theme) => localStorage.setItem("mode-watcher-mode", theme),
        scenario.theme,
      );
      await page.reload();

      await expect(
        page.getByTestId("page-header").getByRole("heading", {
          name: scenario.locale === "pt" ? "Auditoria da Organização" : "Organization audit",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByTestId("organization-audit-events")).toContainText(
        "invitation · created",
      );
      await expect(page.getByText(privateEmail)).toHaveCount(0);
      await expect(page.getByText(/invitation links|ligações de convites/i)).toBeVisible();

      const actionLabel = scenario.locale === "pt" ? "Ação" : "Action";
      await page
        .getByRole("textbox", { name: actionLabel, exact: true })
        .fill("invitation.created");
      await page
        .getByRole("button", {
          name: scenario.locale === "pt" ? "Aplicar filtros" : "Apply filters",
        })
        .click();
      await expect(page.getByTestId("organization-audit-events")).toContainText(
        "invitation · created",
      );
      if (scenario === scenarios[0]) {
        const [jsonResponse, jsonDownload] = await Promise.all([
          page.waitForResponse((response) =>
            response.url().includes("/audit-events/export.json?action=invitation.created"),
          ),
          page.waitForEvent("download"),
          page.getByTestId("audit-export-json").click(),
        ]);
        expect(jsonResponse.ok()).toBeTruthy();
        expect(jsonDownload.suggestedFilename()).toMatch(/openpost-organization-audit-.*\.json/);

        const [csvResponse, csvDownload] = await Promise.all([
          page.waitForResponse((response) =>
            response.url().includes("/audit-events/export.csv?action=invitation.created"),
          ),
          page.waitForEvent("download"),
          page.getByTestId("audit-export-csv").click(),
        ]);
        expect(csvResponse.ok()).toBeTruthy();
        expect(csvResponse.headers()["content-type"]).toContain("text/csv");
        expect(csvDownload.suggestedFilename()).toMatch(/openpost-organization-audit-.*\.csv/);
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
    });
  }
  expect(errors).toEqual([]);
});

test("instance administrators inspect and export the same safe audit vocabulary", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `instance-audit-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Instance audit browser proof");
  const meResponse = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  const requestedOrganizations: string[] = [];

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { ...me, is_admin: true } });
  });
  await page.route("**/api/v1/admin/audit-events?**", async (route) => {
    const url = new URL(route.request().url());
    requestedOrganizations.push(url.searchParams.get("organization_id") ?? "");
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: [
          {
            id: "instance-access-1",
            source: "workspace_access",
            actor_user_id: "actor-1",
            effective_actor_user_id: "effective-1",
            action: "member.role_changed",
            resource: {
              type: "workspace_member",
              id: "member-1",
              organization_id: "org-2",
              workspace_id: workspace.id,
            },
            result: "succeeded",
            changed_fields: [{ field: "role", previous: "viewer", current: "editor" }],
            occurred_at: "2026-08-14T12:00:00Z",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/admin/audit-events/export.json?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "Content-Disposition": 'attachment; filename="openpost-instance-audit.json"' },
      json: { format_version: "1", generated_at: "2026-08-14T12:00:00Z", items: [] },
    });
  });

  await authenticatePage(page, auth.token);
  for (const scenario of [
    { width: 1280, height: 900, locale: "en", heading: "Instance audit" },
    { width: 320, height: 760, locale: "pt", heading: "Auditoria da instância" },
  ] as const) {
    await page.setViewportSize(scenario);
    await page.context().addCookies([
      {
        name: "PARAGLIDE_LOCALE",
        value: scenario.locale,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await page.goto("/settings?tab=instance-audit");
    await expect(page.getByRole("heading", { name: scenario.heading, level: 1 })).toBeVisible();
    const evidence = page.getByTestId("instance-audit-events");
    await expect(evidence).toContainText("member · role changed");
    await expect(evidence).toContainText("org-2");
    await expect(evidence).toContainText("effective-1");
    await expect(
      page
        .getByTestId("instance-audit-settings")
        .getByText(/provider responses|respostas dos fornecedores/i),
    ).toBeVisible();

    const organizationLabel = scenario.locale === "pt" ? "Organização" : "Organization";
    await page.getByRole("textbox", { name: organizationLabel, exact: true }).fill("org-2");
    await page
      .getByRole("button", {
        name: scenario.locale === "pt" ? "Aplicar filtros" : "Apply filters",
      })
      .click();
    await expect.poll(() => requestedOrganizations).toContain("org-2");
    if (scenario.locale === "en") {
      const downloadPromise = page.waitForEvent("download");
      await page.getByTestId("instance-audit-settings").getByTestId("audit-export-json").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/openpost-instance-audit-.*\.json/);
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
});
