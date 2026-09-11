import { expect, test } from "bun:test";
import { compile } from "@inlang/paraglide-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("a fresh translation build works without network access", async () => {
  const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
  const project = path.join(webRoot, `paraglide-offline-${randomUUID()}.inlang`);
  const settings = JSON.parse(await readFile(path.join(webRoot, "project.inlang/settings.json")));
  const originalFetch = globalThis.fetch;
  try {
    settings.locales = ["en", "pt"];
    settings["plugin.inlang.messageFormat"].pathPattern =
      `./${path.basename(project)}/messages/{locale}.json`;
    await mkdir(path.join(project, "messages"), { recursive: true });
    await writeFile(path.join(project, "settings.json"), JSON.stringify(settings));
    await writeFile(
      path.join(project, "messages/en.json"),
      JSON.stringify({ greeting: "Ready, {name}." }),
    );
    await writeFile(
      path.join(project, "messages/pt.json"),
      JSON.stringify({ greeting: "Pronto, {name}." }),
    );
    globalThis.fetch = async () => {
      throw new Error("Network access is disabled for this build");
    };
    const outdir = path.join(project, "output");
    await compile({ project, outdir, strategy: ["baseLocale"] });
    const messages = await import(pathToFileURL(path.join(outdir, "messages.js")).href);
    expect(messages.greeting({ name: "Rodrigo" }, { locale: "en" })).toBe("Ready, Rodrigo.");
    expect(messages.greeting({ name: "Rodrigo" }, { locale: "pt" })).toBe("Pronto, Rodrigo.");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(project, { recursive: true, force: true });
  }
});
