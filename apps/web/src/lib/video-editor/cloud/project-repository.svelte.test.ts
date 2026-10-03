import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '$lib/query/client';
import { CloudVideoProjectRepository } from './project-repository';

afterEach(() => vi.restoreAllMocks());

it.each(['missing', 'denied'] as const)(
	'keeps conflict history readable with unknown origin when browser identity is %s',
	async (storage) => {
		vi.spyOn(queryClient, 'query').mockResolvedValueOnce([
			{
				id: 'conflict',
				name: 'Conflict from stored-device',
				base_revision: 2,
				head_revision: 3,
				device_id: 'stored-device',
				document: { name: 'Preserved conflicting edit' },
				overlap_targets: ['project:name'],
				created_at: '2026-10-03T10:00:00Z'
			}
		]);
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			if (storage === 'denied') throw new DOMException('Storage denied', 'SecurityError');
			return null;
		});
		const write = vi.spyOn(Storage.prototype, 'setItem');
		const repository = new CloudVideoProjectRepository<object>('workspace');
		await expect(repository.listConflicts('project')).resolves.toMatchObject([
			{
				deviceId: 'stored-device',
				origin: 'unknown',
				headRevision: 3,
				document: { name: 'Preserved conflicting edit' }
			}
		]);
		expect(write).not.toHaveBeenCalled();
	}
);
