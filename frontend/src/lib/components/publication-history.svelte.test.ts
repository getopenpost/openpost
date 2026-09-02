import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { schedulingQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import PublicationHistory from './publication-history.svelte';

const mocks = { get: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
beforeEach(() => {
	queryClient.clear();
	mocks.get.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

function historyEvent(id: string, summary: string) {
	return {
		id,
		workspace_id: 'workspace-1',
		publication_id: 'publication-1',
		type: 'updated',
		status: 'succeeded',
		summary,
		actor: { kind: 'system' as const },
		created_at: '2026-08-14T11:01:00Z'
	};
}

it('projects consecutive cache writes that share an update timestamp', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
	mocks.get.mockResolvedValue({
		data: [historyEvent('initial', 'Initial history')],
		error: null,
		response: new Response(null, { headers: { 'X-Has-More': 'false' } })
	});

	const screen = await render(
		PublicationHistory,
		{
			publicationId: 'publication-1',
			workspaceId: 'workspace-1'
		},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await expect.element(screen.getByText('Initial history')).toBeVisible();

	const queryKey = schedulingQueryKeys.publicationEvents('workspace-1', 'publication-1', {
		limit: 30
	});
	vi.setSystemTime(new Date('2026-08-14T12:00:00.001Z'));
	queryClient.setQueryData(queryKey, {
		items: [historyEvent('first-write', 'First cache write')],
		nextCursor: ''
	});
	await expect.element(screen.getByText('First cache write')).toBeVisible();

	const firstWriteState = queryClient.getQueryState(queryKey);
	queryClient.setQueryData(queryKey, {
		items: [historyEvent('second-write', 'Second cache write')],
		nextCursor: ''
	});
	const secondWriteState = queryClient.getQueryState(queryKey);

	expect(secondWriteState?.dataUpdatedAt).toBe(firstWriteState?.dataUpdatedAt);
	expect(secondWriteState?.dataUpdateCount).toBe((firstWriteState?.dataUpdateCount ?? 0) + 1);
	await expect.element(screen.getByText('Second cache write')).toBeVisible();
});

it('places the latest effective outcome at its attempt or reconciliation time', async () => {
	mocks.get.mockResolvedValue({
		data: [
			{
				id: 'failed-attempt-1',
				workspace_id: 'workspace-1',
				publication_id: 'publication-1',
				rendition_id: 'rendition-1',
				type: 'failed',
				status: 'failed',
				summary: 'Provider delivery failed',
				actor: { kind: 'system' },
				destination: {
					rendition_id: 'rendition-1',
					social_account_id: 'account-1',
					target_key: 'x',
					platform: 'x',
					label: '@openpost',
					status: 'failed'
				},
				delivery: {
					target_key: 'x',
					state: 'rejected',
					current_attempt_id: 'attempt-2',
					current_attempt_number: 2,
					current_attempt_created_at: '2026-08-14T11:05:00Z',
					last_reconciled_at: '2026-08-14T11:06:00Z',
					recovery_action: 'retry'
				},
				superseded: true,
				created_at: '2026-08-14T11:01:00Z'
			}
		],
		error: null,
		response: new Response(null, { headers: { 'X-Has-More': 'false' } })
	});

	const screen = await render(
		PublicationHistory,
		{
			publicationId: 'publication-1',
			workspaceId: 'workspace-1'
		},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await expect.element(screen.getByText('Latest effective destination outcome')).toBeVisible();

	const items = [...document.querySelectorAll('ol > li')].map((item) => item.textContent ?? '');
	expect(items).toHaveLength(2);
	expect(items[0]).toContain('Latest effective destination outcome');
	expect(items[0]).toContain('Provider attempt 2');
	expect(items[0]).toContain('Reconciled');
	expect(items[1]).toContain('Provider delivery failed');
});
