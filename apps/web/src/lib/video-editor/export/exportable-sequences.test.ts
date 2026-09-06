import { describe, expect, it } from 'vitest';
import type { Project, SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import type { TimelineSnapshot } from '../timeline/commands/types';
import { createExportableSequences } from './exportable-sequences';

const tracks: TimelineTrack[] = [
	{
		id: 'visuals',
		name: 'Visuals',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	}
];

function shape(id: string, durationInFrames: number): TimelineItem {
	return {
		id,
		trackId: 'visuals',
		from: 0,
		durationInFrames,
		label: id,
		type: 'shape',
		shapeType: 'rectangle'
	};
}

function composition(
	id: string,
	name: string,
	width: number,
	durationInFrames: number
): SubComposition {
	return {
		id,
		name,
		editorKind: 'sequence',
		items: [shape(`${id}-stored`, durationInFrames)],
		tracks,
		transitions: [],
		fps: 24,
		width,
		height: 1920,
		durationInFrames
	};
}

describe('createExportableSequences', () => {
	it('captures every sequence without replacing the active editor timeline', () => {
		const active = composition('sequence-a', 'Portrait cut', 1080, 48);
		const nested = composition('sequence-b', 'Logo motion', 800, 36);
		nested.editorKind = 'composite-2d';
		nested.durationInFrames = 240;
		const project: Project = {
			id: 'project',
			name: 'Launch film',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			duration: 4,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#111111' },
			timeline: {
				tracks,
				items: [shape('root-stored', 120)],
				compositions: [active, nested],
				topLevelSequenceIds: [active.id]
			}
		};
		const snapshot: TimelineSnapshot = {
			items: [shape('sequence-a-live', 72)],
			tracks,
			transitions: [],
			markers: [{ id: 'live-marker', frame: 20, color: '#fff' }],
			inPoint: 10,
			outPoint: 60,
			fps: 24,
			scrollPosition: 0,
			snapEnabled: true,
			currentFrame: 12,
			masterVolumeDb: -3,
			masterMuted: false,
			sequenceRegistry: {
				compositions: [active, nested],
				topLevelSequenceIds: [active.id],
				rootTimeline: {
					tracks,
					items: [shape('root-held', 120)],
					markers: [{ id: 'root-marker', frame: 40, color: '#fff' }]
				},
				rootResolution: project.metadata,
				sequenceViewById: {}
			}
		};
		const before = structuredClone(snapshot);

		const result = createExportableSequences(project, snapshot, active.id);

		expect(result.map(({ id, name }) => [id, name])).toEqual([
			[null, 'Launch film'],
			['sequence-a', 'Portrait cut'],
			['sequence-b', 'Logo motion']
		]);
		expect(result[0]?.project.timeline?.items[0]?.id).toBe('root-held');
		expect(result[1]?.project.timeline?.items[0]?.id).toBe('sequence-a-live');
		expect(result[1]?.project.metadata).toEqual({
			width: 1080,
			height: 1920,
			fps: 24,
			backgroundColor: undefined
		});
		expect(result[1]?.durationInFrames).toBe(72);
		expect(result[2]?.project.timeline?.items[0]?.id).toBe('sequence-b-stored');
		expect(result[2]?.durationInFrames).toBe(240);
		expect(result[2]?.project.duration).toBe(10);
		expect(result[2]?.hasRenderableBackground).toBe(true);
		expect(snapshot).toEqual(before);
	});
});
