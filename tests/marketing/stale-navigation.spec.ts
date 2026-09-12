import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers.js";

test("recovers a failed route import during initial hydration", async ({ page }) => {
  let failedImports = 0;
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  });
  await page.route("**/_app/immutable/nodes/*.js", async (route) => {
    // Root layout and error nodes are eager imports; fail only the page node.
    if (!/\/(0|1)\.[^/]+\.js$/.test(route.request().url()) && failedImports === 0) {
      failedImports++;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/pricing");
  await expect.poll(() => failedImports).toBe(1);
  await expect.poll(() => documents).toBe(2);
  await expect(
    page.getByRole("heading", { name: "OpenPost could not load this page." }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/pricing\/?$/);
  await dismissTelemetryConsent(page);
  const yearly = page.getByRole("button", { name: /^Yearly/ });
  await yearly.click();
  await expect(yearly).toHaveAttribute("aria-pressed", "true");
});

test("failed route imports preserve their cause and allow recovery @desktop", async ({ page }) => {
  // SvelteKit handles this rejection, so pageerror alone cannot detect the secondary crash.
  const debuggerSession = await page.context().newCDPSession(page);
  const exceptions: string[] = [];
  await debuggerSession.send("Debugger.enable");
  await debuggerSession.send("Debugger.setPauseOnExceptions", { state: "all" });
  debuggerSession.on("Debugger.paused", async (event) => {
    if (event.data?.description) exceptions.push(event.data.description);
    await debuggerSession.send("Debugger.resume");
  });
  await page.goto("/");
  await dismissTelemetryConsent(page);
  // Exhaust automatic retries to inspect the error the visitor would otherwise see briefly.
  await page.evaluate(() => {
    sessionStorage.setItem("openpost:chunk-reload", JSON.stringify({ count: 3, at: Date.now() }));
  });
  await page.route("**/_app/immutable/nodes/*.js", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "Pricing", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "OpenPost could not load this page." }),
  ).toBeVisible();
  expect(exceptions.filter((error) => error.includes("universal"))).toEqual([]);
  expect(
    exceptions.some((error) => error.includes("Failed to fetch dynamically imported module")),
  ).toBe(true);
  await page.unroute("**/_app/immutable/nodes/*.js");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "OpenPost could not load this page." }),
  ).toHaveCount(0);
  await debuggerSession.detach();
});
