import { afterEach, expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { splitItemsAtFrame, trimItemStart } from '../timeline/actions/items';
import { planTrimGesture } from '../timeline/edit-gesture';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { animatedImageCache } from './animated-image-client';
import { mediaPool } from './pool.svelte';
import { TimelineFrameRenderer } from './render-export';

const mediaIds: string[] = [];
afterEach(async () => {
	for (const id of mediaIds.splice(0)) await animatedImageCache.clearMedia(id);
	mediaPool.clear();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it.each([
	{ edit: 'split', speed: 1, reversed: false, sourceFps: 10 },
	{ edit: 'trim action', speed: 1, reversed: false, sourceFps: 24 },
	{ edit: 'trim gesture', speed: 1, reversed: true, sourceFps: 60 },
	{ edit: 'split', speed: 2, reversed: false, sourceFps: 10 },
	{ edit: 'extend', speed: 1, reversed: false, sourceFps: 10 },
	{ edit: 'split transition', speed: 1, reversed: false, sourceFps: 10 }
])(
	'preserves GIF phase after $edit at speed $speed, reverse=$reversed, source FPS=$sourceFps',
	async ({ edit, speed, reversed, sourceFps }) => {
		const id = crypto.randomUUID();
		mediaIds.push(id);
		const remoteUrl = new URL('./fixtures/animated-rgb.gif', import.meta.url).href;
		mediaPool.upsert(
			{
				id,
				storageType: 'cloud',
				remoteUrl,
				fileName: 'animated-rgb.gif',
				fileSize: 150,
				mimeType: 'image/gif',
				width: 16,
				height: 12,
				duration: 0.3,
				fps: 10,
				codec: '',
				bitrate: 0,
				tags: ['image'],
				animationFrameCount: 3
			},
			'ready'
		);
		const frame = edit === 'extend' ? 8 : edit === 'split transition' ? 5 : 4 / speed;
		const project = createBlankProject('Animation edits');
		project.metadata = { width: 16, height: 12, fps: 30 };
		timelineStore._setItems([
			{
				id: 'animation',
				type: 'image',
				mediaId: id,
				label: 'animated-rgb.gif',
				trackId: 'track-video-main',
				from: edit === 'extend' ? 9 : 0,
				durationInFrames: 30,
				speed,
				isReversed: reversed,
				sourceFps
			}
		]);
		if (edit === 'split' || edit === 'split transition')
			splitItemsAtFrame(edit === 'split transition' ? 7 : frame, ['animation']);
		else if (edit === 'trim action') trimItemStart('animation', frame);
		else {
			const plan = planTrimGesture(
				timelineStore.items[0]!,
				'start',
				edit === 'extend' ? -3 : frame,
				timelineStore.items,
				30,
				[],
				0
			);
			timelineStore._updateItems([{ id: 'animation', patch: plan.patch }]);
		}
		if (edit === 'split' || edit === 'trim action') {
			commandHistory.undo();
			expect(timelineStore.items).toHaveLength(1);
			expect(timelineStore.items[0]?.from).toBe(0);
			commandHistory.redo();
		}
		project.timeline!.items = structuredClone($state.snapshot(timelineStore.items));
		if (edit === 'split transition') {
			project.timeline!.transitions = [
				{
					id: 'dissolve',
					type: 'crossfade',
					fromItemId: timelineStore.items[0]!.id,
					toItemId: timelineStore.items[1]!.id,
					durationInFrames: 6
				}
			];
		}
		const renderer = new TimelineFrameRenderer(project);
		try {
			// The fixture is red for 0-100ms, green for 100-200ms, then blue.
			// Splits and trims retain green; extending before the original start wraps to blue.
			const pixels = (await renderer.render(frame)).getContext('2d')!.getImageData(8, 6, 1, 1).data;
			expect([...pixels]).toEqual(edit === 'extend' ? [37, 99, 235, 255] : [22, 163, 74, 255]);
		} finally {
			renderer.dispose();
		}
	}
);
