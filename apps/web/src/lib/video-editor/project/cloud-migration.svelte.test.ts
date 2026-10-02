import { afterEach, expect, it, vi } from 'vitest';
import { portableVideoProjectDocument } from '@openpost/video-project';
import { createBlankProject } from './defaults';
import type { Project } from './types';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import {
	CloudVideoProjectRepository,
	CloudVideoProjectConflictError,
	type CloudVideoProject
} from '../cloud/project-repository';

afterEach(() => {
	editorSession.stopAutosaveTimers();
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	vi.restoreAllMocks();
});

it('keeps a migrated Cloud edit usable through offline save failure and revision conflict, then persists it', async () => {
	const stored = createBlankProject('Old Cloud Motion');
	stored.schemaVersion = 9;
	stored.timeline!.compositions = [
		{
			id: 'motion',
			name: 'Motion',
			editorKind: 'composite-2d',
			width: 1920,
			height: 1080,
			fps: 30,
			durationInFrames: 30,
			tracks: stored.timeline!.tracks,
			transitions: [],
			items: [
				{
					id: 'solid',
					type: 'video',
					shapeType: 'rectangle',
					fillColor: '#ff0000',
					label: 'Edited name',
					trackId: 'track-video-main',
					from: 0,
					durationInFrames: 30
				}
			]
		}
	];
	const cloud: CloudVideoProject<Project> = {
		id: stored.id,
		workspaceId: 'migration-workspace',
		name: stored.name,
		headRevision: 7,
		document: structuredClone(stored),
		syncStatus: 'synced',
		attentionReason: '',
		trashedAt: '',
		updatedAt: ''
	};
	vi.spyOn(CloudVideoProjectRepository.prototype, 'get').mockResolvedValue(cloud);
	vi.spyOn(CloudVideoProjectRepository.prototype, 'listMedia').mockResolvedValue([]);
	const save = vi
		.spyOn(CloudVideoProjectRepository.prototype, 'save')
		.mockRejectedValueOnce(new Error('Offline'))
		.mockImplementationOnce(async (_head, next) => {
			throw new CloudVideoProjectConflictError('migration-conflict', next);
		})
		.mockImplementationOnce(async (head, next) => {
			expect(head.headRevision).toBe(7);
			expect(head.document.schemaVersion).toBe(9);
			head.document = portableVideoProjectDocument(next);
			head.headRevision = 8;
		});
	await editorSession.load(stored.id, cloud.workspaceId);
	expect(editorSession.loadError).toBe('');
	expect(editorSession.project!.schemaVersion).toBe(10);
	expect(editorSession.project!.timeline!.compositions![0]!.items[0]!.type).toBe('shape');
	expect(editorSession.projectDirty).toBe(true);
	expect(cloud.document.schemaVersion).toBe(9);
	expect(cloud.headRevision).toBe(7);
	await expect(editorSession.flushAutosave()).rejects.toThrow('Offline');
	expect(editorSession.projectDirty).toBe(true);
	expect(editorSession.loadError).toBe('');
	expect(editorSession.project!.schemaVersion).toBe(10);
	await expect(editorSession.flushAutosave()).rejects.toBeInstanceOf(
		CloudVideoProjectConflictError
	);
	expect(editorSession.saveConflict).toBe(true);
	expect(editorSession.project!.timeline!.compositions![0]!.items[0]!.type).toBe('shape');
	expect(cloud.document).toEqual(stored);
	await editorSession.flushAutosave();
	expect(editorSession.projectDirty).toBe(false);
	expect(editorSession.saveConflict).toBe(false);
	expect(cloud.document.schemaVersion).toBe(10);
	expect(cloud.document.timeline!.compositions![0]!.items[0]!.type).toBe('shape');
	expect(save).toHaveBeenCalledTimes(3);
	await editorSession.load(stored.id, cloud.workspaceId);
	expect(editorSession.project!.schemaVersion).toBe(10);
	expect(editorSession.projectDirty).toBe(false);
	expect(save).toHaveBeenCalledTimes(3);
});
