import type { components } from '@openpost/api-contract';
import type { MessagePage } from '@openpost/query-catalog';
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/query-core';

type DirectMessage = components['schemas']['DirectMessage'];

export function mergeInboxMessages(older: DirectMessage[], current: DirectMessage[]) {
	const byID = new Map(older.map((message) => [message.id, message]));
	for (const message of current) byID.set(message.id, message);
	return [...byID.values()].sort((left, right) => {
		const leftTime = new Date(left.remote_created_at || left.created_at).getTime();
		const rightTime = new Date(right.remote_created_at || right.created_at).getTime();
		return (
			leftTime - rightTime ||
			left.created_at.localeCompare(right.created_at) ||
			left.id.localeCompare(right.id)
		);
	});
}

export async function reconcileSentInboxMessage(
	client: QueryClient,
	queryKey: QueryKey,
	message: DirectMessage,
	pendingOlderPage: Promise<unknown> | null
) {
	if (!pendingOlderPage) await client.cancelQueries({ queryKey, exact: true });
	cacheSentInboxMessage(client, queryKey, message);
	await invalidateSentMessageQuery(client, queryKey);

	if (pendingOlderPage) {
		void pendingOlderPage
			.then(async () => {
				cacheSentInboxMessage(client, queryKey, message);
				await invalidateSentMessageQuery(client, queryKey);
			})
			.catch(() => undefined);
	}
}

function cacheSentInboxMessage(client: QueryClient, queryKey: QueryKey, message: DirectMessage) {
	client.setQueryData<InfiniteData<MessagePage, string>>(queryKey, (current) => {
		if (!current) return current;
		const pages = [...current.pages];
		const firstPage = pages[0];
		if (!firstPage) return current;
		pages[0] = {
			...firstPage,
			items: mergeInboxMessages([], [...(firstPage.items ?? []), message])
		};
		return { ...current, pages };
	});
}

function invalidateSentMessageQuery(client: QueryClient, queryKey: QueryKey) {
	return client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
}
