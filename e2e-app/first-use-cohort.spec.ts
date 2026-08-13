import { expect, test, type Page } from "@playwright/test";
import { password, registerUser } from "./helpers";

const account = {
  id: "journey-destination",
  slug: "journey-destination",
  platform: "bluesky",
  account_id: "provider-account",
  account_username: "openpost.bsky.social",
  account_avatar_url: "",
  instance_url: "",
  is_active: true,
  thread_replies_supported: true,
};

function readiness() {
  return {
    state: "healthy",
    executable: true,
    connectable: false,
    publishable: true,
    advertisable: false,
    facts: {
      configuration: "configured",
      local_test: "passed",
      live_certification: "passed",
      approval: "approved",
      authorization: "authorized",
      control: "enabled",
      policy: "allowed",
    },
    blockers: [],
  };
}

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

test("signup through Activation is one resumable, accessible browser journey", async ({
  page,
  request,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString(36);
  const email = `first-use-cohort-${unique}@example.com`;
  const choiceExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const auth = await registerUser(request, email);
  const session = await request.get("/api/v1/auth/session-state", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(session.ok()).toBeTruthy();
  const user = (await session.json()).user;
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  let workspace: Record<string, unknown> | null = null;
  let connected = false;
  let activated = false;
  let publishAttempts = 0;
  let validationBlocks = true;

  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: true,
        legal_acceptance_required: false,
        purchase_choice_required: true,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/providers", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/billing/purchase-choice", (route) =>
    route.fulfill({
      json: {
        token: "choice-founder-annual",
        plan_id: "founder",
        plan_name: "Founder",
        billing_period: "annual",
        list_price_usd: 250,
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-13",
        expires_at: choiceExpiresAt,
      },
    }),
  );
  await page.route("**/api/v1/auth/register", (route) =>
    route.fulfill({
      json: {
        requires_email_verification: true,
        requires_mfa: false,
        email_verification_id: "journey-verification",
        email_verification_email: email,
        email_delivery_status: "sent",
      },
    }),
  );
  await page.route("**/api/v1/auth/email-verification/confirm", (route) =>
    route.fulfill({
      headers: {
        "set-cookie": `openpost_session=${auth.token}; Path=/; HttpOnly; SameSite=Lax`,
      },
      json: {
        requires_email_verification: false,
        requires_mfa: false,
        token: auth.token,
        user,
      },
    }),
  );
  await page.route("**/api/v1/workspaces", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: workspace ? [workspace] : [] });
  });
  await page.route("**/api/v1/billing/welcome", async (route) => {
    const created = await request.post("/api/v1/workspaces", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { name: "First-use Studio" },
    });
    expect(created.ok()).toBeTruthy();
    workspace = await created.json();
    await route.fulfill({
      json: {
        workspace_id: workspace!.id,
        organization_id: workspace!.organization_id,
        workspace_name: workspace!.name,
        checkout: {
          id: "chkat_journey",
          workspace_id: workspace!.id,
          url: "/checkout?attempt=chkat_journey",
          provider_price_id: "pri_founder_annual",
          price_ids: {
            starter: "pri_starter_annual",
            founder: "pri_founder_annual",
            pro: "pri_pro_annual",
            team: "pri_team_annual",
            agency: "pri_agency_annual",
          },
          plan_id: "founder",
          billing_period: "annual",
          trial_ends_at: trialEndsAt,
          client_token: "test_client_token",
          environment: "sandbox",
          customer_email: email,
          return_url: "/checkout?attempt=chkat_journey&status=success",
        },
      },
    });
  });
  const checkout = {
    id: "chkat_journey",
    url: "/checkout?attempt=chkat_journey",
    provider_price_id: "pri_founder_annual",
    price_ids: {
      starter: "pri_starter_annual",
      founder: "pri_founder_annual",
      pro: "pri_pro_annual",
      team: "pri_team_annual",
      agency: "pri_agency_annual",
    },
    plan_id: "founder",
    billing_period: "annual",
    trial_ends_at: trialEndsAt,
    client_token: "test_client_token",
    environment: "sandbox",
    customer_email: email,
    return_url: "/checkout?attempt=chkat_journey&status=success",
  };
  await page.route("**/api/v1/billing/checkout/chkat_journey", (route) =>
    route.fulfill({ json: checkout }),
  );
  await page.route("**/api/v1/billing/checkout/chkat_journey/return", (route) =>
    route.fulfill({
      json: { status: "success", return_path: "/settings?tab=accounts&onboarding=1" },
    }),
  );
  await installPaddleAdapter(page);

  await page.goto("/register?plan=founder&billing_period=annual");
  await expect(page.getByText("OpenPost Founder")).toBeVisible();
  await expect(page.getByText("$250/year", { exact: true })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.getByLabel("Verification code").fill("654321");
  await page.getByRole("button", { name: "Verify email" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm your Workspace and plan" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("OpenPost Founder")).toBeVisible();
  await page.getByLabel("Workspace name").fill("First-use Studio");
  await page.getByRole("button", { name: "Create Workspace and continue" }).click();
  await expect(page).toHaveURL(/\/checkout\?attempt=chkat_journey/);
  await expect(page.getByTestId("paddle-checkout-frame")).toBeVisible();
  await page.reload();
  await expect(page.getByText("$250.00/year").first()).toBeVisible();
  await page.goto("/checkout?attempt=chkat_journey&status=success");
  await expect(page).toHaveURL(/\/settings\?tab=accounts&onboarding=1$/);

  await page.route("**/api/v1/accounts/providers", (route) =>
    route.fulfill({ json: [{ id: "bluesky", name: "Bluesky", auth_type: "oauth" }] }),
  );
  await page.route("**/api/v1/accounts?**", (route) =>
    route.fulfill({ json: connected ? [account] : [] }),
  );
  await page.route("**/api/v1/accounts/selections/journey-connection", (route) =>
    route.fulfill({
      json: {
        connection_id: "journey-connection",
        platform: "bluesky",
        workspace_id: workspace!.id,
        expires_at: choiceExpiresAt,
        options: [{ id: "provider-selection", username: "openpost.bsky.social", kind: "profile" }],
      },
    }),
  );
  await page.route("**/api/v1/accounts/selections/journey-connection/complete", async (route) => {
    connected = true;
    await route.fulfill({
      json: {
        workspace_id: workspace!.id,
        account_ids: [account.id],
        open_fresh_composer: true,
      },
    });
  });
  await page.route(`**/api/v1/workspaces/${workspace?.id}/setup`, (route) =>
    route.fulfill({
      json: {
        activated,
        visible: !activated,
        completed_steps: activated ? 4 : connected ? 2 : 1,
        total_steps: 4,
        next_step: connected ? "composition" : "destination",
        next_action: connected ? "create_publication" : "connect_destination",
        action_href: connected ? "/" : "/settings?tab=accounts",
        steps: [
          { id: "workspace", completed: true },
          { id: "destination", completed: connected },
          { id: "composition", completed: false },
          { id: "publication", completed: activated },
        ],
      },
    }),
  );
  await page.route("**/api/v1/capabilities", (route) =>
    route.fulfill({
      json: {
        profiles: [],
        capabilities: [
          {
            provider: "bluesky",
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
            media: { min_count: 0, max_count: 4, allowed_mimes: [] },
            native_scheduling: false,
            openpost_queued: true,
            requires_app_review: false,
            requires_public_media: false,
            settings: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const ids = route.request().postDataJSON().account_ids as string[];
    await route.fulfill({
      json: {
        accounts: ids.map((id) => ({
          account_id: id,
          provider: "bluesky",
          profile: "short_text",
          output_profile: "bluesky.post",
          label: "Bluesky post",
          text_limit: 300,
          media: { min_count: 0, max_count: 4, allowed_mimes: [] },
          intents: ["post"],
          media_shapes: ["text"],
          settings: [],
          setting_groups: [],
          compatible: true,
          active_constraints: {},
          issues: [],
          capability_revision: "journey-v1",
          dynamic_options: {},
          immediate_readiness: readiness(),
          scheduled_readiness: readiness(),
        })),
      },
    });
  });
  await page.route("**/api/v1/provider-readiness?**", (route) =>
    route.fulfill({ json: { providers: [] } }),
  );
  await page.route("**/api/v1/repost-automation*", (route) =>
    route.fulfill({
      json: {
        workspace_id: workspace!.id,
        can_manage: true,
        supported_platforms: ["bluesky"],
        policies: [],
        accounts: [],
        grants: [],
      },
    }),
  );

  await page.goto(
    "/accounts/callback?status=selection_required&platform=bluesky&connection_id=journey-connection",
  );
  await page.getByLabel("openpost.bsky.social").click();
  await page.getByRole("button", { name: /Connect selected/ }).click();
  await expect(page).toHaveURL(new RegExp(`workspace_id=${workspace!.id}`));
  await expect(
    page.getByText("Composer ready. The requested destination is selected."),
  ).toBeVisible();
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row").getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Escape");

  await page.route("**/api/v1/posts/draft", (route) =>
    route.fulfill({
      json: {
        post_id: "journey-post",
        publication_id: "journey-publication",
        revision: 1,
        updated_at: "2026-08-13T12:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/posts/journey-post/draft", (route) =>
    route.fulfill({
      json: {
        post_id: "journey-post",
        publication_id: "journey-publication",
        revision: 2,
        updated_at: "2026-08-13T12:00:01Z",
      },
    }),
  );
  await page.route("**/api/v1/publications", (route) =>
    route.fulfill({
      json: {
        id: "journey-publication",
        workspace_id: workspace!.id,
        revision: 1,
        title: "Short text",
        content_profile: "short_text",
        source_text: "",
        status: "draft",
        renditions: [],
      },
    }),
  );
  await page.route("**/api/v1/publications/journey-publication", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/v1/publications/journey-publication/renditions", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/v1/publications/journey-publication/validate", (route) =>
    route.fulfill({
      json: {
        publication_id: "journey-publication",
        issues: validationBlocks
          ? [
              {
                code: "provider_changed",
                field: "body",
                message: "Review this destination before publishing.",
                fallback_message: "Review this destination before publishing.",
                severity: "error",
                provider: "bluesky",
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/v1/publications/journey-publication/publish-now", async (route) => {
    publishAttempts += 1;
    activated = true;
    await route.fulfill({
      json: {
        message: "Publication queued",
        job_id: "journey-job",
        workspace_activated: true,
        activation_publication_id: "journey-publication",
      },
    });
  });

  await page.getByLabel("Post text").fill("A first useful publication");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Fix the blocking issues before publishing.")).toBeVisible();
  validationBlocks = false;
  await page.getByRole("button", { name: "Publish now" }).click();
  const completion = page.getByTestId("workspace-activation-completion");
  await expect(completion).toContainText("Workspace activated");
  await expect(completion.getByRole("link", { name: "View publication" })).toHaveAttribute(
    "href",
    "/publications/journey-publication",
  );
  await completion.getByRole("button", { name: "Create another" }).click();
  await expect(page.getByLabel("Post text")).toBeEmpty();
  await expect(page.getByTestId("workspace-setup-guide-composer")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(publishAttempts).toBe(1);
  expect(consoleErrors).toEqual([]);
});
