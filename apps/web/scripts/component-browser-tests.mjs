import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

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
	const result = spawnSync(executable, args, {
		stdio: 'inherit',
		timeout: 600_000,
		env: {
			...process.env,
			OPENPOST_PARAGLIDE_PRECOMPILED: '1',
			...(suite ? { OPENPOST_COMPONENT_TEST_SUITE: suite } : {})
		}
	});
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${executable} exited with signal ${result.signal}`);
	if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`);
}

// Keep route initialization separate from worker- and GPU-backed editor tests.
// Their browser module runners must not inherit each other's pending resources.
run('bun', ['run', 'generate:i18n']);
for (const shard of shards) {
	for (const suite of ['components', 'routes']) {
		console.log(`Component browser shard: ${shard} (${suite})`);
		run(
			process.execPath,
			[vitest, 'run', '--project', 'client', `--shard=${shard}`, '--isolate', '--maxWorkers=1'],
			suite
		);
	}
}
