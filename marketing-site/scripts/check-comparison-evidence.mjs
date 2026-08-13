import assert from "node:assert/strict";
import {
  comparisonEvidenceRegister,
  comparisonEvidenceReview,
} from "../src/routes/_comparison-evidence.ts";

const today = new Date().toISOString().slice(0, 10);
assert.match(comparisonEvidenceReview.reviewedOn, /^\d{4}-\d{2}-\d{2}$/u);
assert.match(comparisonEvidenceReview.reviewDueOn, /^\d{4}-\d{2}-\d{2}$/u);
assert.ok(
  comparisonEvidenceReview.reviewDueOn >= today,
  `comparison evidence review expired on ${comparisonEvidenceReview.reviewDueOn}`,
);
assert.ok(
  comparisonEvidenceReview.reviewDueOn > comparisonEvidenceReview.reviewedOn,
  "comparison evidence review due date must follow the review date",
);

assert.deepEqual(Object.keys(comparisonEvidenceRegister).sort(), [
  "buffer",
  "hootsuite",
  "mixpost",
  "post-bridge",
  "postiz",
  "typefully",
]);

for (const [slug, comparison] of Object.entries(comparisonEvidenceRegister)) {
  assert.equal(
    comparison.reviewedOn,
    comparisonEvidenceReview.reviewedOn,
    `${slug} review date drifted`,
  );
  assert.equal(
    comparison.reviewDueOn,
    comparisonEvidenceReview.reviewDueOn,
    `${slug} due date drifted`,
  );
  assert.ok(
    comparison.qualifier.length >= 40,
    `${slug} needs a useful plan/region qualifier`,
  );
  assert.equal(
    Object.keys(comparison.rows).length,
    4,
    `${slug} must evidence all four comparison rows`,
  );

  for (const [area, claim] of Object.entries(comparison.rows)) {
    assert.ok(
      ["Direct source", "Interpretation"].includes(claim.basis),
      `${slug}/${area} basis`,
    );
    assert.ok(
      claim.qualifier.length >= 30,
      `${slug}/${area} needs a useful qualifier`,
    );
    assert.ok(claim.sources.length > 0, `${slug}/${area} needs a source`);
    const sourceURLs = new Set();
    for (const source of claim.sources) {
      const url = new URL(source.href);
      assert.equal(
        url.protocol,
        "https:",
        `${slug}/${area} source must use HTTPS`,
      );
      assert.ok(
        source.label.length > 3,
        `${slug}/${area} source label is too short`,
      );
      assert.equal(
        sourceURLs.has(source.href),
        false,
        `${slug}/${area} duplicates ${source.href}`,
      );
      sourceURLs.add(source.href);
    }
  }
}

console.log(
  `Verified row-level evidence for ${Object.keys(comparisonEvidenceRegister).length} comparisons through ${comparisonEvidenceReview.reviewDueOn}.`,
);
