import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { marketingErrorRecovery } from '../src/routes/_error-recovery.ts';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(siteRoot, 'dist');

await assert.rejects(
	readFile(path.join(outputRoot, '_redirects'), 'utf8'),
	(error) => error instanceof Error && 'code' in error && error.code === 'ENOENT',
	'marketing build must not emit compatibility redirects'
);

const headers = await readFile(path.join(outputRoot, '_headers'), 'utf8');
assert.match(headers, /<\/\.well-known\/api-catalog>; rel="api-catalog"/);
assert.match(headers, /<\/auth\.md>; rel="describedby"; type="text\/markdown"/);
assert.doesNotMatch(headers, /rel="sitemap"/);
const headerLines = headers.split('\n');
const apiCatalogRuleIndex = headerLines.indexOf('/.well-known/api-catalog');
assert.equal(
	headerLines[apiCatalogRuleIndex + 1]?.trim(),
	'Content-Type: application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
);
for (const pathname of [
	'/.well-known/integrations.json',
	'/.well-known/ard.json',
	'/.well-known/agent-skills/index.json',
	'/.well-known/mcp/server-card.json',
	'/openapi.json'
]) {
	const ruleIndex = headerLines.indexOf(pathname);
	assert.equal(headerLines[ruleIndex + 1]?.trim(), 'Content-Type: application/json; charset=utf-8');
}

const apiCatalog = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'api-catalog'), 'utf8')
);
assert.deepEqual(apiCatalog, {
	linkset: [
		{
			anchor: 'https://openpo.st',
			item: [{ href: 'https://app.openpo.st/api/v1' }, { href: 'https://app.openpo.st/mcp' }]
		},
		{
			anchor: 'https://app.openpo.st/api/v1',
			'service-desc': [
				{
					href: 'https://openpo.st/openapi.json',
					type: 'application/vnd.oai.openapi+json;version=3.1'
				}
			],
			'service-doc': [
				{
					href: 'https://docs.openpo.st/development/api-reference',
					type: 'text/html'
				}
			],
			status: [
				{
					href: 'https://app.openpo.st/api/v1/ready',
					type: 'application/json'
				}
			]
		},
		{
			anchor: 'https://app.openpo.st/mcp',
			'service-desc': [
				{
					href: 'https://openpo.st/.well-known/mcp/server-card.json',
					type: 'application/mcp-server-card+json'
				}
			],
			'service-doc': [
				{
					href: 'https://docs.openpo.st/mcp/',
					type: 'text/html'
				}
			]
		}
	]
});

const integrations = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'integrations.json'), 'utf8')
);
assert.equal(integrations.version, 3);
assert.deepEqual(
	integrations.surfaces.map(({ type, slug }) => ({ type, slug })),
	[
		{ type: 'http', slug: 'api' },
		{ type: 'mcp', slug: 'mcp' },
		{ type: 'cli', slug: 'cli' }
	]
);
assert.deepEqual(Object.keys(integrations.credentials).toSorted(), [
	'openpost_api_token',
	'openpost_mcp_oauth'
]);
assert.ok(
	integrations.surfaces.every(
		(surface) =>
			surface.basis.via === 'declared' &&
			surface.basis.source === 'https://openpo.st/.well-known/integrations.json'
	)
);

const mcpServerCard = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'mcp', 'server-card.json'), 'utf8')
);
assert.equal(
	mcpServerCard.$schema,
	'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
);
assert.equal(mcpServerCard.name, 'getopenpost/openpost');
assert.deepEqual(mcpServerCard.remotes, [
	{
		type: 'streamable-http',
		url: 'https://app.openpo.st/mcp',
		supportedProtocolVersions: ['2025-06-18', '2025-03-26']
	}
]);

const agentSkills = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'agent-skills', 'index.json'), 'utf8')
);
assert.equal(agentSkills.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
assert.equal(agentSkills.skills.length, 1);
const [openpostSkill] = agentSkills.skills;
assert.equal(openpostSkill.name, 'openpost-cli');
assert.equal(openpostSkill.type, 'archive');
const skillArchive = await readFile(
	path.join(outputRoot, '.well-known', 'agent-skills', 'openpost-cli.tar.gz')
);
assert.equal(
	openpostSkill.digest,
	`sha256:${createHash('sha256').update(skillArchive).digest('hex')}`
);

const ardManifest = JSON.parse(
	await readFile(path.join(outputRoot, '.well-known', 'ard.json'), 'utf8')
);
assert.deepEqual(
	ardManifest.entries.map(({ identifier }) => identifier),
	[
		'urn:air:openpo.st:api:openpost',
		'urn:air:openpo.st:mcp:openpost',
		'urn:air:openpo.st:skill:openpost-cli'
	]
);

for (const unsupportedPath of [
	['.well-known', 'agent-card.json'],
	['.well-known', 'oauth-protected-resource']
]) {
	await assert.rejects(
		readFile(path.join(outputRoot, ...unsupportedPath), 'utf8'),
		(error) => error instanceof Error && 'code' in error && error.code === 'ENOENT'
	);
}

const authDiscovery = await readFile(path.join(outputRoot, 'auth.md'), 'utf8');
assert.match(authDiscovery, /^# OpenPost Auth\.md$/m);
assert.match(authDiscovery, /\.well-known\/oauth-protected-resource/);
assert.match(authDiscovery, /\.well-known\/oauth-authorization-server/);
assert.match(authDiscovery, /Authorization: Bearer <token>/);
assert.doesNotMatch(authDiscovery, /agent_auth:/);

const homepage = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
assert.match(homepage, /<link rel="icon" href="\/favicon\.ico"/);
assert.match(homepage, /<link rel="icon" type="image\/svg\+xml" href="\/icon\.svg"/);
assert.match(homepage, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
const favicon = await readFile(path.join(outputRoot, 'favicon.ico'));
assert.deepEqual([...favicon.subarray(0, 4)], [0, 0, 1, 0]);
assert.ok((await readFile(path.join(outputRoot, 'apple-touch-icon.png'))).length > 0);

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

console.log('Verified marketing discovery and top-level 404 build artifacts.');
