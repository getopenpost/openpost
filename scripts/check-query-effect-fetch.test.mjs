import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findEffectFetchViolations } from "./check-query-effect-fetch.mjs";

function withFixture(files, run) {
  const repoRoot = mkdtempSync(join(tmpdir(), "openpost-query-effects-"));
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(repoRoot, dirname(file)), { recursive: true });
    writeFileSync(join(repoRoot, file), source);
  }
  try {
    run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true });
  }
}

function scan(repoRoot) {
  return findEffectFetchViolations(repoRoot, { roots: ["apps/web/src"] });
}

test("flags transport reads inside $effect", () => {
  const file = "apps/web/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        import { client } from '$lib/api/client';
        $effect(() => {
          void client.GET('/cache-safe', { params: {} });
        });
      </script>`,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).map(({ file: violationFile, kind }) => ({ violationFile, kind })),
        [{ violationFile: file, kind: "transport.GET" }],
      );
    },
  );
});

test("flags imperative Query reads inside $effect", () => {
  const file = "apps/web/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        $effect(() => {
          void queryClient.query(options);
        });
      </script>`,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).map(({ kind }) => kind),
        ["query.query"],
      );
    },
  );
});

test("allows event-driven reads and Query observer refetch in effects", () => {
  const file = "apps/web/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        import { client } from '$lib/api/client';
        async function loadData() {
          await client.GET('/cache-safe', { params: {} });
        }
        $effect(() => {
          void publicationsQuery.refetch();
          const stop = () => {};
          async function helper() {
            await client.GET('/cache-safe', { params: {} });
          }
          void stop;
        });
      </script>
      <button onclick={() => loadData()}>load</button>`,
    },
    (repoRoot) => {
      assert.deepEqual(scan(repoRoot), []);
    },
  );
});

test("skips query adapters", () => {
  const file = "apps/web/src/lib/query/example.ts";
  withFixture(
    {
      [file]: `export function example() {
        $effect(() => {
          void client.GET('/cache-safe', { params: {} });
        });
      }`,
    },
    (repoRoot) => {
      assert.deepEqual(scan(repoRoot), []);
    },
  );
});
