import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { commands, userEvent } from 'vitest/browser';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { setCurrentFrame } from '../timeline/actions/items';
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny';
import { TimelineFrameRenderer } from '../media/render-export';
import { mediaPool } from '../media/pool.svelte';
import SpeedRampEditor from './speed-ramp-editor.svelte';
import '../../../routes/layout.css';

declare module 'vitest/browser' {
	interface BrowserCommands {
		dragPointer(
			selector: string,
			dx: number,
			dy: number,
			options: { cancel: boolean }
		): Promise<void>;
	}
}

afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'clip',
			type: 'video',
			label: 'Own clip',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 240,
			sourceStart: 0,
			sourceEnd: 240,
			sourceFps: 30,
			speed: 1
		}
	]);
	commandHistory.clearHistory();
});
it('explains a speed point collision without authoring another point and recovers at another playhead position', async () => {
	const onedit = vi.fn();
	const screen = await render(SpeedRampEditor, { itemId: 'clip', itemIds: ['clip'], onedit });
	const add = screen.getByRole('button', { name: 'Add point', exact: true });
	add.element().focus();
	await userEvent.keyboard('{Enter}');
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	expect(commandHistory.undoStack).toHaveLength(1);
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('status'))
		.toHaveTextContent('A point already exists at the playhead. Move the playhead to add another.');
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	expect(commandHistory.undoStack).toHaveLength(1);
	expect(onedit).toHaveBeenCalledTimes(1);
	setCurrentFrame(30);
	await userEvent.keyboard('{Enter}');
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	expect(timelineStore.itemById.get('clip')!.speedRamp?.map((p) => p.sourceFrame)).toEqual([
		0, 30, 240
	]);
	expect(onedit).toHaveBeenCalledTimes(2);
	commandHistory.undo();
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	commandHistory.redo();
	expect(timelineStore.itemById.get('clip')!.speedRamp?.map((p) => p.sourceFrame)).toEqual([
		0, 30, 240
	]);
});

function linkedRampProject() {
	const project = createBlankProject('Source speed points');
	const speedRamp = [
		{ id: 'start', sourceFrame: 0, speed: 1, easing: 'hold' as const },
		{ id: 'middle', sourceFrame: 60, speed: 2, easing: 'hold' as const },
		{ id: 'end', sourceFrame: 240, speed: 1, easing: 'linear' as const }
	];
	project.timeline!.items = [
		{
			id: 'clip',
			type: 'video',
			label: 'Own video',
			trackId: 'track-video-main',
			linkedGroupId: 'owned-av',
			from: 0,
			durationInFrames: 150,
			sourceStart: 0,
			sourceEnd: 240,
			sourceFps: 30,
			speed: 1,
			speedRamp,
			keyframes: { opacity: { frames: [0, 75], values: [0, 1] } }
		},
		{
			id: 'audio',
			type: 'audio',
			label: 'Own audio',
			trackId: 'track-audio-main',
			linkedGroupId: 'owned-av',
			from: 0,
			durationInFrames: 150,
			sourceStart: 0,
			sourceEnd: 240,
			sourceFps: 30,
			speed: 1,
			speedRamp
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	return project;
}
it('edits source time through the normal field, retimes linked media and preserves identity across history and saved reopen', async () => {
	const project = linkedRampProject();
	const onedit = vi.fn();
	const screen = await render(SpeedRampEditor, { itemId: 'clip', itemIds: ['clip'], onedit });
	const time = screen.getByRole('spinbutton', { name: 'Source frame 2', exact: true });
	await time.fill('120');
	await userEvent.keyboard('{Tab}');
	expect(
		timelineStore.items.map((i) => [
			i.id,
			i.durationInFrames,
			i.speedRamp?.find((p) => p.id === 'middle')?.sourceFrame
		])
	).toEqual([
		['clip', 180, 120],
		['audio', 180, 120]
	]);
	expect(timelineStore.itemById.get('clip')!.keyframes!.opacity!.frames).toEqual([0, 90]);
	expect(commandHistory.undoStack).toHaveLength(1);
	expect(onedit).toHaveBeenCalledTimes(1);
	commandHistory.undo();
	await expect.element(time).toHaveValue(60);
	expect(timelineStore.items.map((i) => i.durationInFrames)).toEqual([150, 150]);
	commandHistory.redo();
	await expect.element(time).toHaveValue(120);
	const prior = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const dir = `speed-source-${crypto.randomUUID()}`;
	setWorkspaceRoot(await root.getDirectoryHandle(dir, { create: true }));
	try {
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
		await expect.element(time).toHaveValue(120);
		expect(timelineStore.items.map((i) => i.durationInFrames)).toEqual([180, 180]);
	} finally {
		setWorkspaceRoot(prior);
		await root.removeEntry(dir, { recursive: true });
	}
	await time.fill('240');
	await userEvent.keyboard('{Tab}');
	await expect.element(time).toHaveValue(239);
	expect(timelineStore.itemById.get('clip')!.speedRamp!.map((p) => p.sourceFrame)).toEqual([
		0, 239, 240
	]);
});
it('moves a graph point with native drag and arrow keys in the same authoring owner', async () => {
	linkedRampProject();
	const onedit = vi.fn();
	const screen = await render(SpeedRampEditor, { itemId: 'clip', itemIds: ['clip'], onedit });
	const point = screen.getByRole('button', { name: 'Speed 2', exact: true });
	await expect.element(point).toBeVisible();
	const graph = screen.getByRole('group', { name: 'Speed', exact: true });
	await commands.dragPointer('button[aria-label="Speed 2"]', 30, -10, { cancel: true });
	expect(
		timelineStore.itemById.get('clip')!.speedRamp!.find((p) => p.id === 'middle')!.sourceFrame
	).toBe(60);
	expect(timelineStore.itemById.get('clip')!.speedRamp!.find((p) => p.id === 'middle')!.speed).toBe(
		2
	);
	expect(commandHistory.undoStack).toHaveLength(0);
	expect(onedit).not.toHaveBeenCalled();
	const box = graph.element().getBoundingClientRect();
	await userEvent.dragAndDrop(point, graph, {
		targetPosition: {
			x: box.width * 0.5 - graph.element().clientLeft,
			y: box.height * 0.5 - graph.element().clientTop
		}
	});
	expect(
		timelineStore.itemById.get('clip')!.speedRamp!.find((p) => p.id === 'middle')!.sourceFrame
	).toBe(120);
	expect(commandHistory.undoStack).toHaveLength(1);
	expect(onedit).toHaveBeenCalledTimes(1);
	point.element().focus();
	await userEvent.keyboard('{ArrowRight}');
	expect(
		timelineStore.itemById.get('clip')!.speedRamp!.find((p) => p.id === 'middle')!.sourceFrame
	).toBe(121);
	expect(
		timelineStore.itemById.get('audio')!.speedRamp!.find((p) => p.id === 'middle')!.sourceFrame
	).toBe(121);
	await expect.element(point).toHaveFocus();
});

it('renders the source scene selected by a native point-time edit instead of the old scene', async () => {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const video = new VideoSampleSource({ codec: 'avc', bitrate: 500_000 });
	output.addVideoTrack(video, { frameRate: 30 });
	await output.start();
	const canvas = new OffscreenCanvas(64, 64);
	const context = canvas.getContext('2d')!;
	for (let frame = 0; frame < 60; frame++) {
		context.fillStyle = frame < 30 ? '#ff0000' : '#0000ff';
		context.fillRect(0, 0, 64, 64);
		const sample = new VideoSample(canvas, { timestamp: frame / 30, duration: 1 / 30 });
		await video.add(sample);
		sample.close();
	}
	video.close();
	await output.finalize();
	const blob = new Blob([target.buffer!], { type: 'video/mp4' });
	const url = URL.createObjectURL(blob);
	const mediaId = `speed-scene-${crypto.randomUUID()}`;
	mediaPool.upsert(
		{
			id: mediaId,
			storageType: 'cloud',
			remoteUrl: url,
			fileName: 'owned-scenes.mp4',
			fileSize: blob.size,
			mimeType: blob.type,
			duration: 2,
			width: 64,
			height: 64,
			fps: 30,
			codec: 'avc',
			bitrate: 500_000,
			tags: []
		},
		'ready'
	);
	const project = createBlankProject('Decoded speed point');
	project.metadata.width = 64;
	project.metadata.height = 64;
	project.duration = 38 / 30;
	project.timeline!.items = [
		{
			id: 'clip',
			type: 'video',
			label: 'Own scenes',
			trackId: 'track-video-main',
			mediaId,
			from: 0,
			durationInFrames: 38,
			sourceStart: 0,
			sourceEnd: 60,
			sourceFps: 30,
			sourceWidth: 64,
			sourceHeight: 64,
			speedRamp: [
				{ id: 'start', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'middle', sourceFrame: 15, speed: 2, easing: 'hold' },
				{ id: 'end', sourceFrame: 60, speed: 1, easing: 'linear' }
			]
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	async function pixels(frame: number) {
		const renderer = new TimelineFrameRenderer({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		try {
			const rendered = await renderer.render(frame);
			return Array.from(rendered.getContext('2d')!.getImageData(32, 32, 1, 1).data);
		} finally {
			renderer.dispose();
		}
	}
	try {
		const before = await pixels(25);
		expect(before[2]).toBeGreaterThan(220);
		expect(before[0]).toBeLessThan(30);
		const screen = await render(SpeedRampEditor, {
			itemId: 'clip',
			itemIds: ['clip'],
			onedit: vi.fn()
		});
		await screen.getByRole('spinbutton', { name: 'Source frame 2', exact: true }).fill('30');
		await userEvent.keyboard('{Tab}');
		expect(timelineStore.itemById.get('clip')!.durationInFrames).toBe(45);
		const after = await pixels(25);
		expect(after[0]).toBeGreaterThan(220);
		expect(after[2]).toBeLessThan(30);
		const boundary = await pixels(30);
		expect(boundary[2]).toBeGreaterThan(220);
		expect(boundary[0]).toBeLessThan(30);
		commandHistory.undo();
		const undone = await pixels(25);
		expect(undone[2]).toBeGreaterThan(220);
		commandHistory.redo();
		const redone = await pixels(25);
		expect(redone[0]).toBeGreaterThan(220);
	} finally {
		mediaPool.remove(mediaId);
		URL.revokeObjectURL(url);
	}
}, 60000);
