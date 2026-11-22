import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";
import { randomUUID } from "node:crypto";

test.describe("billing recovery", () => {
  interface BillingRecoveryFixture {
    organization_id: string;
    workspace_id: string;
    provider: "paddle";
    status: "active" | "past_due";
    plan_id: string;
    can_manage_billing: boolean;
    access_restricted: boolean;
    past_due_since?: string;
    cancel_at_period_end: boolean;
    limits: Record<string, number>;
    usage: Record<string, number>;
    period_start: string;
    provider_costs: unknown[];
  }

  test("failed-payment recovery stays account-wide, permission-aware, and clears from provider truth", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `billing-recovery-${unique}@example.com`);
    const workspace = await createWorkspace(request, auth.token, `Billing recovery ${unique}`);
    let billingStatus: BillingRecoveryFixture = {
      organization_id: workspace.organization_id,
      workspace_id: workspace.id,
      provider: "paddle",
      status: "past_due",
      plan_id: "team",
      can_manage_billing: true,
      access_restricted: true,
      past_due_since: "2026-08-09T12:00:00Z",
      cancel_at_period_end: false,
      limits: {},
      usage: {},
      period_start: "2026-08-01T00:00:00Z",
      provider_costs: [],
    };
    const recoveryRequests: unknown[] = [];

    await page.route("**/api/v1/billing/status?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: billingStatus,
      });
    });
    await page.route("**/api/v1/billing/portal", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      recoveryRequests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        json: { url: "/settings?tab=plan&recovery=1" },
      });
    });

    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/publications");
    test.skip(
      (await page.locator('meta[name="openpost-edition"][content="cloud"]').count()) === 0,
      "Billing recovery is hosted-only",
    );

    const notice = page.getByTestId("billing-recovery-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Payment action required");
    await expect(notice).toContainText("Past due since");
    await expect(notice).toContainText("paid plan access is restricted");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);

    await notice.getByRole("button", { name: "Update payment method" }).click();
    await expect(page).toHaveURL(/\/settings\?tab=plan&recovery=1$/);
    expect(recoveryRequests).toEqual([
      {
        workspace_id: workspace.id,
        purpose: "update_payment_method",
      },
    ]);

    const recoveryCard = page.getByTestId("billing-recovery-card");
    await expect(recoveryCard).toBeVisible();
    await expect(recoveryCard).toContainText("Payment recovery");
    await expect(recoveryCard).toContainText(
      "OpenPost restores paid-plan access after Paddle confirms recovery.",
    );
    await expect(recoveryCard.getByRole("button", { name: "Update payment method" })).toBeVisible();

    billingStatus = {
      ...billingStatus,
      status: "active",
      access_restricted: false,
      past_due_since: undefined,
    };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("billing-recovery-notice")).toHaveCount(0);
    await expect(page.getByTestId("billing-recovery-card")).toHaveCount(0);

    billingStatus = {
      ...billingStatus,
      status: "past_due",
      can_manage_billing: false,
      access_restricted: true,
      past_due_since: "2026-08-09T12:00:00Z",
    };
    await page.goto("/publications");
    const memberNotice = page.getByTestId("billing-recovery-notice");
    await expect(memberNotice).toBeVisible();
    await expect(memberNotice).toContainText(
      "Ask an organization owner or admin to update the payment method.",
    );
    await expect(memberNotice.getByRole("button", { name: "Update payment method" })).toHaveCount(
      0,
    );
    expect(recoveryRequests).toHaveLength(1);
  });
});

test.describe("checkout open status", () => {
  // The external SDK script is controlled. The route's lifecycle and rendering remain real.
  test("a loaded payment window replaces opening progress and recovers after closure", async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `checkout-status-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Checkout Status");
    await authenticatePage(page, auth.token);
    const attemptID = randomUUID();
    await page.route(`**/api/v1/billing/checkout/${attemptID}`, (route) =>
      route.fulfill({
        json: {
          id: attemptID,
          workspace_id: workspace.id,
          environment: "sandbox",
          client_token: "test_audit_only",
          provider_price_id: "pri_audit_only",
          customer_email: "audit@example.com",
          plan_id: "founder",
          billing_period: "monthly",
          return_url: "http://127.0.0.1/checkout?status=success",
        },
      }),
    );
    await page.route("https://cdn.paddle.com/paddle/v2/paddle.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
      (() => {
        let eventCallback;
        const close = () => document.querySelector('[data-audit-payment]')?.remove();
        window.PaddleBillingV1 = {
          Initialized: false,
          Environment: { set() {} },
          Initialize(options) { this.Initialized = true; eventCallback = options.eventCallback; },
          Update(options) { eventCallback = options.eventCallback; },
          Checkout: {
            close,
            open() {
              const windowElement = document.createElement('aside');
              windowElement.dataset.auditPayment = 'true';
              windowElement.style.cssText = 'position:fixed;inset:auto 1rem 1rem;background:var(--card);border:1px solid var(--border);padding:0.75rem;display:flex;justify-content:center';
              windowElement.setAttribute('role', 'region');
              windowElement.setAttribute('aria-label', 'Controlled payment window');
              const button = document.createElement('button');
              button.textContent = 'Close controlled payment window';
              button.onclick = () => { close(); eventCallback({ name: 'checkout.closed' }); };
              windowElement.append(button); document.body.append(windowElement);
              requestAnimationFrame(() => eventCallback({ name: 'checkout.loaded' }));
            }
          }
        };
      })();`,
      }),
    );
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/billing/") && request.method() !== "GET")
        writes.push(request.url());
    });
    await page.goto(`/checkout?attempt=${attemptID}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.reload();
        await expect(page.getByRole("region", { name: "Controlled payment window" })).toBeVisible();
        const ready = page
          .getByRole("status")
          .filter({ hasText: "Secure payment is open. Complete checkout in the Paddle window." });
        await expect(ready).toBeVisible();
        await page.screenshot({ path: info.outputPath(`checkout-${width}-${scheme}.png`) });

        await expect(ready.locator(".animate-spin")).toHaveCount(0);
        await expect(page.getByText("Opening secure payment…", { exact: true })).toHaveCount(0);
        const close = page.getByRole("button", {
          name: "Close controlled payment window",
          exact: true,
        });
        await close.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("region", { name: "Controlled payment window" })).toHaveCount(
          0,
        );
        const retry = page.getByRole("button", { name: "Try again", exact: true });
        await retry.focus();
        await page.keyboard.press("Enter");
        await expect(ready).toBeVisible();
      }
    expect(writes).toEqual([]);
  });
});
