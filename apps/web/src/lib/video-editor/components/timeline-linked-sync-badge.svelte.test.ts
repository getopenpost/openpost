import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import TimelineLinkedSyncBadge from './timeline-linked-sync-badge.svelte';

it('exposes the linked-sync badge as a labeled image', async () => {
	const screen = await render(TimelineLinkedSyncBadge, {
		offsetFrames: 3,
		fps: 30,
		clipWidthPx: 200
	});

	const badge = screen.getByRole('img', {
		name: m.video_editor_linked_sync_offset({ offset: '+00:03' })
	});
	// The badge text is sized with fixed spacing tokens that compute to 0px in the
	// vitest browser harness, so assert role/name exposure instead of visibility.
	await expect.element(badge).toBeInTheDocument();
});
