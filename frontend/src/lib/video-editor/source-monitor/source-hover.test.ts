import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('sourceHoverStore', () => {
	it('loads without compiler-provided rune globals', () => {
		const moduleURL = new URL('./source-hover.svelte.ts', import.meta.url);
		const script = `
			const { sourceHoverStore } = await import(${JSON.stringify(moduleURL.href)});
			sourceHoverStore.setHovered(true);
			if (!sourceHoverStore.isActive) throw new Error('hover state did not update');
		`;
		const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			encoding: 'utf8'
		});

		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
	});
});
