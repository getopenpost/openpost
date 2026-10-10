import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { BaseSequencer } from 'vitest/node';
import { z } from 'zod';

// Module-mocked files have intermittently stalled imports in reused browser sessions.
// Give them fresh processes while retaining the canonical Vitest shard selection.
// CI owns the job deadline and cleanup of Vitest and browser descendants.
const shard = process.argv[2];
if (!/^\d+\/\d+$/.test(shard ?? '')) throw new Error('Pass a Vitest shard, such as 2/4');
const [index, count] = shard.split('/').map(Number);
if (index < 1 || index > count) throw new Error('Invalid Vitest shard');

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

function run(args) {
	const result = spawnSync(process.execPath, [vitest, ...args], {
		stdio: 'inherit'
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Vitest exited with status ${result.status}`);
}

function usesModuleMocks(file) {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === 'vi' &&
			['mock', 'doMock'].includes(node.expression.name.text)
		)
			return true;
		return ts.forEachChild(node, visit);
	}
	return Boolean(visit(source));
}

const directory = mkdtempSync(join(tmpdir(), 'openpost-component-tests-'));
try {
	const inventoryPath = join(directory, 'files.json');
	run(['list', '--project', 'client', '--filesOnly', '--json', inventoryPath]);
	const inventory = z
		.array(z.object({ file: z.string().min(1) }))
		.min(1)
		.parse(JSON.parse(readFileSync(inventoryPath, 'utf8')));
	const specs = inventory.map(({ file }) => ({ moduleId: file }));
	if (new Set(specs.map((spec) => spec.moduleId)).size !== specs.length)
		throw new Error('Duplicate Vitest browser file inventory');
	const sequencer = new BaseSequencer({
		config: { root: process.cwd(), shard: { index, count } }
	});
	const files = (await sequencer.shard(specs)).map(({ moduleId }) => moduleId);
	if (!files.length) throw new Error('Empty Vitest browser shard');
	const mocked = files.filter(usesModuleMocks);
	const plain = files.filter((file) => !mocked.includes(file));
	console.log(
		`Component shard ${shard}: ${files.length} files, ${mocked.length} isolated module-mock files`
	);
	for (const group of [...mocked.map((file) => [file]), ...(plain.length ? [plain] : [])]) {
		console.log('Component browser process:', group);
		run(['run', '--project', 'client', ...group]);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
