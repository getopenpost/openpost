import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const helper = pathToFileURL(
  path.join(repository, "apps/web/scripts/paraglide-test-maps.mjs"),
).href;

test("browser generated maps preserve code and authored maps, with a resolved coverage bypass", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "openpost-test-maps-")));
  const web = path.join(root, "apps/web");
  const generated = path.join(web, "src/lib/paraglide");
  try {
    await mkdir(generated, { recursive: true });
    await symlink(path.join(repository, "node_modules"), path.join(root, "node_modules"), "dir");
    await writeFile(path.join(generated, "leaf.js"), 'export const message = "Olá";\n');
    await writeFile(
      path.join(generated, "wrapper.js"),
      'import { message } from "./leaf.js";\nexport { message };\n',
    );
    await writeFile(
      path.join(web, "src/lib/authored.ts"),
      'export const author: string = "kept";\n',
    );
    await writeFile(
      path.join(root, "vite.config.mjs"),
      `export default ${JSON.stringify({
        root: web,
        publicDir: false,
        cacheDir: path.join(root, "vite-cache"),
        server: { host: "127.0.0.1", fs: { allow: [root, repository] } },
      })};`,
    );
    await writeFile(
      path.join(root, "vitest.config.mjs"),
      `import { playwright } from '@vitest/browser-playwright';
import { paraglideTestMaps } from ${JSON.stringify(helper)};
const owner = paraglideTestMaps(${JSON.stringify(root)});
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default {
  root: ${JSON.stringify(web)},
  test: {
    reporters: ['default', 'json', owner.reporter],
    outputFile: { json: ${JSON.stringify(path.join(root, "results.json"))} },
    provide: { mapLoader: owner.plugin.name },
    projects: [{
      extends: ${JSON.stringify(path.join(root, "vite.config.mjs"))},
      plugins: [owner.plugin],
      test: {
        name: 'client', maxWorkers: 1, isolate: true,
        include: ['protocol.browser.test.js'],
        browser: {
          enabled: true,
          provider: playwright({ launchOptions: { executablePath, channel: executablePath ? undefined : 'chromium' } }),
          instances: [{ browser: 'chromium', headless: true }]
        }
      }
    }]
  }
};`,
    );
    await writeFile(
      path.join(web, "protocol.browser.test.js"),
      `import { test, expect } from 'vitest';
import baseline from './baseline.json';
import { message } from './src/lib/paraglide/wrapper.js';
test('actual generated leaf and rewritten wrapper keep bytes without maps', async () => {
  expect(message).toBe('Olá');
  for (const id of ['/src/lib/paraglide/leaf.js', '/src/lib/paraglide/wrapper.js', '/src/lib/authored.ts']) {
    const response = await fetch(id);
    expect(response.status).toBe(200);
    const body = await response.text();
    const marker = '\\n//# sourceMappingURL=';
    expect(body.split(marker)[0]).toBe(baseline[id]);
    if (id.includes('/paraglide/')) {
      expect(body.includes(marker), 'generated map still served: ' + id).toBe(false);
    } else {
      const encoded = body.split(marker)[1];
      expect(encoded.startsWith('data:application/json;base64,')).toBe(true);
      const map = JSON.parse(atob(encoded.slice('data:application/json;base64,'.length)));
      expect(map.version).toBe(3);
      expect(map.mappings.length).toBeGreaterThan(0);
      expect(map.sources.some(source => source.endsWith('authored.ts'))).toBe(true);
    }
  }
});`,
    );
    await writeFile(
      path.join(root, "run.mjs"),
      `import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { createVitest, parseCLI } from 'vitest/node';
const root = ${JSON.stringify(root)};
const web = ${JSON.stringify(web)};
const config = ${JSON.stringify(path.join(root, "vitest.config.mjs"))};
let server, context;
const close = async () => { await Promise.all([server?.close(), context?.close()]); server = context = undefined; };
process.once('SIGTERM', () => { void close().finally(() => process.exit(143)); });
try {
  // An ordinary Vite response is the independent code-byte baseline. No test
  // owner or synthetic Vitest browser plugin is installed in this server.
  server = await createServer({ configFile: false, root: web, mode: 'test', publicDir: false,
    cacheDir: path.join(root, 'baseline-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [root, ${JSON.stringify(repository)}] } } });
  await server.listen();
  const baseline = {};
  for (const id of ['/src/lib/paraglide/leaf.js', '/src/lib/paraglide/wrapper.js', '/src/lib/authored.ts']) {
    const response = await fetch(new URL(id, server.resolvedUrls.local[0]));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('\\n//# sourceMappingURL='), 'baseline map control missing: ' + id);
    baseline[id] = body.split('\\n//# sourceMappingURL=')[0];
  }
  assert.equal(baseline['/src/lib/paraglide/leaf.js'], await fs.readFile(path.join(web, 'src/lib/paraglide/leaf.js'), 'utf8'));
  assert.ok(baseline['/src/lib/paraglide/wrapper.js'].includes('/src/lib/paraglide/leaf.js'), 'wrapper import was not rewritten');
  await fs.writeFile(path.join(web, 'baseline.json'), JSON.stringify(baseline));
  await close();

  const options = coverage => parseCLI(['vitest', 'run', '--config', config, '--project', 'client', '--watch=false', ...(coverage ? ['--coverage'] : [])]).options;
  context = await createVitest('test', options(false));
  await context.start();
  const results = JSON.parse(await fs.readFile(path.join(root, 'results.json'), 'utf8'));
  assert.equal(results.numTotalTests, 1);
  assert.equal(results.numPassedTests, 1, 'native response-boundary regression failed');
  assert.equal(results.numPendingTests, 0);
  assert.equal(results.success, true);
  await close();

  // Resolve real CLI coverage options but do not start tests or initialize a
  // coverage provider. The actual configured gate must decline before needing
  // a plugin context; an accidentally eligible gate would throw here.
  context = await createVitest('test', options(true));
  assert.equal(context.config.run, true);
  assert.equal(context.config.watch, false);
  assert.equal(context.config.coverage.enabled, true);
  const gate = context.config.reporters.find(reporter => !Array.isArray(reporter) && typeof reporter.onInit === 'function');
  assert.ok(gate);
  await gate.onInit(context);
  const name = context.config.provide.mapLoader;
  const plugin = context.projects.flatMap(project => project.vite.config.plugins).find(plugin => plugin.name === name);
  assert.ok(plugin);
  const load = typeof plugin.load === 'function' ? plugin.load : plugin.load.handler;
  assert.equal(await load.call(undefined, path.join(web, 'src/lib/paraglide/leaf.js')), null);
} finally { await close(); }`,
    );

    const result = spawnSync("node", [path.join(root, "run.mjs")], {
      cwd: web,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_ENV: "test", OPENPOST_PARAGLIDE_PRECOMPILED: "1" },
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Native map fixture exited ${result.status}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
      );
    }
    const results = JSON.parse(await readFile(path.join(root, "results.json"), "utf8"));
    expect(results.numPassedTests).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 40_000);
