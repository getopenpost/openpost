import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { formatTimelinePreviewTimecode } from '$lib/video-editor/preview/timeline-preview-scrub';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TimelinePanel from './timeline-panel.svelte';

it('announces the ruler playhead position as a timecode', async () => {
	const previous = {
		tracks: timelineStore.tracks,
		items: [...timelineStore.itemById.values()],
		currentFrame: timelineStore.currentFrame,
		fps: timelineStore.fps
	};
	timelineStore.setAll({
		tracks: createDefaultTracks(),
		items: [],
		currentFrame: 90,
		fps: 30
	});
	try {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			importProjectAsset: vi.fn(async () => null)
		});
		const ruler = screen.getByRole('slider', { name: m.video_editor_playhead() });
		await expect
			.element(ruler.element())
			.toHaveAttribute('aria-valuetext', formatTimelinePreviewTimecode(90, 30));

		timelineStore._setCurrentFrame(150);
		await expect
			.element(ruler.element())
			.toHaveAttribute('aria-valuetext', formatTimelinePreviewTimecode(150, 30));
	} finally {
		timelineStore.setAll({
			tracks: previous.tracks,
			items: previous.items,
			currentFrame: previous.currentFrame,
			fps: previous.fps
		});
	}
});
