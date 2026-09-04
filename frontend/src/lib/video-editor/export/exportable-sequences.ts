/** Read-only export snapshots for Main and every reusable sequence. */

import type {
	Project,
	ProjectResolution,
	ProjectTimeline,
	SubComposition,
	TimelineItem
} from '../project/types';
import type { TimelineSnapshot } from '../timeline/commands/types';

export interface ExportableSequence {
	id: string | null;
	name: string;
	durationInFrames: number;
	hasRenderableBackground: boolean;
	project: Project;
}

function copy<T>(value: T): T {
	return structuredClone(value);
}

function durationInFrames(items: readonly TimelineItem[]): number {
	return items.reduce((maximum, item) => Math.max(maximum, item.from + item.durationInFrames), 0);
}

function liveTimeline(snapshot: TimelineSnapshot): ProjectTimeline {
	return {
		tracks: copy(snapshot.tracks),
		items: copy(snapshot.items),
		transitions: copy(snapshot.transitions),
		markers: copy(snapshot.markers),
		inPoint: snapshot.inPoint ?? undefined,
		outPoint: snapshot.outPoint ?? undefined,
		currentFrame: snapshot.currentFrame,
		scrollPosition: snapshot.scrollPosition,
		masterVolumeDb: snapshot.masterVolumeDb,
		masterMuted: snapshot.masterMuted,
		busAudioEq: copy(snapshot.busAudioEq)
	};
}

function effectiveCompositions(
	snapshot: TimelineSnapshot,
	activeSequenceId: string | null
): SubComposition[] {
	return snapshot.sequenceRegistry.compositions.map((composition) => {
		if (composition.id !== activeSequenceId) return copy(composition);
		const timeline = liveTimeline(snapshot);
		const itemDuration = durationInFrames(timeline.items);
		return {
			...copy(composition),
			items: timeline.items,
			tracks: timeline.tracks,
			transitions: timeline.transitions ?? [],
			markers: timeline.markers,
			inPoint: timeline.inPoint ?? null,
			outPoint: timeline.outPoint ?? null,
			masterVolumeDb: timeline.masterVolumeDb,
			masterMuted: timeline.masterMuted,
			busAudioEq: timeline.busAudioEq,
			durationInFrames:
				composition.editorKind === 'composite-2d'
					? Math.max(composition.durationInFrames, itemDuration)
					: itemDuration
		};
	});
}

function projectForTimeline(
	project: Project,
	name: string,
	resolution: ProjectResolution,
	timeline: ProjectTimeline,
	compositions: SubComposition[],
	topLevelSequenceIds: string[],
	explicitDurationInFrames?: number
): Project {
	const frames = explicitDurationInFrames ?? durationInFrames(timeline.items);
	return {
		...copy(project),
		name,
		duration: resolution.fps > 0 ? frames / resolution.fps : 0,
		metadata: copy(resolution),
		timeline: {
			...copy(timeline),
			compositions: copy(compositions),
			topLevelSequenceIds: [...topLevelSequenceIds]
		}
	};
}

export function createExportableSequences(
	project: Project,
	snapshot: TimelineSnapshot,
	activeSequenceId: string | null
): ExportableSequence[] {
	const compositions = effectiveCompositions(snapshot, activeSequenceId);
	const topLevelSequenceIds = snapshot.sequenceRegistry.topLevelSequenceIds;
	const rootTimeline =
		activeSequenceId === null
			? liveTimeline(snapshot)
			: copy(snapshot.sequenceRegistry.rootTimeline);
	const rootResolution = copy(snapshot.sequenceRegistry.rootResolution);
	const rootProject = projectForTimeline(
		project,
		project.name,
		rootResolution,
		rootTimeline,
		compositions,
		topLevelSequenceIds
	);
	const orderedCompositionIds = [
		...topLevelSequenceIds,
		...compositions.map(({ id }) => id)
	].filter((id, index, ids) => ids.indexOf(id) === index);
	const compositionById = new Map(compositions.map((composition) => [composition.id, composition]));

	return [
		{
			id: null,
			name: project.name,
			durationInFrames: durationInFrames(rootTimeline.items),
			hasRenderableBackground: false,
			project: rootProject
		},
		...orderedCompositionIds.flatMap((id): ExportableSequence[] => {
			const composition = compositionById.get(id);
			if (!composition) return [];
			const resolution: ProjectResolution = {
				width: composition.width,
				height: composition.height,
				fps: composition.fps,
				backgroundColor: composition.backgroundColor
			};
			const timeline: ProjectTimeline = {
				tracks: copy(composition.tracks),
				items: copy(composition.items),
				transitions: copy(composition.transitions),
				markers: copy(composition.markers ?? []),
				inPoint: composition.inPoint ?? undefined,
				outPoint: composition.outPoint ?? undefined,
				masterVolumeDb: composition.masterVolumeDb,
				masterMuted: composition.masterMuted,
				busAudioEq: copy(composition.busAudioEq)
			};
			return [
				{
					id,
					name: composition.name,
					durationInFrames: composition.durationInFrames || durationInFrames(composition.items),
					hasRenderableBackground: composition.editorKind === 'composite-2d',
					project: projectForTimeline(
						project,
						composition.name,
						resolution,
						timeline,
						compositions,
						topLevelSequenceIds,
						composition.durationInFrames || durationInFrames(composition.items)
					)
				}
			];
		})
	];
}
