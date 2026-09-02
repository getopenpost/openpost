import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  authConfigurationQueryOptions,
  authQueryKeys,
  authSessionsQueryOptions,
  emailChangeStatusQueryOptions,
  linkableOIDCProvidersQueryOptions,
  oidcIdentitiesQueryOptions,
  oidcProvidersQueryOptions,
  securityStatusQueryOptions,
  stableQueryStaleTime,
  type AuthSession,
  type AuthConfiguration,
  type EmailChangeStatus,
  type OIDCIdentity,
  type OIDCProvider,
  type SecurityStatus,
} from "./index";

describe("auth query catalogue", () => {
  it("uses stable global keys and forwards cancellation", async () => {
    const configuration = { registration_enabled: true } as AuthConfiguration;
    const providers = [{ id: "provider-1" }] as OIDCProvider[];
    const getAuthConfiguration = vi.fn(async () => configuration);
    const listOIDCProviders = vi.fn(async () => providers);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(authConfigurationQueryOptions({ getAuthConfiguration })),
    ).resolves.toBe(configuration);
    await expect(client.fetchQuery(oidcProvidersQueryOptions({ listOIDCProviders }))).resolves.toBe(
      providers,
    );

    expect(authQueryKeys.configuration()).toEqual(["openpost", "v1", "auth", "configuration"]);
    expect(authQueryKeys.oidcProviders()).toEqual(["openpost", "v1", "auth", "oidc-providers"]);
    expect(getAuthConfiguration).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(listOIDCProviders).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(authConfigurationQueryOptions({ getAuthConfiguration }).staleTime).toBe(
      stableQueryStaleTime,
    );
  });

  it("catalogues actor security reads under distinct cancellable keys", async () => {
    const security = { passkeys: [] } as unknown as SecurityStatus;
    const identities = [{ id: "identity-1" }] as OIDCIdentity[];
    const providers = [{ id: "provider-1" }] as OIDCProvider[];
    const emailChange = {} satisfies EmailChangeStatus;
    const sessions = [{ id: "session-1" }] as AuthSession[];
    const getSecurityStatus = vi.fn(async () => security);
    const listOIDCIdentities = vi.fn(async () => identities);
    const listLinkableOIDCProviders = vi.fn(async () => providers);
    const getEmailChangeStatus = vi.fn(async () => emailChange);
    const listAuthSessions = vi.fn(async () => sessions);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(securityStatusQueryOptions({ getSecurityStatus })),
    ).resolves.toBe(security);
    await expect(
      client.fetchQuery(oidcIdentitiesQueryOptions({ listOIDCIdentities })),
    ).resolves.toBe(identities);
    await expect(
      client.fetchQuery(linkableOIDCProvidersQueryOptions({ listLinkableOIDCProviders })),
    ).resolves.toBe(providers);
    await expect(
      client.fetchQuery(emailChangeStatusQueryOptions({ getEmailChangeStatus })),
    ).resolves.toBe(emailChange);
    await expect(client.fetchQuery(authSessionsQueryOptions({ listAuthSessions }))).resolves.toBe(
      sessions,
    );

    expect(authQueryKeys.security()).toEqual(["openpost", "v1", "auth", "security"]);
    expect(authQueryKeys.oidcIdentities()).toEqual(["openpost", "v1", "auth", "oidc-identities"]);
    expect(authQueryKeys.linkableOIDCProviders()).toEqual([
      "openpost",
      "v1",
      "auth",
      "linkable-oidc-providers",
    ]);
    expect(authQueryKeys.emailChange()).toEqual(["openpost", "v1", "auth", "email-change"]);
    expect(authQueryKeys.sessions()).toEqual(["openpost", "v1", "auth", "sessions"]);
    expect(getSecurityStatus).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(listOIDCIdentities).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(listLinkableOIDCProviders).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(getEmailChangeStatus).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(listAuthSessions).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
});
