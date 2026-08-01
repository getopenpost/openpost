import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
  routeBrowserRegistration,
} from "./helpers";

test("registration routes first-time users through onboarding", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-onboarding-${unique}@example.com`;
  const workspaceName = "Launch Workspace E2E";

  await routeBrowserRegistration(page, email);
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to OpenPost" }),
  ).toBeVisible();
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();

	await expect(page).toHaveURL(/\/$/);

  expect(
    await page.evaluate(() => window.localStorage.getItem("token")),
  ).toBeNull();

  const workspaces = await page.context().request.get("/api/v1/workspaces");
  expect(workspaces.ok()).toBeTruthy();
  const workspaceBody = await workspaces.json();
  expect(workspaceBody).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: workspaceName })]),
  );
});

test("login honors same-origin redirects for existing workspaces", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-login-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Login Redirect E2E");

  await page.goto(
    `/login?redirect=${encodeURIComponent("/settings?tab=plan")}`,
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/settings\?tab=plan$/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
});

test("signed-in startup never mounts the login form inside the app shell", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-startup-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Startup Route E2E");
  await authenticatePage(page, auth.token);
  await page.addInitScript(() => {
    const observedWindow = window as typeof window & {
      __openpostLoginShellFlash?: boolean;
    };
    observedWindow.__openpostLoginShellFlash = false;

    const detectLoginShellFlash = () => {
      if (
        document.querySelector('[data-testid="app-sidebar"]') &&
        document.querySelector("form input#email")
      ) {
        observedWindow.__openpostLoginShellFlash = true;
      }
    };

    new MutationObserver(detectLoginShellFlash).observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      },
    );
  });

  await page.goto("/login");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __openpostLoginShellFlash?: boolean;
          }
        ).__openpostLoginShellFlash,
    ),
  ).toBe(false);
});
