import { mediaQueryKeys, type MediaStorage } from '@openpost/query-catalog';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from './client';
import { queryMediaStorage } from './media';

describe('Media web Query helpers', () => {
	beforeEach(() => {
		queryClient.clear();
	});

	it('shares the cached workspace storage capability with upload callers', async () => {
		const storage: MediaStorage = {
			asset_count: 3,
			direct_upload_supported: false,
			internal_bytes: 0,
			limit_bytes: 1024,
			used_bytes: 512
		};
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), storage);

		await expect(queryMediaStorage('workspace-1')).resolves.toEqual(storage);
	});

	it('rejects an upload caller that is already cancelled even when storage is cached', async () => {
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), {
			asset_count: 0,
			direct_upload_supported: true,
			internal_bytes: 0,
			limit_bytes: 0,
			used_bytes: 0
		} satisfies MediaStorage);
		const controller = new AbortController();
		controller.abort();

		await expect(queryMediaStorage('workspace-1', controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});
