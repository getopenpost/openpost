import { QueryClient } from '@tanstack/svelte-query';
import {
	openPostQueryDefaults,
	type CapabilityCatalog,
	type OpenPostQueryAPI,
	type Publication,
	type SocialSet
} from '@openpost/query-catalog';
import { describe, expect, it, vi } from 'vitest';
import { createPerformanceCache } from './performance-cache';

function publicationFixture(publicationId: string, workspaceId: string): Publication {
	return {
		content_profile: '',
		created_at: '2026-01-01T00:00:00Z',
		created_by: 'user-1',
		creation_preset: '',
		id: publicationId,
		intent: 'single',
		media: [],
		metadata: {},
		random_delay_inherited: false,
		random_delay_minutes: 0,
		renditions: [],
		repost_override: { mode: 'inherit' },
		revision: 1,
		segments: [],
		source_text: '',
		status: 'draft',
		title: '',
		updated_at: '2026-01-01T00:00:00Z',
		workspace_id: workspaceId
	};
}

function socialSetFixture(workspaceId: string): SocialSet {
	return {
		accounts: [],
		created_at: '2026-01-01T00:00:00Z',
		id: `set-${workspaceId}`,
		is_default: false,
		name: 'Test set',
		updated_at: '2026-01-01T00:00:00Z',
		workspace_id: workspaceId
	};
}

function capabilityCatalogFixture(): CapabilityCatalog {
	return { capabilities: [], profiles: [] };
}

function fakeAPI(): OpenPostQueryAPI {
	return {
		getPublication: vi.fn(async (workspaceId, publicationId) => {
			return publicationFixture(publicationId, workspaceId);
		}),
		listActivityPublications: vi.fn(),
		listFailedJobs: vi.fn(),
		listAccounts: vi.fn(async () => []),
		listSocialSets: vi.fn(async (workspaceId) => [socialSetFixture(workspaceId)]),
		getCapabilities: vi.fn(async () => capabilityCatalogFixture())
	};
}

describe('performance cache compatibility API', () => {
	it('reuses fresh data, forces an exact refresh, and isolates workspace invalidation', async () => {
		const api = fakeAPI();
		const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
		const cache = createPerformanceCache(queryClient, api);

		const [first, second] = await Promise.all([
			cache.loadPublicationDetail('publication-1', 'workspace-1'),
			cache.loadPublicationDetail('publication-1', 'workspace-1')
		]);
		expect(first).toBe(second);
		expect(api.getPublication).toHaveBeenCalledTimes(1);

		await cache.loadPublicationDetail('publication-1', 'workspace-1', true);
		expect(api.getPublication).toHaveBeenCalledTimes(2);

		await Promise.all([
			cache.loadWorkspaceSocialSets('workspace-1'),
			cache.loadWorkspaceSocialSets('workspace-2')
		]);
		cache.invalidateWorkspaceSocialSets('workspace-1');
		await Promise.all([
			cache.loadWorkspaceSocialSets('workspace-1'),
			cache.loadWorkspaceSocialSets('workspace-2')
		]);
		expect(api.listSocialSets).toHaveBeenCalledTimes(3);
	});
});
