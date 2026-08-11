import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatLegalDate,
  formatPolicyEffectiveDate,
  legalChangeHistory,
  legalPolicy,
  managedService,
  privacyInventory,
  securityAssurance,
} from "./index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function assertCurrentReview(register, name) {
  const reviewedAt = Date.parse(`${register.reviewed_on}T00:00:00Z`);
  const nextReviewAt = Date.parse(`${register.next_review_on}T23:59:59Z`);
  assert.ok(Number.isFinite(reviewedAt), `${name} needs a valid review date`);
  assert.ok(Number.isFinite(nextReviewAt), `${name} needs a valid next review`);
  assert.ok(nextReviewAt > reviewedAt, `${name} review dates are reversed`);
  assert.ok(
    Date.now() <= nextReviewAt,
    `${name} facts require review after ${register.next_review_on}`,
  );
}

function assertSourcePathsExist(paths, owner) {
  for (const source of paths) {
    assert.ok(
      existsSync(`${repositoryRoot}${source}`),
      `${owner} references missing source ${source}`,
    );
  }
}

test("official policy documents use explicit independent acceptance rules", () => {
  assert.equal(legalPolicy.schema_version, 1);
  assert.equal(legalPolicy.terms.requires_acceptance, true);
  assert.equal(legalPolicy.privacy.requires_acceptance, true);
  assert.equal(legalPolicy.refunds.requires_acceptance, false);
});

test("effective dates format from the canonical ISO value", () => {
  assert.equal(formatPolicyEffectiveDate(legalPolicy.privacy), "11 August 2026");
  assert.equal(formatLegalDate("2026-08-05"), "5 August 2026");
  assert.throws(() => formatLegalDate("not-a-date"), /invalid legal date/u);
});

test("managed-service disclosure accounts for every reviewed data path", () => {
  assert.equal(managedService.schema_version, 1);
  assert.match(managedService.contact, /^[^@]+@[^@]+$/u);
  assert.deepEqual(
    managedService.stores.map(({ id }) => id),
    ["primary-host", "recovery-copies", "media-objects", "browser-local"],
  );
  assert.deepEqual(
    managedService.providers.map(({ id }) => id),
    [
      "hetzner",
      "posthog",
      "cloudflare",
      "purelymail",
      "paddle",
      "openrouter",
      "microsoft-azure-ai",
      "discord-feedback",
      "pexels",
      "pixabay",
      "unsplash",
    ],
  );
  assert.deepEqual(Object.keys(managedService.human_access).sort(), [
    "approval",
    "authentication",
    "emergency",
    "logging",
    "review_and_revocation",
    "routine_access",
    "scope",
    "support_access",
  ]);
});

test("managed-service facts have current reviews and safe primary sources", () => {
  assertCurrentReview(managedService, "managed-service");

  for (const provider of managedService.providers) {
    assert.ok(provider.purpose.length > 20, `${provider.id} needs a purpose`);
    assert.ok(
      provider.data.length > 20,
      `${provider.id} needs data categories`,
    );
    assert.ok(provider.location.length > 10, `${provider.id} needs a location`);
    assert.ok(
      provider.transfer.length > 20,
      `${provider.id} needs transfer facts`,
    );
    assert.ok(provider.source_urls.length > 0, `${provider.id} needs a source`);
    for (const source of provider.source_urls) {
      const url = new URL(source);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
    }
  }

  const unsafeKeys = [];
  const visit = (value, path = "managedService") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        /^(api_?key|client_?secret|password|token|webhook_?url)$/iu.test(key)
      ) {
        unsafeKeys.push(`${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(managedService);
  assert.deepEqual(unsafeKeys, []);
});

test("managed data has an owned purpose, retention rule, and deletion trigger", () => {
  assert.equal(privacyInventory.schema_version, 1);
  assertCurrentReview(privacyInventory, "privacy inventory");
  assert.ok(privacyInventory.summary_notice.includes("not a replacement"));
  assert.ok(privacyInventory.summary_points.length >= 5);

  const ids = new Set();
  for (const entry of privacyInventory.managed_retention) {
    assert.ok(!ids.has(entry.id), `duplicate managed category ${entry.id}`);
    ids.add(entry.id);
    for (const field of [
      "category",
      "owner",
      "purpose",
      "includes",
      "duration",
      "deletion_trigger",
      "exceptions",
    ]) {
      assert.ok(
        entry[field].length >= 20,
        `${entry.id} needs a useful ${field}`,
      );
    }
    assert.ok(entry.evidence.length > 0, `${entry.id} needs source evidence`);
    assertSourcePathsExist(entry.evidence, entry.id);
  }

  assert.deepEqual([...ids].sort(), [
    "account-profile-legal",
    "analytics-usage",
    "api-cli-mcp-access",
    "automatic-image-captions",
    "billing-records",
    "browser-sessions",
    "communications-notifications",
    "connected-social-accounts",
    "identity-administration-audit",
    "managed-editor-brand-data",
    "managed-media",
    "one-time-auth-records",
    "operational-logs",
    "operator-provider-configuration",
    "organizations-workspaces-membership",
    "outbound-email",
    "publishing-content",
    "publishing-history-jobs",
    "recovery-copies",
    "sign-in-credentials",
    "stock-search-cache",
    "support-feedback",
    "website-analytics",
  ]);
});

test("browser storage inventory covers every supported storage technology", () => {
  assert.deepEqual(
    [
      ...new Set(
        privacyInventory.browser_storage.map(({ technology }) => technology),
      ),
    ].sort(),
    [
      "Cache Storage",
      "IndexedDB",
      "OPFS",
      "cookie",
      "localStorage",
      "sessionStorage",
    ],
  );

  const ids = new Set();
  const identifiers = new Set();
  for (const entry of privacyInventory.browser_storage) {
    assert.ok(!ids.has(entry.id), `duplicate browser-storage row ${entry.id}`);
    ids.add(entry.id);
    const identity = `${entry.technology}:${entry.identifier_kind}:${entry.identifier}`;
    assert.ok(
      !identifiers.has(identity),
      `duplicate browser identifier ${identity}`,
    );
    identifiers.add(identity);
    assert.match(entry.identifier_kind, /^(exact|prefix)$/u);
    assert.match(entry.necessity, /^(strictly_necessary|functional)$/u);
    for (const field of ["owner", "purpose", "scope", "duration"]) {
      assert.ok(
        entry[field].length >= 15,
        `${entry.id} needs a useful ${field}`,
      );
    }
    assert.ok(
      entry.source_refs.length > 0,
      `${entry.id} needs source evidence`,
    );
    assertSourcePathsExist(entry.source_refs, entry.id);
  }

  for (const required of [
    "cookie:exact:openpost_session",
    "cookie:exact:openpost_oidc_binding",
    "cookie:exact:PARAGLIDE_LOCALE",
    "cookie:exact:sidebar:state",
    "localStorage:exact:mode-watcher-mode",
    "localStorage:exact:mode-watcher-theme",
    "localStorage:exact:vitepress-theme-appearance",
    "sessionStorage:exact:openpost:marketing-motion",
    "IndexedDB:exact:openpost-studio",
    "IndexedDB:exact:openpost-video-editor",
    "IndexedDB:exact:workbox-expiration",
    "OPFS:exact:openpost-image-editor-media",
    "OPFS:exact:openpost-video-editor",
    "OPFS:exact:openpost-video-streams",
    "Cache Storage:exact:openpost-pages-1",
    "Cache Storage:exact:openpost-app-assets-1",
    "Cache Storage:exact:openpost-image-editor-models-1.7.0",
    "Cache Storage:exact:transformers-cache",
    "Cache Storage:prefix:workbox-precache-v2-",
  ]) {
    assert.ok(
      identifiers.has(required),
      `missing browser identifier ${required}`,
    );
  }
});

test("material legal history has a current entry for every canonical policy", () => {
  assert.equal(legalChangeHistory.schema_version, 1);
  assert.equal(legalChangeHistory.reviewed_on, privacyInventory.reviewed_on);
  assert.match(legalChangeHistory.scope, /material changes/u);

  const identities = new Set();
  for (const entry of legalChangeHistory.entries) {
    const identity = `${entry.document}:${entry.version}`;
    assert.ok(
      !identities.has(identity),
      `duplicate legal history entry ${identity}`,
    );
    identities.add(identity);
    assert.ok(Number.isFinite(Date.parse(`${entry.effective_date}T00:00:00Z`)));
    assert.equal(new URL(entry.url).protocol, "https:");
    assert.ok(entry.changes.length > 0, `${identity} needs a material change`);
    assert.ok(entry.changes.every((change) => change.length >= 30));
  }

  for (const document of ["terms", "privacy", "refunds"]) {
    const policy = legalPolicy[document];
    const current = legalChangeHistory.entries.find(
      (entry) =>
        entry.document === document && entry.version === policy.version,
    );
    assert.ok(current, `missing current ${document} history`);
    assert.equal(current.effective_date, policy.effective_date);
    assert.equal(current.url, policy.url);
  }
});

test("security assurance states the evidence and independent-assurance boundary", () => {
  assert.equal(securityAssurance.schema_version, 1);
  assertCurrentReview(securityAssurance, "security assurance");
  assert.deepEqual(
    securityAssurance.assurance_boundary.published_certifications,
    [],
  );
  assert.deepEqual(
    securityAssurance.assurance_boundary.published_independent_reports,
    [],
  );
  assert.match(
    securityAssurance.assurance_boundary.statement,
    /does not claim SOC 2/u,
  );
  assert.match(securityAssurance.assurance_boundary.statement, /ISO 27001/u);
  assert.match(
    securityAssurance.assurance_boundary.statement,
    /penetration-test/u,
  );
  assert.equal(securityAssurance.incident_history.status, "no_public_entries");
  assert.deepEqual(securityAssurance.incident_history.entries, []);
  assert.match(
    securityAssurance.incident_history.statement,
    /not a guarantee/u,
  );
  assert.match(
    securityAssurance.incident_history.publication_commitment,
    /material managed-service incident/u,
  );

  const ids = new Set();
  for (const control of securityAssurance.control_matrix) {
    assert.ok(!ids.has(control.id), `duplicate security control ${control.id}`);
    ids.add(control.id);
    assert.ok(
      control.control.length >= 10,
      `${control.id} needs a useful control`,
    );
    for (const field of [
      "application",
      "managed_service",
      "self_hosted_operator",
      "customer_or_provider",
    ]) {
      assert.ok(
        control[field].length >= 30,
        `${control.id} needs a useful ${field}`,
      );
    }
    assert.ok(control.evidence.length > 0, `${control.id} needs evidence`);
    assertSourcePathsExist(control.evidence, control.id);
  }

  const securityPage = readFileSync(
    `${repositoryRoot}marketing-site/src/routes/security/+page.svelte`,
    "utf8",
  );
  assert.doesNotMatch(
    securityPage,
    /SOC 2 certified|ISO 27001 certified|GDPR compliant|independently audited|independently penetration tested/iu,
  );
});
