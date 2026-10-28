import { afterEach, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { savedMentionQueryKey, type SavedMention } from '@openpost/query-catalog';
import { queryClient } from './client';
import { deleteSavedMention, saveSavedMention } from './saved-mentions';

const guest: SavedMention = {
	id: 'guest',
	name: '@guest',
	profiles: [{ provider: 'x', text: '@guest_x' }]
};

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

it.each(['save', 'delete'] as const)(
	'a delayed library read cannot undo a successful %s',
	async (operation) => {
		const key = savedMentionQueryKey('workspace');
		let release!: (entries: SavedMention[]) => void;
		const pending = new Promise<SavedMention[]>((resolve) => (release = resolve));
		const read = queryClient.query({ queryKey: key, queryFn: () => pending }).catch(() => {});
		if (operation === 'save') {
			vi.spyOn(client, 'POST').mockResolvedValue({ data: guest, response: new Response() });
			await saveSavedMention('workspace', guest.name, guest.profiles);
		} else {
			vi.spyOn(client, 'DELETE').mockResolvedValue({ response: new Response() });
			await deleteSavedMention('workspace', guest.id);
		}
		release(operation === 'save' ? [] : [guest]);
		await read;
		expect(queryClient.getQueryData(key)).toEqual(operation === 'save' ? [guest] : []);
	}
);
