import { expect, test } from "@playwright/test";

test("browser test servers disable external diagnostics", async ({ request }) => {
  const response = await request.get("/api/v1/diagnostics/public-config");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ enabled: false });
});
