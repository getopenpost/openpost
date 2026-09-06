import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("meaningful composition starts once across focus, empty drafts, refresh, and composer instances", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `first-composition-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, `First composition ${unique}`)) as {
    id: string;
  };
  const claims: Array<{ signal: string; claimed: boolean }> = [];

  const recordClaim = async (response: import("@playwright/test").Response) => {
    if (
      new URL(response.url()).pathname === `/api/v1/workspaces/${workspace.id}/setup/composition` &&
      response.request().method() === "POST"
    ) {
      const requestBody = response.request().postDataJSON() as {
        signal: string;
      };
      const responseBody = (await response.json()) as { claimed: boolean };
      claims.push({
        signal: requestBody.signal,
        claimed: responseBody.claimed,
      });
    }
  };
  page.on("response", recordClaim);

  await authenticatePage(page, auth.token);
  await page.goto("/");
  const editor = page.getByLabel("Post text");
  await editor.focus();
  await editor.fill("   ");
  await page.waitForTimeout(300);
  expect(claims).toEqual([]);

  const secondComposer = await page.context().newPage();
  secondComposer.on("response", recordClaim);
  await secondComposer.goto("/");
  await Promise.all([
    editor.fill("A meaningful first composition"),
    secondComposer.getByLabel("Post text").fill("A concurrent first composition"),
  ]);
  await expect.poll(() => claims.length).toBe(2);
  expect(claims.map((claim) => claim.claimed).sort()).toEqual([false, true]);
  expect(claims.map((claim) => claim.signal)).toEqual(["text", "text"]);
  await secondComposer.close();

  await page.reload();
  await page.getByLabel("Post text").fill("A meaningful edit after refresh");
  await expect.poll(() => claims.length).toBe(3);
  expect(claims[2]).toEqual({ signal: "text", claimed: false });

  const setupResponse = await request.get(`/api/v1/workspaces/${workspace.id}/setup`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(setupResponse.ok()).toBeTruthy();
  const setup = (await setupResponse.json()) as {
    steps: Array<{ id: string; completed: boolean }>;
  };
  expect(setup.steps).toContainEqual({ id: "composition", completed: true });
});

test("media and content-mode input start composition without exposing content", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `composition-signals-${unique}@example.com`);
  const workspace = (await createWorkspace(
    request,
    auth.token,
    `Composition signals ${unique}`,
  )) as { id: string };
  const signals: string[] = [];

  page.on("request", (browserRequest) => {
    if (
      new URL(browserRequest.url()).pathname ===
      `/api/v1/workspaces/${workspace.id}/setup/composition`
    ) {
      const body = browserRequest.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["origin_key", "signal"]);
      expect(body.origin_key).toMatch(/^[0-9a-f-]{36}$/);
      signals.push(body.signal as string);
    }
  });

  await authenticatePage(page, auth.token);
  await page.goto("/");
  await page.getByRole("button", { name: "Add post", exact: true }).click();
  await expect.poll(() => signals).toEqual(["content_mode"]);

  const secondAuth = await registerUser(request, `composition-media-${unique}@example.com`);
  const secondWorkspace = (await createWorkspace(
    request,
    secondAuth.token,
    `Composition media ${unique}`,
  )) as { id: string };
  await authenticatePage(page, secondAuth.token);
  await page.route("**/api/v1/media**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/media/tags")) {
      await route.fulfill({
        contentType: "application/json",
        json: { tags: [], can_edit: true },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        media: [
          {
            id: "first-composition-media",
            original_filename: "first-composition.png",
            mime_type: "image/png",
            size: 128,
            width: 1,
            height: 1,
            url: "/assets/logo.svg",
            thumbnail_url: "/assets/logo.svg",
            processing_status: "ready",
            analysis_status: "ready",
            asset_kind: "library",
            created_at: "2026-08-13T12:00:00Z",
          },
        ],
        total: 1,
      },
    });
  });
  const mediaSignals: string[] = [];
  page.on("request", (browserRequest) => {
    if (
      new URL(browserRequest.url()).pathname ===
      `/api/v1/workspaces/${secondWorkspace.id}/setup/composition`
    ) {
      mediaSignals.push((browserRequest.postDataJSON() as { signal: string }).signal);
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add media" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("tab", { name: "Library" }).click();
  await picker.getByRole("button", { name: "Select first-composition.png" }).click();
  await picker.getByRole("button", { name: "Add media", exact: true }).click();
  await expect.poll(() => mediaSignals).toEqual(["media"]);
});
