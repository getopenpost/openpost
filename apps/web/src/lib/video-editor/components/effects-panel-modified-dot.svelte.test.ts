import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import EffectsPanel from './effects-panel.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('exposes the modified-from-defaults dot as a labeled image', async () => {
	const item: TimelineItem = {
		id: 'clip-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'clip-1',
		type: 'image',
		// Brightness default is 1.2, so 1.5 renders the modified dot.
		effects: [{ id: 'fx-1', type: 'brightness', amount: 1.5, enabled: true }]
	};
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([item]);

	const screen = await render(EffectsPanel, { itemId: 'clip-1', onedit: vi.fn() });

	// The dot only renders on collapsed effect rows. The row toggle is the
	// Brightness button carrying aria-expanded; the row menu reuses the label.
	await screen
		.getByRole('button', { name: m.video_editor_effects_brightness(), expanded: true })
		.click();
	const dot = screen.getByRole('img', { name: m.video_editor_effects_modified() });
	// The dot is spacing-sized (size-4), which computes to 0px in the vitest
	// browser harness where the Tailwind spacing token is undefined, so assert
	// attribute exposure rather than visibility (see media-processing progressbar).
	await expect.element(dot).toHaveAttribute('data-effect-modified', '');
});
