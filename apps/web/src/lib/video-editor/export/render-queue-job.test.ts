import { describe, expect, it } from 'vitest';
import type { ExportPreflightResult } from '../media/export-preflight';
import type {
	Project,
	SubComposition,
	TimelineItem,
	TimelineMarker,
	TimelineTrack
} from '../project/types';
import {
	buildSegmentRenderQueueJobs,
	captureRenderSnapshot,
	rangesFromFixedDuration,
	rangesFromMarkers
} from './render-queue-job';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const nestedItem: TimelineItem = {
	id: 'nested-title',
	trackId: track.id,
	from: 0,
	durationInFrames: 30,
	label: 'Original title',
	type: 'text',
	text: 'Original title'
};

const composition: SubComposition = {
	id: 'intro',
	name: 'Intro',
	items: [nestedItem],
	tracks: [track],
	transitions: [],
	fps: 30,
	width: 1920,
	height: 1080,
	durationInFrames: 30
};

const project: Project = {
	id: 'project',
	name: 'Project',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 1,
	metadata: { width: 1920, height: 1080, fps: 30 },
	timeline: {
		tracks: [track],
		items: [],
		compositions: [composition],
		masterVolumeDb: -3,
		masterMuted: true
	}
};

const preflight: ExportPreflightResult = {
	canExport: true,
	pending: false,
	checks: [],
	range: { startFrame: 0, endFrame: 300, frameCount: 300 },
	predictedRenderPath: 'main-thread',
	estimatedDurationSeconds: 10,
	estimatedFileSizeBytes: 10_000
};

describe('captureRenderSnapshot', () => {
	it('freezes nested compositions with the active timeline', () => {
		const liveComposition = structuredClone(composition);
		const snapshot = captureRenderSnapshot(project, [track], [], [], [liveComposition]);
		liveComposition.items[0]!.label = 'Changed later';

		expect(snapshot.compositions[0]?.items[0]?.label).toBe('Original title');
		expect(snapshot.masterVolumeDb).toBe(-3);
		expect(snapshot.masterMuted).toBe(true);
	});
});

describe('render queue segment planning', () => {
	it('splits only at distinct markers inside the active frame range', () => {
		const markers: TimelineMarker[] = [
			{ id: 'before', frame: 5, color: '#fff' },
			{ id: 'start', frame: 10, color: '#fff' },
			{ id: 'middle', frame: 41.6, color: '#fff' },
			{ id: 'duplicate', frame: 42, color: '#fff' },
			{ id: 'end', frame: 100, color: '#fff' }
		];

		expect(rangesFromMarkers(markers, 10, 100)).toEqual([
			{ startFrame: 10, endFrame: 42 },
			{ startFrame: 42, endFrame: 100 }
		]);
	});

	it('keeps the fixed-duration remainder as the final segment', () => {
		expect(rangesFromFixedDuration(15, 100, 30)).toEqual([
			{ startFrame: 15, endFrame: 45 },
			{ startFrame: 45, endFrame: 75 },
			{ startFrame: 75, endFrame: 100 }
		]);
	});

	it('builds named jobs that share one frozen snapshot', () => {
		const jobs = buildSegmentRenderQueueJobs({
			project,
			settings: {
				format: 'mp4',
				codec: 'avc',
				quality: 'standard',
				width: 1920,
				height: 1080,
				subtitleMode: 'burn'
			},
			preflight,
			tracks: [track],
			items: [],
			transitions: [],
			compositions: [composition],
			ranges: [
				{ startFrame: 0, endFrame: 150 },
				{ startFrame: 150, endFrame: 300 }
			],
			name: (index) => `Project - Part ${index + 1}`
		});

		expect(jobs.map(({ name, settings }) => ({ name, range: settings.range }))).toEqual([
			{ name: 'Project - Part 1', range: { startFrame: 0, endFrame: 150 } },
			{ name: 'Project - Part 2', range: { startFrame: 150, endFrame: 300 } }
		]);
		expect(jobs[0]?.snapshot).toBe(jobs[1]?.snapshot);
	});
});
