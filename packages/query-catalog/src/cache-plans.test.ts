import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import {
  accountMutationCachePlan,
  adminQueryKeys,
  authQueryKeys,
  billingMutationCachePlan,
  billingQueryKeys,
  developerQueryKeys,
  emailChangeCachePlan,
  featureQueryKeys,
  openPostBootstrapQueryKeys,
  openPostQueryKeys,
  organizationIdentityMutationCachePlan,
  organizationQueryKeys,
  passwordChangeCachePlan,
  publicationInvalidationCachePlan,
  publicProfileQueryKeys,
  workspaceInvitationAcceptanceCachePlan,
  workspaceInvitationRefreshCachePlan,
  workspaceCreationCachePlan,
  workspaceSettingsQueryKeys,
  type QueryCachePlan,
} from "./index";

async function applyPlan(client: QueryClient, plan: QueryCachePlan) {
  for (const filters of plan.remove ?? []) client.removeQueries(filters);
  await Promise.all(plan.invalidate.map((filters) => client.invalidateQueries(filters)));
}

function seed(client: QueryClient, ...queryKeys: readonly (readonly unknown[])[]) {
  for (const queryKey of queryKeys) client.setQueryData(queryKey, "cached");
}

function expectInvalidated(client: QueryClient, queryKey: readonly unknown[]) {
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
}

describe("mutation cache plans", () => {
  it("owns the complete Workspace creation inventory", async () => {
    const client = new QueryClient();
    const bootstrap = openPostBootstrapQueryKeys.app("workspace-1");
    const workspaces = openPostBootstrapQueryKeys.workspaces();
    const overview = adminQueryKeys.overview();
    const users = adminQueryKeys.users({
      page: 1,
      perPage: 20,
      search: "",
      sort: "created_at",
      direction: "desc",
    });
    const organizations = organizationQueryKeys.all();
    const unrelated = billingQueryKeys.status("workspace-1");
    seed(client, bootstrap, workspaces, overview, users, organizations, unrelated);

    await applyPlan(client, workspaceCreationCachePlan());

    for (const queryKey of [bootstrap, workspaces, overview, users, organizations]) {
      expectInvalidated(client, queryKey);
    }
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("owns every account mutation dependency without crossing Workspace scope", async () => {
    const client = new QueryClient();
    const profile = publicProfileQueryKeys.detail("founder");
    const accounts = openPostQueryKeys.accounts("workspace-1");
    const otherAccounts = openPostQueryKeys.accounts("workspace-2");
    const socialSets = openPostQueryKeys.socialSets("workspace-1");
    const features = featureQueryKeys.accountStates("workspace-1", ["account-1"]);
    const adminUsers = adminQueryKeys.usersRoot();
    const setup = workspaceSettingsQueryKeys.setup("workspace-1");
    seed(client, profile, accounts, otherAccounts, socialSets, features, adminUsers, setup);

    await applyPlan(client, accountMutationCachePlan("workspace-1"));

    expect(client.getQueryData(profile)).toBeUndefined();
    for (const queryKey of [accounts, socialSets, features, adminUsers, setup]) {
      expectInvalidated(client, queryKey);
    }
    expect(client.getQueryState(otherAccounts)?.isInvalidated).toBe(false);
  });

  it("normalizes affected auth projections and keeps password changes narrow", async () => {
    const emailPlan = emailChangeCachePlan({
      workspaceIds: ["workspace-1", "", "workspace-1", "workspace-2"],
      organizationIds: ["organization-1", "organization-1"],
    });
    expect(emailPlan.invalidate.map((filters) => filters.queryKey)).toEqual([
      authQueryKeys.sessions(),
      adminQueryKeys.usersRoot(),
      adminQueryKeys.aiPrompts(),
      workspaceSettingsQueryKeys.team("workspace-1"),
      workspaceSettingsQueryKeys.team("workspace-2"),
      organizationQueryKeys.team("organization-1"),
      organizationQueryKeys.ownershipTransfer("organization-1"),
    ]);
    expect(passwordChangeCachePlan()).toEqual({
      invalidate: [
        { queryKey: authQueryKeys.security(), exact: true },
        { queryKey: authQueryKeys.sessions(), exact: true },
      ],
    });
  });

  it("invalidates billing projections across cached Workspaces and the captured organization", async () => {
    const client = new QueryClient();
    const profile = publicProfileQueryKeys.detail("founder");
    const billingOne = billingQueryKeys.status("workspace-1");
    const billingTwo = billingQueryKeys.status("workspace-2");
    const features = featureQueryKeys.accountStates("workspace-2", ["account-1"]);
    const setup = workspaceSettingsQueryKeys.setup("workspace-3");
    const organizationAudit = organizationQueryKeys.audit("organization-1", { limit: 20 });
    const otherOrganizationAudit = organizationQueryKeys.audit("organization-2", { limit: 20 });
    const instanceAudit = organizationQueryKeys.instanceAudit({ limit: 20 });
    seed(
      client,
      profile,
      billingOne,
      billingTwo,
      features,
      setup,
      organizationAudit,
      otherOrganizationAudit,
      instanceAudit,
    );

    await applyPlan(client, billingMutationCachePlan("organization-1"));

    expect(client.getQueryData(profile)).toBeUndefined();
    for (const queryKey of [
      billingOne,
      billingTwo,
      features,
      setup,
      organizationAudit,
      instanceAudit,
    ]) {
      expectInvalidated(client, queryKey);
    }
    expect(client.getQueryState(otherOrganizationAudit)?.isInvalidated).toBe(false);
  });

  it("invalidates the organization identity graph and every cached billing status", async () => {
    const client = new QueryClient();
    const organizationTeam = organizationQueryKeys.team("organization-1");
    const otherOrganizationTeam = organizationQueryKeys.team("organization-2");
    const instanceAudit = organizationQueryKeys.instanceAudit({ limit: 20 });
    const linkableProviders = authQueryKeys.linkableOIDCProviders();
    const identities = authQueryKeys.oidcIdentities();
    const sessions = authQueryKeys.sessions();
    const activity = developerQueryKeys.mcpActivity(50);
    const billingOne = billingQueryKeys.status("workspace-1");
    const billingTwo = billingQueryKeys.status("workspace-2");
    seed(
      client,
      organizationTeam,
      otherOrganizationTeam,
      instanceAudit,
      linkableProviders,
      identities,
      sessions,
      activity,
      billingOne,
      billingTwo,
    );

    await applyPlan(client, organizationIdentityMutationCachePlan("organization-1"));

    for (const queryKey of [
      organizationTeam,
      instanceAudit,
      linkableProviders,
      identities,
      sessions,
      activity,
      billingOne,
      billingTwo,
    ]) {
      expectInvalidated(client, queryKey);
    }
    expect(client.getQueryState(otherOrganizationTeam)?.isInvalidated).toBe(false);
  });
});

describe("Workspace invitation cache plans", () => {
  it("refreshes bootstrap and every newly reachable Workspace dependency", async () => {
    const client = new QueryClient();
    const profile = publicProfileQueryKeys.detail("founder");
    const bootstrap = openPostBootstrapQueryKeys.app("workspace-1");
    const workspaces = openPostBootstrapQueryKeys.workspaces();
    const organizationTeam = organizationQueryKeys.team("organization-1");
    const workspaceTeam = workspaceSettingsQueryKeys.team("workspace-1");
    seed(client, profile, bootstrap, workspaces, organizationTeam, workspaceTeam);

    const plan = workspaceInvitationAcceptanceCachePlan("workspace-1");
    expect(plan.remove).toEqual([{ queryKey: publicProfileQueryKeys.all() }]);
    expect(plan.invalidate.map((filters) => filters.queryKey ?? "predicate")).toEqual([
      openPostBootstrapQueryKeys.appRoot(),
      openPostBootstrapQueryKeys.workspaces(),
      adminQueryKeys.usersRoot(),
      developerQueryKeys.mcpActivityRoot(),
      organizationQueryKeys.all(),
      authQueryKeys.linkableOIDCProviders(),
      authQueryKeys.security(),
      workspaceSettingsQueryKeys.team("workspace-1"),
      workspaceSettingsQueryKeys.setup("workspace-1"),
      ["openpost", "v1", "workspace", "workspace-1", "access-audit"],
      organizationQueryKeys.instanceAuditRoot(),
      "predicate",
    ]);

    await applyPlan(client, plan);

    expect(client.getQueryData(profile)).toBeUndefined();
    for (const queryKey of [bootstrap, workspaces, organizationTeam, workspaceTeam]) {
      expectInvalidated(client, queryKey);
    }
  });

  it("adds organization-specific projections after refreshed bootstrap identifies the owner", async () => {
    const client = new QueryClient();
    const organizationTeam = organizationQueryKeys.team("organization-1");
    const organizationAudit = organizationQueryKeys.audit("organization-1", { limit: 20 });
    const otherOrganizationTeam = organizationQueryKeys.team("organization-2");
    const workspaceTeam = workspaceSettingsQueryKeys.team("workspace-1");
    seed(client, organizationTeam, organizationAudit, otherOrganizationTeam, workspaceTeam);

    const plan = workspaceInvitationRefreshCachePlan("workspace-1", "organization-1");
    expect(plan.invalidate.map((filters) => filters.queryKey)).toEqual([
      adminQueryKeys.usersRoot(),
      developerQueryKeys.mcpActivityRoot(),
      organizationQueryKeys.all(),
      authQueryKeys.linkableOIDCProviders(),
      authQueryKeys.security(),
      workspaceSettingsQueryKeys.team("workspace-1"),
      workspaceSettingsQueryKeys.setup("workspace-1"),
      ["openpost", "v1", "workspace", "workspace-1", "access-audit"],
      organizationQueryKeys.instanceAuditRoot(),
      organizationQueryKeys.team("organization-1"),
      organizationQueryKeys.auditRoot("organization-1"),
    ]);

    await applyPlan(client, plan);

    for (const queryKey of [organizationTeam, organizationAudit, workspaceTeam]) {
      expectInvalidated(client, queryKey);
    }
    expect(client.getQueryState(otherOrganizationTeam)?.isInvalidated).toBe(false);
  });
});

describe("publication invalidation cache plans", () => {
  it("maps Activity and draft events to their owned cache families", async () => {
    const client = new QueryClient();
    const activity = openPostQueryKeys.publications.activity("workspace-1", "scheduled", {
      limit: 40,
    });
    const failedJobs = openPostQueryKeys.jobs.failedPage("workspace-1", { limit: 50 });
    const drafts = openPostQueryKeys.publications.activity("workspace-2", "draft", { limit: 40 });
    const published = openPostQueryKeys.publications.activity("workspace-2", "published", {
      limit: 40,
    });
    seed(client, activity, failedJobs, drafts, published);

    await applyPlan(
      client,
      publicationInvalidationCachePlan([
        { workspaceId: "workspace-1", scopes: ["activity"] },
        { workspaceId: "workspace-2", scopes: ["drafts"] },
      ]),
    );

    for (const queryKey of [activity, failedJobs, drafts]) expectInvalidated(client, queryKey);
    expect(client.getQueryState(published)?.isInvalidated).toBe(false);
  });

  it("invalidates only the exact buckets carried by a move", async () => {
    const client = new QueryClient();
    const scheduled = openPostQueryKeys.publications.activity("workspace-1", "scheduled", {
      limit: 40,
    });
    const published = openPostQueryKeys.publications.activity("workspace-1", "published", {
      limit: 40,
    });
    const failed = openPostQueryKeys.publications.activity("workspace-1", "failed", {
      limit: 40,
    });
    const failedJobs = openPostQueryKeys.jobs.failedPage("workspace-1", { limit: 50 });
    seed(client, scheduled, published, failed, failedJobs);

    await applyPlan(
      client,
      publicationInvalidationCachePlan([
        {
          workspaceId: "workspace-1",
          scopes: ["activity", "calendar"],
          activities: ["scheduled", "published"],
        },
      ]),
    );

    for (const queryKey of [scheduled, published]) expectInvalidated(client, queryKey);
    expect(client.getQueryState(failed)?.isInvalidated).toBe(false);
    expect(client.getQueryState(failedJobs)?.isInvalidated).toBe(false);
  });

  it("keeps failed-jobs invalidation scoped to failed-bucket moves", async () => {
    const client = new QueryClient();
    const failed = openPostQueryKeys.publications.activity("workspace-1", "failed", {
      limit: 40,
    });
    const failedJobs = openPostQueryKeys.jobs.failedPage("workspace-1", { limit: 50 });
    seed(client, failed, failedJobs);

    await applyPlan(
      client,
      publicationInvalidationCachePlan([
        {
          workspaceId: "workspace-1",
          scopes: ["activity"],
          activities: ["failed", "scheduled"],
        },
      ]),
    );

    for (const queryKey of [failed, failedJobs]) expectInvalidated(client, queryKey);
  });

  it("keeps wildcard Activity invalidation precise", async () => {
    const client = new QueryClient();
    const activity = openPostQueryKeys.publications.activity("workspace-1", "failed", {
      limit: 40,
    });
    const failedJobs = openPostQueryKeys.jobs.failedPage("workspace-2", { limit: 50 });
    const detail = openPostQueryKeys.publications.detail("workspace-1", "publication-1");
    seed(client, activity, failedJobs, detail);

    await applyPlan(
      client,
      publicationInvalidationCachePlan([{ workspaceId: "*", scopes: ["activity"] }]),
    );

    expectInvalidated(client, activity);
    expectInvalidated(client, failedJobs);
    expect(client.getQueryState(detail)?.isInvalidated).toBe(false);
  });
});
