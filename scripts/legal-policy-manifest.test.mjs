import assert from "node:assert/strict";
import test from "node:test";

import {
  renderLegalPolicyEnv,
  renderLegalPolicyGo,
  validateLegalPolicyManifest,
} from "./legal-policy-manifest.mjs";

const manifest = {
  schema_version: 1,
  terms: {
    version: "2024-01-02",
    effective_date: "2024-01-02",
    url: "https://openpo.st/terms",
    requires_acceptance: true,
  },
  privacy: {
    version: "2024-03-04",
    effective_date: "2024-03-04",
    url: "https://openpo.st/privacy",
    requires_acceptance: true,
  },
  refunds: {
    version: "2024-05-06",
    effective_date: "2024-05-06",
    url: "https://openpo.st/refunds",
    requires_acceptance: false,
  },
};

test("generates backend constants and deployment variables from policy dates", () => {
  const generated = renderLegalPolicyGo(manifest);
  assert.match(generated, /TermsVersion\s+= "2024-01-02"/u);
  assert.match(generated, /PrivacyVersion\s+= "2024-03-04"/u);
  assert.match(generated, /RefundsVersion\s+= "2024-05-06"/u);
  assert.match(generated, /RefundsRequiresAcceptance\s+= false/u);
  assert.equal(
    renderLegalPolicyEnv(manifest),
    "OPENPOST_TERMS_URL=https://openpo.st/terms\n" +
      "OPENPOST_PRIVACY_URL=https://openpo.st/privacy\n" +
      "OPENPOST_TERMS_VERSION=2024-01-02\n" +
      "OPENPOST_PRIVACY_VERSION=2024-03-04\n",
  );
});

test("policy documents fail closed on drift and unsupported acceptance", () => {
  assert.throws(
    () =>
      validateLegalPolicyManifest({
        ...manifest,
        refunds: { ...manifest.refunds, requires_acceptance: true },
      }),
    /Refund Policy is incorporated by the Terms/u,
  );

  assert.throws(
    () =>
      validateLegalPolicyManifest({
        ...manifest,
        terms: {
          ...manifest.terms,
          version: "2026-02-31",
          effective_date: "2026-02-31",
        },
      }),
    /terms.version must be an ISO calendar date/u,
  );
});
