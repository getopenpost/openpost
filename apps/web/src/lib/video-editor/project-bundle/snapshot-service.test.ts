import { describe, expect, it } from 'vitest';
import type { MediaMetadata } from '@openpost/editor-shared/media';
import { createBlankProject } from '../project/defaults';
import type { Project } from '../project/types';
import { computeSnapshotChecksum } from './snapshot-utils';
import { createSnapshotService, type SnapshotServiceRuntime } from './snapshot-service';

function media(id: string, contentHash = 'hash'): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		contentHash,
		fileName: 'launch.mp4',
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: 2,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'avc1',
		bitrate: 1_000_000,
		tags: []
	};
}

function runtime(
	options: {
		available?: MediaMetadata[];
		failAssociation?: boolean;
		failDelete?: boolean;
	} = {}
) {
	const source = createBlankProject('Launch');
	source.timeline!.currentFrame = 12;
	source.timeline!.zoomLevel = 2;
	source.timeline!.scrollPosition = 100;
	source.timeline!.items = [
		{
			id: 'clip',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'launch.mp4',
			type: 'video',
			mediaId: 'source-media'
		}
	];
	const sourceMedia = media('source-media');
	const available = options.available ?? [sourceMedia];
	const created: Project[] = [];
	const deleted: string[] = [];
	const associations: string[] = [];
	const storage: SnapshotServiceRuntime = {
		getProject: async (id) => (id === source.id ? source : undefined),
		createProject: async (project) => {
			created.push(project);
			return project;
		},
		deleteProject: async (id) => {
			deleted.push(id);
			if (options.failDelete) throw new Error('cleanup failed');
		},
		getProjectMediaIds: async () => ['source-media'],
		getMedia: async (id) => (id === sourceMedia.id ? sourceMedia : undefined),
		getAllMedia: async () => available,
		associateMedia: async (_projectId, mediaId) => {
			if (options.failAssociation) throw new Error('association failed');
			associations.push(mediaId);
		}
	};
	return {
		associations,
		created,
		deleted,
		service: createSnapshotService(storage),
		source
	};
}

describe('project snapshot service', () => {
	it('exports media metadata, strips view state, and signs the snapshot', async () => {
		const testRuntime = runtime();
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id, {
			editorVersion: 'test'
		});

		expect(snapshot.mediaReferences).toEqual([
			expect.objectContaining({ id: 'source-media', contentHash: 'hash' })
		]);
		expect(snapshot.project.timeline?.currentFrame).toBeUndefined();
		expect(snapshot.project.timeline?.zoomLevel).toBeUndefined();
		expect(snapshot.checksum).toBe(await computeSnapshotChecksum(snapshot));
	});

	it('imports with fresh document ids and matches renamed media by hash', async () => {
		const currentMedia = media('current-media');
		const testRuntime = runtime({ available: [currentMedia] });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		snapshot.checksum = await computeSnapshotChecksum(snapshot);

		const result = await testRuntime.service.importProjectSnapshot(snapshot, {
			name: 'Imported'
		});

		expect(result.project.id).not.toBe(testRuntime.source.id);
		expect(result.project.name).toBe('Imported');
		expect(result.project.timeline?.items[0]?.id).not.toBe('clip');
		expect(result.project.timeline?.items[0]?.mediaId).toBe('current-media');
		expect(result.matchedMedia).toBe(1);
		expect(result.unmatchedMedia).toEqual([]);
		expect(testRuntime.associations).toEqual(['current-media']);
	});

	it('rejects projects written by a newer editor without creating anything', async () => {
		const testRuntime = runtime();
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		snapshot.project.schemaVersion = 999;
		snapshot.checksum = await computeSnapshotChecksum(snapshot);

		await expect(testRuntime.service.importProjectSnapshot(snapshot)).rejects.toThrow(
			'Update OpenPost before importing it'
		);
		expect(testRuntime.created).toEqual([]);
	});
});
