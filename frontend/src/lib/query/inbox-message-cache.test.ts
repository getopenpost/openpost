import type { components } from '@openpost/api-contract';
import { inboxQueryKeys, type MessagePage } from '@openpost/query-catalog';
import { QueryClient, type InfiniteData } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';
import { reconcileSentInboxMessage } from './inbox-message-cache';

type DirectMessage = components['schemas']['DirectMessage'];

describe('sent inbox message reconciliation', () => {
	it('cancels an older background response before writing the sent message', async () => {
		const client = new QueryClient();
		const queryKey = inboxQueryKeys.messages('workspace-1', 'conversation-1', { limit: 200 });
		const initial = message('message-1', '10:00:00');
		const sent = message('message-2', '10:01:00');
		client.setQueryData(queryKey, infiniteData([initial]));
		const response = deferred<InfiniteData<MessagePage, string>>();
		let signal: AbortSignal | undefined;
		const pending = client
			.fetchQuery({
				queryKey,
				staleTime: 0,
				queryFn: (context) => {
					signal = context.signal;
					return response.promise;
				}
			})
			.catch(() => undefined);
		await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));

		await reconcileSentInboxMessage(client, queryKey, sent, null);
		response.resolve(infiniteData([initial]));
		await pending;

		expect(signal?.aborted).toBe(true);
		expect(messageIDs(client, queryKey)).toEqual(['message-1', 'message-2']);
		expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
	});

	it('reapplies the sent message after an older-page request settles', async () => {
		const client = new QueryClient();
		const queryKey = inboxQueryKeys.messages('workspace-1', 'conversation-1', { limit: 200 });
		const initial = message('message-1', '10:00:00');
		const sent = message('message-2', '10:01:00');
		const olderPage = deferred<void>();
		client.setQueryData(queryKey, infiniteData([initial]));

		await reconcileSentInboxMessage(client, queryKey, sent, olderPage.promise);
		client.setQueryData(queryKey, infiniteData([initial]));
		olderPage.resolve();
		await vi.waitFor(() => expect(messageIDs(client, queryKey)).toContain('message-2'));

		expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
	});
});

function infiniteData(items: DirectMessage[]): InfiniteData<MessagePage, string> {
	return {
		pages: [{ items, next_cursor: '', sync_states: [] }],
		pageParams: ['']
	};
}

function message(id: string, time: string): DirectMessage {
	return {
		id,
		created_at: `2026-09-02T${time}Z`,
		remote_created_at: `2026-09-02T${time}Z`
	} as DirectMessage;
}

function messageIDs(client: QueryClient, queryKey: readonly unknown[]) {
	return (
		client.getQueryData<InfiniteData<MessagePage, string>>(queryKey)?.pages[0]?.items ?? []
	).map(({ id }) => id);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
