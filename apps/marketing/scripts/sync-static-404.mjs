import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketingErrorRecovery as content } from '../src/routes/_error-recovery.ts';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(siteRoot, 'static/404.html');

function escapeHTML(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function externalAttributes(href) {
	return href.startsWith('https://') ? ' target="_blank" rel="noreferrer"' : '';
}

const links = [...content.routes, ...content.support]
	.map(
		(link) =>
			`<a href="${escapeHTML(link.href)}"${externalAttributes(link.href)}>${escapeHTML(link.label)}</a>`
	)
	.join('\n              ');

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
      body { min-width: 0; min-height: 100vh; margin: 0; background: #faf9f7; }
      a { color: inherit; text-decoration: none; }
      a:focus-visible { outline: 3px solid #b74c05; outline-offset: 3px; }
      .page { display: grid; min-height: 100vh; align-items: center; padding-block: 3rem; }
      .shell { width: min(calc(100% - 2rem), 72rem); margin-inline: auto; }
      .code { color: #b74c05; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { max-width: 16ch; margin: 1rem 0 0; font-size: clamp(2.25rem, 7vw, 3.75rem); font-weight: 600; line-height: 1.04; letter-spacing: -.025em; text-wrap: balance; }
      .description { max-width: 52ch; margin: 1.25rem 0 0; color: #67605c; line-height: 1.7; }
      .primary { display: inline-flex; min-height: 44px; align-items: center; gap: .5rem; margin-top: 2rem; padding: .8rem 1.25rem; border-radius: .6rem; background: #b74c05; color: #fff; font-size: .875rem; font-weight: 600; }
      .links { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem 1.25rem; margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid #e4dfdb; }
      .links a { display: inline-flex; align-items: center; min-height: 44px; border-radius: .5rem; font-size: .85rem; font-weight: 600; }
      @media (prefers-color-scheme: dark) {
        :root { color: #edeae6; background: #171513; }
        body { background: #171513; }
        a:focus-visible { outline-color: #fd975d; }
        .code { color: #fd975d; }
        .description { color: #b0a79e; }
        .primary { background: #fd975d; color: #21150b; }
        .links { border-color: #37312b; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="shell">
        <p class="code">${content.status} · ${escapeHTML(content.label)}</p>
        <h1>${escapeHTML(content.title)}</h1>
        <p class="description">${escapeHTML(content.description)}</p>
        <a class="primary" href="${escapeHTML(content.primary.href)}"><span aria-hidden="true">←</span>${escapeHTML(content.primary.label)}</a>
        <nav class="links" aria-label="Continue from a maintained page">
          ${links}
        </nav>
      </div>
    </main>
  </body>
</html>
`;

if (process.argv.includes('--check')) {
	const existing = await readFile(output, 'utf8');
	assert.equal(existing, html, 'static/404.html is stale; run bun run sync:404');
	console.log('Verified static 404 content matches the shared recovery source.');
} else {
	await writeFile(output, html);
	console.log(`Updated ${path.relative(process.cwd(), output)}.`);
}
