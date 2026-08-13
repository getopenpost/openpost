import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "marketing-claims.json");

export function validateMarketingClaims(manifest, sources, now = new Date()) {
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      "claims",
      "illustrative_material",
      "next_review_on",
      "owner",
      "reviewed_on",
      "schema_version",
    ],
    "marketing claim register has unexpected or missing fields",
  );
  assert.equal(manifest.schema_version, 1);
  assert.match(manifest.owner, /@/);
  const reviewed = parseDate(manifest.reviewed_on, "reviewed_on");
  const nextReview = parseDate(manifest.next_review_on, "next_review_on");
  assert.ok(nextReview > reviewed, "next_review_on must follow reviewed_on");
  assert.ok(
    nextReview >= startOfDay(now),
    "marketing claim register review is overdue",
  );
  assert.ok(Array.isArray(manifest.claims));
  assert.ok(Array.isArray(manifest.illustrative_material));

  const registeredText = new Set();
  const registeredAssets = new Set();
  for (const [index, claim] of manifest.claims.entries()) {
    const label = `claims[${index}]`;
    assert.equal(typeof claim.id, "string", `${label}.id is required`);
    assert.equal(typeof claim.owner, "string", `${label}.owner is required`);
    assert.equal(
      typeof claim.exact_text,
      "string",
      `${label}.exact_text is required`,
    );
    assert.equal(
      typeof claim.evidence,
      "string",
      `${label}.evidence is required`,
    );
    assert.ok(claim.evidence.trim(), `${label}.evidence must not be empty`);
    const expires = parseDate(claim.expires_on, `${label}.expires_on`);
    assert.ok(expires >= startOfDay(now), `${label} is expired`);
    registeredText.add(claim.exact_text);
    for (const asset of claim.assets ?? []) registeredAssets.add(asset);
  }

  const marketingSource = [...sources.values()].join("\n");
  for (const phrase of [
    "Used by builders at",
    "Trusted by",
    "customers use OpenPost",
  ]) {
    if (marketingSource.includes(phrase)) {
      assert.ok(
        registeredText.has(phrase),
        `unregistered public proof claim: ${phrase}`,
      );
    }
  }
  for (const match of marketingSource.matchAll(
    /\/assets\/customer-logos\/[A-Za-z0-9._/-]+/g,
  )) {
    assert.ok(
      registeredAssets.has(match[0]),
      `unregistered customer logo: ${match[0]}`,
    );
  }

  for (const [index, material] of manifest.illustrative_material.entries()) {
    const label = `illustrative_material[${index}]`;
    assert.equal(typeof material.id, "string", `${label}.id is required`);
    assert.equal(
      typeof material.source,
      "string",
      `${label}.source is required`,
    );
    assert.equal(typeof material.label, "string", `${label}.label is required`);
    assert.equal(
      typeof material.description,
      "string",
      `${label}.description is required`,
    );
    const source = sources.get(material.source);
    assert.ok(source, `${label}.source does not exist`);
    assert.ok(
      source.includes(material.label),
      `${label}.label is not visible in its source`,
    );
    assert.match(
      source,
      /fictional/i,
      `${label}.source must state that the examples are fictional`,
    );
  }

  const generatedPortraitSources = [...sources.entries()].filter(([, source]) =>
    source.includes("/assets/testimonial-portraits/"),
  );
  for (const [sourcePath] of generatedPortraitSources) {
    assert.ok(
      manifest.illustrative_material.some(
        (material) => material.source === sourcePath,
      ),
      `generated persona portraits require an illustrative register entry: ${sourcePath}`,
    );
  }
}

function parseDate(value, label) {
  assert.match(
    value ?? "",
    /^\d{4}-\d{2}-\d{2}$/,
    `${label} must be YYYY-MM-DD`,
  );
  const parsed = new Date(`${value}T00:00:00Z`);
  assert.ok(!Number.isNaN(parsed.getTime()), `${label} must be a valid date`);
  return parsed;
}

function startOfDay(value) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sourcePaths = [
    "marketing-site/src/routes/+page.svelte",
    "marketing-site/src/routes/_components/CreatorStories.svelte",
  ];
  const sources = new Map(
    await Promise.all(
      sourcePaths.map(async (sourcePath) => [
        sourcePath,
        await readFile(path.join(root, sourcePath), "utf8"),
      ]),
    ),
  );
  validateMarketingClaims(manifest, sources);
  console.log(
    "Marketing claim register is current and public proof claims are registered.",
  );
}

if (import.meta.main) await main();
