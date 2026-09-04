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

test("finds native API fetches through direct, assigned, and bound aliases", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        await fetch('/api/v1/cache-safe?workspace_id=one');
        const request = globalThis.fetch;
        await request('/api/v1/aliased');
        const boundRequest = window.fetch.bind(window);
        await boundRequest(apiURL(\`/media/metadata?workspace_id=\${workspaceID}\`));
      `,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/cache-safe", "/aliased", "/media/metadata"],
      );
    },
  );
});

test("finds typed and raw reads inside Svelte markup expressions", () => {
  const file = "frontend/src/routes/example/+page.svelte";
  withFixture(
    {
      [file]: `<script lang="ts">
        const typedRequest = client.GET;
        const rawRequest = globalThis.fetch;
      </script>
      <button onclick={() => typedRequest('/markup-typed')}>
        {rawRequest('/api/v1/markup-raw')}
      </button>`,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/markup-typed", "/markup-raw"],
      );
    },
  );
});

test("treats uncertain raw fetch initialization as a read", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        const request = globalThis.fetch;
        await request('/api/v1/identifier-init', requestInit);
        await fetch('/api/v1/dynamic-method', { method });
        await fetch('/api/v1/overridden-method', { method: 'DELETE', ...requestInit });
        await fetch('/api/v1/head-read', { method: 'HEAD' });
      `,
    },
    (repoRoot) => {
      assert.deepEqual(
        scan(repoRoot).violations.map(({ endpoint }) => endpoint),
        ["/identifier-init", "/dynamic-method", "/overridden-method", "/head-read"],
      );
    },
  );
});

test("ignores raw fetches whose mutation method is statically decisive", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        const request = window.fetch.bind(window);
        await request('/api/v1/post', { method: 'POST' });
        await fetch('/api/v1/patch', { ...requestInit, method: \`PATCH\` });
        await fetch('/api/v1/delete', { method: 'DELETE' as const });
        await fetch('/api/v1/put', { method: 'PUT', credentials: 'include' });
      `,
    },
    (repoRoot) => {
      assert.deepEqual(scan(repoRoot).calls, []);
    },
  );
});

test("ignores raw mutations, external resources, and dynamic downloads", () => {
  const file = "frontend/src/lib/example.ts";
  withFixture(
    {
      [file]: `
        await fetch('/api/v1/media/upload-session', { method: 'POST' });
        await fetch('https://cdn.example.test/model.bin');
        await fetch(getAuthenticatedMediaURL(media.url), { credentials: 'include' });
        await fetch(path, { ...init, credentials: 'include' });
      `,
    },
    (repoRoot) => {
      assert.deepEqual(scan(repoRoot).calls, []);
    },
  );
});

test("requires raw Query adapter fetches to cross the central transport boundary", () => {
  withFixture(
    {
      "frontend/src/lib/query/media.ts": `
        queryGET({
          signal,
          fallback: 'Could not load media.',
          request: (requestSignal) => fetch('/api/v1/media/metadata', { signal: requestSignal })
        });
      `,
      "frontend/src/lib/query/bypass.ts": "fetch('/api/v1/query-bypass');",
    },
    (repoRoot) => {
      const result = scan(repoRoot);
      assert.deepEqual(
        result.adapterCalls.map(({ endpoint }) => endpoint),
        ["/query-bypass", "/media/metadata"],
      );
      assert.deepEqual(
        result.adapterViolations.map(({ file, endpoint }) => ({ file, endpoint })),
        [{ file: "frontend/src/lib/query/bypass.ts", endpoint: "/query-bypass" }],
      );
    },
  );
});

test("tracks native fetch supplied as a function parameter default", () => {
  withFixture(
    {
      "frontend/src/lib/query/media.ts": `
        function createMediaQueryAPI(rawFetch = globalThis.fetch) {
          return {
            getMetadata(signal) {
              return queryGET({
                signal,
                request: (requestSignal) =>
                  rawFetch('/api/v1/media/metadata', { signal: requestSignal })
              });
            }
          };
        }
      `,
      "frontend/src/lib/query/bypass.ts": `
        function createBypass(rawFetch = globalThis.fetch) {
          return rawFetch('/api/v1/query-bypass');
        }
      `,
    },
    (repoRoot) => {
      const result = scan(repoRoot);
      assert.deepEqual(
        result.adapterCalls.map(({ endpoint }) => endpoint),
        ["/query-bypass", "/media/metadata"],
      );
      assert.deepEqual(
        result.adapterViolations.map(({ file, endpoint }) => ({ file, endpoint })),
        [{ file: "frontend/src/lib/query/bypass.ts", endpoint: "/query-bypass" }],
      );
    },
  );
});

test("scans mobile TSX and recognizes API paths behind a selected server origin", () => {
  const file = "mobile/src/app/example.tsx";
  withFixture(
    {
      [file]: `
        export function Example() {
          void api().GET('/mobile-cache-safe');
          void fetch(\`\${serverBaseUrl}/api/v1/ready\`);
          return <View />;
        }
      `,
    },
    (repoRoot) => {
      const result = scan(repoRoot, { roots: ["mobile/src"] });
      assert.deepEqual(
        result.violations.map(({ endpoint }) => endpoint),
        ["/mobile-cache-safe", "/ready"],
      );
    },
  );
});

test("enforces the central boundary in mobile Query adapters", () => {
  withFixture(
    {
      "mobile/src/lib/query-api.ts": `
        queryGET({
          signal,
          request: (requestSignal) => transport.GET('/workspaces', { signal: requestSignal })
        });
      `,
      "mobile/src/lib/app-bootstrap.ts": `
        mobileQueryTransportRequest(signal, (requestSignal) =>
          transport.GET('/app/bootstrap', { signal: requestSignal })
        );
      `,
      "mobile/src/lib/example.ts": "transport.GET('/outside-query');",
    },
    (repoRoot) => {
      const result = scan(repoRoot, { roots: ["mobile/src"] });
      assert.deepEqual(
        result.adapterCalls.map(({ endpoint }) => endpoint),
        ["/app/bootstrap", "/workspaces"],
      );
      assert.deepEqual(result.adapterViolations, []);
      assert.deepEqual(
        result.violations.map(({ endpoint }) => endpoint),
        ["/outside-query"],
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

test("classifies the CLI session read as pairing with an exact count", () => {
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
        result.pairingCalls.map(({ endpoint }) => endpoint),
        ["/cli/auth/session", "/cli/auth/session"],
      );
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
