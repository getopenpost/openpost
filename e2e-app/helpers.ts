import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const password = "password-1234";

function registrationHash(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function registrationClientIP(seed: string): string {
  const hash = registrationHash(seed);
  return `198.18.${(hash >>> 8) & 255}.${hash & 255 || 1}`;
}

function registrationUsername(seed: string): string {
  return `e2e-${registrationHash(seed).toString(36)}`;
}

export async function registerUser(request: APIRequestContext, email: string) {
  const register = await request.post("/api/v1/auth/register", {
    headers: { "X-Forwarded-For": registrationClientIP(email) },
    data: { email, username: registrationUsername(email), password },
  });
  if (!register.ok()) {
    throw new Error(`registration failed with ${register.status()}: ${await register.text()}`);
  }

  const auth = await register.json();
  expect(auth.token).toBeTruthy();
  return auth as { token: string };
}

export async function createWorkspace(request: APIRequestContext, token: string, name: string) {
  const workspace = await request.post("/api/v1/workspaces", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  if (!workspace.ok()) {
    throw new Error(
      `workspace creation failed with ${workspace.status()}: ${await workspace.text()}`,
    );
  }
  return workspace.json();
}

export async function createPublication(
  request: APIRequestContext,
  token: string,
  workspaceID: string,
  sourceText: string,
  options: { contentProfile?: string; mediaIDs?: string[] } = {},
) {
  const publication = await request.post("/api/v1/publications", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      workspace_id: workspaceID,
      title: sourceText.slice(0, 80) || "Untitled",
      content_profile: options.contentProfile ?? "short_text",
      source_text: sourceText,
      social_account_ids: [],
      media: (options.mediaIDs ?? []).map((mediaID) => ({ media_id: mediaID })),
    },
  });
  if (!publication.ok()) {
    throw new Error(
      `publication creation failed with ${publication.status()}: ${await publication.text()}`,
    );
  }
  return publication.json() as Promise<{
    id: string;
    publication_id?: string;
    revision: number;
  }>;
}

export async function authenticatePage(page: Page, token: string) {
  await page.context().addCookies([
    {
      name: "openpost_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function composerDeliveryAction(page: Page, name: string) {
  const trigger = page.getByTestId("composer-delivery-menu");
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu.getByRole("menuitem", { name, exact: true });
}

export async function clickComposerDeliveryAction(page: Page, name: string) {
  const action = await composerDeliveryAction(page, name);
  await expect(action).toBeVisible();
  await action.click();
}

export async function routeBrowserRegistration(page: Page, seed: string) {
  await page.route("**/api/v1/auth/register", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "X-Forwarded-For": registrationClientIP(seed),
      },
    });
  });
}
