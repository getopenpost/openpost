import { QueryClient } from '@tanstack/svelte-query';
import { openPostQueryKeys } from '@openpost/query-catalog';
import { describe, expect, it } from 'vitest';
import { createPublicationQueryInvalidationBridge } from './publication-invalidation';
import {
	PublicationInvalidationCoalescer,
	publicationInvalidationForWorkspace
} from '$lib/publication-invalidation';

function seedQuery(client: QueryClient, queryKey: readonly unknown[]) {
	client.setQueryData(queryKey, { seeded: true });
}

function isInvalidated(client: QueryClient, queryKey: readonly unknown[]) {
	return client.getQueryState(queryKey)?.isInvalidated ?? false;
}

describe('publication query invalidation bridge', () => {
	it.each([
		{
			scopes: ['activity', 'drafts'] as const,
			activities: ['draft', 'scheduled'] as const,
			stale: ['draft', 'scheduled']
		},
		{ scopes: ['activity'] as const, activities: ['draft'] as const, stale: ['draft'] }
	])('refreshes only affected buckets for $activities', async ({ scopes, activities, stale }) => {
		const client = new QueryClient();
		const bridge = createPublicationQueryInvalidationBridge(client);
		const buckets = ['draft', 'scheduled', 'published', 'failed'] as const;
		for (const bucket of buckets)
			seedQuery(
				client,
				openPostQueryKeys.publications.activity('workspace-1', bucket, { limit: 40 })
			);
		const jobs = openPostQueryKeys.jobs.failedPage('workspace-1', { limit: 50 });
		seedQuery(client, jobs);
		await bridge.observe({
			revision: 1,
			entries: [
				{
					workspaceId: 'workspace-1',
					scopes: [...scopes],
					activities: [...activities],
					dateKeys: []
				}
			]
		});
		for (const bucket of buckets)
			expect(
				isInvalidated(
					client,
					openPostQueryKeys.publications.activity('workspace-1', bucket, { limit: 40 })
				)
			).toBe(stale.includes(bucket));
		expect(isInvalidated(client, jobs)).toBe(false);
	});

	it.each([false, true])(
		'keeps broad invalidations when batched with exact buckets, wildcard=%s',
		async (wildcard) => {
			const client = new QueryClient();
			const bridge = createPublicationQueryInvalidationBridge(client);
			const key = openPostQueryKeys.publications.activity('workspace-1', 'published', {
				limit: 40
			});
			seedQuery(client, key);
			const coalescer = new PublicationInvalidationCoalescer();
			coalescer.add({ workspaceId: wildcard ? '*' : 'workspace-1', scopes: ['activity'] });
			coalescer.add({
				workspaceId: 'workspace-1',
				scopes: ['activity'],
				activities: ['scheduled']
			});
			const batch = coalescer.drain(1)!;
			const entry = publicationInvalidationForWorkspace(batch, 'workspace-1')!;
			await bridge.observe({ revision: 1, entries: [entry] });
			expect(isInvalidated(client, key)).toBe(true);
		}
	);

	it('handles every off-route batch without crossing workspace boundaries', async () => {
		const client = new QueryClient();
		const bridge = createPublicationQueryInvalidationBridge(client);
		const workspaceOneActivity = openPostQueryKeys.publications.activity(
			'workspace-1',
			'scheduled',
			{ limit: 40 }
		);
		const workspaceOneJobs = openPostQueryKeys.jobs.failedPage('workspace-1', { limit: 50 });
		const workspaceTwoActivity = openPostQueryKeys.publications.activity(
			'workspace-2',
			'published',
			{ limit: 40 }
		);
		const workspaceTwoJobs = openPostQueryKeys.jobs.failedPage('workspace-2', { limit: 50 });

		for (const queryKey of [
			workspaceOneActivity,
			workspaceOneJobs,
			workspaceTwoActivity,
			workspaceTwoJobs
		]) {
			seedQuery(client, queryKey);
		}

		await bridge.observe({
			revision: 1,
			entries: [{ workspaceId: 'workspace-1', scopes: ['activity'], dateKeys: [] }]
		});
		await bridge.observe({
			revision: 2,
			entries: [{ workspaceId: 'workspace-2', scopes: ['activity'], dateKeys: [] }]
		});

		expect(isInvalidated(client, workspaceOneActivity)).toBe(true);
		expect(isInvalidated(client, workspaceOneJobs)).toBe(true);
		expect(isInvalidated(client, workspaceTwoActivity)).toBe(true);
		expect(isInvalidated(client, workspaceTwoJobs)).toBe(true);
	});

	it('keeps wildcard invalidation precise to Activity reads', async () => {
		const client = new QueryClient();
		const bridge = createPublicationQueryInvalidationBridge(client);
		const activity = openPostQueryKeys.publications.activity('workspace-1', 'failed', {
			limit: 40
		});
		const failedJobs = openPostQueryKeys.jobs.failedPage('workspace-2', { limit: 50 });
		const detail = openPostQueryKeys.publications.detail('workspace-1', 'publication-1');
		const accounts = openPostQueryKeys.accounts('workspace-1');
		const capabilities = openPostQueryKeys.capabilities();

		for (const queryKey of [activity, failedJobs, detail, accounts, capabilities]) {
			seedQuery(client, queryKey);
		}

		await bridge.observe({
			revision: 3,
			entries: [
				{ workspaceId: '*', scopes: ['activity'], dateKeys: [] },
				{ workspaceId: 'workspace-1', scopes: ['drafts'], dateKeys: [] }
			]
		});

		expect(isInvalidated(client, activity)).toBe(true);
		expect(isInvalidated(client, failedJobs)).toBe(true);
		expect(isInvalidated(client, detail)).toBe(false);
		expect(isInvalidated(client, accounts)).toBe(false);
		expect(isInvalidated(client, capabilities)).toBe(false);
	});

	it('maps draft invalidations to only the draft Activity bucket, including wildcards', async () => {
		const client = new QueryClient();
		const bridge = createPublicationQueryInvalidationBridge(client);
		const workspaceOneDrafts = openPostQueryKeys.publications.activity('workspace-1', 'draft', {
			limit: 40
		});
		const workspaceOneScheduled = openPostQueryKeys.publications.activity(
			'workspace-1',
			'scheduled',
			{ limit: 40 }
		);
		const workspaceTwoDrafts = openPostQueryKeys.publications.activity('workspace-2', 'draft', {
			limit: 40
		});
		const failedJobs = openPostQueryKeys.jobs.failedPage('workspace-1', { limit: 50 });

		for (const queryKey of [
			workspaceOneDrafts,
			workspaceOneScheduled,
			workspaceTwoDrafts,
			failedJobs
		]) {
			seedQuery(client, queryKey);
		}

		await bridge.observe({
			revision: 1,
			entries: [{ workspaceId: 'workspace-1', scopes: ['drafts'], dateKeys: [] }]
		});

		expect(isInvalidated(client, workspaceOneDrafts)).toBe(true);
		expect(isInvalidated(client, workspaceOneScheduled)).toBe(false);
		expect(isInvalidated(client, workspaceTwoDrafts)).toBe(false);
		expect(isInvalidated(client, failedJobs)).toBe(false);

		await bridge.observe({
			revision: 2,
			entries: [{ workspaceId: '*', scopes: ['drafts'], dateKeys: [] }]
		});

		expect(isInvalidated(client, workspaceTwoDrafts)).toBe(true);
		expect(isInvalidated(client, workspaceOneScheduled)).toBe(false);
		expect(isInvalidated(client, failedJobs)).toBe(false);
	});
});
