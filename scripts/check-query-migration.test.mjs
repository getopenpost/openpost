import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findImperativeQueryViolations } from "./check-query-migration.mjs";

function withFixture(files, run) {
  const repoRoot = mkdtempSync(join(tmpdir(), "openpost-query-migration-"));
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

function scan(repoRoot, options = {}) {
  return findImperativeQueryViolations(repoRoot, {
    roots: ["frontend/src"],
    allowlist: [],
    pairingAllowlist: [],
    ...options,
  });
}

test("ignores GET-shaped text in comments and strings", () => {
  const file = "frontend/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        // client.GET('/comment')
        const example = "transport.GET('/string')";
        const template = \`dependencies.get('/template')\`;
      </script>`,
    },
    (repoRoot) => {
      assert.deepEqual(scan(repoRoot).calls, []);
    },
  );
});

test("finds multiline uppercase GET calls on arbitrary receivers", () => {
  const file = "frontend/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        await arbitraryTransport.GET(
          '/cache-safe',
          { signal }
        );
      </script>`,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/cache-safe"],
      );
    },
  );
});

test("finds lowercase injected receivers and direct endpoint getters", () => {
  const file = "frontend/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        await dependencies.get('/injected');
        await get('/direct');
      </script>`,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/injected", "/direct"],
      );
    },
  );
});

test("finds simple aliases assigned from uppercase GET", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        const request = client.GET;
        await request('/aliased');
        let rebound;
        rebound = transport.GET;
        await rebound('/rebound');
      `,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/aliased", "/rebound"],
      );
    },
  );
});

test("reports dynamic endpoints", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        await api.GET(endpoint);
        const request = api.GET;
        await request(\`/workspaces/\${workspaceID}\`);
      `,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["<dynamic>", "<dynamic>"],
      );
    },
  );
});

test("reports duplicate, unexpected, and missing direct reads", () => {
  const file = "frontend/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        await client.GET('/one-time-read');
        await client.GET('/one-time-read');
        await client.GET('/cache-safe');
      </script>`,
    },
    (repoRoot) => {
      const result = scan(repoRoot, {
        allowlist: [
          { file, endpoint: "/one-time-read", count: 1 },
          { file, endpoint: "/required-read", count: 1 },
        ],
      });
      assert.deepEqual(
        result.violations.map(({ endpoint }) => endpoint),
        ["/one-time-read", "/cache-safe"],
      );
      assert.deepEqual(result.missing, [
        { file, endpoint: "/one-time-read", expected: 1, actual: 2 },
        { file, endpoint: "/required-read", expected: 1, actual: 0 },
      ]);
    },
  );
});

test("requires Query adapters to cross the central transport boundary", () => {
  withFixture(
    {
      "frontend/src/lib/query/accounts.ts": `
		queryData(signal, (requestSignal) =>
			transport.GET('/accounts', { signal: requestSignal })
		);
		function queryData(signal, request) {
			return queryGET({ signal, fallback: 'Could not load accounts.', request });
		}
      `,
      "frontend/src/lib/query/bypass.ts": "transport.GET('/query-bypass');",
      "frontend/src/lib/image-editor/api.ts": "client.GET('/image-editor/designs');",
      "frontend/src/lib/image-editor/other.ts": "client.GET('/must-still-be-seen');",
    },
    (repoRoot) => {
      const result = scan(repoRoot);
      assert.deepEqual(
        result.adapterCalls.map(({ endpoint }) => endpoint),
        ["/accounts", "/query-bypass"],
      );
      assert.deepEqual(
        result.adapterViolations.map(({ file, endpoint }) => ({ file, endpoint })),
        [
          {
            file: "frontend/src/lib/query/bypass.ts",
            endpoint: "/query-bypass",
          },
        ],
      );
      assert.deepEqual(
        result.violations.map(({ file, endpoint }) => ({ file, endpoint })),
        [
          {
            file: "frontend/src/lib/image-editor/api.ts",
            endpoint: "/image-editor/designs",
          },
          {
            file: "frontend/src/lib/image-editor/other.ts",
            endpoint: "/must-still-be-seen",
          },
        ],
      );
    },
  );
});

test("classifies the CLI session read as pairing instead of imperative", () => {
  const file = "frontend/src/routes/cli/authorize/cli-authorize-page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        await dependencies.get('/cli/auth/session');
      </script>`,
    },
    (repoRoot) => {
      const result = scan(repoRoot, {
        pairingAllowlist: [{ file, endpoint: "/cli/auth/session", count: 1 }],
      });
      assert.deepEqual(result.violations, []);
      assert.deepEqual(result.pairingMissing, []);
      assert.deepEqual(
        result.pairingCalls.map(({ endpoint }) => endpoint),
        ["/cli/auth/session"],
      );
    },
  );
});

test("requires the exact CLI pairing read count", () => {
  const file = "frontend/src/routes/cli/authorize/cli-authorize-page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        await dependencies.get('/cli/auth/session');
        await dependencies.get('/cli/auth/session');
      </script>`,
    },
    (repoRoot) => {
      const result = scan(repoRoot, {
        pairingAllowlist: [{ file, endpoint: "/cli/auth/session", count: 1 }],
      });
      assert.deepEqual(
        result.violations.map(({ endpoint }) => endpoint),
        ["/cli/auth/session"],
      );
      assert.deepEqual(result.pairingMissing, [
        { file, endpoint: "/cli/auth/session", expected: 1, actual: 2 },
      ]);
    },
  );
});
