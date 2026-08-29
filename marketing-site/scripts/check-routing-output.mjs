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

const headers = await readFile(path.join(outputRoot, '_headers'), 'utf8');
assert.match(headers, /<\/\.well-known\/api-catalog>; rel="api-catalog"/);
assert.match(headers, /<\/auth\.md>; rel="describedby"; type="text\/markdown"/);
const headerLines = headers.split('\n');
const apiCatalogRuleIndex = headerLines.indexOf('/.well-known/api-catalog');
assert.equal(
	headerLines[apiCatalogRuleIndex + 1]?.trim(),
	'Content-Type: application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
);

const apiCatalog = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'api-catalog'), 'utf8')
);
assert.deepEqual(apiCatalog, {
	linkset: [
		{
			anchor: 'https://app.openpost.social/api/v1',
			'service-desc': [
				{
					href: 'https://docs.openpost.social/openapi.json',
					type: 'application/vnd.oai.openapi+json;version=3.1'
				}
			],
			'service-doc': [
				{
					href: 'https://docs.openpost.social/development/api-reference',
					type: 'text/html'
				}
			],
			status: [
				{
					href: 'https://app.openpost.social/api/v1/ready',
					type: 'application/json'
				}
			]
		}
	]
});

const authDiscovery = await readFile(path.join(outputRoot, 'auth.md'), 'utf8');
assert.match(authDiscovery, /^# OpenPost Auth\.md$/m);
assert.match(authDiscovery, /\.well-known\/oauth-protected-resource/);
assert.match(authDiscovery, /\.well-known\/oauth-authorization-server/);
assert.match(authDiscovery, /Authorization: Bearer <token>/);
assert.doesNotMatch(authDiscovery, /agent_auth:/);

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

console.log('Verified marketing discovery, redirect, and top-level 404 build artifacts.');
