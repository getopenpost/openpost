import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { formatTrackHeightText } from '$lib/video-editor/timeline/track-resize';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TimelinePanel from './timeline-panel.svelte';

it('announces the track-height resize slider with a pixels unit', async () => {
	const previous = {
		tracks: timelineStore.tracks,
		items: [...timelineStore.itemById.values()],
		currentFrame: timelineStore.currentFrame,
		fps: timelineStore.fps
	};
	const tracks = createDefaultTracks();
	timelineStore.setAll({
		tracks,
		items: [],
		currentFrame: 0,
		fps: 30
	});
	try {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			importProjectAsset: vi.fn(async () => null)
		});
		const slider = screen.getByRole('slider', {
			name: m.video_editor_track_resize({ name: tracks[1].name })
		});
		await expect
			.element(slider.element())
			.toHaveAttribute('aria-valuetext', formatTrackHeightText(tracks[1].height));
	} finally {
		timelineStore.setAll({
			tracks: previous.tracks,
			items: previous.items,
			currentFrame: previous.currentFrame,
			fps: previous.fps
		});
	}
});
