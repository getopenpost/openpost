import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '@openpost/query-catalog';
import SourceFields from './source-fields.svelte';
import type { Source } from './api';

function sourceAccount(id: string, username: string): SocialAccount {
	return {
		id,
		slug: id,
		platform: 'x',
		account_id: id,
		account_username: username,
		account_avatar_url: '',
		instance_url: '',
		is_active: true,
		thread_replies_supported: false,
		messaging_supported: false,
		messages_enabled: false,
		grant_destination_count: 0,
		shared_grant: false
	};
}

const AVATAR_URL = 'https://example.com/avatar-alice.png';

const accounts: SocialAccount[] = [
	{ ...sourceAccount('account-a', 'alice'), account_avatar_url: AVATAR_URL },
	sourceAccount('account-b', 'bob')
];

function publishedSource(account_ids: string[]): Source {
	return { kind: 'rendition_published', account_ids };
}

describe('workflow repost source picker', () => {
	it('unchecking any-source selects the first account and rechecking clears the list', async () => {
		const onchange = vi.fn();
		const screen = await render(SourceFields, {
			source: publishedSource([]),
			connections: [],
			accounts,
			onchange
		});

		const anySource = screen.getByRole('checkbox', { name: 'Any compatible source account' });
		await expect.element(anySource).toBeChecked();
		// The picker passes each account's photo through to the shared row.
		const image = screen.container.querySelector(`img[src="${AVATAR_URL}"]`);
		expect(image?.getAttribute('src')).toBe(AVATAR_URL);

		await anySource.click();
		expect(onchange).toHaveBeenLastCalledWith(
			expect.objectContaining({ account_ids: ['account-a'] })
		);

		await screen.rerender({
			source: publishedSource(['account-a']),
			connections: [],
			accounts,
			onchange
		});
		await expect.element(anySource).not.toBeChecked();

		await anySource.click();
		expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ account_ids: [] }));
	});
});

it('keeps hidden workflow source accounts when selecting a search result', async () => {
	const onchange = vi.fn();
	const screen = await render(SourceFields, {
		source: publishedSource(['account-0']),
		connections: [],
		accounts: Array.from({ length: 8 }, (_, index) =>
			sourceAccount(`account-${index}`, `founder${index}`)
		),
		onchange
	});

	await screen.getByRole('searchbox').fill('founder7');
	await expect
		.element(screen.getByRole('checkbox', { name: 'founder0, X' }))
		.not.toBeInTheDocument();
	await screen.getByRole('checkbox', { name: 'founder7, X' }).click();
	expect(onchange).toHaveBeenLastCalledWith(
		expect.objectContaining({ account_ids: ['account-0', 'account-7'] })
	);
	await screen.getByRole('checkbox', { name: 'Any compatible source account' }).click();
	expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ account_ids: [] }));
});
