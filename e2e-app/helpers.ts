import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const password = "password-1234";

function registrationClientIP(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `198.18.${(hash >>> 8) & 255}.${hash & 255 || 1}`;
}

export async function registerUser(request: APIRequestContext, email: string) {
  const register = await request.post("/api/v1/auth/register", {
    headers: { "X-Forwarded-For": registrationClientIP(email) },
    data: { email, password },
  });
  if (!register.ok()) {
    throw new Error(
      `registration failed with ${register.status()}: ${await register.text()}`,
    );
  }

  const auth = await register.json();
  expect(auth.token).toBeTruthy();
  return auth as { token: string };
}

export async function createWorkspace(
  request: APIRequestContext,
  token: string,
  name: string,
) {
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
