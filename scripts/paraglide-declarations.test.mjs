// FMT-03 (#393, #371): the fast declaration emitter must preserve the typed
// inputs contract that `emitTsDeclarations` used to provide. This test runs
// a bounded real generation (no network), then proves through an actual
// TypeScript program and actual runtime readers that required params,
// locale options and plural variants still typecheck and resolve — not by
// grepping generated source, but by compiling a consumer and calling the
// compiled messages.

import { expect, test } from "bun:test";
import { compile, paraglideVitePlugin } from "@inlang/paraglide-js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  emitAllDeclarationsFromOutdir,
  generateMessageDeclarations,
  paraglideFastDeclarationsPlugin,
} from "./paraglide-declarations.mjs";

const IS_SERVER = "import.meta.env?.SSR ?? typeof window === 'undefined'";
const STRATEGY = ["cookie", "globalVariable", "preferredLanguage", "baseLocale"];

const MESSAGES = {
  en: {
    hello: "Hello, {name}!",
    plain: "Just text",
    "my-key": "Keyed, {name}!",
    media_selected: [
      {
        declarations: ["input count", "local countPlural = count: plural"],
        selectors: ["countPlural"],
        match: { "countPlural=one": "{count} selected", "countPlural=other": "{count} selected" },
      },
    ],
  },
  fr: {
    hello: "Salut, {name} !",
    plain: "Texte simple",
    "my-key": "Clé, {name} !",
    media_selected: [
      {
        declarations: ["input count", "local countPlural = count: plural"],
        selectors: ["countPlural"],
        match: {
          "countPlural=one": "{count} sélectionné",
          "countPlural=other": "{count} sélectionnés",
          "countPlural=many": "{count} sélectionnés (many)",
        },
      },
    ],
  },
};

async function createFixtureProject() {
  const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
  const project = path.join(webRoot, `paraglide-declarations-${randomUUID()}-project.inlang`);
  const settings = JSON.parse(await readFile(path.join(webRoot, "project.inlang/settings.json")));
  settings.locales = ["en", "fr"];
  settings.baseLocale = "en";
  settings["plugin.inlang.messageFormat"].pathPattern =
    `./${path.basename(project)}/messages/{locale}.json`;
  await mkdir(path.join(project, "messages"), { recursive: true });
  await writeFile(path.join(project, "settings.json"), JSON.stringify(settings));
  for (const [locale, catalog] of Object.entries(MESSAGES)) {
    await writeFile(path.join(project, "messages", `${locale}.json`), JSON.stringify(catalog));
  }
  return project;
}

test("fast declarations keep typed inputs, locale options and plurals", async () => {
  const project = await createFixtureProject();
  const outdir = path.join(project, "output");
  const consumerDir = await mkdtempDir();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Network access is disabled for this build");
    };
    await compile({
      project,
      outdir,
      strategy: STRATEGY,
      outputStructure: "locale-modules",
      isServer: IS_SERVER,
    });

    const started = Date.now();
    const result = await emitAllDeclarationsFromOutdir(outdir);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(result.pruned).toEqual([]);

    // Every generated module keeps a sibling declaration.
    const generated = [];
    for (const entry of await readdir(outdir)) {
      if (entry.endsWith(".js")) generated.push(entry);
    }
    for (const entry of await readdir(path.join(outdir, "messages"))) {
      if (entry.endsWith(".js")) generated.push(`messages/${entry}`);
    }
    expect(generated.length).toBeGreaterThan(0);
    for (const relativePath of generated) {
      const declarationPath = path.join(outdir, relativePath.replace(/\.js$/, ".d.ts"));
      const declaration = await readFile(declarationPath, "utf8");
      expect(declaration.length).toBeGreaterThan(0);
      if (relativePath.startsWith("messages/")) {
        // No bare `any` stubs: every message keeps its generated inputs type.
        const typedExports = declaration
          .split("\n")
          .filter((line) => line.startsWith("export const ") || line.startsWith("declare const "));
        expect(typedExports.length).toBeGreaterThan(0);
        for (const line of typedExports) {
          expect(line).toContain("Inputs");
          expect(line).not.toMatch(/\bany\b/);
        }
      }
    }

    // A real TypeScript consumer: correct calls pass, missing required
    // inputs and unknown locales fail for the reported reason.
    const require = createRequire(import.meta.url);
    const typescript = require("typescript");
    const good = [
      `import { m } from ${JSON.stringify(path.join(outdir, "messages.js"))};`,
      `export const a: string = m.hello({ name: "Ada" });`,
      `export const b: string = m.plain();`,
      `export const c: string = m.media_selected({ count: 1000000 }, { locale: "fr" });`,
      `export const d: string = m["my-key"]({ name: "Ada" }, { locale: "en" });`,
      `export const e: string = m.hello({ name: "Ada" }, { locale: "fr" });`,
    ].join("\n");
    const bad = [
      `import { m } from ${JSON.stringify(path.join(outdir, "messages.js"))};`,
      `export const missing = m.hello();`,
      `export const wrongLocale = m.hello({ name: "Ada" }, { locale: "es" });`,
    ].join("\n");
    const goodPath = path.join(consumerDir, "good.ts");
    const badPath = path.join(consumerDir, "bad.ts");
    await writeFile(goodPath, good);
    await writeFile(badPath, bad);
    const program = typescript.createProgram([goodPath, badPath], {
      strict: true,
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      types: [],
    });
    const diagnostics = (file) =>
      program
        .getSemanticDiagnostics(program.getSourceFile(file))
        .map((diagnostic) => typescript.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    expect(diagnostics(goodPath)).toEqual([]);
    const badDiagnostics = diagnostics(badPath);
    expect(badDiagnostics.length).toBeGreaterThanOrEqual(2);
    expect(badDiagnostics.some((message) => message.includes("arguments, but got 0"))).toBe(true);
    expect(badDiagnostics.some((message) => message.includes("is not assignable"))).toBe(true);

    // Actual readers: the compiled messages resolve per-locale strings,
    // including the French `many` plural category.
    const compiled = await import(pathToFileURL(path.join(outdir, "messages.js")).href);
    expect(compiled.m.hello({ name: "Ada" }, { locale: "en" })).toBe("Hello, Ada!");
    expect(compiled.m.hello({ name: "Ada" }, { locale: "fr" })).toBe("Salut, Ada !");
    expect(compiled.m.media_selected({ count: 1 }, { locale: "en" })).toBe("1 selected");
    expect(compiled.m.media_selected({ count: 1000000 }, { locale: "fr" })).toBe(
      "1000000 sélectionnés (many)",
    );
    expect(compiled.m["my-key"]({ name: "Ada" }, { locale: "en" })).toBe("Keyed, Ada!");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(project, { recursive: true, force: true });
    await rm(consumerDir, { recursive: true, force: true });
  }
}, 120_000);

test("unrecognized generated shapes fail instead of emitting stubs", () => {
  expect(() => generateMessageDeclarations("export const x = 1;\n")).toThrow(/unrecognized/);
  expect(() => generateMessageDeclarations("/** dangling\n")).toThrow(/unterminated/);
  expect(() =>
    generateMessageDeclarations("/**\n * @typedef {string} Lost\n */\nexport const x = 1;\n"),
  ).toThrow(/multiline @typedef/);
});

test("companion declarations survive a slow upstream compile in the dev container", async () => {
  // The dev server dispatches `buildStart` across plugins concurrently. The
  // upstream plugin compiles asynchronously and its output writer deletes
  // files the compile did not emit (our `.d.ts` siblings included), so the
  // companion settle must run strictly after the upstream hook completes —
  // not merely be registered after it. This drives both plugins through a
  // real Vite dev container instead of calling the hooks directly.
  const project = await createFixtureProject();
  const outdir = path.join(project, "output");
  const serverRoot = await mkdtempDir();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Network access is disabled for this build");
    };
    await compile({
      project,
      outdir,
      strategy: STRATEGY,
      outputStructure: "locale-modules",
      isServer: IS_SERVER,
    });
    const plugin = paraglideFastDeclarationsPlugin({ outdir });
    await emitAllDeclarationsFromOutdir(outdir);
    const messageDir = path.join(outdir, "messages");
    const before = (await readdir(messageDir)).filter((entry) => entry.endsWith(".d.ts"));
    expect(before.length).toBeGreaterThan(0);

    const upstream = {
      name: "test-slow-upstream-compile",
      async buildStart() {
        // Slow async compile like the real paraglide plugin, then the
        // seed-delete pass its output writer performs on a fresh process:
        // files the compile did not emit are removed.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await compile({
          project,
          outdir,
          strategy: STRATEGY,
          outputStructure: "locale-modules",
          isServer: IS_SERVER,
        });
        for (const entry of await readdir(messageDir)) {
          if (entry.endsWith(".d.ts")) await rm(path.join(messageDir, entry));
        }
      },
    };
    const { createServer } = await import("vite");
    const server = await createServer({
      root: serverRoot,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      plugins: [upstream, plugin],
    });
    // The container runs `buildStart` while the server is created; the
    // explicit call below is a backstop. Read the declarations BEFORE
    // `server.close()`: close fires `closeBundle`, which reconverges and
    // would mask a race lost during the session.
    try {
      await server.pluginContainer.buildStart({});
      const after = (await readdir(messageDir)).filter((entry) => entry.endsWith(".d.ts"));
      expect(new Set(after)).toEqual(new Set(before));
      const declarations = new Map();
      for (const entry of after) {
        const contents = await readFile(path.join(messageDir, entry), "utf8");
        declarations.set(entry, contents);
        expect(contents).toContain("Inputs");
        expect(contents).not.toMatch(/\bany\b/);
      }

      // One-shot builds also need buildEnd to repair siblings removed by an upstream writer.
      for (const entry of before) await rm(path.join(messageDir, entry));
      expect((await readdir(messageDir)).filter((entry) => entry.endsWith(".d.ts"))).toEqual([]);
      await plugin.buildEnd();
      const restored = (await readdir(messageDir)).filter((entry) => entry.endsWith(".d.ts"));
      expect(new Set(restored)).toEqual(new Set(before));
      for (const entry of restored) {
        expect(await readFile(path.join(messageDir, entry), "utf8")).toBe(declarations.get(entry));
      }
    } finally {
      await server.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(project, { recursive: true, force: true });
    await rm(serverRoot, { recursive: true, force: true });
  }
}, 120_000);

test("watched locale settings update TypeScript consumers before the dev server closes", async () => {
  const project = await createFixtureProject();
  const outdir = path.join(project, "output");
  const serverRoot = await mkdtempDir();
  const settingsPath = path.join(project, "settings.json");
  let server;
  try {
    const { createServer } = await import("vite");
    server = await createServer({
      root: serverRoot,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      plugins: [
        paraglideVitePlugin({
          project,
          outdir,
          strategy: STRATEGY,
          outputStructure: "locale-modules",
          isServer: IS_SERVER,
          emitTsDeclarations: false,
        }),
        paraglideFastDeclarationsPlugin({ outdir }),
      ],
    });
    await server.pluginContainer.buildStart({});
    const require = createRequire(import.meta.url);
    const ts = require("typescript");
    const consumer = path.join(serverRoot, "consumer.ts");
    async function diagnostics(locale) {
      await writeFile(
        consumer,
        `import { m } from ${JSON.stringify(path.join(outdir, "messages.js"))};
import type { Locale } from ${JSON.stringify(path.join(outdir, "runtime.js"))};
export const selected: Locale = "${locale}";
export const value: string = m.hello({ name: "Ada" }, { locale: selected });`,
      );
      const program = ts.createProgram([consumer], {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        types: [],
      });
      return program
        .getSemanticDiagnostics(program.getSourceFile(consumer))
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    }
    expect(await diagnostics("fr")).toEqual([]);
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.locales.push("de");
    await writeFile(path.join(project, "messages/de.json"), JSON.stringify(MESSAGES.en));
    await writeFile(settingsPath, JSON.stringify(settings));
    await server.pluginContainer.watchChange(settingsPath, { event: "update" });
    expect(await diagnostics("de")).toEqual([]);

    settings.locales = ["en"];
    await writeFile(settingsPath, JSON.stringify(settings));
    await server.pluginContainer.watchChange(settingsPath, { event: "update" });
    expect(await diagnostics("en")).toEqual([]);
    expect((await diagnostics("fr")).some((message) => message.includes("is not assignable"))).toBe(
      true,
    );
  } finally {
    await server?.close();
    await rm(project, { recursive: true, force: true });
    await rm(serverRoot, { recursive: true, force: true });
  }
}, 120_000);

async function mkdtempDir() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), "paraglide-declarations-"));
}
