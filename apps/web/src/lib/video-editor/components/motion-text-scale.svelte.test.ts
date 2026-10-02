import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { setTransformParent } from '../timeline/actions/transform-parenting';
import { updateItemProperties } from '../timeline/actions/items';
import { TimelineFrameRenderer, renderMultiTrackVideoArtifact } from '../media/render-export';
import PreviewLayer from './preview-layer.svelte';

function inkSize(canvas: HTMLCanvasElement | OffscreenCanvas) {
	const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
	let left = canvas.width,
		top = canvas.height,
		right = -1,
		bottom = -1;
	for (let y = 0; y < canvas.height; y++)
		for (let x = 0; x < canvas.width; x++) {
			if (pixels[(y * canvas.width + x) * 4]! < 128) continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	return { width: right - left + 1, height: bottom - top + 1 };
}

afterEach(() => {
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('scales inherited text ink and preserves local typography through history and saved reload', async () => {
	const project = createBlankProject('Controller text');
	project.metadata = { width: 128, height: 128, fps: 30 };
	project.timeline!.items = [
		{
			id: 'text',
			type: 'text',
			label: 'H',
			text: 'H',
			fontFamily: 'sans-serif',
			fontSize: 64,
			fontWeight: 700,
			color: '#ffffff',
			paddingX: 0,
			paddingY: 0,
			textAlign: 'center',
			verticalAlign: 'middle',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 6,
			transform: { width: 128, height: 128 }
		},
		{
			id: 'controller',
			type: 'controller',
			label: 'Controller',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 6,
			transform: { width: 128, height: 128 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	expect(setTransformParent('text', 'controller')).toEqual({ ok: true });
	async function frameSize() {
		const renderer = new TimelineFrameRenderer({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		try {
			return inkSize(await renderer.render(0));
		} finally {
			renderer.dispose();
		}
	}
	const full = await frameSize();
	expect(full.width).toBeGreaterThan(30);
	updateItemProperties('controller', { transform: { width: 64, height: 64 } });
	const half = await frameSize();
	expect(Math.abs(half.width - full.width / 2)).toBeLessThanOrEqual(2);
	expect(Math.abs(half.height - full.height / 2)).toBeLessThanOrEqual(2);
	expect(timelineStore.itemById.get('text')!.fontSize).toBe(64);
	expect(timelineStore.itemById.get('text')!.transform).toEqual({ width: 128, height: 128 });
	commandHistory.undo();
	expect(await frameSize()).toEqual(full);
	commandHistory.redo();
	expect(await frameSize()).toEqual(half);
	updateItemProperties('controller', { transform: { width: 32, height: 64 } });
	const narrow = await frameSize();
	expect(Math.abs(narrow.width - full.width / 4)).toBeLessThanOrEqual(2);
	expect(Math.abs(narrow.height - full.height / 2)).toBeLessThanOrEqual(2);
	commandHistory.undo();
	const saved = JSON.parse(
		JSON.stringify({ ...project, timeline: sequenceStore.projectTimeline() })
	);
	sequenceStore.load(saved.timeline, saved.metadata);
	expect(await frameSize()).toEqual(half);
	const screen = await render(PreviewLayer, {
		item: timelineStore.itemById.get('text')!,
		displayFrame: 0,
		canvasWidth: 128,
		canvasHeight: 128,
		selected: false,
		onselect: () => {}
	});
	const canvas = screen.container.querySelector('canvas')!;
	screen.container.style.cssText = 'position:relative;width:128px;height:128px;background:#000000';
	await expect.poll(() => canvas.width === 128 && inkSize(canvas).width > 0).toBe(true);
	const bounds = canvas.getBoundingClientRect();
	expect(bounds.width).toBe(64);
	expect(bounds.height).toBe(64);
	expect(
		Math.abs((inkSize(canvas).width * bounds.width) / canvas.width - full.width / 2)
	).toBeLessThanOrEqual(2);
	updateItemProperties('controller', {
		keyframes: {
			width: { frames: [0, 5], values: [128, 64] },
			height: { frames: [0, 5], values: [128, 64] }
		}
	});
	const artifact = await renderMultiTrackVideoArtifact(
		{ ...project, timeline: sequenceStore.projectTimeline() },
		{
			format: 'webm',
			codec: 'vp8',
			quality: 'draft'
		}
	);
	const input = new Input({ source: new BlobSource(artifact.blob), formats: ALL_FORMATS });
	try {
		const track = (await input.getPrimaryVideoTrack())!;
		const sizes = [];
		for await (const decoded of new CanvasSink(track, { poolSize: 1 }).canvases())
			sizes.push(inkSize(decoded.canvas));
		expect(sizes).toHaveLength(6);
		expect(Math.abs(sizes[5]!.width - sizes[0]!.width / 2)).toBeLessThanOrEqual(2);
		expect(Math.abs(sizes[5]!.height - sizes[0]!.height / 2)).toBeLessThanOrEqual(2);
	} finally {
		input.dispose();
	}
});
