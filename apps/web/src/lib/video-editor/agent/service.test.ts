import { describe, expect, it } from 'vitest';
import { runStep } from './service';

describe('Video Editor agent step execution', () => {
	it('identifies an unknown tool in the reported error', async () => {
		const result = await runStep({
			tool: 'missing-tool',
			args: {},
			summary: '',
			handoff: false,
			destructive: false
		});

		expect(result).toEqual({ ok: false, message: 'Unknown tool: missing-tool' });
	});
});
