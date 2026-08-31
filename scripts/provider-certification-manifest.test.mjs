import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoUnprojectedPublicClaims,
  readPublicClaimManifest,
  readPublicClaimManifestBinding,
  renderPublicClaimProjection,
  subjectDigest,
  subjectKey,
  validatePublicClaimManifest,
  validatePublicClaimSurfaceSources,
} from "./provider-certification-manifest.mjs";

const now = "2026-08-09T12:00:00.000Z";
const currentRevision = "b".repeat(40);
const contractDigest = `sha256:${"c".repeat(64)}`;

test("the canonical empty manifest makes no unsupported public claims", async () => {
  const manifest = await readPublicClaimManifest(undefined, { now });
  assert.deepEqual(manifest, { schema_version: 1, claims: [] });
});

test("the release binding hashes the exact checked-in zero-claim manifest", async () => {
  const binding = await readPublicClaimManifestBinding();
  assert.equal(binding.schema_version, 1);
  assert.equal(binding.claim_count, 0);
  assert.match(binding.manifest_sha256, /^sha256:[0-9a-f]{64}$/u);
});

test("public provider claims are derived from the manifest on every claim surface", () => {
  const manifest = { schema_version: 1, claims: [] };
  const projection = renderPublicClaimProjection(manifest);
  const sources = validPublicClaimSurfaces(projection);
  assert.doesNotThrow(() => validatePublicClaimSurfaceSources(manifest, sources));
  assert.doesNotThrow(() =>
    validatePublicClaimSurfaceSources(manifest, {
      ...sources,
      marketingCatalog: sources.marketingCatalog.replaceAll('"', "'"),
    }),
  );

  assert.throws(
    () =>
      validatePublicClaimSurfaceSources(manifest, {
        ...sources,
        marketingCatalog: `${sources.marketingCatalog}\nstatus: "Available"`,
      }),
    /cannot infer availability/u,
  );
  assert.throws(
    () =>
      validatePublicClaimSurfaceSources(manifest, {
        ...sources,
        providerIndex: sources.providerIndex.replace(
          "No posting option has passed our final live check",
          "One posting option has passed our final live check",
        ),
      }),
    /projection is stale/u,
  );
});

test("the README keeps live provider claims in plain language", () => {
  const manifest = validManifest();
  const detailedProjection = renderPublicClaimProjection(manifest);
  const readmeProjection = renderPublicClaimProjection(manifest, { detailLevel: "summary" });
  const sources = validPublicClaimSurfaces(detailedProjection);

  assert.match(readmeProjection, /1 way to post/u);
  assert.doesNotMatch(readmeProjection, /publish_immediate|standard_text|standard_policy/u);
  assert.doesNotThrow(() =>
    validatePublicClaimSurfaceSources(manifest, {
      ...sources,
      readme: readmeProjection,
    }),
  );
});

test("a complete production subject with current local and live proof is claimable", () => {
  const manifest = validManifest();
  assert.equal(validatePublicClaimManifest(manifest, { now }).claims.length, 1);
});

test("the standalone gate refuses claims without the ledger contract projection", () => {
  assert.throws(
    () => assertNoUnprojectedPublicClaims(validManifest()),
    /standalone check refuses non-empty claims/u,
  );
});

test("official versioned documentation links keep their safe query selector", () => {
  const manifest = validManifest();
  const claim = manifest.claims[0];
  claim.subject.provider = "linkedin";
  claim.local_certification.subject_digest = subjectDigest(claim.subject);
  claim.live_certification.subject_digest = subjectDigest(claim.subject);
  const source =
    "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-02";
  claim.approval.source_url = source;
  claim.policy_sources = [source];
  assert.doesNotThrow(() => validatePublicClaimManifest(manifest, { now }));
});

test("a contract projection can carry proof across revisions but never across contracts", () => {
  const manifest = validManifest();
  const key = subjectKey(manifest.claims[0].subject);
  assert.doesNotThrow(() =>
    validatePublicClaimManifest(manifest, {
      now,
      currentRevision,
      contractDigests: new Map([[key, contractDigest]]),
    }),
  );
  assert.throws(
    () =>
      validatePublicClaimManifest(manifest, {
        now,
        currentRevision,
        contractDigests: new Map([[key, `sha256:${"d".repeat(64)}`]]),
      }),
    /contract digest is stale/u,
  );
  assert.throws(
    () =>
      validatePublicClaimManifest(manifest, {
        now,
        currentRevision,
        contractDigests: new Map(),
      }),
    /projection is missing/u,
  );
});

test("an exact-SHA release gate is available for high-risk certification contracts", () => {
  const manifest = validManifest();
  assert.throws(
    () =>
      validatePublicClaimManifest(manifest, {
        now,
        currentRevision,
        requireExactRevision: true,
      }),
    /does not match the release revision/u,
  );
  for (const claim of manifest.claims) {
    claim.local_certification.tested_revision = currentRevision;
    claim.live_certification.tested_revision = currentRevision;
  }
  assert.doesNotThrow(() =>
    validatePublicClaimManifest(manifest, {
      now,
      currentRevision,
      requireExactRevision: true,
    }),
  );
});

test("claims fail closed on unsafe, stale, incomplete, or non-production facts", () => {
  const tests = [
    {
      name: "unknown secret-shaped field",
      mutate: (claim) => {
        claim.access_token = "should-never-be-public";
      },
      pattern: /must contain exactly/u,
    },
    {
      name: "development provider app",
      mutate: (claim) => {
        claim.subject.provider_environment = "development";
      },
      pattern: /provider_environment must be production/u,
    },
    {
      name: "disabled runtime control",
      mutate: (claim) => {
        claim.runtime_control.state = "disabled";
      },
      pattern: /runtime_control.state must be enabled/u,
    },
    {
      name: "expired live proof",
      mutate: (claim) => {
        claim.live_certification.expires_at = now;
      },
      pattern: /live_certification is expired/u,
    },
    {
      name: "missing lifecycle check",
      mutate: (claim) => {
        claim.live_certification.checks = claim.live_certification.checks.filter(
          (check) => check.kind !== "revoke",
        );
      },
      pattern: /is missing revoke/u,
    },
    {
      name: "publish check marked not applicable",
      mutate: (claim) => {
        const publish = claim.live_certification.checks.find(
          (check) => check.kind === "publish_immediate",
        );
        publish.outcome = "not_applicable";
        publish.not_applicable_reason = "not_supported";
      },
      pattern: /must pass/u,
    },
    {
      name: "missing granted scope",
      mutate: (claim) => {
        claim.granted_scopes = ["users.read"];
      },
      pattern: /is missing tweet.write/u,
    },
    {
      name: "policy URL with query data",
      mutate: (claim) => {
        claim.policy_sources = ["https://docs.x.com/x-api/overview?token=secret"];
      },
      pattern: /unsupported documentation query parameter/u,
    },
    {
      name: "unrelated provider policy source",
      mutate: (claim) => {
        claim.policy_sources = ["https://docs.discord.com/developers/reference"];
      },
      pattern: /is not an official source for x/u,
    },
    {
      name: "certification outlives approval review",
      mutate: (claim) => {
        claim.approval.expires_at = "2026-08-20T12:00:00.000Z";
      },
      pattern: /cannot outlive approval review/u,
    },
    {
      name: "approval changed since certification",
      mutate: (claim) => {
        claim.approval.tier = "enterprise";
      },
      pattern: /approval_tier_at_test is stale/u,
    },
    {
      name: "certification predates approval review",
      mutate: (claim) => {
        claim.approval.reviewed_at = "2026-08-08T18:00:00.000Z";
      },
      pattern: /predates approval review/u,
    },
    {
      name: "certification belongs to another exact subject",
      mutate: (claim) => {
        claim.live_certification.subject_digest = `sha256:${"f".repeat(64)}`;
      },
      pattern: /subject_digest does not match the claim/u,
    },
    {
      name: "local and live contract mismatch",
      mutate: (claim) => {
        claim.live_certification.contract_digest = `sha256:${"f".repeat(64)}`;
      },
      pattern: /certification contracts differ/u,
    },
  ];

  for (const scenario of tests) {
    const manifest = validManifest();
    scenario.mutate(manifest.claims[0]);
    assert.throws(
      () => validatePublicClaimManifest(manifest, { now }),
      scenario.pattern,
      scenario.name,
    );
  }
});

test("one exact subject cannot be advertised twice", () => {
  const manifest = validManifest();
  manifest.claims.push(structuredClone(manifest.claims[0]));
  assert.throws(
    () => validatePublicClaimManifest(manifest, { now }),
    /duplicates another public claim/u,
  );
});

function validManifest() {
  const subject = {
    provider: "x",
    app_fingerprint: `sha256:${"a".repeat(64)}`,
    deployment_environment: "production",
    provider_environment: "production",
    instance_fingerprint: null,
    account_kind: "standard",
    output_profile: "text",
    operation: "publish_immediate",
    policy_mode: "default",
  };
  return {
    schema_version: 1,
    claims: [
      {
        subject,
        configuration: {
          state: "configured",
          source: "environment",
        },
        approval: {
          state: "approved",
          tier: "standard",
          source_url: "https://docs.x.com/x-api/overview",
          reviewed_at: "2026-08-01T12:00:00.000Z",
          expires_at: "2026-11-01T12:00:00.000Z",
        },
        required_scopes: ["tweet.write", "users.read"],
        granted_scopes: ["tweet.write", "users.read"],
        runtime_control: { state: "enabled" },
        policy_state: "allowed",
        policy_sources: ["https://docs.x.com/x-api/overview"],
        local_certification: certification("local", subject),
        live_certification: certification("live", subject),
      },
    ],
  };
}

function validPublicClaimSurfaces(projection) {
  return {
    marketingCatalog: [
      'import publicClaimManifest from "../../../provider-certification/public-claims.json";',
      "const publicProviderClaims = publicClaimManifest.claims",
      "managedCertificationState",
    ].join("\n"),
    marketingIndex: "implementation and exact certification facts",
    marketingDetail: "implementation and exact certification facts",
    marketingLanding: '<div aria-label="Implemented social platform adapters">',
    providerIndex: projection,
    launchMatrix: projection,
    certificationReadme: projection,
    readme: projection,
  };
}

function certification(kind, subject) {
  return {
    id: `${kind}-x-standard-text-immediate-1`,
    kind,
    tested_revision: "a".repeat(40),
    contract_digest: contractDigest,
    subject_digest: subjectDigest(subject),
    approval_state_at_test: "approved",
    approval_tier_at_test: "standard",
    required_scopes: ["tweet.write", "users.read"],
    granted_scopes: ["tweet.write", "users.read"],
    tested_at: "2026-08-08T12:00:00.000Z",
    expires_at: "2026-09-08T12:00:00.000Z",
    checks: [
      passedCheck("connect"),
      passedCheck("authorization"),
      passedCheck("publish_immediate"),
      passedCheck("final_result"),
      passedCheck("refresh"),
      passedCheck("revoke"),
    ],
  };
}

function passedCheck(kind) {
  return { kind, outcome: "passed", not_applicable_reason: null };
}
