import { expect, it } from 'vitest';
import { QueryProjectionTracker } from './projection';

it('skips only the same data reference in the same scope', () => {
	const projection = new QueryProjectionTracker();
	const data = { summary: 'Cached history' };

	expect(projection.shouldProject(data, 'workspace-1:publication-1')).toBe(true);
	expect(projection.shouldProject(data, 'workspace-1:publication-1')).toBe(false);
	expect(projection.shouldProject(data, 'workspace-2:publication-1')).toBe(true);
});
