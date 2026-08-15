import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type DeliveryStage = {
  state:
    | "queued"
    | "submitted"
    | "processing"
    | "provider_scheduled"
    | "live"
    | "rejected"
    | "ambiguous"
    | "manual_resolution";
  publicationStatus: "scheduled" | "published" | "failed";
  label: string;
  recoveryAction: "none" | "retry" | "reconcile" | "manual_resolution";
};

const deliveryStages: DeliveryStage[] = [
  { state: "queued", publicationStatus: "scheduled", label: "Queued", recoveryAction: "none" },
  {
    state: "submitted",
    publicationStatus: "scheduled",
    label: "Submitted",
    recoveryAction: "none",
  },
  {
    state: "processing",
    publicationStatus: "scheduled",
    label: "Processing at provider",
    recoveryAction: "reconcile",
  },
  {
    state: "provider_scheduled",
    publicationStatus: "scheduled",
    label: "Scheduled at provider",
    recoveryAction: "none",
  },
  { state: "live", publicationStatus: "published", label: "Live", recoveryAction: "none" },
  {
    state: "rejected",
    publicationStatus: "failed",
    label: "Rejected",
    recoveryAction: "retry",
  },
  {
    state: "ambiguous",
    publicationStatus: "failed",
    label: "Outcome needs reconciliation",
    recoveryAction: "reconcile",
  },
  {
    state: "manual_resolution",
    publicationStatus: "failed",
    label: "Manual review required",
    recoveryAction: "manual_resolution",
  },
];

test("one persisted Rendition exposes every exact delivery outcome across daily surfaces", async ({
  page,
  request,
}) => {
  test.slow();
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `daily-outcomes-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Daily outcome cohort")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await connectMastodon(page, workspace.id);
  await page.goto(`/?workspace=${workspace.id}`);
  await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row").getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByLabel("Post text").fill("One Rendition advances through every provider outcome.");

  const publishResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/v1\/publications\/[^/]+\/publish-now$/u.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish now" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
  const published = (await publishResponse.json()) as { publication_id: string };
  expect(published.publication_id).toBeTruthy();
  await expect(page.getByTestId("composer-delivery-feedback")).toBeVisible();

  const initial = await request.get(`/api/v1/publications/${published.publication_id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(initial.ok(), await initial.text()).toBeTruthy();
  const initialPublication = (await initial.json()) as {
    workspace_id: string;
    source_text: string;
    renditions: Array<{ id: string; social_account_id: string }>;
  };
  expect(initialPublication).toMatchObject({
    workspace_id: workspace.id,
    source_text: "One Rendition advances through every provider outcome.",
  });
  expect(initialPublication.renditions).toHaveLength(1);
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/publications/${published.publication_id}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!response.ok()) return `http-${response.status()}`;
        const publication = (await response.json()) as {
          renditions: Array<{ delivery?: { state: string } }>;
        };
        return publication.renditions[0]?.delivery?.state ?? "missing";
      },
      { timeout: 15_000 },
    )
    .toBe("live");

  for (const [index, stage] of deliveryStages.entries()) {
    await test.step(stage.state, async () => {
      const projected = await page.evaluate(
        async ({ publicationID, state, attemptNumber }) => {
          const response = await fetch(`/api/v1/e2e/publications/${publicationID}/delivery`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state, attempt_number: attemptNumber }),
          });
          return { ok: response.ok, status: response.status, body: await response.text() };
        },
        { publicationID: published.publication_id, state: stage.state, attemptNumber: index + 1 },
      );
      expect(projected.ok, `${projected.status}: ${projected.body}`).toBeTruthy();

      const persisted = await request.get(`/api/v1/publications/${published.publication_id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      expect(persisted.ok(), await persisted.text()).toBeTruthy();
      const publication = (await persisted.json()) as {
        status: string;
        renditions: Array<{
          id: string;
          delivery?: { state: string; recovery_action: string; current_attempt_number: number };
        }>;
      };
      expect(publication.status).toBe(stage.publicationStatus);
      expect(publication.renditions).toHaveLength(1);
      expect(publication.renditions[0].delivery).toMatchObject({
        state: stage.state,
        recovery_action: stage.recoveryAction,
        current_attempt_number: index + 1,
      });

      await page.goto(`/publications/${published.publication_id}?workspace=${workspace.id}`);
      const destinations = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Destinations" }),
      });
      await expect(destinations.getByText(stage.label, { exact: true })).toBeVisible();
      await expectRecoveryAction(destinations, stage);
      const history = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Version history" }),
      });
      await expect(history.getByText(stage.label, { exact: true }).first()).toBeVisible();
      if (index === deliveryStages.length - 1) {
        await expectNoSeriousAccessibilityViolations(page);
      }
      await page.goto(`/activity?workspace=${workspace.id}`);
      const activityTab =
        stage.publicationStatus === "published"
          ? "Published"
          : stage.publicationStatus === "failed"
            ? "Failed"
            : "Scheduled";
      await page.getByRole("tab", { name: activityTab, exact: true }).click();
      const activity = page.getByRole("tabpanel", { name: activityTab, exact: true });
      await expect(activity.getByText(stage.label, { exact: true }).first()).toBeVisible();
      await expectRecoveryAction(activity, stage);
      await expectNoDocumentOverflow(page);
      if (index === deliveryStages.length - 1) {
        await expectNoSeriousAccessibilityViolations(page);
      }
    });
  }

  const outsider = await registerUser(request, `daily-outsider-${unique}@example.com`);
  const forbidden = await request.post(
    `/api/v1/e2e/publications/${published.publication_id}/delivery`,
    {
      headers: { Authorization: `Bearer ${outsider.token}` },
      data: { state: "live", attempt_number: 9 },
    },
  );
  expect(forbidden.status()).toBe(403);
  expect(consoleErrors).toEqual([]);
});

async function connectMastodon(page: Page, workspaceID: string) {
  const providersResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/accounts/providers" &&
      response.request().method() === "GET",
  );
  const accountsResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/accounts" &&
      response.request().method() === "GET",
  );
  await page.goto(`/settings?tab=accounts&workspace=${workspaceID}`);
  expect((await providersResponse).ok()).toBeTruthy();
  expect((await accountsResponse).ok()).toBeTruthy();
  const authURL = await page.evaluate(async (id) => {
    const query = new URLSearchParams({
      workspace_id: id,
      server_name: "OpenPost Daily E2E",
    });
    const response = await fetch(`/api/v1/accounts/mastodon/auth-url?${query}`, {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await response.text());
    localStorage.setItem("oauth_account_management_mode", "settings");
    localStorage.setItem("oauth_workspace_id", id);
    localStorage.setItem("oauth_mastodon_server", "OpenPost Daily E2E");
    localStorage.removeItem("oauth_mastodon_instance_url");
    return ((await response.json()) as { url: string }).url;
  }, workspaceID);
  await page.goto(authURL);
  await expect(page).toHaveURL(new RegExp(`workspace_id=${workspaceID}`), { timeout: 15_000 });
  await expect(
    page.getByText("Composer ready. The requested destination is selected."),
  ).toBeVisible();
}

async function expectRecoveryAction(page: Page | Locator, stage: DeliveryStage) {
  const retry = page.getByRole("button", { name: "Retry destination" });
  const review = page.getByRole("button", { name: "Review destination" });
  const reconcile = page.getByText("OpenPost is checking the provider before another send.");

  if (stage.recoveryAction === "retry") await expect(retry.first()).toBeVisible();
  else await expect(retry).toHaveCount(0);
  if (stage.recoveryAction === "manual_resolution") await expect(review.first()).toBeVisible();
  else await expect(review).toHaveCount(0);
  if (stage.recoveryAction === "reconcile") await expect(reconcile.first()).toBeVisible();
  else await expect(reconcile).toHaveCount(0);
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}
