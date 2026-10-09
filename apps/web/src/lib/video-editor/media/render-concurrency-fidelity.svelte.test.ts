import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PreviewLayer from '../components/preview-layer.svelte';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TimelineItem } from '../project/types';
import { createBlankProject } from '../project/defaults';
import { mediaPool } from './pool.svelte';
import { TimelineFrameRenderer } from './render-export';

async function imageFile(color?: string): Promise<File> {
	const canvas = new OffscreenCanvas(16, 16);
	const context = canvas.getContext('2d')!;
	if (color) {
		context.fillStyle = color;
		context.fillRect(0, 0, 16, 16);
	}
	return new File([await canvas.convertToBlob()], 'source.png', { type: 'image/png' });
}

function pendingImage(id: string) {
	const read = Promise.withResolvers<File>();
	const started = Promise.withResolvers<void>();
	let reads = 0;
	// SAFETY: linked source resolution only calls getFile at this native I/O boundary.
	const fileHandle = {
		kind: 'file',
		name: 'source.png',
		getFile: () => {
			reads++;
			started.resolve();
			return read.promise;
		}
	} as FileSystemFileHandle;
	mediaPool.upsert(
		{
			id,
			storageType: 'handle',
			fileHandle,
			fileName: 'source.png',
			fileSize: 100,
			mimeType: 'image/png',
			width: 16,
			height: 16,
			duration: 0,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: ['image']
		},
		'ready'
	);
	return {
		read,
		started,
		get reads() {
			return reads;
		}
	};
}

afterEach(() => {
	mediaPool.clear();
	editorSession.project = null;
	sequenceStore.reset();
});

it('keeps overlapping frame requests from painting into the latest frame', async () => {
	const red = await imageFile('#ff0000');
	const transparent = await imageFile();
	const oldSource = pendingImage('old');
	const currentSource = pendingImage('current');
	const project = createBlankProject('Concurrent frame requests');
	project.metadata = { width: 16, height: 16, fps: 30, backgroundColor: '#0000ff' };
	project.timeline!.items = ['old', 'current'].map((id, index) => ({
		id,
		mediaId: id,
		type: 'image',
		trackId: 'track-video-main',
		label: id,
		from: index,
		durationInFrames: 1
	}));
	const renderer = new TimelineFrameRenderer(project);
	try {
		const oldFrame = renderer.render(0);
		await oldSource.started.promise;
		const currentFrame = renderer.render(1);
		// Let a newer request enter while the older linked file read is pending.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		oldSource.read.resolve(red);
		const firstCanvas = await oldFrame;
		expect([...firstCanvas.getContext('2d')!.getImageData(8, 8, 1, 1).data]).toEqual([
			255, 0, 0, 255
		]);
		currentSource.read.resolve(transparent);
		const canvas = await currentFrame;
		expect([...canvas.getContext('2d')!.getImageData(8, 8, 1, 1).data]).toEqual([0, 0, 255, 255]);
	} finally {
		oldSource.read.resolve(red);
		currentSource.read.resolve(transparent);
		renderer.dispose();
	}
});

it.each(['seek', 'source offset', 'failed seek'])(
	'renders the latest nested preview after a %s update',
	async (update) => {
		const red = await imageFile('#ff0000');
		const green = await imageFile('#00ff00');
		const blue = await imageFile('#0000ff');
		const oldSource = pendingImage('old');
		const middleSource = pendingImage('middle');
		const latestSource = pendingImage('latest');
		middleSource.read.resolve(green);
		latestSource.read.resolve(blue);
		const project = createBlankProject('Nested preview seeks');
		project.metadata = { width: 16, height: 16, fps: 30 };
		const item: TimelineItem = {
			id: 'nested',
			type: 'composition',
			compositionId: 'nested-source',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 3,
			label: 'Nested'
		};
		project.timeline!.items = [item];
		project.timeline!.compositions = [
			{
				id: 'nested-source',
				name: 'Nested',
				width: 16,
				height: 16,
				fps: 30,
				durationInFrames: 3,
				tracks: project.timeline!.tracks,
				transitions: [],
				items: ['old', 'middle', 'latest'].map((id, index) => ({
					id,
					mediaId: id,
					type: 'image',
					trackId: 'track-video-main',
					label: id,
					from: index,
					durationInFrames: 1
				}))
			}
		];
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		const props = {
			item: timelineStore.itemById.get('nested')!,
			canvasWidth: 16,
			canvasHeight: 16,
			displayFrame: 0,
			onselect: () => undefined
		};
		const screen = await render(PreviewLayer, props);
		try {
			await oldSource.started.promise;
			const canvas = screen.container.querySelector('canvas')!;
			if (update === 'source offset') {
				oldSource.read.resolve(red);
				await expect
					.poll(() => [...canvas.getContext('2d')!.getImageData(8, 8, 1, 1).data])
					.toEqual([255, 0, 0, 255]);
				timelineStore._updateItems([{ id: 'nested', patch: { sourceStart: 2 } }]);
			} else {
				await screen.rerender({ displayFrame: 1 });
				await screen.rerender({ displayFrame: 2 });
				if (update === 'failed seek') oldSource.read.reject(new Error('Source read failed'));
				else oldSource.read.resolve(red);
			}
			await expect
				.poll(() => [...canvas.getContext('2d')!.getImageData(8, 8, 1, 1).data])
				.toEqual([0, 0, 255, 255]);
			expect(middleSource.reads).toBe(0);
		} finally {
			oldSource.read.resolve(red);
			await screen.unmount();
		}
	}
);

it('discards queued frame reads when the renderer is disposed during an active read', async () => {
	const file = await imageFile('#ff0000');
	const activeSource = pendingImage('active');
	const queuedSource = pendingImage('queued');
	const project = createBlankProject('Disposed render queue');
	project.metadata = { width: 16, height: 16, fps: 30 };
	project.timeline!.items = ['active', 'queued'].map((id, index) => ({
		id,
		mediaId: id,
		type: 'image',
		trackId: 'track-video-main',
		label: id,
		from: index,
		durationInFrames: 1
	}));
	const renderer = new TimelineFrameRenderer(project);
	try {
		const active = renderer.render(0);
		await activeSource.started.promise;
		const queued = renderer.render(1);
		const rejected = expect(queued).rejects.toThrow('disposed renderer');
		renderer.dispose();
		activeSource.read.resolve(file);
		queuedSource.read.resolve(file);
		await active;
		await rejected;
		expect(queuedSource.reads).toBe(0);
	} finally {
		activeSource.read.resolve(file);
		queuedSource.read.resolve(file);
		renderer.dispose();
	}
});
