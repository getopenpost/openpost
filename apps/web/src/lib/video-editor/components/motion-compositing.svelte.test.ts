import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { createCompoundClip } from '../sequences/sequence-actions';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { renderMultiTrackVideoArtifact, TimelineFrameRenderer } from '../media/render-export';
import PreviewLayer from './preview-layer.svelte';

function whitePixelsLeft(pixels: Uint8ClampedArray): number {
	let count = 0;
	for (let y = 0; y < 64; y++) {
		for (let x = 0; x < 40; x++) {
			const index = (y * 64 + x) * 4;
			if (pixels[index]! > 200 && pixels[index + 2]! > 200) count++;
		}
	}
	return count;
}

afterEach(() => {
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('keeps a converted moving title transparent in live Motion preview and decoded export', async () => {
	const project = createBlankProject('Transparent title');
	project.metadata = { width: 64, height: 64, fps: 30 };
	project.duration = 0.2;
	project.timeline!.items = [
		{
			id: 'green',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#00ff00',
			label: 'Green',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 6
		},
		{
			id: 'title',
			type: 'text',
			text: 'I',
			color: '#ffffff',
			fontFamily: 'sans-serif',
			fontSize: 32,
			fontWeight: 700,
			textAlign: 'center',
			verticalAlign: 'middle',
			paddingX: 0,
			paddingY: 0,
			keyframes: { x: { frames: [0, 5], values: [0, 16] } },
			label: 'Title',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 6
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const compositionId = createCompoundClip(['title'], 'Title Motion', 'composite-2d');
	expect(compositionId).not.toBeNull();
	project.timeline = sequenceStore.projectTimeline();
	const wrapper = project.timeline.items.find((item) => item.compositionId === compositionId)!;
	const renderer = new TimelineFrameRenderer(project);
	let input: Input | undefined;
	try {
		const first = await renderer.render(0);
		const firstPixels = first.getContext('2d')!.getImageData(0, 0, 64, 64).data;
		expect([...firstPixels.slice(0, 4)]).toEqual([0, 255, 0, 255]);
		expect(whitePixelsLeft(firstPixels)).toBeGreaterThan(0);
		const last = await renderer.render(5);
		expect(whitePixelsLeft(last.getContext('2d')!.getImageData(0, 0, 64, 64).data)).toBe(0);

		const screen = await render(PreviewLayer, {
			item: wrapper,
			displayFrame: 0,
			canvasWidth: 64,
			canvasHeight: 64,
			selected: false,
			onselect: () => {}
		});
		const preview = screen.container.querySelector('canvas')!;
		await expect
			.poll(
				() =>
					preview.width === 64 &&
					whitePixelsLeft(preview.getContext('2d')!.getImageData(0, 0, 64, 64).data)
			)
			.toBeGreaterThan(0);
		expect(preview.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(0);

		const artifact = await renderMultiTrackVideoArtifact(project, {
			format: 'webm',
			codec: 'vp8',
			quality: 'draft'
		});
		input = new Input({ source: new BlobSource(artifact.blob), formats: ALL_FORMATS });
		const track = (await input.getPrimaryVideoTrack())!;
		let frameCount = 0;
		for await (const decoded of new CanvasSink(track, { poolSize: 1 }).canvases()) {
			const pixels = decoded.canvas.getContext('2d')!.getImageData(0, 0, 64, 64).data;
			expect(pixels[1]).toBeGreaterThan(240);
			expect(pixels[0]).toBeLessThan(15);
			expect(pixels[2]).toBeLessThan(15);
			if (frameCount === 0) expect(whitePixelsLeft(pixels)).toBeGreaterThan(0);
			if (frameCount === 5) expect(whitePixelsLeft(pixels)).toBe(0);
			frameCount++;
		}
		expect(frameCount).toBe(6);

		const opaque = new TimelineFrameRenderer({
			...project,
			timeline: {
				...project.timeline,
				compositions: project.timeline.compositions!.map((composition) =>
					composition.id === compositionId
						? { ...composition, backgroundColor: '#000000' }
						: composition
				)
			}
		});
		try {
			const frame = await opaque.render(0);
			expect([...frame.getContext('2d')!.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 0, 255]);
		} finally {
			opaque.dispose();
		}
	} finally {
		input?.dispose();
		renderer.dispose();
	}
});
