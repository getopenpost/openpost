import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  instanceAuditQueryOptions,
  isOrganizationAuditQueryKey,
  organizationAuditQueryOptions,
  organizationIdentityAuditQueryOptions,
  organizationIdentityProvidersQueryOptions,
  organizationQueryKeys,
  organizationsQueryOptions,
  organizationSSODomainsQueryOptions,
  organizationSSOPolicyQueryOptions,
  organizationTeamQueryOptions,
  ownershipTransferQueryOptions,
  type InstanceAuditPage,
  type Organization,
  type OrganizationAuditPage,
  type OrganizationIdentityAuditEvent,
  type OrganizationIdentityProvider,
  type OrganizationSSODomain,
  type OrganizationSSOPolicy,
  type OrganizationTeam,
  type PendingOwnershipTransfer,
} from "./index";

describe("organization queries", () => {
  it("partitions every organization-owned read and forwards cancellation", async () => {
    const organizationId = "organization-1";
    const organizations = [{ id: organizationId }] as Organization[];
    const team = { members: [] } as unknown as OrganizationTeam;
    const transfer = { pending: false } satisfies PendingOwnershipTransfer;
    const providers = [] as OrganizationIdentityProvider[];
    const policy = { mode: "disabled" } as unknown as OrganizationSSOPolicy;
    const domains = [] as OrganizationSSODomain[];
    const identityAudit = [] as OrganizationIdentityAuditEvent[];
    const audit = { items: [] } as OrganizationAuditPage;
    const instanceAudit = { items: [] } as InstanceAuditPage;
    const api = {
      listOrganizations: vi.fn(async () => organizations),
      getOrganizationTeam: vi.fn(async () => team),
      getOwnershipTransfer: vi.fn(async () => transfer),
      listIdentityProviders: vi.fn(async () => providers),
      getSSOPolicy: vi.fn(async () => policy),
      listSSODomains: vi.fn(async () => domains),
      listIdentityAuditEvents: vi.fn(async () => identityAudit),
      listOrganizationAuditEvents: vi.fn(async () => audit),
      listInstanceAuditEvents: vi.fn(async () => instanceAudit),
    };
    const client = new QueryClient();
    const auditQuery = { action: "member.updated", limit: 50 };

    await client.fetchQuery(organizationsQueryOptions(api));
    await client.fetchQuery(organizationTeamQueryOptions(api, organizationId));
    await client.fetchQuery(ownershipTransferQueryOptions(api, organizationId));
    await client.fetchQuery(organizationIdentityProvidersQueryOptions(api, organizationId));
    await client.fetchQuery(organizationSSOPolicyQueryOptions(api, organizationId));
    await client.fetchQuery(organizationSSODomainsQueryOptions(api, organizationId));
    await client.fetchQuery(organizationIdentityAuditQueryOptions(api, organizationId, 20));
    await client.fetchQuery(organizationAuditQueryOptions(api, organizationId, auditQuery));
    await client.fetchQuery(instanceAuditQueryOptions(api, auditQuery));

    expect(organizationQueryKeys.team(organizationId)).toEqual([
      "openpost",
      "v1",
      "organization",
      organizationId,
      "team",
    ]);
    expect(organizationQueryKeys.audit(organizationId, auditQuery)).toEqual([
      "openpost",
      "v1",
      "organization",
      organizationId,
      "audit",
      auditQuery,
    ]);
    expect(
      isOrganizationAuditQueryKey(organizationQueryKeys.audit(organizationId, auditQuery)),
    ).toBe(true);
    expect(
      isOrganizationAuditQueryKey(organizationQueryKeys.identityAudit(organizationId, 20)),
    ).toBe(false);
    expect(api.getOrganizationTeam).toHaveBeenCalledWith(organizationId, expect.any(AbortSignal));
    expect(api.listIdentityAuditEvents).toHaveBeenCalledWith(
      organizationId,
      20,
      expect.any(AbortSignal),
    );
    expect(api.listOrganizationAuditEvents).toHaveBeenCalledWith(
      organizationId,
      auditQuery,
      expect.any(AbortSignal),
    );
    expect(api.listInstanceAuditEvents).toHaveBeenCalledWith(auditQuery, expect.any(AbortSignal));
  });
});
