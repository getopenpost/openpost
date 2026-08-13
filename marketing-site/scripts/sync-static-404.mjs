import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marketingErrorRecovery as content } from "../src/routes/_error-recovery.ts";

const siteRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.join(siteRoot, "static/404.html");

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function externalAttributes(href) {
  return href.startsWith("https://") ? ' target="_blank" rel="noreferrer"' : "";
}

const routes = content.routes
  .map(
    (route) => `
            <li>
              <a class="route-link" href="${escapeHTML(route.href)}"${externalAttributes(route.href)}>
                <span><strong>${escapeHTML(route.label)}</strong><small>${escapeHTML(route.description)}</small></span>
                <span aria-hidden="true">${route.href.startsWith("https://") ? "↗" : "→"}</span>
              </a>
            </li>`,
  )
  .join("");

const support = content.support
  .map(
    (link) =>
      `<a href="${escapeHTML(link.href)}"${externalAttributes(link.href)}>${escapeHTML(link.label)}</a>`,
  )
  .join("\n              ");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="light dark" />
    <title>Page not found · OpenPost</title>
    <style>
      :root { color-scheme: light dark; font-family: Geist, ui-sans-serif, system-ui, sans-serif; color: #302b28; background: #faf9f7; }
      * { box-sizing: border-box; }
      body { min-width: 0; min-height: 100vh; margin: 0; background: radial-gradient(circle at 82% 22%, rgba(183, 76, 5, .12), transparent 24rem), #faf9f7; }
      a { color: inherit; text-decoration: none; }
      a:focus-visible { outline: 3px solid #b74c05; outline-offset: 3px; }
      .page { display: grid; min-height: 100vh; align-items: center; overflow: hidden; padding-block: 3rem; }
      .shell { width: min(calc(100% - 2rem), 72rem); margin-inline: auto; }
      .brand { display: inline-flex; min-height: 44px; align-items: center; gap: .55rem; border-radius: .5rem; font-weight: 650; }
      .brand img { width: 36px; height: 28px; }
      .grid { display: grid; gap: 3rem; margin-top: clamp(3rem, 7vw, 6rem); }
      .code, .panel-label { color: #b74c05; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { max-width: 11ch; margin: 1rem 0 0; font-size: clamp(2.8rem, 7vw, 5.8rem); font-weight: 660; line-height: .96; letter-spacing: -.04em; text-wrap: balance; }
      .description { max-width: 58ch; margin: 1.4rem 0 0; color: #67605c; line-height: 1.7; }
      .primary { display: inline-flex; min-height: 44px; align-items: center; gap: .5rem; margin-top: 1.8rem; border-radius: .6rem; color: #b74c05; font-size: .86rem; font-weight: 650; }
      .panel { padding: clamp(1.2rem, 3vw, 2rem); border: 1px solid #e4dfdb; border-radius: 1rem; background: rgba(255, 255, 255, .82); }
      ul { margin: .8rem 0 0; padding: 0; list-style: none; }
      li + li { border-top: 1px solid #e4dfdb; }
      .route-link { display: grid; min-height: 84px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; border-radius: .5rem; }
      .route-link strong, .route-link small { display: block; }
      .route-link strong { font-size: .9rem; }
      .route-link small { margin-top: .25rem; color: #67605c; font-size: .75rem; line-height: 1.45; }
      .support { display: flex; flex-wrap: wrap; min-height: 44px; align-items: center; gap: .4rem .8rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e4dfdb; color: #67605c; font-size: .74rem; }
      .support a { display: inline-flex; min-height: 44px; align-items: center; border-radius: .5rem; color: #302b28; font-weight: 600; }
      @media (min-width: 52rem) { .grid { grid-template-columns: minmax(0, 1fr) minmax(22rem, .78fr); align-items: end; gap: clamp(3rem, 8vw, 8rem); } }
      @media (max-width: 39.99rem) { .page { align-items: start; padding-top: 1.5rem; } .grid { margin-top: 2.5rem; } .support { display: grid; grid-template-columns: auto 1fr; } .support a { grid-column: 2; } }
      @media (prefers-color-scheme: dark) {
        :root { color: #f2eeeb; background: #211e1c; }
        body { background: radial-gradient(circle at 82% 22%, rgba(215, 102, 23, .12), transparent 24rem), #211e1c; }
        .code, .panel-label, .primary { color: #db6c22; }
        .description, .route-link small, .support { color: #aaa19b; }
        .panel { border-color: #403a36; background: rgba(46, 42, 39, .84); }
        li + li, .support { border-color: #403a36; }
        .support a { color: #f2eeeb; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="shell">
        <a class="brand" href="/" aria-label="OpenPost home"><img src="/logo.svg" alt="" width="36" height="28" /><span>OpenPost</span></a>
        <div class="grid">
          <div>
            <p class="code">${content.status} · ${escapeHTML(content.label)}</p>
            <h1>${escapeHTML(content.title)}</h1>
            <p class="description">${escapeHTML(content.description)}</p>
            <a class="primary" href="${escapeHTML(content.primary.href)}"><span aria-hidden="true">←</span>${escapeHTML(content.primary.label)}</a>
          </div>
          <div class="panel">
            <p class="panel-label">Continue from a maintained page</p>
            <nav aria-label="Page recovery"><ul>${routes}
            </ul></nav>
            <div class="support"><span aria-hidden="true">?</span><span>Need help?</span>
              ${support}
            </div>
          </div>
        </div>
      </div>
    </main>
  </body>
</html>
`;

if (process.argv.includes("--check")) {
  const existing = await readFile(output, "utf8");
  assert.equal(
    existing,
    html,
    "static/404.html is stale; run bun run sync:404",
  );
  console.log(
    "Verified static 404 content matches the shared recovery source.",
  );
} else {
  await writeFile(output, html);
  console.log(`Updated ${path.relative(process.cwd(), output)}.`);
}
