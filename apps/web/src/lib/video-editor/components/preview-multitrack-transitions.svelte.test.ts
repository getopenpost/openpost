import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import PreviewPlayer from './preview-player.svelte';
import '../../../routes/layout.css';

const urls: string[] = [];
afterEach(() => {
	mediaPool.clear();
	for (const url of urls.splice(0)) URL.revokeObjectURL(url);
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
});

it.each([
	{ hidden: false, output: 'export' },
	{ hidden: true, output: 'export' },
	{ hidden: false, output: 'preview' },
	{ hidden: true, output: 'preview' }
])(
	'renders concurrent transitions in $output with hidden overlay=$hidden',
	async ({ hidden, output }) => {
		const project = createBlankProject('Concurrent dissolves');
		project.metadata = { width: 128, height: 64, fps: 30 };
		project.duration = 2;
		const timeline = project.timeline!;
		timeline.tracks.find((track) => track.id === 'track-video-overlay')!.visible = !hidden;
		for (const [index, color] of ['#ff0000', '#0000ff', '#00ff00', '#ffffff'].entries()) {
			const id = `color-${index}`;
			const canvas = new OffscreenCanvas(64, 64);
			const context = canvas.getContext('2d')!;
			context.fillStyle = color;
			context.fillRect(0, 0, 64, 64);
			const blob = await canvas.convertToBlob();
			const remoteUrl = URL.createObjectURL(blob);
			urls.push(remoteUrl);
			mediaPool.upsert(
				{
					id,
					storageType: 'cloud',
					remoteUrl,
					fileName: `${id}.png`,
					fileSize: blob.size,
					mimeType: 'image/png',
					width: 64,
					height: 64,
					duration: 0,
					fps: 0,
					codec: '',
					bitrate: 0,
					tags: []
				},
				'ready'
			);
			timeline.items.push({
				id,
				mediaId: id,
				type: 'image',
				label: id,
				trackId: index < 2 ? 'track-video-main' : 'track-video-overlay',
				from: (index % 2) * 30,
				durationInFrames: 30,
				transform: { width: index < 2 ? 128 : 64, height: 64, x: index < 2 ? 0 : 32 }
			});
		}
		// Put the overlay first to prove array order cannot suppress the lower track.
		timeline.transitions = [2, 0].map((index) => ({
			id: `dissolve-${index}`,
			type: 'crossfade',
			presentation: 'fade',
			fromItemId: `color-${index}`,
			toItemId: `color-${index + 1}`,
			durationInFrames: 21
		}));
		const checkPixels = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
			const context = canvas.getContext('2d')!;
			const left = context.getImageData(canvas.width / 4, canvas.height / 2, 1, 1).data;
			const right = context.getImageData((canvas.width * 3) / 4, canvas.height / 2, 1, 1).data;
			for (const [actual, expected] of [
				[left, [128, 0, 128]],
				[right, hidden ? [128, 0, 128] : [128, 255, 128]]
			] as const) {
				for (let channel = 0; channel < 3; channel++)
					expect(Math.abs(actual[channel]! - expected[channel]!)).toBeLessThanOrEqual(2);
			}
		};
		if (output === 'export') {
			const renderer = new TimelineFrameRenderer(project);
			try {
				checkPixels(await renderer.render(30));
			} finally {
				renderer.dispose();
			}
			return;
		}
		editorSession.project = project;
		sequenceStore.load(timeline, project.metadata);
		editorSession.clock.seek(30);
		const screen = await render(PreviewPlayer, { onedit: () => {} });
		screen.container.style.cssText = 'display:flex;width:640px;height:400px';
		try {
			await expect
				.poll(() => {
					const canvas =
						screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
					if (!canvas) return false;
					checkPixels(canvas);
					return true;
				})
				.toBe(true);
		} finally {
			await screen.unmount();
		}
	}
);
