import { readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
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

// A healthy batch finishes in well under a minute. A batch that outlives the
// watchdog is hung, usually on one file that never settles; fail fast and name
// it instead of letting the CI job time out without a culprit.
const batchTimeoutMs = Number(process.env.OPENPOST_COMPONENT_BATCH_TIMEOUT_MS ?? 240_000);

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

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

// Vitest prints each file path once that file finishes (pass or fail). Track
// them from the streamed output so a hung batch reports only unfinished files.
function browserRun(files, suite) {
	if (files.length === 0) return Promise.resolve();
	const finished = new Set();
	let lastSeen;
	const child = spawn(
		process.execPath,
		[vitest, 'run', '--project', 'client', '--isolate', '--maxWorkers=1', ...files],
		{
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, OPENPOST_COMPONENT_TEST_SUITE: suite }
		}
	);
	const observe = (target) => (chunk) => {
		target.write(chunk);
		for (const match of String(chunk).matchAll(/src\/\S+?\.svelte\.(?:test|spec)\.(?:js|ts)/g)) {
			lastSeen = match[0];
			if (files.includes(lastSeen)) finished.add(lastSeen);
		}
	};
	const stop = () => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			child.kill('SIGKILL');
		}
	};
	// Detached children miss the terminal's interrupt; forward it.
	process.once('SIGINT', stop).once('SIGTERM', stop);
	child.stdout.on('data', observe(process.stdout));
	child.stderr.on('data', observe(process.stderr));

	return new Promise((resolve, reject) => {
		let hung = false;
		const watchdog = setTimeout(() => {
			hung = true;
			stop();
		}, batchTimeoutMs);
		child.on('error', (error) => {
			clearTimeout(watchdog);
			process.off('SIGINT', stop).off('SIGTERM', stop);
			reject(error);
		});
		child.on('close', (status, signal) => {
			clearTimeout(watchdog);
			process.off('SIGINT', stop).off('SIGTERM', stop);
			if (hung) {
				const unfinished = files.filter((file) => !finished.has(file));
				reject(
					new Error(
						[
							`${suite} batch exceeded ${batchTimeoutMs / 1000}s and was killed.`,
							`Unfinished files:\n  ${unfinished.join('\n  ')}`,
							...(lastSeen ? [`Last file reported: ${lastSeen}`] : []),
							`Batch:\n  ${files.join('\n  ')}`
						].join('\n')
					)
				);
			} else if (signal) reject(new Error(`vitest exited with signal ${signal}`));
			else if (status !== 0) reject(new Error(`vitest exited with status ${status}`));
			else resolve();
		});
	});
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
const i18n = spawnSync('bun', ['run', 'generate:i18n'], { stdio: 'inherit' });
if (i18n.status !== 0) throw new Error('generate:i18n failed');
try {
	for (const shard of shards) {
		await browserRun(selectShard(dialogs, shard), 'dialogs');
		for (const batch of batches(selectShard(components, shard), 12)) {
			await browserRun(batch, 'components');
		}
		await browserRun(selectShard(routes, shard), 'routes');
	}
} catch (error) {
	console.error(`\n${error.message}`);
	process.exit(1);
}
