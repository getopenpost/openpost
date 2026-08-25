import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import PreviewLayer from '$lib/video-editor/components/preview-layer.svelte';
import animatedGifUrl from './fixtures/animated-rgb.gif?url';

const WIDTH = 64;
const HEIGHT = 48;
let mediaSeq = 0;

async function animatedImageItem(
	overrides: Partial<TimelineItem> = {}
): Promise<{ item: TimelineItem; mediaId: string }> {
	const blob = await (await fetch(animatedGifUrl)).blob();
	const mediaId = `preview-anim-${++mediaSeq}`;
	mediaPool.loadAll([
		{
			id: mediaId,
			// SAFETY: the cache only reads name/kind/getFile from this stub handle.
			fileHandle: { getFile: async () => new File([blob], 'animated.gif') },
			storageType: 'handle',
			fileName: 'animated.gif',
			fileSize: blob.size,
			mimeType: 'image/gif',
			duration: 0.3,
			width: 16,
			height: 12,
			fps: 10,
			codec: '',
			bitrate: 0,
			animationFrameCount: 3,
			tags: ['image']
		}
	]);
	return {
		item: {
			id: 'anim',
			trackId: 'visuals',
			from: 0,
			durationInFrames: 30,
			label: 'Animated',
			type: 'image',
			mediaId,
			sourceWidth: 16,
			sourceHeight: 12,
			transform: { width: WIDTH, height: HEIGHT },
			...overrides
		},
		mediaId
	};
}

function project(item: TimelineItem): Project {
	return {
		id: 'animated-image-project',
		name: 'Animated image project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [
				{
					id: 'visuals',
					name: 'Visuals',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		}
	};
}

async function mount(item: TimelineItem): Promise<HTMLCanvasElement> {
	editorSession.project = project(item);
	timelineStore.setAll({
		items: [item],
		tracks: editorSession.project.timeline?.tracks,
		fps: 30,
		currentFrame: 0
	});
	await render(PreviewLayer, {
		item,
		url: URL.createObjectURL(await (await fetch(animatedGifUrl)).blob()),
		canvasWidth: WIDTH,
		canvasHeight: HEIGHT,
		onselect: vi.fn()
	});
	const canvas = document.querySelector<HTMLCanvasElement>(
		`[data-animated-frame-canvas="${item.id}"]`
	);
	expect(canvas).not.toBeNull();
	return canvas!;
}

function centerColor(canvas: HTMLCanvasElement): string {
	const context = canvas.getContext('2d');
	if (!context || canvas.width === 0) return 'empty';
	const data = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
		.data;
	const [r, g, b] = [data[0]!, data[1]!, data[2]!];
	if (r > 150 && g < 120) return 'red';
	if (g > 100 && r < 120) return 'green';
	if (b > 150) return 'blue';
	return `unknown(${r},${g},${b})`;
}

afterEach(() => {
	timelineStore.clear();
	editorSession.project = null;
});

describe('PreviewLayer animated image frames', () => {
	it('paints the exact animation frame for the playhead instead of a frozen still', async () => {
		const { item } = await animatedImageItem();
		const canvas = await mount(item);

		await vi.waitFor(() => expect(centerColor(canvas)).toBe('red'));
		expect(canvas.width).toBe(16);
		expect(canvas.height).toBe(12);

		// Frame 5 = ~166ms -> the green frame bucket (100-200ms).
		editorSession.clock.seek(5);
		await vi.waitFor(() => expect(centerColor(canvas)).toBe('green'));

		// Frame 15 = 0.5s into the clip -> 500ms loops to 200ms -> blue.
		editorSession.clock.seek(15);
		await vi.waitFor(() => expect(centerColor(canvas)).toBe('blue'));
	});

	it('plays backward for reversed clips', async () => {
		const { item } = await animatedImageItem({ isReversed: true });
		const canvas = await mount(item);

		await vi.waitFor(() => expect(centerColor(canvas)).toBe('red'));
		// Reversed reads the animation clock backward: frame 7 maps forward to
		// ~233ms so it plays at 67ms (red), frame 15 at 100ms (green).
		editorSession.clock.seek(7);
		await vi.waitFor(() => expect(centerColor(canvas)).toBe('red'));
		editorSession.clock.seek(15);
		await vi.waitFor(() => expect(centerColor(canvas)).toBe('green'));
	});

	it('honors item speed while looping', async () => {
		const { item } = await animatedImageItem({ speed: 2 });
		const canvas = await mount(item);

		await vi.waitFor(() => expect(centerColor(canvas)).toBe('red'));
		// Speed 2 at frame 15 = 1s of animation time -> 1000ms % 300 = 100ms,
		// the exact start of the green frame bucket.
		editorSession.clock.seek(15);
		await vi.waitFor(() => expect(centerColor(canvas)).toBe('green'));
	});
});
