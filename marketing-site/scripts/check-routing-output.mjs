import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
assert.match(notFound, /<h1>Page not found<\/h1>/);
assert.match(notFound, /<a href="\/">Return to OpenPost<\/a>/);
assert.doesNotMatch(
	notFound,
	/(?:href|src)="\.\/_app\//,
	'top-level 404 must not depend on path-relative application assets'
);

console.log('Verified marketing redirect and top-level 404 build artifacts.');
