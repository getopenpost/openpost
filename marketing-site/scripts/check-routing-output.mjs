import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { marketingErrorRecovery } from '../src/routes/_error-recovery.ts';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(siteRoot, 'dist');

const redirects = await readFile(path.join(outputRoot, '_redirects'), 'utf8');
assert.equal(
	redirects,
	[
		'/docs https://docs.openpost.social/ 301',
		'/docs/* https://docs.openpost.social/:splat 301',
		''
	].join('\n'),
	'marketing build must permanently redirect /docs and every /docs/* suffix to the canonical docs site'
);

const notFound = await readFile(path.join(outputRoot, '404.html'), 'utf8');
assert.match(notFound, /<title>Page not found · OpenPost<\/title>/);
assert.match(notFound, /<meta name="robots" content="noindex" \/>/);
assert.ok(notFound.includes(`<h1>${marketingErrorRecovery.title}</h1>`));
assert.ok(notFound.includes(marketingErrorRecovery.description));
assert.ok(notFound.includes(marketingErrorRecovery.primary.label));
for (const route of marketingErrorRecovery.routes) {
  assert.ok(notFound.includes(`href="${route.href}"`));
  assert.ok(notFound.includes(route.label));
}
assert.doesNotMatch(
	notFound,
	/(?:href|src)="\.\/_app\//,
	'top-level 404 must not depend on path-relative application assets'
);

console.log('Verified marketing redirect and top-level 404 build artifacts.');
