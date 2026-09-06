import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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

test("policy acceptance flags, register reviews, and change history stay current", () => {
  assert.equal(legalPolicy.terms.requires_acceptance, true);
  assert.equal(legalPolicy.privacy.requires_acceptance, true);
  assert.equal(legalPolicy.refunds.requires_acceptance, false);

  assertCurrentReview(managedService, "managed-service");
  assertCurrentReview(privacyInventory, "privacy inventory");
  assertCurrentReview(securityAssurance, "security assurance");

  assert.equal(legalChangeHistory.reviewed_on, privacyInventory.reviewed_on);
  assert.match(legalChangeHistory.scope, /material changes/u);

  const identities = new Set();
  for (const entry of legalChangeHistory.entries) {
    const identity = `${entry.document}:${entry.version}`;
    assert.ok(!identities.has(identity), `duplicate legal history entry ${identity}`);
    identities.add(identity);
    assert.ok(Number.isFinite(Date.parse(`${entry.effective_date}T00:00:00Z`)));
    assert.equal(new URL(entry.url).protocol, "https:");
    assert.ok(entry.changes.length > 0, `${identity} needs a material change`);
    assert.ok(entry.changes.every((change) => change.length >= 30));
  }

  for (const document of ["terms", "privacy", "refunds"]) {
    const policy = legalPolicy[document];
    const current = legalChangeHistory.entries.find(
      (entry) => entry.document === document && entry.version === policy.version,
    );
    assert.ok(current, `missing current ${document} history`);
    assert.equal(current.effective_date, policy.effective_date);
    assert.equal(current.url, policy.url);
  }
});

test("managed-service providers disclose purpose, data, and transfer with safe sources", () => {
  assert.match(managedService.contact, /^[^@]+@[^@]+$/u);
  assert.equal(
    new Set(managedService.stores.map(({ id }) => id)).size,
    managedService.stores.length,
  );
  assert.equal(
    new Set(managedService.providers.map(({ id }) => id)).size,
    managedService.providers.length,
  );

  for (const provider of managedService.providers) {
    assert.ok(provider.purpose.length > 20, `${provider.id} needs a purpose`);
    assert.ok(provider.data.length > 20, `${provider.id} needs data categories`);
    assert.ok(provider.location.length > 10, `${provider.id} needs a location`);
    assert.ok(provider.transfer.length > 20, `${provider.id} needs transfer facts`);
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
      if (/^(api_?key|client_?secret|password|token|webhook_?url)$/iu.test(key)) {
        unsafeKeys.push(`${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(managedService);
  assert.deepEqual(unsafeKeys, []);
});

test("managed data has an owned purpose, retention rule, and deletion trigger", () => {
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
      assert.ok(entry[field].length >= 20, `${entry.id} needs a useful ${field}`);
    }
    assert.ok(entry.evidence.length > 0, `${entry.id} needs source evidence`);
    assertSourcePathsExist(entry.evidence, entry.id);
  }
});

test("analytics disclosures match the rendered privacy page and stay consent-gated", () => {
  const analytics = privacyInventory.managed_retention.find(({ id }) => id === "analytics-usage");
  assert.ok(analytics);
  assert.match(analytics.includes, /bounded titles and text.*published outside OpenPost/u);
  assert.match(
    analytics.exceptions,
    /do not retain raw provider responses, remote media bytes, access tokens, bot tokens, or webhook secrets/u,
  );

  const policy = readFileSync(
    `${repositoryRoot}apps/marketing/src/routes/privacy/+page.svelte`,
    "utf8",
  );
  assert.match(
    policy,
    /bounded titles and text for eligible content published\s+outside OpenPost/u,
  );
  assert.match(
    policy,
    /do not contain raw platform replies, remote media, access tokens, bot tokens,\s+webhook secrets/u,
  );
  assert.match(policy, /We do not send post content[\s\S]*telemetry properties/u);

  const storage = new Map(privacyInventory.browser_storage.map((entry) => [entry.id, entry]));
  assert.equal(storage.get("cookie-telemetry-preference")?.necessity, "functional");
  assert.equal(storage.get("cookie-posthog-analytics")?.necessity, "analytics");
  assert.equal(storage.get("local-posthog-analytics")?.necessity, "analytics");

  const telemetry = privacyInventory.managed_retention.find(({ id }) => id === "website-analytics");
  assert.match(telemetry?.includes ?? "", /country derived before raw IP discard/u);
  assert.match(telemetry?.exceptions ?? "", /No optional browser telemetry is sent before/u);
  assert.match(telemetry?.exceptions ?? "", /Backend service telemetry is separately disclosed/u);

  const technologies = new Set(
    privacyInventory.browser_storage.map(({ technology }) => technology),
  );
  for (const technology of ["cookie", "localStorage", "sessionStorage", "IndexedDB"]) {
    assert.ok(technologies.has(technology), `browser storage misses ${technology}`);
  }
});

test("security assurance states its boundary and the security page claims nothing more", () => {
  assert.deepEqual(securityAssurance.assurance_boundary.published_certifications, []);
  assert.deepEqual(securityAssurance.assurance_boundary.published_independent_reports, []);
  assert.match(securityAssurance.assurance_boundary.statement, /does not claim SOC 2/u);
  assert.match(securityAssurance.assurance_boundary.statement, /ISO 27001/u);
  assert.match(securityAssurance.assurance_boundary.statement, /penetration-test/u);
  assert.equal(securityAssurance.incident_history.status, "no_public_entries");
  assert.deepEqual(securityAssurance.incident_history.entries, []);
  assert.match(securityAssurance.incident_history.statement, /not a guarantee/u);
  assert.match(
    securityAssurance.incident_history.publication_commitment,
    /material managed-service incident/u,
  );

  const ids = new Set();
  for (const control of securityAssurance.control_matrix) {
    assert.ok(!ids.has(control.id), `duplicate security control ${control.id}`);
    ids.add(control.id);
    assert.ok(control.control.length >= 10, `${control.id} needs a useful control`);
    for (const field of [
      "application",
      "managed_service",
      "self_hosted_operator",
      "customer_or_provider",
    ]) {
      assert.ok(control[field].length >= 30, `${control.id} needs a useful ${field}`);
    }
    assert.ok(control.evidence.length > 0, `${control.id} needs evidence`);
    assertSourcePathsExist(control.evidence, control.id);
  }

  const securityPage = readFileSync(
    `${repositoryRoot}apps/marketing/src/routes/security/+page.svelte`,
    "utf8",
  );
  assert.doesNotMatch(
    securityPage,
    /SOC 2 certified|ISO 27001 certified|GDPR compliant|independently audited|independently penetration tested/iu,
  );
});
