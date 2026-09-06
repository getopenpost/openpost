import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
    plan_id: "pro",
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
  await expect(memberNotice.getByRole("button", { name: "Update payment method" })).toHaveCount(0);
  expect(recoveryRequests).toHaveLength(1);
});
