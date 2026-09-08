import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers.js";

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
  await page.getByRole("link", { name: "Features", exact: true }).first().click();
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
