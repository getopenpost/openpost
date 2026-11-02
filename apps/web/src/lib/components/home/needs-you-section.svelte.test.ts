import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NeedsYouSection from './needs-you-section.svelte';

describe('NeedsYouSection', () => {
	it('stays hidden while nothing needs attention', async () => {
		const screen = await render(NeedsYouSection, {
			failedCount: 0,
			unreadReplies: 0,
			unreadMessages: 0,
			disconnectedCount: 0,
			pendingReviews: []
		});

		expect(screen.container.querySelector('[data-testid="home-needs-you"]')).toBeNull();
		expect(screen.container.querySelectorAll('a')).toHaveLength(0);
	});

	it('links each row to where it is fixed', async () => {
		const screen = await render(NeedsYouSection, {
			failedCount: 2,
			unreadReplies: 1,
			unreadMessages: 0,
			disconnectedCount: 1,
			pendingReviews: [{ id: 'pub-1', title: 'Launch notes' }]
		});

		const failed = screen.getByRole('link', { name: '2 posts failed to publish' });
		await expect.element(failed).toHaveAttribute('href', '/publications?tab=failed');

		const replies = screen.getByRole('link', { name: '1 unread reply' });
		await expect.element(replies).toHaveAttribute('href', '/inbox/engagement');

		const review = screen.getByRole('link', { name: 'Launch notes' });
		await expect.element(review).toHaveAttribute('href', '/publications/pub-1');

		const disconnected = screen.getByRole('link', { name: '1 account is disconnected' });
		await expect.element(disconnected).toHaveAttribute('href', '/accounts');

		expect(screen.container.querySelector('a[href="/inbox/messages"]')).toBeNull();
	});
});
