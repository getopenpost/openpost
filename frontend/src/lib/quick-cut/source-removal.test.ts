import { describe, expect, it, vi } from 'vitest';
import { createNewProject } from './project';
import { prepareSourceRemoval } from './source-removal';
import type { QuickCutSegment, QuickCutSource } from './types';

function source(id: string): QuickCutSource {
	return {
		id,
		name: `${id}.mov`,
		size: 1024,
		mimeType: 'video/quicktime',
		duration: 10,
		width: 1920,
		height: 1080,
		videoCodec: 'avc',
		audioCodec: null,
		sampleRate: null,
		channels: null,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [0],
		keyframeState: 'known',
		videoStreams: [
			{
				index: 0,
				codec: 'avc',
				width: 1920,
				height: 1080,
				rotation: 0,
				fps: 30,
				keyframeTimestamps: [0],
				keyframeState: 'known'
			}
		],
		audioStreams: []
	};
}

function segment(id: string, sourceId: string): QuickCutSegment {
	return { id, sourceId, start: 0, end: 1 };
}

describe('Quick Cut source removal', () => {
	it('persists a complete cleanup plan before returning it', async () => {
		const sources = [source('a'), source('b'), source('c')];
		const segments = [segment('keep-a', 'a'), segment('remove-b', 'b')];
		const project = createNewProject(sources);
		project.segments = segments;
		const persist = vi.fn(async () => undefined);

		const plan = await prepareSourceRemoval(
			{
				sources,
				segments,
				project,
				targetId: 'b',
				activeSourceId: 'b',
				selectedSegmentId: 'remove-b',
				inPoint: { sourceId: 'b', time: 1 },
				outPoint: { sourceId: 'a', time: 2 }
			},
			persist
		);

		expect(persist).toHaveBeenCalledOnce();
		expect(plan).toMatchObject({
			activeSourceId: 'c',
			selectedSegmentId: null,
			inPoint: null,
			outPoint: { sourceId: 'a', time: 2 }
		});
		expect(plan?.sources.map((item) => item.id)).toEqual(['a', 'c']);
		expect(plan?.segments.map((item) => item.id)).toEqual(['keep-a']);
		expect(plan?.project?.sources.map((item) => item.id)).toEqual(['a', 'c']);
		expect(plan?.project?.segments.map((item) => item.id)).toEqual(['keep-a']);
	});

	it('does not mutate editor state when persistence fails', async () => {
		const sources = [source('a'), source('b')];
		const segments = [segment('keep-a', 'a'), segment('remove-b', 'b')];
		const project = createNewProject(sources);
		project.segments = segments;

		await expect(
			prepareSourceRemoval(
				{
					sources,
					segments,
					project,
					targetId: 'b',
					activeSourceId: 'b',
					selectedSegmentId: 'remove-b',
					inPoint: null,
					outPoint: null
				},
				async () => {
					throw new Error('disk full');
				}
			)
		).rejects.toThrow('disk full');

		expect(sources.map((item) => item.id)).toEqual(['a', 'b']);
		expect(segments.map((item) => item.id)).toEqual(['keep-a', 'remove-b']);
		expect(project.sources.map((item) => item.id)).toEqual(['a', 'b']);
		expect(project.segments.map((item) => item.id)).toEqual(['keep-a', 'remove-b']);
	});
});
