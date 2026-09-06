import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { frameToSourceSeconds } from '../media/render-plan';
import { resolveTransitionWindow } from '../timeline/transition-planner';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';

export interface PreviewPrewarmTarget {
	itemId: string;
	mediaId: string;
	timestampSeconds: number;
	boundaryFrame: number;
}

/** Replan five times per second during playback, while edits still invalidate reactively. */
export function previewPrewarmPlanningFrame(frame: number, fps: number): number {
	const safeFrame = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0));
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	const stepFrames = Math.max(1, Math.round(safeFps / 5));
	return Math.floor(safeFrame / stepFrames) * stepFrames;
}

interface Candidate extends PreviewPrewarmTarget {
	rootBoundary: number;
}

interface TimelineVisit {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
	fps: number;
	localStart: number;
	localEnd: number;
	rootStart: number;
	rootEnd: number;
	toRootFrame: (localFrame: number) => number;
	path: string;
	ancestry: ReadonlySet<string>;
}

function visibleTrackIds(tracks: readonly TimelineTrack[]): Set<string> {
	return new Set(
		effectiveMediaTracks([...tracks])
			.filter((track) => track.visible)
			.map((track) => track.id)
	);
}

function incomingBoundaries(
	items: readonly TimelineItem[],
	itemsById: ReadonlyMap<string, TimelineItem>,
	transitions: readonly TimelineTransition[]
): ReadonlyMap<string, number> {
	const boundaries = new Map(items.map((item) => [item.id, item.from]));
	for (const transition of transitions) {
		const outgoing = itemsById.get(transition.fromItemId);
		const incoming = itemsById.get(transition.toItemId);
		if (!outgoing || !incoming) continue;
		const window = resolveTransitionWindow(transition, outgoing, incoming);
		if (!window) continue;
		boundaries.set(
			incoming.id,
			Math.min(boundaries.get(incoming.id) ?? incoming.from, window.startFrame)
		);
	}
	return boundaries;
}

function transitionParticipantsAtFrame(
	frame: number,
	itemsById: ReadonlyMap<string, TimelineItem>,
	transitions: readonly TimelineTransition[]
): ReadonlySet<string> {
	const participants = new Set<string>();
	for (const transition of transitions) {
		const outgoing = itemsById.get(transition.fromItemId);
		const incoming = itemsById.get(transition.toItemId);
		if (!outgoing || !incoming) continue;
		const window = resolveTransitionWindow(transition, outgoing, incoming);
		if (!window || frame < window.startFrame || frame >= window.endFrame) continue;
		participants.add(outgoing.id);
		participants.add(incoming.id);
	}
	return participants;
}

function nestedFrameAtParentFrame(
	wrapper: TimelineItem,
	parentFrame: number,
	parentFps: number,
	composition: SubComposition
): number {
	const sourceFps =
		wrapper.sourceFps && wrapper.sourceFps > 0 ? wrapper.sourceFps : composition.fps;
	const speed = wrapper.speed && wrapper.speed > 0 ? wrapper.speed : 1;
	const sourceStart = wrapper.sourceStart ?? 0;
	const raw = sourceStart + ((parentFrame - wrapper.from) / parentFps) * speed * sourceFps;
	const sourceEnd = Math.min(
		wrapper.sourceEnd ?? composition.durationInFrames,
		composition.durationInFrames
	);
	return Math.min(sourceEnd, Math.max(0, raw));
}

function parentFrameForNestedFrame(
	wrapper: TimelineItem,
	nestedFrame: number,
	parentFps: number,
	composition: SubComposition
): number {
	const sourceFps =
		wrapper.sourceFps && wrapper.sourceFps > 0 ? wrapper.sourceFps : composition.fps;
	const speed = wrapper.speed && wrapper.speed > 0 ? wrapper.speed : 1;
	return (
		wrapper.from + ((nestedFrame - (wrapper.sourceStart ?? 0)) / sourceFps / speed) * parentFps
	);
}

function activeLeafTargets(options: {
	composition: SubComposition;
	frame: number;
	compositionsById: ReadonlyMap<string, SubComposition>;
	ancestry: ReadonlySet<string>;
	path: string;
}): Array<Omit<PreviewPrewarmTarget, 'boundaryFrame'>> {
	const { composition, frame, compositionsById, ancestry, path } = options;
	const visibleTracks = visibleTrackIds(composition.tracks);
	const itemsById = new Map(composition.items.map((item) => [item.id, item]));
	const transitionParticipants = transitionParticipantsAtFrame(
		frame,
		itemsById,
		composition.transitions
	);
	const targets: Array<Omit<PreviewPrewarmTarget, 'boundaryFrame'>> = [];
	for (const item of composition.items) {
		if (!visibleTracks.has(item.trackId)) continue;
		if (
			(frame < item.from || frame >= item.from + item.durationInFrames) &&
			!transitionParticipants.has(item.id)
		)
			continue;
		const itemId = `${path}${item.id}`;
		if (item.type === 'video' && item.mediaId) {
			targets.push({
				itemId,
				mediaId: item.mediaId,
				timestampSeconds: Math.max(0, frameToSourceSeconds(item, frame, composition.fps))
			});
			continue;
		}
		if (item.type !== 'composition' || !item.compositionId || ancestry.has(item.compositionId)) {
			continue;
		}
		const nested = compositionsById.get(item.compositionId);
		if (!nested) continue;
		targets.push(
			...activeLeafTargets({
				composition: nested,
				frame: nestedFrameAtParentFrame(item, frame, composition.fps, nested),
				compositionsById,
				ancestry: new Set([...ancestry, item.compositionId]),
				path: `${itemId}/`
			})
		);
	}
	return targets;
}

export function collectPreviewPrewarmTargets(input: {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	currentFrame: number;
	minimumBoundaryFrame?: number;
	fps: number;
	transitions?: readonly TimelineTransition[];
	compositions?: readonly SubComposition[];
	lookaheadSeconds?: number;
	limit?: number;
}): PreviewPrewarmTarget[] {
	const lookaheadFrames = Math.max(1, Math.round((input.lookaheadSeconds ?? 2.5) * input.fps));
	const limit = Math.max(0, Math.floor(input.limit ?? 2));
	if (limit === 0) return [];
	const minimumBoundary = Math.max(
		input.currentFrame,
		input.minimumBoundaryFrame ?? input.currentFrame
	);
	const rootEnd = input.currentFrame + lookaheadFrames;
	const compositionsById = new Map(
		(input.compositions ?? []).map((composition) => [composition.id, composition])
	);
	const candidates: Candidate[] = [];
	const candidateKey = (candidate: Pick<Candidate, 'mediaId' | 'timestampSeconds'>): string =>
		`${candidate.mediaId}:${candidate.timestampSeconds.toFixed(6)}`;
	const compareCandidates = (left: Candidate, right: Candidate): number =>
		left.rootBoundary - right.rootBoundary || left.itemId.localeCompare(right.itemId);
	const keepCandidate = (candidate: Candidate): void => {
		const key = candidateKey(candidate);
		const existingIndex = candidates.findIndex((entry) => candidateKey(entry) === key);
		if (existingIndex >= 0) {
			if (compareCandidates(candidate, candidates[existingIndex]!) < 0) {
				candidates[existingIndex] = candidate;
			}
			return;
		}
		if (candidates.length < limit) {
			candidates.push(candidate);
			return;
		}
		let worstIndex = 0;
		for (let index = 1; index < candidates.length; index++) {
			if (compareCandidates(candidates[index]!, candidates[worstIndex]!) > 0) worstIndex = index;
		}
		if (compareCandidates(candidate, candidates[worstIndex]!) < 0)
			candidates[worstIndex] = candidate;
	};

	const addTarget = (
		target: Omit<PreviewPrewarmTarget, 'boundaryFrame'>,
		rootBoundary: number,
		rootStart: number,
		rootLimit: number
	): void => {
		if (
			rootBoundary <= minimumBoundary ||
			rootBoundary < rootStart ||
			rootBoundary > rootLimit ||
			rootBoundary > rootEnd
		)
			return;
		keepCandidate({
			...target,
			rootBoundary,
			boundaryFrame: Math.max(0, Math.floor(rootBoundary))
		});
	};

	const visit = (timeline: TimelineVisit): void => {
		const visibleTracks = visibleTrackIds(timeline.tracks);
		const itemsById = new Map(timeline.items.map((item) => [item.id, item]));
		const boundaryById = incomingBoundaries(timeline.items, itemsById, timeline.transitions);
		for (const item of timeline.items) {
			if (!visibleTracks.has(item.trackId)) continue;
			const boundary = boundaryById.get(item.id) ?? item.from;
			if (item.type === 'video' && item.mediaId) {
				if (boundary < timeline.localStart || boundary > timeline.localEnd) continue;
				addTarget(
					{
						itemId: `${timeline.path}${item.id}`,
						mediaId: item.mediaId,
						timestampSeconds: Math.max(0, frameToSourceSeconds(item, boundary, timeline.fps))
					},
					timeline.toRootFrame(boundary),
					timeline.rootStart,
					timeline.rootEnd
				);
				continue;
			}
			if (
				item.type !== 'composition' ||
				!item.compositionId ||
				timeline.ancestry.has(item.compositionId)
			)
				continue;
			const composition = compositionsById.get(item.compositionId);
			if (!composition) continue;
			const localEntry = Math.max(timeline.localStart, boundary);
			const localExit = Math.min(timeline.localEnd, item.from + item.durationInFrames);
			if (localExit < localEntry) continue;
			const rootEntry = timeline.toRootFrame(localEntry);
			const rootExit = timeline.toRootFrame(localExit);
			const childRootStart = Math.max(timeline.rootStart, Math.min(rootEntry, rootExit));
			const childRootEnd = Math.min(timeline.rootEnd, Math.max(rootEntry, rootExit));
			if (childRootEnd <= minimumBoundary || childRootStart > rootEnd) continue;

			const nestedEntry = nestedFrameAtParentFrame(item, localEntry, timeline.fps, composition);
			const nestedExit = nestedFrameAtParentFrame(item, localExit, timeline.fps, composition);
			if (rootEntry > minimumBoundary) {
				for (const target of activeLeafTargets({
					composition,
					frame: nestedEntry,
					compositionsById,
					ancestry: new Set([...timeline.ancestry, item.compositionId]),
					path: `${timeline.path}${item.id}/`
				})) {
					addTarget(target, rootEntry, childRootStart, childRootEnd);
				}
			}

			visit({
				items: composition.items,
				tracks: composition.tracks,
				transitions: composition.transitions,
				fps: composition.fps,
				localStart: Math.min(nestedEntry, nestedExit),
				localEnd: Math.max(nestedEntry, nestedExit),
				rootStart: childRootStart,
				rootEnd: childRootEnd,
				toRootFrame: (nestedFrame) =>
					timeline.toRootFrame(
						parentFrameForNestedFrame(item, nestedFrame, timeline.fps, composition)
					),
				path: `${timeline.path}${item.id}/`,
				ancestry: new Set([...timeline.ancestry, item.compositionId])
			});
		}
	};

	visit({
		items: input.items,
		tracks: input.tracks,
		transitions: input.transitions ?? [],
		fps: input.fps,
		localStart: input.currentFrame,
		localEnd: rootEnd,
		rootStart: input.currentFrame,
		rootEnd,
		toRootFrame: (frame) => frame,
		path: '',
		ancestry: new Set()
	});

	return candidates.toSorted(compareCandidates).map(({ rootBoundary: _, ...target }) => target);
}
