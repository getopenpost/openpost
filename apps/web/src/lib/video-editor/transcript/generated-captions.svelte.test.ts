import { afterEach, expect, it } from 'vitest';
import { addGeneratedSubtitleItem } from './transcribe-action';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import { ItemRasterizer } from '../media/item-rasterizer';
import { collectSubtitleCues } from './subtitle-export';

afterEach(() => timelineStore.__resetForTesting());

it('places new captions above the top video on a compact track', () => {
	timelineStore.setAll({
		fps: 30,
		tracks: createDefaultTracks(),
		items: [
			{
				id: 'speech-video',
				type: 'video',
				trackId: 'track-video-overlay',
				label: 'Speech',
				mediaId: 'speech-media',
				from: 0,
				durationInFrames: 120,
				sourceFps: 30
			}
		]
	});
	const id = addGeneratedSubtitleItem('speech-video', [
		{ text: 'Hello', startSeconds: 0, endSeconds: 1 }
	]);
	const caption = timelineStore.itemById.get(id)!;
	const track = timelineStore.tracks.find((track) => track.id === caption.trackId)!;
	const videoTrack = timelineStore.tracks.find((track) => track.id === 'track-video-overlay')!;
	expect(track.order).toBeLessThan(videoTrack.order);
	expect(track.height).toBe(48);
});

it('renders generated captions at the speech position when the source starts later in the timeline', () => {
	timelineStore.setAll({
		fps: 30,
		tracks: createDefaultTracks(),
		items: [
			{
				id: 'speech',
				type: 'audio',
				trackId: 'track-audio-main',
				label: 'Speech',
				mediaId: 'speech-media',
				from: 700,
				durationInFrames: 120,
				sourceFps: 30,
				sourceStart: 0,
				sourceEnd: 120
			}
		]
	});
	const id = addGeneratedSubtitleItem('speech', [
		{ text: 'Hello', startSeconds: 0.2, endSeconds: 1.2 },
		{ text: 'world', startSeconds: 1.3, endSeconds: 2.2 }
	]);
	const caption = timelineStore.itemById.get(id)!;
	const rasterizer = new ItemRasterizer(1920, 1080, 30);
	try {
		const raster = rasterizer.render(caption, 715);
		expect(raster).not.toBeNull();
		const canvas = raster!.source;
		if (!(canvas instanceof OffscreenCanvas))
			throw new Error('Expected caption pixels on an offscreen canvas');
		const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
		expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
		expect(rasterizer.render(caption, 699)).toBeNull();
		expect(collectSubtitleCues([caption], 30)[0]?.startSeconds).toBeCloseTo(706 / 30);
	} finally {
		rasterizer.dispose();
	}
});
