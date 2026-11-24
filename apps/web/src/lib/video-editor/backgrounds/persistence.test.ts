import { describe, expect, it } from 'vitest';
import { createBlankProject, normalizeProject, migrateProjectDocument } from '../project/defaults';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { addBackgroundItem, updateBackground } from '../timeline/actions/backgrounds';

describe('background persistence, clone, migration, undo', () => {
	it('undo restores previous background after update', () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		const project = createBlankProject('Undo');
		timelineStore.setAll({
			tracks: project.timeline!.tracks,
			items: [],
			currentFrame: 0,
			fps: 30
		});
		const id = addBackgroundItem('mesh-sunset');
		const before = timelineStore.itemById.get(id)!.background!;
		expect(before.kind).toBe('mesh-gradient');
		const beforeRotation = before.kind === 'mesh-gradient' ? before.rotation : 0;
		updateBackground(id, { rotation: 45 });
		const after = timelineStore.itemById.get(id)!.background!;
		expect(after.kind === 'mesh-gradient' ? after.rotation : -1).toBe(45);
		commandHistory.undo();
		const undone = timelineStore.itemById.get(id)!.background!;
		expect(undone.kind === 'mesh-gradient' ? undone.rotation : -1).toBe(beforeRotation);
		commandHistory.redo();
		const redone = timelineStore.itemById.get(id)!.background!;
		expect(redone.kind === 'mesh-gradient' ? redone.rotation : -1).toBe(45);
	});
});

describe('shader authored state', () => {
	it('preserves shader controls through undo, redo, normalization and portable serialization', async () => {
		const { portableVideoProjectDocument } = await import('@openpost/video-project');
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		const project = migrateProjectDocument({
			...createBlankProject('Shaders'),
			schemaVersion: 7
		}).project;
		timelineStore.setAll({
			tracks: project.timeline!.tracks,
			items: [],
			currentFrame: 0,
			fps: 30
		});
		const id = addBackgroundItem('shader-aurora');
		const before = timelineStore.itemById.get(id)!.background;
		expect(before?.kind).toBe('shader');
		updateBackground(id, {
			speed: 0,
			phase: 4.5,
			detail: 0.8,
			colors: ['#123456', '#abcdef', '#112233', '#445566']
		});
		const updated = timelineStore.itemById.get(id)!.background;
		expect(updated).toMatchObject({
			kind: 'shader',
			speed: 0,
			phase: 4.5,
			detail: 0.8
		});
		commandHistory.undo();
		expect(timelineStore.itemById.get(id)!.background).toEqual(before);
		commandHistory.redo();
		expect(timelineStore.itemById.get(id)!.background).toEqual(updated);
		project.timeline!.items = [...timelineStore.items];
		const portable = JSON.parse(JSON.stringify(portableVideoProjectDocument(project)));
		const normalized = normalizeProject(portable);
		expect(normalized.project.timeline!.items[0]!.background).toEqual(updated);
	});
});
