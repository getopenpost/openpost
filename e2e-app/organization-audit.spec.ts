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
