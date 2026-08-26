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
		contentFingerprint: 'a'.repeat(64)
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

	it('rejects segments that reference a missing source', () => {
		const project = createNewProject([source()]);
		project.segments = [createSegment(0, 1, { id: 'missing', sourceId: 'removed' })];
		expect(() => parseProject(JSON.stringify(project))).toThrow(/missing source/iu);
	});

	it('rejects duplicate source IDs', () => {
		const project = createNewProject([source(), source()]);
		expect(() => parseProject(JSON.stringify(project))).toThrow(/duplicate source/iu);
	});
});
