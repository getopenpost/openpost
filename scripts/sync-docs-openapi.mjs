import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const source = path.join(root, 'frontend', 'openapi.json');

const openapi = spawnSync('go', ['run', './cmd/openpost-openapi'], {
	cwd: path.join(root, 'backend'),
	encoding: 'utf8',
	maxBuffer: 20 * 1024 * 1024,
});
if (openapi.status !== 0) {
	if (openapi.stderr) {
		process.stderr.write(openapi.stderr);
	}
	throw new Error(`Failed to generate OpenAPI spec with exit code ${openapi.status}`);
}
await mkdir(path.dirname(source), { recursive: true });
await writeFile(source, formatJSON(JSON.parse(openapi.stdout)) + '\n');
const prettier = spawnSync('pnpm', ['--filter', '@openpost/web', 'exec', 'prettier', '--write', 'openapi.json'], {
	cwd: root,
	stdio: 'inherit',
});
if (prettier.status !== 0) {
	throw new Error(`Failed to format OpenAPI spec with exit code ${prettier.status}`);
}
console.log(`Generated OpenAPI spec -> ${path.relative(root, source)}`);

const targets = [
	path.join(root, 'docs-site', '.generated', 'openapi.json'),
	path.join(root, 'docs-site', 'public', 'openapi.json'),
];

for (const target of targets) {
	await mkdir(path.dirname(target), { recursive: true });
	await cp(source, target);
	console.log(`Synced OpenAPI spec -> ${path.relative(root, target)}`);
}

const cliDocs = path.join(root, 'docs-site', 'reference', 'cli.md');
const result = spawnSync('go', ['run', './cmd/openpost-docs', cliDocs], {
	cwd: path.join(root, 'cli'),
	stdio: 'inherit',
});
if (result.status !== 0) {
	throw new Error(`Failed to generate CLI reference docs with exit code ${result.status}`);
}
console.log(`Generated CLI reference -> ${path.relative(root, cliDocs)}`);

function formatJSON(value, depth = 0) {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return '[]';
		}
		if (value.every((item) => item === null || typeof item !== 'object')) {
			const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
			if (inline.length <= 60) {
				return inline;
			}
		}
		const nextIndent = '\t'.repeat(depth + 1);
		const indent = '\t'.repeat(depth);
		return `[\n${nextIndent}${value.map((item) => formatJSON(item, depth + 1)).join(`,\n${nextIndent}`)}\n${indent}]`;
	}

	const entries = Object.entries(value);
	if (entries.length === 0) {
		return '{}';
	}
	const indent = '\t'.repeat(depth);
	const nextIndent = '\t'.repeat(depth + 1);
	return `{\n${entries
		.map(([key, entryValue]) => `${nextIndent}${JSON.stringify(key)}: ${formatJSON(entryValue, depth + 1)}`)
		.join(',\n')}\n${indent}}`;
}
