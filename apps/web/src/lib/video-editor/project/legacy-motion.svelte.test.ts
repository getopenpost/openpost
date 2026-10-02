import { afterEach, expect, it } from 'vitest';
import { createBlankProject, migrateProjectDocument } from './defaults';
import type { TimelineItem } from './types';
import { TimelineFrameRenderer } from '../media/render-export';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { readJson, writeJsonAtomic } from '../workspace-fs/fs-primitives';
import { projectJsonPath } from '../workspace-fs/paths';
import type { Project } from './types';

afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('opens legacy generated Motion fills as editable shapes without guessing missing video sources', async () => {
	const stored = createBlankProject('Legacy Motion');
	stored.schemaVersion = 9;
	stored.metadata = { width: 64, height: 64, fps: 30 };
	const solid: TimelineItem = {
		id: 'solid',
		originId: 'authored-solid',
		type: 'video',
		label: 'Cor authored',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 1,
		shapeType: 'rectangle',
		fillColor: '#ff0000',
		keyframes: { opacity: { frames: [0], values: [1] } }
	};
	const gradient: TimelineItem = {
		...solid,
		id: 'gradient',
		originId: 'authored-gradient',
		label: 'Other name',
		from: 1,
		shapeType: undefined,
		fillColor: undefined,
		fillType: 'linear',
		gradientStartColor: '#ff0000',
		gradientEndColor: '#0000ff'
	};
	const untouched: TimelineItem[] = [
		{
			...solid,
			id: 'missing',
			label: 'Solid',
			shapeType: undefined,
			fillColor: undefined,
			from: 5
		},
		{ ...solid, id: 'media', mediaId: 'missing-source', from: 5 },
		{ ...gradient, id: 'reference', compositionId: 'external', from: 5 }
	];
	stored.timeline!.items = [
		{ ...solid, id: 'root', from: 5 },
		{
			id: 'wrapper',
			type: 'composition',
			compositionId: 'motion',
			label: 'Motion',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 2
		}
	];
	stored.timeline!.compositions = [
		{
			id: 'motion',
			name: 'Motion',
			editorKind: 'composite-2d',
			width: 64,
			height: 64,
			fps: 30,
			durationInFrames: 10,
			tracks: stored.timeline!.tracks,
			transitions: [],
			items: [solid, gradient, ...untouched]
		},
		{
			id: 'sequence',
			name: 'Sequence',
			editorKind: 'sequence',
			width: 64,
			height: 64,
			fps: 30,
			durationInFrames: 1,
			tracks: stored.timeline!.tracks,
			transitions: [],
			items: [solid]
		}
	];
	const result = migrateProjectDocument(stored);
	const previousRoot = getWorkspaceRoot();
	const opfs = await navigator.storage.getDirectory();
	const folderName = `legacy-motion-${crypto.randomUUID()}`;
	const root = await opfs.getDirectoryHandle(folderName, { create: true });
	setWorkspaceRoot(root);
	try {
		await writeJsonAtomic(root, projectJsonPath(stored.id), stored);
		const opened = (await getProject(stored.id))!;
		expect(opened.schemaVersion).toBe(10);
		expect((await readJson<Project>(root, projectJsonPath(stored.id)))!.timeline).toEqual(
			opened.timeline
		);
		const backup = await readJson<Project>(root, projectJsonPath(`${stored.id}-backup-v9-v10`));
		expect(backup!.schemaVersion).toBe(9);
		expect(backup!.timeline).toEqual(stored.timeline);
		expect((await getProject(stored.id))!.timeline).toEqual(opened.timeline);
	} finally {
		setWorkspaceRoot(previousRoot);
		await opfs.removeEntry(folderName, { recursive: true });
	}
	const renderer = new TimelineFrameRenderer(result.project);
	try {
		const first = await renderer.render(0);
		expect([...first.getContext('2d')!.getImageData(8, 32, 1, 1).data]).toEqual([255, 0, 0, 255]);
		const second = await renderer.render(1);
		const context = second.getContext('2d')!;
		expect(context.getImageData(8, 32, 1, 1).data[0]).toBeGreaterThan(200);
		expect(context.getImageData(56, 32, 1, 1).data[2]).toBeGreaterThan(200);
	} finally {
		renderer.dispose();
	}
	const items = result.project.timeline!.compositions![0]!.items;
	expect(items[0]).toEqual({ ...solid, type: 'shape' });
	expect(items[1]).toEqual({ ...gradient, type: 'shape', shapeType: 'rectangle' });
	expect(items.slice(2)).toEqual(untouched);
	expect(result.project.timeline!.items[0]).toEqual(stored.timeline!.items[0]);
	expect(result.project.timeline!.compositions![1]!.items).toEqual([solid]);
	expect(stored.timeline!.compositions![0]!.items[0]!.type).toBe('video');
	expect(migrateProjectDocument(result.project).appliedMigrations).toEqual([]);
	sequenceStore.load(result.project.timeline!, result.project.metadata);
	sequenceStore.switchTo('motion');
	updateItemProperties('solid', { fillColor: '#00ff00' });
	expect(timelineStore.itemById.get('solid')!.fillColor).toBe('#00ff00');
	commandHistory.undo();
	expect(timelineStore.itemById.get('solid')).toEqual(items[0]);
	commandHistory.redo();
	expect(timelineStore.itemById.get('solid')!.keyframes).toEqual(solid.keyframes);
});
