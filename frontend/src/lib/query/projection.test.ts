import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import { QueryProjectionTracker } from './projection';

afterEach(() => {
	vi.restoreAllMocks();
});

it('projects consecutive cache writes that share an update timestamp', () => {
	vi.spyOn(Date, 'now').mockReturnValue(1_786_709_600_000);
	const client = new QueryClient();
	const queryKey = ['publication-history'] as const;
	const projection = new QueryProjectionTracker();

	client.setQueryData(queryKey, { summary: 'First cache write' });
	const firstWrite = client.getQueryState(queryKey);
	expect(projection.shouldProject(firstWrite?.data, 'workspace-1:publication-1')).toBe(true);

	client.setQueryData(queryKey, { summary: 'Second cache write' });
	const secondWrite = client.getQueryState(queryKey);
	expect(secondWrite?.dataUpdatedAt).toBe(firstWrite?.dataUpdatedAt);
	expect(secondWrite?.dataUpdateCount).toBe((firstWrite?.dataUpdateCount ?? 0) + 1);
	expect(projection.shouldProject(secondWrite?.data, 'workspace-1:publication-1')).toBe(true);
});

it('skips only the same data reference in the same scope', () => {
	const projection = new QueryProjectionTracker();
	const data = { summary: 'Cached history' };

	expect(projection.shouldProject(data, 'workspace-1:publication-1')).toBe(true);
	expect(projection.shouldProject(data, 'workspace-1:publication-1')).toBe(false);
	expect(projection.shouldProject(data, 'workspace-2:publication-1')).toBe(true);
});
