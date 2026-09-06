import type { Page } from "@playwright/test";

export async function dismissTelemetryConsent(page: Page) {
  const consent = page.getByTestId("telemetry-consent");
  await consent.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  if (await consent.isVisible()) {
    await consent.getByRole("button", { name: "Continue without cookies" }).click();
  }
}
