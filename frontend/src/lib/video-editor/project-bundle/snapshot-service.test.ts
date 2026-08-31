import { describe, expect, it } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { createBlankProject } from '../project/defaults';
import type { Project, TimelineTransition } from '../project/types';
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
	options: { available?: MediaMetadata[]; failAssociation?: boolean; failDelete?: boolean } = {}
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

		const result = await testRuntime.service.importProjectSnapshot(snapshot, { name: 'Imported' });

		expect(result.project.id).not.toBe(testRuntime.source.id);
		expect(result.project.name).toBe('Imported');
		expect(result.project.timeline?.items[0]?.id).not.toBe('clip');
		expect(result.project.timeline?.items[0]?.mediaId).toBe('current-media');
		expect(result.matchedMedia).toBe(1);
		expect(result.unmatchedMedia).toEqual([]);
		expect(testRuntime.associations).toEqual(['current-media']);
	});

	it('imports FreeCut schema 15 snapshots through the compatibility converter', async () => {
		const testRuntime = runtime();
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		delete snapshot.project.schemaFamily;
		snapshot.project.schemaVersion = 15;
		const freeCutTransition: TimelineTransition = {
			id: 'freecut-transition',
			type: 'crossfade',
			durationInFrames: 12,
			fromItemId: 'clip',
			toItemId: 'clip'
		};
		Object.assign(freeCutTransition, {
			leftClipId: 'clip',
			rightClipId: 'clip',
			trackId: 'track-video-main'
		});
		Reflect.deleteProperty(freeCutTransition, 'fromItemId');
		Reflect.deleteProperty(freeCutTransition, 'toItemId');
		snapshot.project.timeline!.transitions = [freeCutTransition];
		snapshot.checksum = await computeSnapshotChecksum(snapshot);

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.project.schemaVersion).toBe(testRuntime.source.schemaVersion);
		expect(result.project.schemaFamily).toBe('openpost');
		expect(result.project.timeline?.transitions?.[0]).toMatchObject({
			fromItemId: result.project.timeline.items[0]?.id,
			toItemId: result.project.timeline.items[0]?.id
		});
		expect(result.warnings).toContain(
			'Converted FreeCut schema 15 to the OpenPost project format.'
		);
	});

	it('uses an explicit bundle media map without guessing from workspace metadata', async () => {
		const bundledMedia = media('bundled-media', 'different-hash');
		const testRuntime = runtime({ available: [bundledMedia] });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);

		const result = await testRuntime.service.importProjectSnapshot(snapshot, {
			mediaIdMap: new Map([['source-media', 'bundled-media']])
		});

		expect(result.project.timeline?.items[0]?.mediaId).toBe('bundled-media');
		expect(result.unmatchedMedia).toEqual([]);
		expect(testRuntime.associations).toEqual(['bundled-media']);
	});

	it('matches one hashless media record by exact file metadata', async () => {
		const currentMedia = media('current-media', '');
		const testRuntime = runtime({ available: [currentMedia] });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		delete snapshot.mediaReferences[0]!.contentHash;

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.project.timeline?.items[0]?.mediaId).toBe('current-media');
		expect(result.matchedMedia).toBe(1);
	});

	it('does not use file metadata after a content hash mismatch', async () => {
		const currentMedia = media('current-media', 'different-hash');
		const testRuntime = runtime({ available: [currentMedia] });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.matchedMedia).toBe(0);
		expect(result.unmatchedMedia).toHaveLength(1);
		expect(testRuntime.associations).toEqual([]);
	});

	it('does not choose between ambiguous metadata matches', async () => {
		const testRuntime = runtime({
			available: [media('first', ''), media('second', '')]
		});
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		delete snapshot.mediaReferences[0]!.contentHash;

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.matchedMedia).toBe(0);
		expect(result.unmatchedMedia).toHaveLength(1);
	});

	it('warns when the checksum does not match', async () => {
		const testRuntime = runtime();
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);
		snapshot.checksum = 'tampered';

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.warnings).toContain(
			'The snapshot checksum does not match. Review the imported project.'
		);
	});

	it('keeps missing media references recoverable without associating them', async () => {
		const testRuntime = runtime({ available: [] });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);

		const result = await testRuntime.service.importProjectSnapshot(snapshot);

		expect(result.matchedMedia).toBe(0);
		expect(result.unmatchedMedia).toEqual([
			expect.objectContaining({ id: 'source-media', fileName: 'launch.mp4' })
		]);
		expect(result.project.timeline?.items[0]?.mediaId).toBe('source-media');
		expect(testRuntime.associations).toEqual([]);
	});

	it('rolls back a failed media association', async () => {
		const testRuntime = runtime({ failAssociation: true });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);

		await expect(testRuntime.service.importProjectSnapshot(snapshot)).rejects.toThrow(
			'association failed'
		);
		expect(testRuntime.deleted).toEqual([testRuntime.created[0]?.id]);
	});

	it('reports when rollback cannot remove a partial project', async () => {
		const testRuntime = runtime({ failAssociation: true, failDelete: true });
		const snapshot = await testRuntime.service.exportProjectSnapshot(testRuntime.source.id);

		await expect(testRuntime.service.importProjectSnapshot(snapshot)).rejects.toThrow(
			'partial project could not be removed'
		);
		expect(testRuntime.deleted).toEqual([testRuntime.created[0]?.id]);
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

	it('rejects oversized JSON before parsing it', async () => {
		const testRuntime = runtime();
		await expect(
			testRuntime.service.importProjectSnapshotJson(' '.repeat(32 * 1024 * 1024 + 1))
		).rejects.toThrow('larger than 32 MB');
	});
});
