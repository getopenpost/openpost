import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolveConfig, loadConfigFromFile } from "vite";
import { mkdtemp, writeFile, readFile, readdir, rm, chmod, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the installed plugin and its hooks, replacing only its CLI executable.
const root = await mkdtemp(join(tmpdir(), "openpost-posthog-"));
const cli = join(root, "posthog-cli");
const receipt = join(root, "receipt.json");
await writeFile(
  cli,
  `#!/usr/bin/env node
const paths = (await import("node:fs")).readFileSync(0, "utf8").trim().split("\\n");
const maps = [];
for (const path of paths) {
  const map = JSON.parse((await import("node:fs")).readFileSync(path + ".map", "utf8"));
  if (!map.sourcesContent.some(source => source?.includes("fixture failure"))) process.exit(9);
  maps.push(map);
}
(await import("node:fs")).writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({paths, maps, args: process.argv.slice(2), host: process.env.POSTHOG_CLI_HOST}));
if (process.env.OPENPOST_FIXTURE_UPLOAD_FAIL === "1") process.exit(7);
for (const path of paths) await (await import("node:fs/promises")).unlink(path + ".map");
`,
);
await chmod(cli, 0o755);
const { postHogSourceMaps } = await import("../../scripts/posthog-source-maps");
// Production Vite runs in Node. Intercept only the CLI path in its installed
// plugin, leaving the helper and real build hooks unchanged.
const wrapper = join(root, "plugin-wrapper.mjs");
await writeFile(
  wrapper,
  `import plugin from ${JSON.stringify(import.meta.resolve("@posthog/rollup-plugin"))}; export default options => plugin({...options,cliBinaryPath:${JSON.stringify(cli)}});`,
);
const builder = join(root, "build.mjs");
await writeFile(
  builder,
  `
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='@posthog/rollup-plugin' ? ${JSON.stringify(pathToFileURL(wrapper).href)} : specifier,context);}});
const {build}=await import(${JSON.stringify(import.meta.resolve("vite"))});
const {postHogSourceMaps}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "scripts/posthog-source-maps.ts")).href)});
const options=JSON.parse(process.argv[2]);
await build({...options,plugins:postHogSourceMaps(options.surface).plugins});
`,
);
async function fixtureBuild(options: Record<string, unknown>) {
  const stdout = join(root, "bundle-build.log");
  const stderr = join(root, "bundle-build-error.log");
  const child = Bun.spawn(["node", builder, JSON.stringify(options)], {
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
    env: process.env,
  });
  const status = await child.exited;
  if (status !== 0)
    throw new Error((await readFile(stdout, "utf8")) + (await readFile(stderr, "utf8")));
}

const saved = { ...process.env };
beforeAll(() => {
  process.env.POSTHOG_SOURCEMAPS_ENABLED = "1";
  process.env.POSTHOG_PERSONAL_API_KEY = "fixture-key";
  process.env.POSTHOG_PROJECT_ID = "123";
  process.env.POSTHOG_UI_HOST = "https://eu.posthog.com";
  process.env.OPENPOST_RELEASE_VERSION = "fixture-release";
});
afterAll(async () => {
  process.env = saved;
  await rm(root, { recursive: true, force: true });
});

for (const surface of ["app", "marketing"] as const) {
  for (const ssr of [false, true]) {
    test(`${surface} ${ssr ? "SSR" : "client"} resolves upload scope`, async () => {
      const maps = postHogSourceMaps(surface);
      const config = await resolveConfig(
        {
          configFile: false,
          plugins: maps.plugins,
          build: { ssr },
        },
        "build",
      );
      expect(config.plugins.some((plugin) => plugin.name === "posthog-rollup-plugin")).toBe(!ssr);
    });
  }
}

test("explicit upload enablement rejects missing credentials", () => {
  for (const key of ["POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID", "POSTHOG_UI_HOST"]) {
    const value = process.env[key];
    process.env[key] = " ";
    expect(() => postHogSourceMaps("app")).toThrow("required");
    process.env[key] = value;
  }
});

for (const ssr of [false, true]) {
  test(`real Vite ${ssr ? "SSR" : "client"} bundle invokes only the client CLI`, async () => {
    await rm(receipt, { force: true });
    const entry = join(root, "entry.js");
    await writeFile(
      entry,
      'export function fail() { throw new Error("fixture failure"); } globalThis.fail = fail;',
    );
    const outDir = join(root, ssr ? "server" : "client");
    await fixtureBuild({
      configFile: false,
      root,
      logLevel: "silent",
      surface: "marketing",
      build: { ssr, outDir, minify: true, rollupOptions: { input: entry } },
    });
    const files = await readdir(outDir, { recursive: true });
    expect(files.some((file) => file.endsWith(".map"))).toBe(false);
    const js = await readFile(
      join(
        outDir,
        files.find((file) => /\.m?js$/.test(file))!,
      ),
      "utf8",
    );
    expect(js).not.toContain("sourceMappingURL");
    if (ssr) {
      expect(await Bun.file(receipt).exists()).toBe(false);
    } else {
      const upload = JSON.parse(await readFile(receipt, "utf8"));
      expect(upload.paths).toHaveLength(1);
      expect(upload.args).toEqual([
        "sourcemap",
        "process",
        "--stdin",
        "--release-name",
        "openpost-marketing",
        "--release-version",
        "fixture-release",
        ...(process.env.GITHUB_RUN_ID ? ["--build", process.env.GITHUB_RUN_ID.trim()] : []),
        "--delete-after",
      ]);
      expect(upload.host).toBe("https://eu.posthog.com");
      expect(upload.maps[0].sourcesContent.join("")).toContain("fixture failure");
    }
  });
}

test("client CLI failure fails the build and retains private maps", async () => {
  process.env.OPENPOST_FIXTURE_UPLOAD_FAIL = "1";
  try {
    const outDir = join(root, "failed-client");
    await expect(
      fixtureBuild({
        configFile: false,
        root,
        logLevel: "silent",
        surface: "app",
        build: { outDir, rollupOptions: { input: join(root, "entry.js") } },
      }),
    ).rejects.toThrow("Command failed with code 7");
    expect((await readdir(outDir, { recursive: true })).some((file) => file.endsWith(".map"))).toBe(
      true,
    );
    expect(await Bun.file(receipt).exists()).toBe(true);
  } finally {
    delete process.env.OPENPOST_FIXTURE_UPLOAD_FAIL;
  }
});

for (const surface of ["web", "marketing"]) {
  test(`${surface} actual Vite config keeps hidden maps only for client`, async () => {
    const cwd = process.cwd();
    try {
      process.chdir(join(cwd, "apps", surface));
      for (const isSsrBuild of [false, true]) {
        const loaded = await loadConfigFromFile(
          { command: "build", mode: "production", isSsrBuild },
          "vite.config.ts",
        );
        expect(loaded?.config.build?.sourcemap).toBe(isSsrBuild ? false : "hidden");
      }
    } finally {
      process.chdir(cwd);
    }
  });
}

test("adapter-static shipping output excludes server code and prerender failures stay in logs", async () => {
  const fixture = join(root, "static-site");
  await mkdir(join(fixture, "src/routes"), { recursive: true });
  await symlink(join(process.cwd(), "node_modules"), join(fixture, "node_modules"));
  await writeFile(join(fixture, "package.json"), '{"type":"module"}');
  await writeFile(
    join(fixture, "svelte.config.js"),
    `import adapter from '@sveltejs/adapter-static'; export default { kit: { adapter: adapter({ pages: 'dist', assets: 'dist', strict: true }) } };`,
  );
  await writeFile(
    join(fixture, "vite.config.js"),
    `import { sveltekit } from '@sveltejs/kit/vite'; export default { plugins: [sveltekit()] };`,
  );
  await writeFile(
    join(fixture, "src/app.html"),
    "<html><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>",
  );
  await writeFile(join(fixture, "src/routes/+layout.js"), "export const prerender = true;");
  await writeFile(join(fixture, "src/routes/+page.svelte"), "<h1>Static fixture</h1>");
  const run = async () => {
    const logFile = join(root, "static-build.log");
    const errorFile = join(root, "static-build-error.log");
    const child = Bun.spawn(
      [process.execPath, join(process.cwd(), "node_modules/vite/bin/vite.js"), "build"],
      {
        cwd: fixture,
        stdout: Bun.file(logFile),
        stderr: Bun.file(errorFile),
        env: { ...process.env, POSTHOG_SOURCEMAPS_ENABLED: "0" },
      },
    );
    const code = await child.exited;
    return { code, log: (await readFile(logFile, "utf8")) + (await readFile(errorFile, "utf8")) };
  };
  const success = await run();
  expect(success.code, success.log).toBe(0);
  const files = await readdir(join(fixture, "dist"), { recursive: true });
  expect(files).toContain("index.html");
  expect(files.some((file) => /(^|\/)server(\/|$)|\.map$/.test(file))).toBe(false);
  expect(await Bun.file(join(fixture, ".svelte-kit/output/server/index.js")).exists()).toBe(true);
  await writeFile(
    join(fixture, "src/routes/+page.server.js"),
    'export function load() { throw new Error("prerender fixture failure"); }',
  );
  const failure = await run();
  expect(failure.code).not.toBe(0);
  expect(failure.log).toContain("prerender fixture failure");
});

test("release identity is mandatory and disabled uploads need no credentials", () => {
  const keys = [
    "OPENPOST_RELEASE_VERSION",
    "GITHUB_SHA",
    "CF_PAGES_COMMIT_SHA",
    "VITE_OPENPOST_REVISION",
  ];
  const values = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    expect(() => postHogSourceMaps("marketing")).toThrow("required");
    process.env.POSTHOG_SOURCEMAPS_ENABLED = "0";
    expect(postHogSourceMaps("marketing")).toEqual({ enabled: false, plugins: [] });
  } finally {
    keys.forEach((key, index) => {
      if (values[index] === undefined) delete process.env[key];
      else process.env[key] = values[index];
    });
    process.env.POSTHOG_SOURCEMAPS_ENABLED = "1";
  }
});
