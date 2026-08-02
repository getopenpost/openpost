import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const oidcProvider = {
  id: "acme-sso",
  name: "Acme SSO",
  organization: "Acme",
  start_url: "/api/v1/auth/oidc/acme-sso/start",
};

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function mockOIDCStart(page: Page) {
  let startURL = "";
  await page.route("**/api/v1/auth/oidc/acme-sso/start?**", async (route) => {
    startURL = route.request().url();
    await route.fulfill({
      status: 303,
      headers: { location: "/login?oidc_error=Stubbed+OIDC+redirect" },
    });
  });
  return () => startURL;
}

test("OIDC login preserves a safe relative redirect at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors = collectConsoleErrors(page);
  await page.route("**/api/v1/auth/oidc/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [oidcProvider],
    });
  });
  const getStartURL = await mockOIDCStart(page);

  await page.goto(
    `/login?redirect=${encodeURIComponent("/settings?tab=security")}`,
  );
  const providerButton = page.getByRole("button", {
    name: "Continue with Acme SSO",
  });
  await expect(providerButton).toBeVisible();
  const buttonBox = await providerButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.width).toBeLessThanOrEqual(390);
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);

  await providerButton.click();
  await expect(page).toHaveURL(/oidc_error=Stubbed\+OIDC\+redirect/);
  const startURL = new URL(getStartURL());
  expect(startURL.searchParams.get("return_path")).toBe(
    "/settings?tab=security",
  );
  expect(startURL.searchParams.has("native")).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("verified-domain discovery selects the organization provider", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/oidc/providers", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.route("**/api/v1/auth/oidc/discover?**", async (route) => {
    const email = new URL(route.request().url()).searchParams.get("email");
    expect(email).toBe("person@acme.example");
    await route.fulfill({
      contentType: "application/json",
      json: { found: true, provider: oidcProvider },
    });
  });
  const getStartURL = await mockOIDCStart(page);

  await page.goto("/login");
  await page.getByText("Use a work account").click();
  await page.getByLabel("Work email").fill("person@acme.example");
  await page.getByRole("button", { name: "Continue with SSO" }).click();

  await expect.poll(getStartURL).toContain("/auth/oidc/acme-sso/start");
});

test("managed users without workspaces wait for administrator assignment", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `managed-onboarding-${unique}@example.com`,
  );
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const user = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...user,
        is_managed: true,
        managed_organization_name: "Acme",
      },
    });
  });

  await page.goto("/onboarding");

  await expect(
    page.getByText(
      "Your Acme account is ready, but an administrator has not assigned a workspace yet.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Contact your organization administrator. OpenPost will show your workspace after they assign access.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create workspace" }),
  ).toHaveCount(0);
});

test("required SSO sends an unlinked local account to explicit linking", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `sso-link-${unique}@example.com`);
  await createWorkspace(request, auth.token, `Acme ${unique}`);
  await authenticatePage(page, auth.token);
  const consoleErrors = collectConsoleErrors(page);

  await page.route("**/api/v1/workspaces", async (route) => {
    const response = await route.fetch();
    const workspaces = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({
      response,
      json: workspaces.map((workspace) => ({
        ...workspace,
        sso_required: true,
        sso_authenticated: false,
        sso_provider_id: oidcProvider.id,
        sso_provider_name: oidcProvider.name,
        sso_identity_linked: false,
      })),
    });
  });
  await page.route("**/api/v1/auth/oidc/identities", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.route("**/api/v1/auth/oidc/link-providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [oidcProvider],
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/settings\?tab=security$/);
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  const linkButton = page.getByRole("button", { name: "Link Acme SSO" });
  await expect(linkButton).toBeVisible();
  await expect(linkButton).toBeDisabled();
  await page.locator("#identity-link-password").fill("password-1234");
  await expect(linkButton).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});
