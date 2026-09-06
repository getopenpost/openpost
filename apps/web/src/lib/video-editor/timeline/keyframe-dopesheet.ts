/** Framework-free FreeCut dope-sheet selection, retime, and paste planning. */

import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
import type {
	KeyframeClipboard,
	KeyframeClipboardEntry
} from './stores/keyframe-selection-store.svelte';
import type { KeyframeInsert } from './actions/keyframes';
import { keyframeIdentity, type EditorKeyframe } from './keyframe-editor';

export interface BlockedFrameRange {
	start: number;
	end: number;
}

export interface DopesheetRetimePreview {
	frames: ReadonlyMap<string, number>;
	appliedDeltaFrames: number;
}

export function buildDopesheetRetimePreview({
	keyframes,
	selectionIds,
	lockedProperties,
	requestedDeltaFrames,
	totalFrames,
	blockedRanges
}: {
	keyframes: readonly EditorKeyframe[];
	selectionIds: ReadonlySet<string>;
	lockedProperties: ReadonlySet<KeyframeProperty>;
	requestedDeltaFrames: number;
	totalFrames: number;
	blockedRanges: readonly BlockedFrameRange[];
}): DopesheetRetimePreview {
	const movable = keyframes.filter(
		(keyframe) =>
			selectionIds.has(keyframeIdentity(keyframe)) && !lockedProperties.has(keyframe.property)
	);
	if (movable.length === 0 || requestedDeltaFrames === 0) {
		return { frames: new Map(), appliedDeltaFrames: 0 };
	}

	let minDelta = -Infinity;
	let maxDelta = Infinity;
	const maxFrame = Math.max(0, Math.round(totalFrames) - 1);
	for (const selected of movable) {
		minDelta = Math.max(minDelta, -selected.frame);
		maxDelta = Math.min(maxDelta, maxFrame - selected.frame);
		const lane = keyframes
			.filter((keyframe) => keyframe.property === selected.property)
			.toSorted((left, right) => left.frame - right.frame);
		const index = lane.findIndex(
			(keyframe) => keyframeIdentity(keyframe) === keyframeIdentity(selected)
		);
		for (let previous = index - 1; previous >= 0; previous--) {
			const candidate = lane[previous];
			if (!candidate || selectionIds.has(keyframeIdentity(candidate))) continue;
			minDelta = Math.max(minDelta, candidate.frame + 1 - selected.frame);
			break;
		}
		for (let next = index + 1; next < lane.length; next++) {
			const candidate = lane[next];
			if (!candidate || selectionIds.has(keyframeIdentity(candidate))) continue;
			maxDelta = Math.min(maxDelta, candidate.frame - 1 - selected.frame);
			break;
		}
	}

	const constrained = Math.max(minDelta, Math.min(maxDelta, Math.round(requestedDeltaFrames)));
	const allowed = movable.map((keyframe) => {
		const target = clampAwayFromBlockedRanges(
			keyframe.frame + constrained,
			keyframe.frame,
			blockedRanges
		);
		return Math.max(0, Math.min(maxFrame, target)) - keyframe.frame;
	});
	const commonDelta =
		constrained > 0 ? Math.min(...allowed) : constrained < 0 ? Math.max(...allowed) : 0;
	return {
		frames: new Map(
			movable.map((keyframe) => [keyframeIdentity(keyframe), keyframe.frame + commonDelta])
		),
		appliedDeltaFrames: commonDelta
	};
}

export function shiftRangeSelection(
	keyframes: readonly EditorKeyframe[],
	selection: ReadonlySet<string>,
	property: KeyframeProperty,
	anchorId: string | undefined,
	targetId: string
): Set<string> {
	const next = new Set(selection);
	const lane = keyframes
		.filter((keyframe) => keyframe.property === property)
		.toSorted((left, right) => left.frame - right.frame);
	const anchorIndex = anchorId
		? lane.findIndex((keyframe) => keyframeIdentity(keyframe) === anchorId)
		: -1;
	const targetIndex = lane.findIndex((keyframe) => keyframeIdentity(keyframe) === targetId);
	if (anchorIndex < 0 || targetIndex < 0) {
		next.add(targetId);
		return next;
	}
	for (
		let index = Math.min(anchorIndex, targetIndex);
		index <= Math.max(anchorIndex, targetIndex);
		index++
	) {
		const keyframe = lane[index];
		if (keyframe) next.add(keyframeIdentity(keyframe));
	}
	return next;
}

export interface KeyframePastePlan {
	inserts: KeyframeInsert[];
	skippedUnsupported: number;
	skippedBlocked: number;
}

export function buildKeyframePastePlan({
	clipboard,
	item,
	anchorFrame,
	availableProperties,
	blockedRanges
}: {
	clipboard: KeyframeClipboard;
	item: TimelineItem;
	anchorFrame: number;
	availableProperties: readonly KeyframeProperty[];
	blockedRanges: readonly BlockedFrameRange[];
}): KeyframePastePlan {
	const inserts: KeyframeInsert[] = [];
	let skippedUnsupported = 0;
	let skippedBlocked = 0;
	for (const keyframe of clipboard.keyframes) {
		if (!availableProperties.includes(keyframe.property)) {
			skippedUnsupported++;
			continue;
		}
		const frame = Math.max(
			0,
			Math.min(item.durationInFrames - 1, Math.round(anchorFrame + keyframe.frame))
		);
		if (blockedRanges.some((range) => frame >= range.start && frame < range.end)) {
			skippedBlocked++;
			continue;
		}
		inserts.push(clipboardEntryToInsert(keyframe, frame));
	}
	return { inserts, skippedUnsupported, skippedBlocked };
}

function clipboardEntryToInsert(entry: KeyframeClipboardEntry, frame: number): KeyframeInsert {
	return {
		property: entry.property,
		frame,
		value: entry.value,
		easing: entry.easing,
		...(entry.vectorGroupId && { vectorGroupId: entry.vectorGroupId }),
		...(entry.spatial && {
			spatial: {
				...entry.spatial,
				inTangent: { ...entry.spatial.inTangent },
				outTangent: { ...entry.spatial.outTangent }
			}
		}),
		...(entry.easingConfig && {
			easingConfig: {
				...entry.easingConfig,
				...(entry.easingConfig.bezier && { bezier: { ...entry.easingConfig.bezier } }),
				...(entry.easingConfig.spring && { spring: { ...entry.easingConfig.spring } })
			}
		})
	};
}

function clampAwayFromBlockedRanges(
	frame: number,
	initialFrame: number,
	blockedRanges: readonly BlockedFrameRange[]
): number {
	let candidate = frame;
	let changed = true;
	while (changed) {
		changed = false;
		for (const range of blockedRanges) {
			if (candidate < range.start || candidate >= range.end) continue;
			if (initialFrame < range.start) candidate = range.start - 1;
			else if (initialFrame >= range.end) candidate = range.end;
			else {
				candidate = candidate - range.start < range.end - candidate ? range.start - 1 : range.end;
			}
			changed = true;
		}
	}
	return candidate;
}
