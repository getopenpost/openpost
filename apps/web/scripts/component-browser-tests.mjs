import { readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const shard = process.argv[2];
if (process.argv.length > 3 || (shard !== undefined && !/^\d+\/\d+$/.test(shard)))
	throw new Error('Pass at most one Vitest shard, such as 2/4');
if (shard !== undefined) {
	const [index, count] = shard.split('/').map(Number);
	if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count)
		throw new Error('Invalid Vitest shard');
}
const shards = shard === undefined ? ['1/4', '2/4', '3/4', '4/4'] : [shard];

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

function run(executable, args, suite) {
	const env = { ...process.env };
	if (suite) env.OPENPOST_COMPONENT_TEST_SUITE = suite;
	const result = spawnSync(executable, args, {
		stdio: 'inherit',
		// A healthy shard takes about two minutes locally; release preflight runs
		// several suites in parallel, so allow generous headroom before treating
		// the run as hung.
		timeout: 1_800_000,
		env
	});
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${executable} exited with signal ${result.signal}`);
	if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`);
}

function collectTests(directory) {
	return readdirSync(directory, { recursive: true })
		.map((file) => String(file).split(sep).join('/'))
		.filter((file) => /\.svelte\.(?:test|spec)\.(?:js|ts)$/.test(file))
		.sort()
		.map((file) => `src/${file}`);
}

function selectShard(files, value) {
	const [index, count] = value.split('/').map(Number);
	return files.filter((_, position) => position % count === index - 1);
}

function batches(files, size) {
	const result = [];
	for (let index = 0; index < files.length; index += size)
		result.push(files.slice(index, index + size));
	return result;
}

function browserRun(files, suite) {
	if (files.length === 0) return;
	run(
		process.execPath,
		[vitest, 'run', '--project', 'client', '--isolate', '--maxWorkers=1', ...files],
		suite
	);
}

const srcDirectory = fileURLToPath(new URL('../src/', import.meta.url));
const tests = collectTests(srcDirectory);
const routes = tests.filter((file) => file.startsWith('src/routes/'));
const dialogs = tests.filter(
	(file) =>
		!file.startsWith('src/routes/') &&
		/(?:^|\/)(?:[^/]*-delete-dialog|delete-account-dialog)\.svelte\.(?:test|spec)\.(?:js|ts)$/.test(
			file
		)
);
const components = tests.filter((file) => !routes.includes(file) && !dialogs.includes(file));

// Native dialogs, route initialization, and worker- or GPU-backed editor tests
// get separate browser module runners. Component files run in small batches so
// one long-lived Chromium page cannot exhaust the shard before its final file.
run('bun', ['run', 'generate:i18n']);
for (const shard of shards) {
	browserRun(selectShard(dialogs, shard), 'dialogs');
	for (const batch of batches(selectShard(components, shard), 12)) {
		browserRun(batch, 'components');
	}
	browserRun(selectShard(routes, shard), 'routes');
}
