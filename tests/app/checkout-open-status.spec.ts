import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
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
      await expect(page.getByRole("region", { name: "Controlled payment window" })).toHaveCount(0);
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect(ready).toBeVisible();
    }
  expect(writes).toEqual([]);
});
