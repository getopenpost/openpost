import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import SpeechCleanupDialog from './speech-cleanup-dialog.svelte';

it('names the cleanup mode tablist so assistive technology announces it', async () => {
	const screen = await render(SpeechCleanupDialog, {
		open: true,
		itemIds: [],
		onapplied: vi.fn()
	});

	const tablist = screen.getByRole('tablist', { name: m.video_editor_cleanup_title() });
	await expect.element(tablist).toBeVisible();
	await expect
		.element(tablist.getByRole('tab', { name: m.video_editor_filler_review() }))
		.toBeVisible();
});
