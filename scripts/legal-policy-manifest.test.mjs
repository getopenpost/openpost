import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readLegalPolicyManifest,
  renderLegalPolicyEnv,
  renderLegalPolicyGo,
  validateLegalPolicyManifest,
} from "./legal-policy-manifest.mjs";

test("the official manifest generates the backend policy constants", async () => {
  const manifest = await readLegalPolicyManifest();
  const generated = renderLegalPolicyGo(manifest);
  assert.match(generated, /TermsVersion\s+= "2026-08-05"/u);
  assert.match(generated, /PrivacyVersion\s+= "2026-08-11"/u);
  assert.match(generated, /RefundsRequiresAcceptance\s+= false/u);
  assert.equal(
    renderLegalPolicyEnv(manifest),
    "OPENPOST_TERMS_URL=https://openpost.social/terms\n" +
      "OPENPOST_PRIVACY_URL=https://openpost.social/privacy\n" +
      "OPENPOST_TERMS_VERSION=2026-08-05\n" +
      "OPENPOST_PRIVACY_VERSION=2026-08-11\n",
  );
});

test("policy documents fail closed on drift and unsupported acceptance", () => {
  assert.throws(
    () =>
      validateLegalPolicyManifest({
        schema_version: 1,
        terms: {
          version: "2026-08-05",
          effective_date: "2026-08-05",
          url: "https://openpost.social/terms",
          requires_acceptance: true,
        },
        privacy: {
          version: "2026-08-09",
          effective_date: "2026-08-09",
          url: "https://openpost.social/privacy",
          requires_acceptance: true,
        },
        refunds: {
          version: "2026-08-05",
          effective_date: "2026-08-05",
          url: "https://openpost.social/refunds",
          requires_acceptance: true,
        },
      }),
    /Refund Policy is incorporated by the Terms/u,
  );

  assert.throws(
    () =>
      validateLegalPolicyManifest({
        schema_version: 1,
        terms: {
          version: "2026-02-31",
          effective_date: "2026-02-31",
          url: "https://openpost.social/terms",
          requires_acceptance: true,
        },
        privacy: {
          version: "2026-08-09",
          effective_date: "2026-08-09",
          url: "https://openpost.social/privacy",
          requires_acceptance: true,
        },
        refunds: {
          version: "2026-08-05",
          effective_date: "2026-08-05",
          url: "https://openpost.social/refunds",
          requires_acceptance: false,
        },
      }),
    /terms.version must be an ISO calendar date/u,
  );
});

test("public legal pages render dates and versions from the canonical manifest", async () => {
  for (const name of ["terms", "privacy", "refunds"]) {
    const source = await readFile(
      `marketing-site/src/routes/${name}/+page.svelte`,
      "utf8",
    );
    assert.match(source, /from "@openpost\/legal-policy"/u);
    assert.match(
      source,
      new RegExp(`formatPolicyEffectiveDate\\(legalPolicy\\.${name}\\)`, "u"),
    );
    assert.match(source, new RegExp(`legalPolicy\\.${name}\\.version`, "u"));
    assert.doesNotMatch(
      source,
      /const effectiveDate = "\d{1,2} [A-Z][a-z]+ \d{4}"/u,
    );
  }
});
