import { describe, expect, it } from 'vitest';
import { createNewProject, parseProject, serializeProject } from './project';
import { createSegment } from './model';
import type { QuickCutSourceMetadata } from './types';

function source(id = 'source-a'): QuickCutSourceMetadata {
	return {
		id,
		name: 'source.mp4',
		size: 1024,
		mimeType: 'video/mp4',
		duration: 10,
		width: 1920,
		height: 1080,
		videoCodec: 'avc',
		audioCodec: 'aac',
		sampleRate: 48_000,
		channels: 2,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [0, 5],
		keyframeState: 'known',
		lastModified: 1,
		contentFingerprint: 'a'.repeat(64),
		videoStreams: [{ index: 0, codec: 'avc', width: 1920, height: 1080, rotation: 0, fps: 30 }],
		audioStreams: [{ index: 0, codec: 'aac', sampleRate: 48_000, channels: 2 }]
	};
}

describe('quick-cut project parsing', () => {
	it('round-trips an ordered multi-source edit', () => {
		const project = createNewProject([source('a'), source('b')]);
		project.segments = [
			createSegment(0, 1, { id: 'a1', sourceId: 'a' }),
			createSegment(0, 1, { id: 'b1', sourceId: 'b' }),
			createSegment(1, 2, { id: 'a2', sourceId: 'a' })
		];
		expect(parseProject(serializeProject(project)).segments.map((segment) => segment.id)).toEqual([
			'a1',
			'b1',
			'a2'
		]);
	});

	it('round-trips per-segment cut strategies and keeps older segments on the project mode', () => {
		const project = createNewProject([source()]);
		project.cutMode = 'nearestKeyframe';
		project.segments = [
			createSegment(0, 1, { id: 'project-mode', sourceId: 'source-a' }),
			createSegment(1, 2, { id: 'exact', sourceId: 'source-a', cutMode: 'exact' })
		];

		const parsed = parseProject(serializeProject(project));
		expect(parsed.segments[0]).toEqual(expect.objectContaining({ id: 'project-mode' }));
		expect(parsed.segments[0]).not.toHaveProperty('cutMode');
		expect(parsed.segments[1]).toEqual(expect.objectContaining({ id: 'exact', cutMode: 'exact' }));
	});

	it('rejects segments that reference a missing source', () => {
		const project = createNewProject([source()]);
		project.segments = [createSegment(0, 1, { id: 'missing', sourceId: 'removed' })];
		expect(() => parseProject(JSON.stringify(project))).toThrow(/missing source/iu);
	});

	it('rejects duplicate source IDs', () => {
		const project = createNewProject([source(), source()]);
		expect(() => parseProject(JSON.stringify(project))).toThrow(/duplicate source/iu);
	});

	it('round-trips per-source stream selections', () => {
		const s = source();
		s.selectedVideoTrackIndex = null;
		s.selectedAudioTrackIndices = [];
		// need at least one track selected, so allow audio off is invalid, use video on
		s.selectedVideoTrackIndex = 0;
		s.selectedAudioTrackIndices = [];
		const project = createNewProject([s]);
		project.segments = [createSegment(0, 1, { id: 'only', sourceId: s.id })];
		const parsed = parseProject(serializeProject(project));
		expect(parsed.sources[0]?.selectedVideoTrackIndex).toBe(0);
		expect(parsed.sources[0]?.selectedAudioTrackIndices).toEqual([]);
	});

	it('parses older projects without stream fields', () => {
		const legacy = {
			version: 1,
			id: 'proj',
			name: 'Legacy',
			sources: [
				{
					id: 'a',
					name: 'a.mp4',
					size: 100,
					mimeType: 'video/mp4',
					duration: 5,
					width: 1280,
					height: 720,
					videoCodec: 'avc',
					audioCodec: 'aac',
					sampleRate: 48000,
					channels: 2,
					rotation: 0,
					fps: 30,
					keyframeTimestamps: [0],
					keyframeState: 'known'
				}
			],
			segments: [{ id: 's1', sourceId: 'a', start: 0, end: 1 }],
			cutMode: 'nearestKeyframe',
			merge: false,
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		const parsed = parseProject(JSON.stringify(legacy));
		expect(parsed.sources[0]?.videoStreams).toEqual([]);
		expect(parsed.sources[0]?.audioStreams).toEqual([]);
	});

	it('rejects invalid stream selections', () => {
		const s = source();
		s.selectedVideoTrackIndex = 5;
		const project = createNewProject([s]);
		project.segments = [createSegment(0, 1, { id: 'seg', sourceId: s.id })];
		expect(() => parseProject(JSON.stringify(project))).toThrow(/does not exist/i);
	});
});
