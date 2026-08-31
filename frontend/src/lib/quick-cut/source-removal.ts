import { snapshotProject } from './project';
import type { QuickCutProject, QuickCutSegment, QuickCutSource } from './types';

export interface QuickCutMark {
	sourceId: string;
	time: number;
}

export interface SourceRemovalInput {
	sources: QuickCutSource[];
	segments: QuickCutSegment[];
	project: QuickCutProject | null;
	targetId: string;
	activeSourceId: string | null;
	selectedSegmentId: string | null;
	inPoint: QuickCutMark | null;
	outPoint: QuickCutMark | null;
}

export interface SourceRemovalPlan {
	removedSource: QuickCutSource;
	sources: QuickCutSource[];
	segments: QuickCutSegment[];
	project: QuickCutProject | null;
	activeSourceId: string | null;
	selectedSegmentId: string | null;
	inPoint: QuickCutMark | null;
	outPoint: QuickCutMark | null;
}

export async function prepareSourceRemoval(
	input: SourceRemovalInput,
	persist: (plan: SourceRemovalPlan) => Promise<void>
): Promise<SourceRemovalPlan | null> {
	const removedIndex = input.sources.findIndex((source) => source.id === input.targetId);
	if (removedIndex < 0) return null;

	const removedSource = input.sources[removedIndex]!;
	const sources = input.sources.filter((source) => source.id !== input.targetId);
	const segments = input.segments.filter((segment) => segment.sourceId !== input.targetId);
	const projectSnapshot = input.project ? snapshotProject(input.project) : null;
	const project = projectSnapshot
		? {
				...projectSnapshot,
				sources: sources.map((source) => {
					const { handle: _handle, file: _file, ...metadata } = source;
					return metadata;
				}),
				segments: segments.map((segment) => ({ ...segment }))
			}
		: null;
	const activeSourceId =
		input.activeSourceId === input.targetId
			? (sources[Math.min(removedIndex, sources.length - 1)]?.id ?? null)
			: input.activeSourceId;
	const selectedSegmentId = segments.some((segment) => segment.id === input.selectedSegmentId)
		? input.selectedSegmentId
		: null;
	const plan: SourceRemovalPlan = {
		removedSource,
		sources,
		segments,
		project: sources.length === 0 ? null : project,
		activeSourceId,
		selectedSegmentId,
		inPoint: input.inPoint?.sourceId === input.targetId ? null : input.inPoint,
		outPoint: input.outPoint?.sourceId === input.targetId ? null : input.outPoint
	};

	await persist(plan);
	return plan;
}
