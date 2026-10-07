import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspace, registerUser } from "./helpers";

test.describe.configure({ timeout: 60_000 });

// Serve the real marketing build at its production origin. The app's existing
// fixture server answers its production hostname without making external calls.
async function connectPublicOrigins(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
) {
  await context.route("https://openpo.st/**", async (route) => {
    const url = new URL(route.request().url());
    const root = path.resolve("apps/marketing/dist");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(`${root}/`)) return route.abort();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    } catch {
      file += ".html";
    }
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".woff2": "font/woff2",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: types[path.extname(file)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  await context.route("https://app.openpo.st/**", async (route) => {
    const original = new URL(route.request().url());
    const upstream = await route.fetch({
      url: `${baseURL}${original.pathname}${original.search}`,
      headers: { ...route.request().headers(), origin: baseURL },
    });
    await route.fulfill({
      response: upstream,
      headers: {
        ...upstream.headers(),
        "access-control-allow-origin": route.request().headers().origin ?? "https://app.openpo.st",
      },
    });
  });
}

test("a reviewed thread survives sign-in and becomes an editable draft with its original parts", async ({
  page,
  context,
  request,
  baseURL,
}, testInfo) => {
  const auth = await registerUser(request, `tool-thread-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Imported thread");
  await connectPublicOrigins(context, baseURL!);
  await page.goto("https://openpo.st/tools/thread-splitter");
  const first = "The first launch lesson belongs in the first post. ".repeat(4).trim();
  const second = "The second lesson belongs in the second post. ".repeat(4).trim();
  await page.getByLabel("Text to split into a thread").fill(`${first}\n\n${second}`);
  await expect(page.getByText("Part 2", { exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Schedule this thread", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/login\?redirect=/);
  expect(popup.url()).not.toContain("lesson");
  await popup.reload();
  await expect(popup.getByRole("textbox", { name: /email/i })).toBeVisible();
  await context.addCookies([
    {
      name: "openpost_session",
      value: auth.token,
      domain: "app.openpo.st",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await popup.reload();
  const editors = popup.getByRole("textbox", { name: "Post text", exact: true });
  await expect(editors).toHaveCount(2);
  await expect(editors.nth(0)).toHaveValue(`${first}\n\n1/2`);
  await expect(editors.nth(1)).toHaveValue(`${second}\n\n2/2`);
  await expect(popup).toHaveURL(/\/publications\//);
  const id = new URL(popup.url()).pathname.split("/").at(-1);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const saved = await (await request.get(`/api/v1/publications/${id}`, { headers })).json();
  expect(saved.workspace_id).toBe(workspace.id);
  expect(saved.status).toBe("draft");
  expect(saved.segments.map((item: { body: string }) => item.body)).toEqual([
    `${first}\n\n1/2`,
    `${second}\n\n2/2`,
  ]);
  await editors.nth(1).fill("The second lesson, reviewed in OpenPost.");
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/publications/${id}`, { headers })).json()).segments[1]
          .body,
    )
    .toBe("The second lesson, reviewed in OpenPost.");
  await popup.screenshot({
    path: testInfo.outputPath("imported-thread.png"),
    animations: "disabled",
  });
});

test("preview files and alt text reach the same draft after a failed upload is retried", async ({
  page,
  context,
  request,
  baseURL,
}, testInfo) => {
  const auth = await registerUser(request, `tool-media-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Imported preview");
  await connectPublicOrigins(context, baseURL!);
  await context.addCookies([
    {
      name: "openpost_session",
      value: auth.token,
      domain: "app.openpo.st",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("https://openpo.st/tools/bluesky-post-preview");
  await page.getByLabel("Post copy").fill("A preview with our original image.");
  await page.getByRole("button", { name: /Post details/ }).click();
  await page.getByLabel("Media alt text").fill("A yellow tram in Lisbon.");
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/app/fixtures/product-screenshots/lisbon-tram.png");
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  let rejectUpload = true;
  let holdUpload: Promise<void> | undefined;
  await context.route(
    /https:\/\/app\.openpo\.st\/api\/v1\/media\/upload(?:-session)?$/,
    async (route) => {
      if (rejectUpload)
        return route.fulfill({
          status: 403,
          contentType: "application/problem+json",
          body: JSON.stringify({ detail: "Fixture upload denied" }),
        });
      await holdUpload;
      const upstream = await route.fetch({
        url: `${baseURL}${new URL(route.request().url()).pathname}`,
        headers: { ...route.request().headers(), origin: baseURL! },
      });
      await route.fulfill({
        response: upstream,
        headers: {
          ...upstream.headers(),
          "access-control-allow-origin":
            route.request().headers().origin ?? "https://app.openpo.st",
        },
      });
    },
  );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Schedule this post", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("alert")).toContainText("The draft could not be prepared");
  await popup.reload();
  await expect(popup.getByRole("alert")).toContainText("The draft could not be prepared");
  rejectUpload = false;
  await popup.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Post text", exact: true })).toHaveValue(
    "A preview with our original image.",
  );
  await expect(popup).toHaveURL(/\/publications\//);
  const id = new URL(popup.url()).pathname.split("/").at(-1);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const saved = await (await request.get(`/api/v1/publications/${id}`, { headers })).json();
  expect(saved.segments[0].media).toHaveLength(1);
  expect(saved.segments[0].media[0].alt_text).toBe("A yellow tram in Lisbon.");
  expect(saved.status).toBe("draft");
  await popup.screenshot({
    path: testInfo.outputPath("imported-preview.png"),
    animations: "disabled",
  });
  let releaseUpload!: () => void;
  holdUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const nextPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Schedule this post", exact: true }).click();
  const nextPopup = await nextPopupPromise;
  await expect(nextPopup.getByTestId("compose-shell").getByRole("status")).toContainText(
    "Preparing your draft",
  );
  await nextPopup.getByRole("link", { name: "New post", exact: true }).click();
  const emptyEditor = nextPopup.getByRole("textbox", { name: "Post text", exact: true });
  await expect(emptyEditor).toHaveValue("");
  releaseUpload();
  await expect(
    nextPopup.getByRole("img", { name: "A yellow tram in Lisbon.", exact: true }),
  ).toHaveCount(0);
  await expect(emptyEditor).toHaveValue("");
});
