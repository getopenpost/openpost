import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { staticUICSS } from "./static-ui.mjs";
import { offlineTranslations } from "../apps/web/src/lib/offline-translations.ts";

const css = await staticUICSS();
const mark = (await readFile(new URL("../assets/brand/icon.svg", import.meta.url), "utf8"))
  .replace(/<\?xml[^>]*>\s*/u, "")
  .replace(
    /<svg([^>]*)>/u,
    (_, attributes) =>
      `<svg aria-hidden="true" width="32" height="32"${attributes.replace(/\s(?:width|height)="[^"]*"/gu, "")}>`,
  )
  .replace(/#[bB]45309/gu, "currentColor");

const offline = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="light dark" />
    <title>You're offline | OpenPost</title>
    <style>${css}</style>
  </head>
  <body data-theme-button="dither">
    <main class="op-recovery op-recovery--compact">
      <div class="op-recovery-brand">${mark.replace(/^[ \t]+$/gmu, "")}OpenPost</div>
      <div class="op-recovery-body">
        <div>
          <h1>You're offline</h1>
          <p class="op-recovery-copy">This page isn't available on this device yet. Reconnect to open it. Your saved local projects remain on this device.</p>
          <div class="op-recovery-actions"><a href="" data-static-action data-dither-button="always">Try again</a></div>
        </div>
      </div>
    </main>
    <script>
      const translations = ${JSON.stringify(offlineTranslations).replaceAll("<", "\\u003c")};
      const savedLocale = document.cookie.match(/(?:^|;\\s*)PARAGLIDE_LOCALE=([^;]*)/)?.[1];
      const locales = [savedLocale, ...navigator.languages].filter(Boolean);
      for (const locale of locales) {
        const key = locale.toLowerCase();
        const language = translations[key] ? key : key.split('-')[0];
        if (language === 'en') break;
        const copy = translations[language];
        if (!copy) continue;
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
        document.title = copy[0] + ' | OpenPost';
        document.querySelector('h1').textContent = copy[0];
        document.querySelector('.op-recovery-copy').textContent = copy[1];
        document.querySelector('a').textContent = copy[2];
        break;
      }
    </script>
  </body>
</html>
`;

for (const [relative, content] of [
  ["apps/web/static/offline.html", offline],
  ["apps/server/internal/api/handlers/mcp_ui.css", css],
]) {
  const output = new URL(`../${relative}`, import.meta.url);
  if (process.argv.includes("--check")) {
    assert.equal(
      await readFile(output, "utf8"),
      content,
      `${relative} is stale; run bun scripts/sync-static-ui.mjs`,
    );
  } else {
    await writeFile(output, content);
  }
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Updated"} standalone UI styles.`);
