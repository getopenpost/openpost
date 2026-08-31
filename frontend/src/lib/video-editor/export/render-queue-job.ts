import type {
	Project,
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import type { AudioEqSettings } from '../audio/types';
import type { ExportPreflightResult } from '../media/export-preflight';
import type {
	RenderQueueJob,
	RenderQueueSettings,
	RenderQueueSnapshot
} from './render-queue-store';

function cloneTimeline<T>(value: T): T {
	return structuredClone(value);
}

export interface RenderQueueRange {
	startFrame: number;
	endFrame: number;
}

interface RenderQueueJobBuildOptions {
	project: Project;
	settings: Omit<RenderQueueSettings, 'range'>;
	preflight: ExportPreflightResult;
	tracks: readonly TimelineTrack[];
	items: readonly TimelineItem[];
	transitions: readonly TimelineTransition[];
	compositions: readonly SubComposition[];
	masterVolumeDb?: number;
	masterMuted?: boolean;
	busAudioEq?: AudioEqSettings;
}

export function captureRenderSnapshot(
	project: Project,
	tracks: readonly TimelineTrack[],
	items: readonly TimelineItem[],
	transitions: readonly TimelineTransition[],
	compositions: readonly SubComposition[],
	masterVolumeDb = project.timeline?.masterVolumeDb ?? 0,
	masterMuted = project.timeline?.masterMuted ?? false,
	busAudioEq = project.timeline?.busAudioEq
): RenderQueueSnapshot {
	return {
		projectId: project.id,
		projectName: project.name,
		fps: project.metadata.fps,
		width: project.metadata.width,
		height: project.metadata.height,
		backgroundColor: project.metadata.backgroundColor,
		tracks: cloneTimeline([...tracks]),
		items: cloneTimeline([...items]),
		transitions: cloneTimeline([...transitions]),
		compositions: cloneTimeline([...compositions]),
		masterVolumeDb,
		masterMuted,
		busAudioEq: busAudioEq ? cloneTimeline(busAudioEq) : undefined
	};
}

function assembleRenderQueueJob(
	options: RenderQueueJobBuildOptions,
	snapshot: RenderQueueSnapshot,
	range: RenderQueueRange,
	name: string
): RenderQueueJob {
	return {
		id: crypto.randomUUID(),
		projectId: options.project.id,
		name,
		status: 'queued',
		progress: 0,
		settings: { ...options.settings, range },
		snapshot,
		createdAt: Date.now()
	};
}

function captureFromOptions(options: RenderQueueJobBuildOptions): RenderQueueSnapshot {
	return captureRenderSnapshot(
		options.project,
		options.tracks,
		options.items,
		options.transitions,
		options.compositions,
		options.masterVolumeDb,
		options.masterMuted,
		options.busAudioEq
	);
}

function assertQueueable(preflight: ExportPreflightResult): void {
	if (!preflight.canExport) throw new Error('Export preflight must pass before queueing.');
}

export function buildRenderQueueJob(options: RenderQueueJobBuildOptions): RenderQueueJob {
	assertQueueable(options.preflight);
	return assembleRenderQueueJob(
		options,
		captureFromOptions(options),
		{
			startFrame: options.preflight.range.startFrame,
			endFrame: options.preflight.range.endFrame
		},
		options.project.name
	);
}

export function buildSegmentRenderQueueJobs(
	options: RenderQueueJobBuildOptions & {
		ranges: readonly RenderQueueRange[];
		name: (index: number, range: RenderQueueRange) => string;
	}
): RenderQueueJob[] {
	assertQueueable(options.preflight);
	const snapshot = captureFromOptions(options);
	return options.ranges.flatMap((range, index) =>
		range.endFrame > range.startFrame
			? [assembleRenderQueueJob(options, snapshot, range, options.name(index, range))]
			: []
	);
}

export function rangesFromMarkers(
	markers: readonly { frame: number }[],
	rangeStart: number,
	rangeEnd: number
): RenderQueueRange[] {
	if (rangeEnd <= rangeStart) return [];
	const cuts = [
		rangeStart,
		...markers
			.map((marker) => Math.round(marker.frame))
			.filter((frame) => frame > rangeStart && frame < rangeEnd),
		rangeEnd
	];
	const unique = [...new Set(cuts)].sort((left, right) => left - right);
	const ranges: RenderQueueRange[] = [];
	for (let index = 0; index < unique.length - 1; index += 1) {
		const startFrame = unique[index]!;
		const endFrame = unique[index + 1]!;
		if (endFrame > startFrame) ranges.push({ startFrame, endFrame });
	}
	return ranges;
}

export function rangesFromFixedDuration(
	rangeStart: number,
	rangeEnd: number,
	chunkFrames: number
): RenderQueueRange[] {
	if (rangeEnd <= rangeStart || chunkFrames <= 0 || !Number.isFinite(chunkFrames)) return [];
	const size = Math.max(1, Math.round(chunkFrames));
	const ranges: RenderQueueRange[] = [];
	for (let startFrame = rangeStart; startFrame < rangeEnd; startFrame += size) {
		ranges.push({ startFrame, endFrame: Math.min(startFrame + size, rangeEnd) });
	}
	return ranges;
}
