import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";
import { password, routeBrowserRegistration } from "./helpers";

const appPort = Number(process.env.OPENPOST_APP_E2E_PORT ?? 18180);
const boundaryURL = `http://127.0.0.1:${appPort + 12}`;
const mastodonURL = `https://127.0.0.1:${appPort + 14}`;

async function installPaddleAdapter(page: Page) {
  await page.route("https://cdn.paddle.com/paddle/v2/paddle.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `(() => {
        const state = { initialize: null, checkout: null };
        window.__openpostFirstUsePaddle = state;
        window.PaddleBillingV1 = {
          Initialized: false,
          Environment: { set() {} },
          Initialize(options) { state.initialize = options; this.Initialized = true; },
          Update(options) { state.initialize = options; },
          PricePreview: async ({ items }) => ({ data: { details: { lineItems: items.map(
            ({ priceId }) => ({ price: { id: priceId }, formattedTotals: { total: "$250.00" } })
          ) } } }),
          Checkout: {
            open(options) {
              state.checkout = options;
              queueMicrotask(() => state.initialize.eventCallback({ name: "checkout.loaded" }));
            },
            close() {}
          }
        };
      })();`,
    }),
  );
}

async function verificationCode(request: APIRequestContext, email: string) {
  await expect
    .poll(async () => {
      const response = await request.get(
        `${boundaryURL}/__e2e/email-code?email=${encodeURIComponent(email)}`,
      );
      return response.ok() ? ((await response.json()) as { code: string }).code : "";
    })
    .toMatch(/^[0-9]{6}$/u);
  const response = await request.get(
    `${boundaryURL}/__e2e/email-code?email=${encodeURIComponent(email)}`,
  );
  return ((await response.json()) as { code: string }).code;
}

async function registerVerifiedAPIUser(
  request: APIRequestContext,
  email: string,
  purchaseChoiceToken: string,
) {
  let address = 0;
  for (const character of email) {
    address = (address * 31 + character.charCodeAt(0)) >>> 0;
  }
  const register = await request.post("/api/v1/auth/register", {
    headers: {
      "X-Forwarded-For": `198.19.${(address >>> 8) & 255}.${address & 255 || 1}`,
    },
    data: {
      email,
      username: `e2e-${Date.now().toString(36)}`,
      password,
      purchase_choice_token: purchaseChoiceToken,
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();
  const pending = (await register.json()) as { email_verification_id: string };
  const code = await verificationCode(request, email);
  const confirm = await request.post("/api/v1/auth/email-verification/confirm", {
    data: { challenge_id: pending.email_verification_id, code },
  });
  expect(confirm.ok(), await confirm.text()).toBeTruthy();
  return (await confirm.json()) as { token: string };
}

test("signup through Activation is one resumable, accessible browser journey", async ({
  page,
  request,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString(36);
  const email = `first-use-cohort-${unique}@example.com`;
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await routeBrowserRegistration(page, email);
  await installPaddleAdapter(page);

  await page.goto("/register?plan=founder&billing_period=annual");
  await expect(page.getByText("OpenPost Founder")).toBeVisible();
  await expect(page.getByText("$250/year", { exact: true })).toBeVisible();
  const purchaseChoiceToken = new URL(page.url()).searchParams.get("purchase_choice");
  expect(purchaseChoiceToken).toBeTruthy();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?/u);
  await page.getByLabel("Verification code").fill(await verificationCode(request, email));
  await page.getByRole("button", { name: "Verify email" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm your Workspace and plan" }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.reload();
  await expect(page.getByText("OpenPost Founder")).toBeVisible();
  await page.getByLabel("Workspace name").fill("First-use Studio");
  const welcomeResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/billing/welcome" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Workspace and continue" }).click();
  const welcomeResponse = await welcomeResponsePromise;
  expect(welcomeResponse.ok()).toBeTruthy();
  const welcome = (await welcomeResponse.json()) as {
    workspace_id: string;
    checkout: { id: string; provider_price_id: string; customer_email: string };
  };
  await expect(page).toHaveURL(new RegExp(`/checkout\\?[^#]*attempt=${welcome.checkout.id}`));
  await expect(page.getByTestId("paddle-checkout-frame")).toBeVisible();
  await page.reload();
  await expect(page.getByText("$250.00/year").first()).toBeVisible();

  const paddleComplete = await request.post(`${boundaryURL}/__e2e/paddle/complete`, {
    data: {
      attempt_id: welcome.checkout.id,
      email: welcome.checkout.customer_email,
      price_id: welcome.checkout.provider_price_id,
    },
  });
  expect(paddleComplete.ok(), await paddleComplete.text()).toBeTruthy();
  await page.evaluate(() => {
    const state = (
      window as Window & {
        __openpostFirstUsePaddle?: {
          initialize?: { eventCallback?: (event: { name: string }) => void };
        };
      }
    ).__openpostFirstUsePaddle;
    state?.initialize?.eventCallback?.({ name: "checkout.completed" });
  });
  const trialReady = page.getByRole("heading", {
    name: "Your trial is ready",
  });
  await expect
    .poll(async () => new URL(page.url()).pathname === "/" || (await trialReady.isVisible()), {
      timeout: 30_000,
    })
    .toBe(true);
  if (await trialReady.isVisible()) {
    await page.getByRole("button", { name: "Connect a social account" }).click();
  }
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toMatch(/^\/(?:settings)?$/u);
  if (new URL(page.url()).pathname === "/") {
    await page.getByRole("link", { name: "Connect a destination" }).click();
  }
  await expect(page).toHaveURL(/\/settings\?tab=accounts(?:&onboarding=1)?$/u);

  const mastodonCard = page.getByTestId("provider-card-mastodon");
  await expect(mastodonCard).toBeVisible();
  await mastodonCard.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Continue to Mastodon" }).click();
  const mastodonDialog = page
    .getByRole("dialog", { name: "Connect Mastodon" })
    .filter({ has: page.getByLabel("Server address") });
  await expect(mastodonDialog).toBeVisible();
  await mastodonDialog.getByLabel("Server address").fill(mastodonURL);
  const authURLResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/accounts/mastodon/auth-url" &&
      response.request().method() === "GET",
  );
  const externalAuthorizationRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).origin === mastodonURL &&
      new URL(request.url()).pathname === "/oauth/authorize",
  );
  await mastodonDialog.getByRole("button", { name: "Connect", exact: true }).click();
  expect((await authURLResponse).ok()).toBe(true);
  expect(new URL((await externalAuthorizationRequest).url()).origin).toBe(mastodonURL);
  await expect(page).toHaveURL(new RegExp(`workspace_id=${welcome.workspace_id}`), {
    timeout: 15_000,
  });
  await expect(
    page.getByText("Composer ready. The requested destination is selected."),
  ).toBeVisible();
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row").getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Escape");
  const reorderablePost = page.locator("[data-reorderable-item]").first();
  await expect(reorderablePost).toHaveAttribute("role", "listitem");
  await reorderablePost.evaluate((item) => item.setAttribute("aria-grabbed", "true"));
  await expect(reorderablePost).not.toHaveAttribute("aria-grabbed");

  await page
    .getByLabel("Post text")
    .fill(
      "This first publication is intentionally much longer than the configured Mastodon instance permits for one status.",
    );
  await expect(page.getByText("113/80", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish now" })).toBeDisabled();
  await expectNoSeriousAccessibilityViolations(page);

  const publishResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/v1\/publications\/[^/]+\/publish-now$/u.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Post text").fill("A first useful publication");
  await expect(page.getByRole("button", { name: "Publish now" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish now" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
  const published = (await publishResponse.json()) as {
    publication_id: string;
    workspace_activated: boolean;
    activation_publication_id: string;
  };
  expect(published.workspace_activated).toBe(true);
  expect(published.activation_publication_id).toBe(published.publication_id);

  const completion = page.getByTestId("composer-delivery-feedback");
  await expect(completion).toContainText("Workspace activated");
  await expect(completion.getByRole("link", { name: "View publication" })).toHaveAttribute(
    "href",
    `/publications/${published.publication_id}`,
  );
  const closeToast = page.getByRole("button", { name: "Close toast" });
  if (await closeToast.isVisible()) await closeToast.click();
  await expectNoSeriousAccessibilityViolations(page);

  const persisted = await page
    .context()
    .request.get(`/api/v1/publications/${published.publication_id}`);
  expect(persisted.ok(), await persisted.text()).toBeTruthy();
  const publication = (await persisted.json()) as {
    id: string;
    workspace_id: string;
    source_text: string;
    renditions: unknown[];
  };
  expect(publication).toMatchObject({
    id: published.publication_id,
    workspace_id: welcome.workspace_id,
    source_text: "A first useful publication",
  });
  expect(publication.renditions).toHaveLength(1);

  const setupResponse = await page
    .context()
    .request.get(`/api/v1/workspaces/${welcome.workspace_id}/setup`);
  expect(setupResponse.ok(), await setupResponse.text()).toBeTruthy();
  const setup = (await setupResponse.json()) as {
    activated: boolean;
    visible: boolean;
    steps: Array<{ id: string; completed: boolean }>;
  };
  expect(setup.activated).toBe(true);
  expect(setup.visible).toBe(false);
  expect(setup.steps).toEqual([
    { id: "workspace", completed: true },
    { id: "destination", completed: true },
    { id: "composition", completed: true },
    { id: "publication", completed: true },
  ]);

  const outsider = await registerVerifiedAPIUser(
    request,
    `first-use-outsider-${unique}@example.com`,
    purchaseChoiceToken!,
  );
  const forbidden = await request.get(`/api/v1/publications/${published.publication_id}`, {
    headers: { Authorization: `Bearer ${outsider.token}` },
  });
  expect([403, 404]).toContain(forbidden.status());

  await completion.getByRole("button", { name: "Create another" }).click();
  await expect(page.getByLabel("Post text")).toBeEmpty();
  await expect(page.getByTestId("workspace-setup-guide-composer")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(consoleErrors).toEqual([]);
});
